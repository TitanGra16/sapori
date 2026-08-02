const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const { loadAppScripts } = require('../helpers/load-app.cjs');

function createContext(overrides = {}) {
  return loadAppScripts(['js/drafts/draft-store.js'], {
    indexedDB: new IDBFactory(),
    IDBKeyRange,
    ...overrides
  });
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function target(mode, draftId, recipeId) {
  return { mode, draftId, recipeId };
}

async function expireRecord(database, key, expiresAt = Date.now() - 1) {
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    const store = transaction.objectStore('drafts');
    const request = store.get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      store.put({ ...request.result, expiresAt });
    };
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function rawRecord(database, key) {
  return new Promise((resolve, reject) => {
    const request = database
      .transaction('drafts', 'readonly')
      .objectStore('drafts')
      .get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putRawRecord(database, record) {
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').put(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

test('inizializza un database separato con gli indici per le bozze', async t => {
  const context = createContext();
  const database = await context.DraftStore.init();
  t.after(() => database.close());

  assert.equal(database.name, 'SaporiDraftsDB');
  assert.notEqual(database.name, 'SaporiDB');
  assert.equal(database.version, 1);
  assert.equal(database.objectStoreNames.contains('drafts'), true);

  const indexes = database
    .transaction('drafts', 'readonly')
    .objectStore('drafts')
    .indexNames;
  assert.equal(indexes.contains('expiresAt'), true);
  assert.equal(indexes.contains('updatedAt'), true);
  assert.equal(indexes.contains('mode'), true);
});

test('salva, legge e rimuove una bozza scoped per trenta giorni', async t => {
  const context = createContext();
  const database = await context.DraftStore.init();
  t.after(() => database.close());
  const draftTarget = target('create', 'sessione-a');
  const source = {
    recipe: { name: 'Pane', ingredients: [{ name: 'Farina' }] },
    activeTab: 'tab-prep'
  };

  const saved = await context.DraftStore.save(draftTarget, source, {
    writerId: 'scheda-a'
  });
  source.recipe.name = 'Modificato dopo il salvataggio';
  const restored = await context.DraftStore.get(draftTarget);

  assert.equal(saved.mode, 'create');
  assert.equal(saved.draftId, 'sessione-a');
  assert.equal(saved.revision, 1);
  assert.equal(saved.expiresAt - saved.updatedAt, context.DraftStore.DRAFT_TTL_MS);
  assert.deepEqual(plain(restored.data), {
    recipe: { name: 'Pane', ingredients: [{ name: 'Farina' }] },
    activeTab: 'tab-prep'
  });
  assert.equal(
    await context.DraftStore.remove(draftTarget, { expectedRevision: saved.revision }),
    true
  );
  assert.equal(await context.DraftStore.get(draftTarget), null);
});

test('mantiene isolate creazioni e modifiche aperte in schede diverse', async t => {
  const context = createContext();
  const database = await context.DraftStore.init();
  t.after(() => database.close());

  const createA = target('create', 'scheda-a');
  const createB = target('create', 'scheda-b');
  const editA = target('edit', 'scheda-a', 'ricetta-1');
  const editB = target('edit', 'scheda-b', 'ricetta-1');
  await context.DraftStore.save(createA, { recipe: { name: 'Nuova A' } });
  await context.DraftStore.save(createB, { recipe: { name: 'Nuova B' } });
  await context.DraftStore.save(editA, { recipe: { name: 'Modifica A' } });
  await context.DraftStore.save(editB, { recipe: { name: 'Modifica B' } });

  assert.equal((await context.DraftStore.get(createA)).data.recipe.name, 'Nuova A');
  assert.equal((await context.DraftStore.get(createB)).data.recipe.name, 'Nuova B');
  assert.equal((await context.DraftStore.get(editA)).data.recipe.name, 'Modifica A');
  assert.equal((await context.DraftStore.get(editB)).data.recipe.name, 'Modifica B');
});

test('due writer sullo stesso URL non possono sovrascrivere la stessa revisione', async t => {
  const indexedDB = new IDBFactory();
  const firstContext = createContext({ indexedDB });
  const secondContext = createContext({ indexedDB });
  const firstDatabase = await firstContext.DraftStore.init();
  const secondDatabase = await secondContext.DraftStore.init();
  t.after(() => {
    firstDatabase.close();
    secondDatabase.close();
  });
  const draftTarget = target('edit', 'stesso-url', 'ricetta-1');
  const initial = await firstContext.DraftStore.save(
    draftTarget,
    { recipe: { name: 'Versione iniziale' } },
    { writerId: 'origine' }
  );

  const attempts = await Promise.allSettled([
    firstContext.DraftStore.save(
      draftTarget,
      { recipe: { name: 'Versione scheda A' } },
      { writerId: 'scheda-a', expectedRevision: initial.revision }
    ),
    secondContext.DraftStore.save(
      draftTarget,
      { recipe: { name: 'Versione scheda B' } },
      { writerId: 'scheda-b', expectedRevision: initial.revision }
    )
  ]);
  const successful = attempts.filter(result => result.status === 'fulfilled');
  const conflicted = attempts.filter(result => result.status === 'rejected');

  assert.equal(successful.length, 1);
  assert.equal(conflicted.length, 1);
  assert.equal(successful[0].value.revision, 2);
  assert.equal(conflicted[0].reason.name, 'DraftStoreError');
  assert.equal(conflicted[0].reason.code, 'DRAFT_CONFLICT');
  assert.equal(conflicted[0].reason.currentRevision, 2);
  assert.equal(
    conflicted[0].reason.currentWriterId,
    successful[0].value.writerId
  );

  const finalRecord = await firstContext.DraftStore.get(draftTarget);
  assert.equal(finalRecord.revision, 2);
  assert.equal(finalRecord.writerId, successful[0].value.writerId);
  assert.deepEqual(plain(finalRecord.data), plain(successful[0].value.data));
});

test('expectedRevision null crea una sola bozza anche con richieste concorrenti', async t => {
  const indexedDB = new IDBFactory();
  const firstContext = createContext({ indexedDB });
  const secondContext = createContext({ indexedDB });
  const firstDatabase = await firstContext.DraftStore.init();
  const secondDatabase = await secondContext.DraftStore.init();
  t.after(() => {
    firstDatabase.close();
    secondDatabase.close();
  });
  const draftTarget = target('create', 'creazione-concorrente');

  const attempts = await Promise.allSettled([
    firstContext.DraftStore.save(
      draftTarget,
      { recipe: { name: 'Creazione A' } },
      { writerId: 'scheda-a', expectedRevision: null }
    ),
    secondContext.DraftStore.save(
      draftTarget,
      { recipe: { name: 'Creazione B' } },
      { writerId: 'scheda-b', expectedRevision: null }
    )
  ]);
  const successful = attempts.filter(result => result.status === 'fulfilled');
  const conflicted = attempts.filter(result => result.status === 'rejected');

  assert.equal(successful.length, 1);
  assert.equal(successful[0].value.revision, 1);
  assert.equal(conflicted.length, 1);
  assert.equal(conflicted[0].reason.code, 'DRAFT_CONFLICT');
  assert.equal(conflicted[0].reason.currentRevision, 1);
  assert.equal(
    conflicted[0].reason.currentWriterId,
    successful[0].value.writerId
  );
});

test('CAS distingue opzione assente, null e revisione non valida', async t => {
  const context = createContext();
  const database = await context.DraftStore.init();
  t.after(() => database.close());
  const draftTarget = target('create', 'semantica-cas');

  const first = await context.DraftStore.save(
    draftTarget,
    { recipe: { name: 'Prima' } }
  );
  const unconditional = await context.DraftStore.save(
    draftTarget,
    { recipe: { name: 'Sovrascrittura esplicita' } },
    { writerId: 'senza-cas' }
  );
  assert.equal(unconditional.revision, first.revision + 1);

  await assert.rejects(
    () => context.DraftStore.save(
      draftTarget,
      { recipe: { name: 'Non deve sovrascrivere' } },
      { writerId: 'nuova-creazione', expectedRevision: null }
    ),
    error => {
      assert.equal(error.code, 'DRAFT_CONFLICT');
      assert.equal(error.currentRevision, unconditional.revision);
      assert.equal(error.currentWriterId, 'senza-cas');
      return true;
    }
  );
  await assert.rejects(
    () => context.DraftStore.save(
      draftTarget,
      { recipe: { name: 'Revisione ambigua' } },
      { expectedRevision: undefined }
    ),
    error => error.code === 'INVALID_REVISION'
  );
});

test('CAS segnala quando la revisione attesa è scomparsa', async t => {
  const context = createContext();
  const database = await context.DraftStore.init();
  t.after(() => database.close());
  const draftTarget = target('edit', 'scomparsa', 'ricetta-1');
  const saved = await context.DraftStore.save(
    draftTarget,
    { recipe: { name: 'Temporanea' } },
    { writerId: 'scheda-a' }
  );
  await context.DraftStore.remove(draftTarget, {
    expectedRevision: saved.revision
  });

  await assert.rejects(
    () => context.DraftStore.save(
      draftTarget,
      { recipe: { name: 'Scrittura obsoleta' } },
      { writerId: 'scheda-a', expectedRevision: saved.revision }
    ),
    error => {
      assert.equal(error.name, 'DraftStoreError');
      assert.equal(error.code, 'DRAFT_CONFLICT');
      assert.equal(error.currentRevision, null);
      assert.equal(error.currentWriterId, null);
      return true;
    }
  );
  assert.equal(await context.DraftStore.get(draftTarget), null);
});

test('una rimozione tardiva non cancella una revisione più recente', async t => {
  const context = createContext();
  const database = await context.DraftStore.init();
  t.after(() => database.close());
  const draftTarget = target('create', 'concorrenza');

  const first = await context.DraftStore.save(draftTarget, { recipe: { name: 'Prima' } });
  const second = await context.DraftStore.save(draftTarget, { recipe: { name: 'Seconda' } });

  assert.equal(second.revision, first.revision + 1);
  assert.equal(
    await context.DraftStore.remove(draftTarget, { expectedRevision: first.revision }),
    false
  );
  assert.equal((await context.DraftStore.get(draftTarget)).data.recipe.name, 'Seconda');
  assert.equal(
    await context.DraftStore.remove(draftTarget, { expectedRevision: second.revision }),
    true
  );
});

test('get elimina una bozza scaduta nella stessa transazione', async t => {
  const context = createContext();
  const database = await context.DraftStore.init();
  t.after(() => database.close());
  const draftTarget = target('create', 'scaduta');
  await context.DraftStore.save(draftTarget, { recipe: { name: 'Scaduta' } });
  await expireRecord(database, 'create:scaduta');

  assert.equal(await context.DraftStore.get(draftTarget), null);
  const raw = await new Promise((resolve, reject) => {
    const request = database
      .transaction('drafts', 'readonly')
      .objectStore('drafts')
      .get('create:scaduta');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.equal(raw, undefined);
});

test('cleanup elimina soltanto le bozze scadute', async t => {
  const context = createContext();
  const database = await context.DraftStore.init();
  t.after(() => database.close());

  await context.DraftStore.save(target('create', 'scaduta'), { recipe: { name: 'Scaduta' } });
  await context.DraftStore.save(target('edit', 'valida', 'ricetta-1'), {
    recipe: { name: 'Valida' }
  });
  await expireRecord(database, 'create:scaduta');

  assert.equal(await context.DraftStore.cleanup(), 1);
  assert.equal(
    (await context.DraftStore.get(target('edit', 'valida', 'ricetta-1'))).data.recipe.name,
    'Valida'
  );
});

test('list ordina, filtra e rimuove le bozze scadute nella stessa transazione', async t => {
  let now = Date.now();
  const context = createContext({
    Date: { now: () => now }
  });
  const database = await context.DraftStore.init();
  t.after(() => database.close());

  await context.DraftStore.save(
    target('create', 'nuova'),
    { recipe: { name: 'Nuova ricetta' } }
  );
  now += 10;
  await context.DraftStore.save(
    target('edit', 'prima', 'ricetta-1'),
    { recipe: { name: 'Prima modifica' } }
  );
  now += 10;
  await context.DraftStore.save(
    target('edit', 'seconda', 'ricetta-2'),
    { recipe: { name: 'Seconda modifica' } }
  );
  now += 10;
  await context.DraftStore.save(
    target('edit', 'recente', 'ricetta-1'),
    { recipe: { name: 'Modifica recente' } }
  );
  now += 10;
  await context.DraftStore.save(
    target('create', 'scaduta-lista'),
    { recipe: { name: 'Da eliminare' } }
  );
  await expireRecord(database, 'create:scaduta-lista', now - 1);

  const all = await context.DraftStore.list();
  assert.deepEqual(
    plain(all.map(record => record.draftId)),
    ['recente', 'seconda', 'prima', 'nuova']
  );
  assert.deepEqual(
    plain((await context.DraftStore.list({ mode: 'create' }))
      .map(record => record.draftId)),
    ['nuova']
  );
  assert.deepEqual(
    plain((await context.DraftStore.list({ mode: 'edit' }))
      .map(record => record.draftId)),
    ['recente', 'seconda', 'prima']
  );
  assert.deepEqual(
    plain((await context.DraftStore.list({ recipeId: 'ricetta-1' }))
      .map(record => record.draftId)),
    ['recente', 'prima']
  );
  assert.deepEqual(
    plain((await context.DraftStore.list({ mode: 'edit', recipeId: 'ricetta-2' }))
      .map(record => record.draftId)),
    ['seconda']
  );
  assert.equal(await rawRecord(database, 'create:scaduta-lista'), undefined);
});

test('list rifiuta filtri ambigui o non sicuri', async t => {
  const context = createContext();
  const database = await context.DraftStore.init();
  t.after(() => database.close());

  const invalidFilters = [
    null,
    { mode: 'unknown' },
    { recipeId: 'id/non-sicuro' },
    { mode: 'create', recipeId: 'ricetta-1' },
    { recipeID: 'ricetta-1' }
  ];
  for (const filters of invalidFilters) {
    await assert.rejects(
      () => context.DraftStore.list(filters),
      error => error.name === 'DraftStoreError' && error.code === 'INVALID_FILTER'
    );
  }
});

test('restituisce record legacy illeggibili senza bloccare le altre bozze', async t => {
  const context = createContext();
  const database = await context.DraftStore.init();
  t.after(() => database.close());
  const validRecord = await context.DraftStore.save(
    target('create', 'valida-accanto'),
    { recipe: { name: 'Bozza valida' } }
  );
  const legacyUpdatedAt = validRecord.updatedAt + 1;
  await putRawRecord(database, {
    key: 'create:legacy-illeggibile',
    mode: 'create',
    recipeId: null,
    draftId: 'legacy-illeggibile',
    data: null,
    writerId: 'versione-vecchia',
    revision: 1,
    createdAt: validRecord.createdAt,
    updatedAt: legacyUpdatedAt,
    expiresAt: legacyUpdatedAt + context.DraftStore.DRAFT_TTL_MS
  });

  const unreadable = await context.DraftStore.get(
    target('create', 'legacy-illeggibile')
  );
  assert.equal(unreadable.data, null);
  const listed = await context.DraftStore.list();
  assert.deepEqual(
    plain(listed.map(record => [record.draftId, record.data])),
    [
      ['legacy-illeggibile', null],
      ['valida-accanto', { recipe: { name: 'Bozza valida' } }]
    ]
  );
});

test('il fallback senza structuredClone conserva i dati semplici e rifiuta valori ambigui', async t => {
  const context = createContext({ structuredClone: undefined });
  const database = await context.DraftStore.init();
  t.after(() => database.close());
  const draftTarget = target('create', 'fallback');

  await context.DraftStore.save(draftTarget, {
    recipe: { name: 'Pane', values: [1, true, null] }
  });
  assert.equal((await context.DraftStore.get(draftTarget)).data.recipe.name, 'Pane');

  await assert.rejects(
    () => context.DraftStore.save(draftTarget, {
      recipe: { name: 'Non valida', callback() {} }
    }),
    /valore non salvabile/
  );
  await assert.rejects(
    () => context.DraftStore.save(draftTarget, {
      recipe: { name: 'Non valida', missing: undefined }
    }),
    /valore non salvabile/
  );
});

test('rifiuta destinazioni e contenuti non validi con errori leggibili', async t => {
  const context = createContext();
  const database = await context.DraftStore.init();
  t.after(() => database.close());

  await assert.rejects(
    () => context.DraftStore.save({ mode: 'unknown', draftId: 'x' }, {}),
    /Tipo di bozza non valido/
  );
  await assert.rejects(
    () => context.DraftStore.save(target('edit', 'sessione', 'id/non-sicuro'), {}),
    /ID ricetta non valido/
  );
  await assert.rejects(
    () => context.DraftStore.save(target('create', 'sessione'), []),
    /deve essere un oggetto/
  );
});

test('segnala chiaramente quando IndexedDB non è disponibile', async () => {
  const context = loadAppScripts(['js/drafts/draft-store.js']);
  await assert.rejects(
    () => context.DraftStore.init(),
    /IndexedDB non è disponibile/
  );
});
