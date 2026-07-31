const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppScripts } = require('../helpers/load-app.cjs');

function createHarness(initialRecord = null) {
  let record = initialRecord;
  let saves = 0;
  const removals = [];
  const saveOptions = [];
  const context = loadAppScripts(['js/drafts/draft-manager.js'], {
    console: { warn() {} },
    DraftStore: {
      async get() {
        return record;
      },
      async save(target, data, options) {
        saves += 1;
        saveOptions.push(options);
        const expected = options.expectedRevision;
        const currentRevision = record ? record.revision : null;
        if (expected !== currentRevision) {
          const error = new Error('Conflitto bozza');
          error.name = 'DraftStoreError';
          error.code = 'DRAFT_CONFLICT';
          error.currentRevision = currentRevision;
          error.currentWriterId = record ? record.writerId : null;
          throw error;
        }
        record = {
          ...target,
          data,
          writerId: options.writerId,
          revision: record ? record.revision + 1 : 1,
          updatedAt: Date.now()
        };
        return record;
      },
      async remove(target, options) {
        removals.push({ target, options });
        if (!record || record.revision !== options.expectedRevision) return false;
        record = null;
        return true;
      }
    }
  });
  return {
    context,
    saves: () => saves,
    saveOptions,
    removals,
    record: () => record,
    setRecord(value) {
      record = value;
    }
  };
}

test('compatta gli input ravvicinati in un solo autosalvataggio', async () => {
  const harness = createHarness();
  let value = 'Pane';
  const statuses = [];
  const session = harness.context.DraftManager.open({
    target: { mode: 'create', draftId: 'sessione-a' },
    delay: 10,
    read: () => ({ recipe: { name: value } }),
    isDirty: () => true,
    onStatus: status => statuses.push(status)
  });

  session.schedule();
  value = 'Pane rustico';
  session.schedule();
  value = 'Pane rustico finale';
  session.schedule();
  await new Promise(resolve => setTimeout(resolve, 30));
  await session.flush();

  assert.equal(harness.saves(), 1);
  assert.equal(harness.saveOptions[0].expectedRevision, null);
  assert.equal(harness.record().data.recipe.name, 'Pane rustico finale');
  assert.equal(statuses.includes('pending'), true);
  assert.equal(statuses.includes('saved'), true);
});

test('ripristina e scarta soltanto la revisione letta', async () => {
  const initial = {
    mode: 'edit',
    recipeId: 'ricetta-1',
    draftId: 'sessione-a',
    data: { recipe: { name: 'Bozza' } },
    revision: 4,
    updatedAt: Date.now()
  };
  const harness = createHarness(initial);
  const statuses = [];
  const session = harness.context.DraftManager.open({
    target: { mode: 'edit', recipeId: 'ricetta-1', draftId: 'sessione-a' },
    read: () => initial.data,
    isDirty: () => true,
    onStatus: status => statuses.push(status)
  });

  const restored = await session.restore();
  assert.equal(restored.revision, 4);
  assert.equal(session.getRevision(), 4);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await session.discard())),
    { status: 'removed', removed: true }
  );
  assert.equal(harness.removals[0].options.expectedRevision, 4);
  assert.equal(harness.record(), null);
  assert.equal(statuses.includes('recovered'), true);
  assert.equal(statuses.includes('discarded'), true);
});

test('close forza il salvataggio pendente prima di chiudere la vista', async () => {
  const harness = createHarness();
  const session = harness.context.DraftManager.open({
    target: { mode: 'create', draftId: 'sessione-b' },
    delay: 1000,
    read: () => ({ recipe: { name: 'Da conservare' } }),
    isDirty: () => true
  });

  session.schedule();
  await session.close();
  assert.equal(harness.saves(), 1);
  assert.equal(harness.record().data.recipe.name, 'Da conservare');
});

test('genera identificatori compatibili con le chiavi IndexedDB', () => {
  const harness = createHarness();
  const first = harness.context.DraftManager.createId('draft');
  const second = harness.context.DraftManager.createId('draft');
  assert.match(first, /^draft-[a-z0-9_-]+$/i);
  assert.notEqual(first, second);
});

test('un errore di chiusura mantiene la sessione aperta e consente di riprovare', async () => {
  const warnings = [];
  let attempts = 0;
  const context = loadAppScripts(['js/drafts/draft-manager.js'], {
    console: {
      warn(...args) {
        warnings.push(args);
      }
    },
    DraftStore: {
      async get() {
        return null;
      },
      async save(target, data, options) {
        attempts += 1;
        if (attempts === 1) throw new Error('Quota esaurita');
        return {
          ...target,
          data,
          writerId: options.writerId,
          revision: 1,
          updatedAt: Date.now()
        };
      },
      async remove() {
        return false;
      }
    }
  });
  const statuses = [];
  const session = context.DraftManager.open({
    target: { mode: 'create', draftId: 'sessione-errore' },
    delay: 1000,
    read: () => ({ recipe: { name: 'Da proteggere' } }),
    isDirty: () => true,
    onStatus: status => statuses.push(status)
  });

  session.schedule();
  const failedOutcome = await session.close();

  assert.equal(failedOutcome.closed, false);
  assert.match(failedOutcome.error.message, /Quota esaurita/);
  assert.equal(session.isClosed(), false);
  const successfulOutcome = await session.close();
  assert.equal(successfulOutcome.closed, true);
  assert.equal(successfulOutcome.error, null);
  assert.equal(session.isClosed(), true);
  assert.equal(attempts, 2);
  assert.equal(statuses.includes('error'), true);
  assert.equal(warnings.length, 1);
});

test('un writer obsoleto non sovrascrive la bozza e resta in conflitto', async () => {
  const initial = {
    mode: 'create',
    draftId: 'url-duplicato',
    data: { recipe: { name: 'Versione iniziale' } },
    writerId: 'altra-scheda',
    revision: 2,
    updatedAt: Date.now()
  };
  const harness = createHarness(initial);
  const statuses = [];
  const session = harness.context.DraftManager.open({
    target: { mode: 'create', draftId: 'url-duplicato' },
    delay: 10,
    read: () => ({ recipe: { name: 'Versione locale obsoleta' } }),
    isDirty: () => true,
    onStatus: status => statuses.push(status)
  });

  await session.restore();
  harness.setRecord({
    ...initial,
    data: { recipe: { name: 'Versione dell’altra scheda' } },
    revision: 3
  });
  session.schedule();

  await assert.rejects(
    session.flush(),
    error => error && error.code === 'DRAFT_CONFLICT'
  );
  assert.equal(harness.record().data.recipe.name, 'Versione dell’altra scheda');
  assert.equal(session.getConflict().code, 'DRAFT_CONFLICT');
  assert.equal(statuses.includes('conflict'), true);

  const closeOutcome = await session.close();
  assert.equal(closeOutcome.closed, false);
  const discardOutcome = await session.discard();
  assert.equal(discardOutcome.status, 'conflict');
  assert.equal(discardOutcome.currentRevision, 3);
});

test('non elimina una bozza comparsa dopo che la sessione aveva visto l’archivio vuoto', async () => {
  const harness = createHarness();
  const statuses = [];
  const session = harness.context.DraftManager.open({
    target: { mode: 'create', draftId: 'comparsa-dopo' },
    delay: 10,
    read: () => ({ recipe: { name: '' } }),
    isDirty: () => false,
    onStatus: status => statuses.push(status)
  });

  assert.equal(await session.restore(), null);
  harness.setRecord({
    mode: 'create',
    recipeId: null,
    draftId: 'comparsa-dopo',
    data: { recipe: { name: 'Creata da un’altra scheda' } },
    writerId: 'altra-scheda',
    revision: 1,
    updatedAt: Date.now()
  });

  const result = await session.discard();

  assert.equal(result.status, 'conflict');
  assert.equal(result.removed, false);
  assert.equal(harness.removals.length, 0);
  assert.equal(harness.record().data.recipe.name, 'Creata da un’altra scheda');
  assert.equal(statuses.at(-1), 'conflict');
});
