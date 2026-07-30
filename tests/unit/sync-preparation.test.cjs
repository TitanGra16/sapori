const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const { loadAppScripts } = require('../helpers/load-app.cjs');

function createContext(testIndexedDB = new IDBFactory()) {
  return loadAppScripts([
    'js/utils.js',
    'js/recipes.js',
    'js/sync/sync-preparation.js',
    'js/db.js'
  ], {
    indexedDB: testIndexedDB,
    IDBKeyRange
  });
}

function sampleRecipe(overrides = {}) {
  return {
    name: 'Pane di prova',
    category: 'altro',
    ingredients: [{ name: 'Farina', quantity: '500', unit: 'g' }],
    steps: [{ text: 'Impasta e cuoci' }],
    isFavorite: false,
    image: null,
    ...overrides
  };
}

function closeContext(context) {
  if (context.DB.db) context.DB.db.close();
  context.DB.db = null;
  context.SyncPreparation.reset();
}

test('aggiorna IndexedDB alla versione 3 senza perdere i dati locali', async t => {
  const testIndexedDB = new IDBFactory();
  await new Promise((resolve, reject) => {
    const request = testIndexedDB.open('SaporiDB', 2);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      const recipes = database.createObjectStore('recipes', { keyPath: 'id' });
      recipes.createIndex('name', 'name', { unique: false });
      recipes.createIndex('category', 'category', { unique: false });
      recipes.createIndex('createdAt', 'createdAt', { unique: false });
      recipes.createIndex('isFavorite', 'isFavorite', { unique: false });
      database.createObjectStore('images', { keyPath: 'recipeId' });
      database.createObjectStore('settings', { keyPath: 'key' });
      recipes.put({
        id: 'ricetta-v2',
        name: 'Ricetta esistente',
        category: 'altro',
        ingredients: [{ name: 'Pane' }],
        steps: [{ text: 'Servi' }],
        image: null,
        hasImage: true,
        createdAt: 1,
        updatedAt: 1
      });
      request.transaction.objectStore('images').put({
        recipeId: 'ricetta-v2',
        data: 'data:image/png;base64,UEhPVE8='
      });
      request.transaction.objectStore('settings').put({
        key: 'customCategories',
        value: '[]'
      });
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });

  const context = createContext(testIndexedDB);
  t.after(() => closeContext(context));
  await context.DB.init();

  assert.equal(context.DB.db.version, 3);
  assert.equal(context.DB.db.objectStoreNames.contains('syncQueue'), true);
  assert.equal(context.DB.db.objectStoreNames.contains('syncMeta'), true);
  const queueIndexes = context.DB.db
    .transaction('syncQueue', 'readonly')
    .objectStore('syncQueue')
    .indexNames;
  assert.equal(queueIndexes.contains('statusNext'), true);
  assert.equal(queueIndexes.contains('ownerScope'), true);
  assert.equal((await context.DB.getRecipe('ricetta-v2')).name, 'Ricetta esistente');
  assert.equal((await context.SyncPreparation.getStatus()).preparationEnabled, false);
});

test('prepara una coda leggera per le ricette già presenti', async t => {
  const context = createContext();
  t.after(() => closeContext(context));
  await context.DB.init();
  await context.DB.addRecipe(sampleRecipe());
  await context.DB.addRecipe(sampleRecipe({
    name: 'Ricetta con foto',
    image: 'data:image/jpeg;base64,Rk9UTw=='
  }));

  const status = await context.SyncPreparation.prepareDevice();
  const changes = await context.SyncPreparation.getPendingChanges();

  assert.equal(status.preparationEnabled, true);
  assert.equal(status.cloudConnected, false);
  assert.equal(status.recipeCount, 2);
  assert.equal(status.pendingRecipeCount, 2);
  assert.equal(status.pendingCount, 6);
  assert.equal(changes.filter(change => change.channel === 'content').length, 2);
  assert.equal(changes.filter(change => change.channel === 'favorite').length, 2);
  assert.equal(changes.filter(change => change.channel === 'image').length, 1);
  assert.equal(changes.filter(change => change.channel === 'categories').length, 1);
  assert.equal(JSON.stringify(changes).includes('data:image'), false);
  assert.equal(changes.every(change => change.ownerScope.startsWith('locale:')), true);
});

test('compatta gli aggiornamenti e riaccoda la foto solo quando cambia', async t => {
  const context = createContext();
  t.after(() => closeContext(context));
  await context.DB.init();
  await context.SyncPreparation.prepareDevice();

  const firstImage = 'data:image/jpeg;base64,UFJJTUE=';
  const secondImage = 'data:image/jpeg;base64,U0VDT05EQQ==';
  const id = await context.DB.addRecipe(sampleRecipe({ image: firstImage }));
  let changes = await context.SyncPreparation.getPendingChanges();
  const firstImageOperation = changes.find(change => (
    change.entityId === id && change.channel === 'image'
  ));
  const firstContentOperation = changes.find(change => (
    change.entityId === id && change.channel === 'content'
  ));

  const recipe = await context.DB.getRecipe(id);
  await context.DB.updateRecipe({ ...recipe, name: 'Pane aggiornato' });
  changes = await context.SyncPreparation.getPendingChanges();
  const unchangedImageOperation = changes.find(change => (
    change.entityId === id && change.channel === 'image'
  ));
  const updatedContentOperation = changes.find(change => (
    change.entityId === id && change.channel === 'content'
  ));

  assert.equal(unchangedImageOperation.operationId, firstImageOperation.operationId);
  assert.notEqual(updatedContentOperation.operationId, firstContentOperation.operationId);
  assert.equal(changes.filter(change => change.entityId === id && change.channel === 'content').length, 1);

  await context.DB.updateRecipe({
    ...(await context.DB.getRecipe(id)),
    image: secondImage
  });
  changes = await context.SyncPreparation.getPendingChanges();
  const changedImageOperation = changes.find(change => (
    change.entityId === id && change.channel === 'image'
  ));
  assert.notEqual(changedImageOperation.operationId, firstImageOperation.operationId);
  assert.equal(changedImageOperation.action, 'upsert');
  assert.equal(JSON.stringify(changedImageOperation).includes(secondImage), false);
});

test('separa il preferito dal contenuto e compatta la cancellazione', async t => {
  const context = createContext();
  t.after(() => closeContext(context));
  await context.DB.init();
  await context.SyncPreparation.prepareDevice();
  const id = await context.DB.addRecipe(sampleRecipe());
  const before = await context.DB.getRecipe(id);

  await context.DB.toggleFavorite(id);
  const after = await context.DB.getRecipe(id);
  let changes = await context.SyncPreparation.getPendingChanges();
  assert.equal(after.updatedAt, before.updatedAt);
  assert.equal(changes.some(change => (
    change.entityId === id &&
    change.channel === 'favorite' &&
    change.action === 'set'
  )), true);

  await context.DB.deleteRecipe(id);
  changes = await context.SyncPreparation.getPendingChanges();
  const recipeChanges = changes.filter(change => change.entityId === id);
  assert.equal(recipeChanges.length, 1);
  assert.equal(recipeChanges[0].channel, 'content');
  assert.equal(recipeChanges[0].action, 'delete');
});

test('registra categorie e ricette riassegnate nella stessa operazione locale', async t => {
  const context = createContext();
  t.after(() => closeContext(context));
  await context.DB.init();
  await context.SyncPreparation.prepareDevice();
  await context.DB.addCustomCategory({
    id: 'veloci',
    label: 'Veloci',
    icon: '⚡',
    color: '#E85D3A',
    isCustom: true
  });
  const id = await context.DB.addRecipe(sampleRecipe({ category: 'veloci' }));

  await context.DB.deleteCustomCategory('veloci');
  const changes = await context.SyncPreparation.getPendingChanges();
  assert.equal((await context.DB.getRecipe(id)).category, 'altro');
  assert.equal(changes.some(change => (
    change.entityId === id &&
    change.channel === 'content' &&
    change.action === 'upsert'
  )), true);
  assert.equal(changes.filter(change => change.channel === 'categories').length, 1);
});

test('il replace accoda le cancellazioni omesse senza ricreare duplicati', async t => {
  const context = createContext();
  t.after(() => closeContext(context));
  await context.DB.init();
  await context.SyncPreparation.prepareDevice();

  const firstPayload = JSON.stringify(sampleRecipe({
    id: 'prima',
    name: 'Prima ricetta',
    createdAt: 10,
    updatedAt: 10
  }));
  await context.DB.importData(firstPayload);
  const beforeDuplicate = await context.SyncPreparation.getPendingChanges();
  await context.DB.importData(firstPayload);
  const afterDuplicate = await context.SyncPreparation.getPendingChanges();
  assert.deepEqual(
    afterDuplicate.map(change => change.operationId).sort(),
    beforeDuplicate.map(change => change.operationId).sort()
  );

  await context.DB.importData(JSON.stringify({
    recipes: [sampleRecipe({
      id: 'seconda',
      name: 'Seconda ricetta',
      createdAt: 20,
      updatedAt: 20
    })]
  }), { mode: 'replace' });

  const changes = await context.SyncPreparation.getPendingChanges();
  const deleted = changes.filter(change => change.entityId === 'prima');
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].action, 'delete');
  assert.equal(changes.some(change => (
    change.entityId === 'seconda' &&
    change.channel === 'content' &&
    change.action === 'upsert'
  )), true);
});

test('stato e coda sopravvivono alla riapertura dell’app', async t => {
  const context = createContext();
  t.after(() => closeContext(context));
  await context.DB.init();
  await context.SyncPreparation.prepareDevice();
  await context.DB.addRecipe(sampleRecipe());
  const before = await context.SyncPreparation.getStatus();

  closeContext(context);
  await context.DB.init();
  const after = await context.SyncPreparation.getStatus();

  assert.equal(after.preparationEnabled, true);
  assert.equal(after.localProfileId, before.localProfileId);
  assert.equal(after.pendingCount, before.pendingCount);
  assert.equal(after.pendingRecipeCount, 1);
});

test('una scheda già aperta accoda le modifiche dopo la preparazione fatta altrove', async t => {
  const testIndexedDB = new IDBFactory();
  const firstContext = createContext(testIndexedDB);
  const secondContext = createContext(testIndexedDB);
  t.after(() => {
    closeContext(firstContext);
    closeContext(secondContext);
  });
  await Promise.all([firstContext.DB.init(), secondContext.DB.init()]);

  const prepared = await firstContext.SyncPreparation.prepareDevice();
  const id = await secondContext.DB.addRecipe(sampleRecipe({
    name: 'Creata dalla seconda scheda'
  }));
  const changes = await firstContext.SyncPreparation.getPendingChanges();

  assert.equal(changes.some(change => change.entityId === id), true);
  assert.equal(changes.every(change => change.ownerScope === prepared.ownerScope), true);
});

test('due preparazioni concorrenti convergono sullo stesso profilo locale', async t => {
  const testIndexedDB = new IDBFactory();
  const firstContext = createContext(testIndexedDB);
  const secondContext = createContext(testIndexedDB);
  t.after(() => {
    closeContext(firstContext);
    closeContext(secondContext);
  });
  await Promise.all([firstContext.DB.init(), secondContext.DB.init()]);
  await firstContext.DB.addRecipe(sampleRecipe());

  const statuses = await Promise.all([
    firstContext.SyncPreparation.prepareDevice(),
    secondContext.SyncPreparation.prepareDevice()
  ]);
  const changes = await firstContext.SyncPreparation.getPendingChanges();

  assert.equal(statuses[0].localProfileId, statuses[1].localProfileId);
  assert.equal(statuses[0].ownerScope, statuses[1].ownerScope);
  assert.equal(changes.every(change => change.ownerScope === statuses[0].ownerScope), true);
  assert.equal(changes.every(change => change.entityKey.startsWith(statuses[0].ownerScope + '|')), true);
  assert.equal(new Set(changes.map(change => change.entityKey)).size, changes.length);
});

test('una scrittura identica delle categorie non ricrea la modifica in coda', async t => {
  const context = createContext();
  t.after(() => closeContext(context));
  await context.DB.init();
  await context.SyncPreparation.prepareDevice();

  await context.DB.setSetting('customCategories', '[]');
  const before = (await context.SyncPreparation.getPendingChanges())
    .find(change => change.channel === 'categories');
  await context.DB.setSetting('customCategories', '[]');
  const after = (await context.SyncPreparation.getPendingChanges())
    .find(change => change.channel === 'categories');

  assert.ok(before);
  assert.equal(after.operationId, before.operationId);
});

test('impedisce sovrascritture obsolete e non fa risorgere ricette eliminate', async t => {
  const testIndexedDB = new IDBFactory();
  const firstContext = createContext(testIndexedDB);
  const secondContext = createContext(testIndexedDB);
  t.after(() => {
    closeContext(firstContext);
    closeContext(secondContext);
  });
  await Promise.all([firstContext.DB.init(), secondContext.DB.init()]);
  const id = await firstContext.DB.addRecipe(sampleRecipe());
  const firstCopy = await firstContext.DB.getRecipe(id);
  const staleCopy = await secondContext.DB.getRecipe(id);

  await firstContext.DB.updateRecipe({ ...firstCopy, name: 'Versione aggiornata' });
  await assert.rejects(
    secondContext.DB.updateRecipe({ ...staleCopy, name: 'Versione obsoleta' }),
    error => error && error.code === 'RECIPE_CONFLICT'
  );
  assert.equal((await firstContext.DB.getRecipe(id)).name, 'Versione aggiornata');

  const beforeDelete = await secondContext.DB.getRecipe(id);
  await firstContext.DB.deleteRecipe(id);
  await assert.rejects(
    secondContext.DB.updateRecipe({ ...beforeDelete, name: 'Ricetta risorta' }),
    error => error && error.code === 'RECIPE_NOT_FOUND'
  );
  assert.equal(await firstContext.DB.getRecipe(id), undefined);
});

test('un aggiornamento del contenuto conserva il preferito cambiato in un’altra scheda', async t => {
  const testIndexedDB = new IDBFactory();
  const firstContext = createContext(testIndexedDB);
  const secondContext = createContext(testIndexedDB);
  t.after(() => {
    closeContext(firstContext);
    closeContext(secondContext);
  });
  await Promise.all([firstContext.DB.init(), secondContext.DB.init()]);
  const id = await firstContext.DB.addRecipe(sampleRecipe());
  const contentCopy = await firstContext.DB.getRecipe(id);

  await secondContext.DB.toggleFavorite(id);
  await firstContext.DB.updateRecipe({ ...contentCopy, name: 'Contenuto aggiornato' });
  const updated = await firstContext.DB.getRecipe(id);

  assert.equal(updated.name, 'Contenuto aggiornato');
  assert.equal(updated.isFavorite, true);
  assert.equal(updated.contentVersion, 2);
  assert.equal(updated.favoriteVersion, 2);
});

test('migra le vecchie chiavi della coda includendo il profilo proprietario', async t => {
  const context = createContext();
  t.after(() => closeContext(context));
  await context.DB.init();
  const ownerScope = 'locale:profilo-precedente';
  const tx = context.DB.db.transaction(['syncMeta', 'syncQueue'], 'readwrite');
  tx.objectStore('syncMeta').put({
    key: 'state',
    intentEnabled: true,
    localProfileId: 'profilo-precedente',
    ownerScope,
    accountId: null,
    preparedAt: 100
  });
  tx.objectStore('syncQueue').put({
    entityKey: 'recipe:ricetta-precedente:content',
    operationId: 'operazione-precedente',
    entityType: 'recipe',
    entityId: 'ricetta-precedente',
    channel: 'content',
    action: 'upsert',
    ownerScope,
    baseServerVersion: null,
    queuedAt: 100,
    updatedAt: 100,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null
  });
  await context.DB._txComplete(tx);

  closeContext(context);
  await context.DB.init();
  const changes = await context.SyncPreparation.getPendingChanges();
  const migrated = changes.find(change => change.entityId === 'ricetta-precedente');

  assert.ok(migrated);
  assert.equal(migrated.entityKey, ownerScope + '|recipe:ricetta-precedente:content');
});
