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
