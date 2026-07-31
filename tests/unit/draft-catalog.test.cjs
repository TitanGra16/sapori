const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppScripts } = require('../helpers/load-app.cjs');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function createContext(additions = {}) {
  return loadAppScripts(['js/drafts/draft-catalog.js'], {
    Utils: { escapeHtml },
    Icons: {
      arrowLeft: '<svg>indietro</svg>',
      clock: '<svg>orologio</svg>',
      edit: '<svg>modifica</svg>',
      plus: '<svg>aggiungi</svg>',
      trash: '<svg>elimina</svg>'
    },
    ...additions
  });
}

function record(overrides = {}) {
  return {
    mode: 'create',
    recipeId: null,
    draftId: 'bozza-1',
    revision: 2,
    updatedAt: Date.UTC(2026, 6, 31, 8, 30),
    data: {
      recipe: {
        id: 'ricetta-nuova',
        name: 'Pane rustico'
      }
    },
    ...overrides
  };
}

test('descrive bozze attive, già salvate e rimaste senza ricetta originale', () => {
  const { DraftCatalog } = createContext();
  const items = DraftCatalog.describe(
    [
      record(),
      record({
        draftId: 'bozza-salvata',
        data: { recipe: { id: 'ricetta-salvata', name: 'Torta salvata' } }
      }),
      record({
        mode: 'edit',
        recipeId: 'ricetta-esistente',
        draftId: 'modifica-attiva',
        data: { recipe: { name: 'Pasta' } }
      }),
      record({
        mode: 'edit',
        recipeId: 'ricetta-eliminata',
        draftId: 'modifica-orfana',
        data: { recipe: { name: 'Zuppa' } }
      })
    ],
    [
      { id: 'ricetta-salvata' },
      { id: 'ricetta-esistente' }
    ]
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(items.map(item => ({
      draftId: item.draftId,
      status: item.status,
      savedRecipeId: item.savedRecipeId
    })))),
    [
      { draftId: 'bozza-1', status: 'active', savedRecipeId: null },
      {
        draftId: 'bozza-salvata',
        status: 'already-saved',
        savedRecipeId: 'ricetta-salvata'
      },
      { draftId: 'modifica-attiva', status: 'active', savedRecipeId: null },
      { draftId: 'modifica-orfana', status: 'orphaned', savedRecipeId: null }
    ]
  );
});

test('ignora record con destinazioni o revisioni non sicure', () => {
  const { DraftCatalog } = createContext();
  const items = DraftCatalog.describe([
    record({ mode: 'unknown' }),
    record({ draftId: '../pericolosa' }),
    record({ revision: 0 }),
    record({ mode: 'edit', recipeId: null }),
    record({ draftId: 'valida' })
  ], []);

  assert.equal(items.length, 1);
  assert.equal(items[0].draftId, 'valida');
});

test('usa un nome sicuro e limita testi e markup non attendibili', () => {
  const { DraftCatalog } = createContext();
  const longName = '<img src=x onerror=alert(1)>' + 'a'.repeat(180);
  const item = DraftCatalog.describe([
    record({ data: { recipe: { id: 'id-sicuro', name: longName } } })
  ], [])[0];

  assert.equal(item.name.length, 120);
  const html = DraftCatalog.homeSummaryHTML([item]);
  assert.equal(html.includes('<img'), false);
  assert.match(html, /&lt;img/);
});

test('fornisce fallback leggibili per payload incompleti e date assenti', () => {
  const { DraftCatalog } = createContext();
  const item = DraftCatalog.describe([
    record({ data: null, updatedAt: Number.NaN })
  ], [])[0];

  assert.equal(item.name, 'Nuova ricetta senza titolo');
  assert.equal(item.updatedAt, null);
  assert.equal(DraftCatalog.formatUpdatedAt(null), 'Data non disponibile');
});

test('usa il titolo originale per una bozza di modifica ancora senza titolo', () => {
  const { DraftCatalog } = createContext();
  const item = DraftCatalog.describe([
    record({
      mode: 'edit',
      recipeId: 'ricetta-base',
      draftId: 'modifica-vuota',
      data: { recipe: { name: '' } }
    })
  ], [{ id: 'ricetta-base', name: 'Titolo della ricetta salvata' }])[0];

  assert.equal(item.name, 'Titolo della ricetta salvata');
  assert.equal(item.status, 'active');
});

test('costruisce rotte scoped per creazione e modifica', () => {
  const { DraftCatalog } = createContext();

  assert.equal(
    DraftCatalog.routeFor({ mode: 'create', draftId: 'nuova-1' }),
    '#create/nuova-1'
  );
  assert.equal(
    DraftCatalog.routeFor({
      mode: 'edit',
      recipeId: 'ricetta-1',
      draftId: 'modifica-1'
    }),
    '#edit/ricetta-1/modifica-1'
  );
});

test('estrae dal controllo soltanto snapshot completi e validi', () => {
  const { DraftCatalog } = createContext();
  const attributes = new Map([
    ['data-draft-mode', 'edit'],
    ['data-draft-id', 'bozza-22'],
    ['data-draft-revision', '7'],
    ['data-recipe-id', 'ricetta-5'],
    ['data-saved-recipe-id', '']
  ]);
  const element = {
    getAttribute(name) {
      return attributes.get(name) ?? null;
    }
  };

  assert.deepEqual(
    JSON.parse(JSON.stringify(DraftCatalog.targetFromElement(element))),
    {
      mode: 'edit',
      recipeId: 'ricetta-5',
      draftId: 'bozza-22',
      revision: 7,
      savedRecipeId: null
    }
  );
  attributes.set('data-draft-revision', 'non-numero');
  assert.equal(DraftCatalog.targetFromElement(element), null);
});

test('carica record e ricette una volta e restituisce descrittori', async () => {
  let listCalls = 0;
  let recipeCalls = 0;
  const context = createContext({
    DraftStore: {
      async list() {
        listCalls += 1;
        return [record()];
      }
    },
    DB: {
      async getRecipeSummaries() {
        recipeCalls += 1;
        return [];
      }
    }
  });

  const items = await context.DraftCatalog.load();
  assert.equal(items.length, 1);
  assert.equal(listCalls, 1);
  assert.equal(recipeCalls, 1);

  await context.DraftCatalog.load([{ id: 'altra-ricetta' }]);
  assert.equal(recipeCalls, 1);
});

test('renderizza elenco e stato vuoto con azioni accessibili', () => {
  const { DraftCatalog } = createContext();
  const container = { innerHTML: '' };
  const item = DraftCatalog.describe([record()], [])[0];

  DraftCatalog.render(container, [item]);
  assert.match(container.innerHTML, /Bozze locali/);
  assert.match(container.innerHTML, /data-action="resume-draft"/);
  assert.match(container.innerHTML, /data-action="delete-draft"/);
  assert.match(container.innerHTML, /aria-label="Elimina la bozza Pane rustico"/);

  DraftCatalog.render(container, []);
  assert.match(container.innerHTML, /Nessuna bozza da recuperare/);
  assert.match(container.innerHTML, /data-action="go-create"/);
});
