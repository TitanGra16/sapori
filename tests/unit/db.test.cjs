const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB, IDBKeyRange } = require('fake-indexeddb');
const { loadAppScripts, projectRoot } = require('../helpers/load-app.cjs');

function createContext() {
  return loadAppScripts(['js/utils.js', 'js/recipes.js', 'js/db.js'], {
    indexedDB,
    IDBKeyRange
  });
}

async function deleteDatabase(context) {
  if (context.DB.db) context.DB.db.close();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('SaporiDB');
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}

async function getStoredRecords(context, id) {
  const tx = context.DB.db.transaction(['recipes', 'images'], 'readonly');
  const recipePromise = context.DB._promisify(tx.objectStore('recipes').get(id));
  const imagePromise = context.DB._promisify(tx.objectStore('images').get(id));
  const [recipe, image] = await Promise.all([recipePromise, imagePromise]);
  return { recipe, image };
}

test('importa il fixture completo senza perdere note', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const fixture = fs.readFileSync(`${projectRoot}/ricette_test_import.json`, 'utf8');
  const preview = await context.DB.previewImport(fixture);
  assert.equal(preview.total, 21);
  assert.equal(preview.rejected, 0);

  const summary = await context.DB.importData(fixture, { mode: 'merge' });
  assert.equal(summary.imported, 21);
  const recipes = await context.DB.getAllRecipes();
  assert.equal(recipes.length, 21);
  assert.equal(recipes.filter(recipe => recipe.notes).length, 21);
});

test('merge aggiorna gli ID esistenti e ignora duplicati di contenuto', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const recipe = {
    id: 'fixed-id',
    name: 'Torta test',
    category: 'dolci',
    description: '',
    notes: 'prima',
    ingredients: [{ name: 'Farina', quantity: '100', unit: 'g', notes: '' }],
    steps: [{ text: 'Mescola', notes: '' }],
    prepTime: 5,
    cookTime: 10,
    difficulty: 'facile',
    servings: 4
  };
  await context.DB.importData(JSON.stringify(recipe));
  const updated = { ...recipe, notes: 'dopo' };
  const updateSummary = await context.DB.importData(JSON.stringify(updated));
  assert.equal(updateSummary.updated, 1);
  assert.equal((await context.DB.getRecipe('fixed-id')).notes, 'dopo');

  const duplicate = { ...updated, id: 'different-id' };
  const duplicateSummary = await context.DB.importData(JSON.stringify(duplicate));
  assert.equal(duplicateSummary.skipped, 1);
  assert.equal((await context.DB.getAllRecipes()).length, 1);
});

test('anteprima e merge deduplicano rispetto allo stato finale in ordine', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const original = {
    id: 'fixed-id',
    name: 'Versione originale',
    category: 'altro',
    ingredients: [{ name: 'Pane' }],
    steps: [{ text: 'Tosta' }]
  };
  await context.DB.importData(JSON.stringify(original));

  const payload = JSON.stringify([
    {
      ...original,
      name: 'Versione aggiornata',
      ingredients: [{ name: 'Pane nuovo' }]
    },
    {
      ...original,
      id: 'old-content-new-id'
    },
    {
      ...original,
      id: 'duplicate-old-content'
    }
  ]);

  const preview = await context.DB.previewImport(payload);
  assert.deepEqual(
    { additions: preview.additions, updates: preview.updates, duplicates: preview.duplicates },
    { additions: 1, updates: 1, duplicates: 1 }
  );

  const summary = await context.DB.importData(payload);
  assert.deepEqual(
    { imported: summary.imported, updated: summary.updated, skipped: summary.skipped },
    { imported: 1, updated: 1, skipped: 1 }
  );
  const recipes = await context.DB.getAllRecipes();
  assert.equal(recipes.length, 2);
  assert.equal(recipes.find(recipe => recipe.id === 'fixed-id').name, 'Versione aggiornata');
  assert.ok(recipes.some(recipe => recipe.id === 'old-content-new-id'));
});

test('backup versione 2 ripristina ricette, categorie e tema', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  await context.DB.setSetting('customCategories', JSON.stringify([
    { id: 'veloci', label: 'Veloci', icon: '⚡', color: '#0EA5E9', isCustom: true }
  ]));
  await context.DB.setSetting('themeMode', 'dark');
  await context.DB.setSetting('themePalette', 'oceano');
  await context.DB.importData(JSON.stringify({
    name: 'Toast',
    category: 'altro',
    ingredients: [{ name: 'Pane' }],
    steps: [{ text: 'Tosta' }]
  }));

  const backup = JSON.parse(await context.DB.exportData());
  assert.equal(backup.version, 2);
  assert.equal(backup.recipes.length, 1);
  assert.equal(backup.settings.themeMode, 'dark');
  assert.equal(backup.settings.themePalette, 'oceano');
  assert.match(backup.settings.customCategories, /Veloci/);
});

test('non confonde varianti con note e conservazione diverse', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const base = {
    name: 'Pane di casa',
    category: 'altro',
    ingredients: [{ name: 'Farina' }],
    steps: [{ text: 'Impasta' }]
  };
  await context.DB.importData(JSON.stringify({ ...base, id: 'pane-frigo', notes: 'Prima versione', storage: 'Frigorifero' }));
  const summary = await context.DB.importData(JSON.stringify({
    ...base,
    id: 'pane-freezer',
    notes: 'Seconda versione',
    storage: 'Congelatore'
  }));

  assert.equal(summary.imported, 1);
  assert.equal(summary.skipped, 0);
  assert.equal((await context.DB.getAllRecipes()).length, 2);
});

test('in unione preserva la versione locale più recente', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  await context.DB.importData(JSON.stringify({
    id: 'ricetta-conflitto',
    name: 'Versione locale',
    category: 'altro',
    notes: 'Da conservare',
    ingredients: [{ name: 'Pane' }],
    steps: [{ text: 'Tosta' }],
    updatedAt: 2000
  }));

  const olderBackup = JSON.stringify({
    id: 'ricetta-conflitto',
    name: 'Versione vecchia',
    category: 'altro',
    notes: 'Da non ripristinare',
    ingredients: [{ name: 'Pane' }],
    steps: [{ text: 'Tosta' }],
    updatedAt: 1000
  });
  const preview = await context.DB.previewImport(olderBackup);
  assert.equal(preview.conflicts, 1);
  assert.equal(preview.updates, 0);

  const summary = await context.DB.importData(olderBackup);
  assert.equal(summary.conflicts, 1);
  assert.equal(summary.updated, 0);
  assert.equal((await context.DB.getRecipe('ricetta-conflitto')).name, 'Versione locale');
});

test('ignora categorie personalizzate con ID riservati', () => {
  const context = createContext();
  const categories = context.DB._parseCustomCategories([
    { id: 'primi', label: 'Primi duplicati', icon: '🍝', color: '#E85D3A' },
    { id: 'veloci', label: 'Ricette veloci', icon: '⚡', color: '#0EA5E9' }
  ]);

  assert.deepEqual(
    JSON.parse(JSON.stringify(categories)),
    [{ id: 'veloci', label: 'Ricette veloci', icon: '⚡', color: '#0EA5E9', isCustom: true }]
  );
});

test('sostituisce gli ID importati non sicuri con un nuovo ID valido', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const summary = await context.DB.importData(JSON.stringify({
    id: 'ricetta/con-slash',
    name: 'Ricetta importata',
    category: 'altro',
    ingredients: [{ name: 'Farina' }],
    steps: [{ text: 'Impasta' }]
  }));

  assert.equal(summary.imported, 1);
  const recipes = await context.DB.getAllRecipes();
  assert.equal(recipes.length, 1);
  assert.notEqual(recipes[0].id, 'ricetta/con-slash');
  assert.match(recipes[0].id, /^[a-z0-9][a-z0-9_-]{0,127}$/i);
});

test('separa foto complete e miniature senza perdere backup o dettaglio', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const fullImage = 'data:image/jpeg;base64,Rk9UT19DT01QTEVUQQ==';
  const thumbnail = 'data:image/jpeg;base64,TUlOSUFUVVJB';
  const id = await context.DB.addRecipe({
    name: 'Ricetta fotografata',
    category: 'altro',
    description: '',
    notes: '',
    ingredients: [{ name: 'Pane', quantity: '', unit: '', notes: '' }],
    steps: [{ text: 'Servi', notes: '' }],
    prepTime: 1,
    cookTime: 0,
    difficulty: 'facile',
    servings: 1,
    image: fullImage,
    imageThumbnail: thumbnail,
    isFavorite: false
  });

  const stored = await getStoredRecords(context, id);
  assert.equal(stored.recipe.image, null);
  assert.equal(stored.recipe.imageThumbnail, thumbnail);
  assert.equal(stored.recipe.hasImage, true);
  assert.equal(stored.image.data, fullImage);

  const summaries = await context.DB.getRecipeSummaries();
  assert.equal(summaries[0].image, thumbnail);
  assert.notEqual(summaries[0].image, fullImage);
  assert.equal(await context.DB.countRecipes(), 1);
  assert.equal(await context.DB.countRecipes('altro'), 1);
  assert.equal(await context.DB.countRecipes('dolci'), 0);
  assert.equal((await context.DB.getRecipe(id)).image, fullImage);
  assert.equal(JSON.parse(await context.DB.exportData()).recipes[0].image, fullImage);

  await context.DB.deleteRecipe(id);
  const deleted = await getStoredRecords(context, id);
  assert.equal(deleted.recipe, undefined);
  assert.equal(deleted.image, undefined);
});

test('migra le foto incorporate da IndexedDB v1 al nuovo archivio', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  const fullImage = 'data:image/png;base64,TEVHQUNZ';

  await new Promise((resolve, reject) => {
    const request = indexedDB.open('SaporiDB', 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      const recipes = db.createObjectStore('recipes', { keyPath: 'id' });
      db.createObjectStore('settings', { keyPath: 'key' });
      recipes.put({
        id: 'legacy-photo',
        name: 'Ricetta precedente',
        category: 'altro',
        ingredients: [{ name: 'Pane' }],
        steps: [{ text: 'Servi' }],
        image: fullImage,
        createdAt: 1,
        updatedAt: 1
      });
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });

  await context.DB.init();
  const stored = await getStoredRecords(context, 'legacy-photo');
  assert.equal(stored.recipe.image, null);
  assert.equal(stored.recipe.hasImage, true);
  assert.equal(stored.image.data, fullImage);
  assert.equal((await context.DB.getRecipe('legacy-photo')).image, fullImage);
});

test('import e replace mantengono sincronizzati record e foto', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const firstImage = 'data:image/webp;base64,UFJJTUE=';
  await context.DB.importData(JSON.stringify({
    id: 'with-photo',
    name: 'Prima',
    category: 'altro',
    ingredients: [{ name: 'Uno' }],
    steps: [{ text: 'Prepara' }],
    image: firstImage
  }));
  assert.equal((await context.DB.getRecipe('with-photo')).image, firstImage);
  assert.equal((await getStoredRecords(context, 'with-photo')).recipe.image, null);

  await context.DB.importData(JSON.stringify({
    recipes: [{
      id: 'without-photo',
      name: 'Seconda',
      category: 'altro',
      ingredients: [{ name: 'Due' }],
      steps: [{ text: 'Prepara' }]
    }]
  }), { mode: 'replace' });

  assert.equal(await context.DB.getRecipe('with-photo'), undefined);
  assert.equal((await getStoredRecords(context, 'with-photo')).image, undefined);
  assert.equal((await context.DB.getRecipe('without-photo')).image, null);
});
