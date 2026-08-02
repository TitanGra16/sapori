const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB, IDBKeyRange } = require('fake-indexeddb');
const { loadAppScripts, projectRoot } = require('../helpers/load-app.cjs');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createContext() {
  return loadAppScripts([
    'js/utils.js',
    'js/recipes.js',
    'js/sync/sync-preparation.js',
    'js/db.js'
  ], {
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

function importableRecipe(overrides = {}) {
  return {
    id: 'ricetta-importata',
    name: 'Ricetta importata',
    category: 'altro',
    description: '',
    notes: '',
    storage: '',
    ingredients: [{ name: 'Farina', quantity: '100', unit: 'g', notes: '' }],
    steps: [{ text: 'Prepara', notes: '' }],
    prepTime: 5,
    cookTime: 10,
    difficulty: 'facile',
    servings: 4,
    image: null,
    isFavorite: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides
  };
}

test('preserva su richiesta l’ID sicuro di una bozza', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const id = await context.DB.addRecipe({
    id: 'bozza-stabile_123',
    name: 'Ricetta da bozza',
    category: 'altro',
    ingredients: [{ name: 'Pane' }],
    steps: [{ text: 'Servi' }]
  }, { preserveId: true });

  assert.equal(id, 'bozza-stabile_123');
  assert.equal((await context.DB.getRecipe(id)).name, 'Ricetta da bozza');
});

test('rigenera un ID non sicuro anche quando ne viene chiesta la conservazione', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const id = await context.DB.addRecipe({
    id: 'bozza/con-slash',
    name: 'Ricetta con ID non sicuro',
    category: 'altro',
    ingredients: [{ name: 'Pane' }],
    steps: [{ text: 'Servi' }]
  }, { preserveId: true });

  assert.notEqual(id, 'bozza/con-slash');
  assert.match(id, /^[a-z0-9][a-z0-9_-]{0,127}$/i);
});

test('segnala una collisione senza sovrascrivere la ricetta esistente', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  await context.DB.addRecipe({
    id: 'ricetta-esistente',
    name: 'Versione originale',
    category: 'altro',
    ingredients: [{ name: 'Pane' }],
    steps: [{ text: 'Servi' }]
  }, { preserveId: true });

  await assert.rejects(
    () => context.DB.addRecipe({
      id: 'ricetta-esistente',
      name: 'Versione da non salvare',
      category: 'altro',
      ingredients: [{ name: 'Farina' }],
      steps: [{ text: 'Impasta' }]
    }, { preserveId: true }),
    error => {
      assert.equal(error.code, 'RECIPE_ALREADY_EXISTS');
      assert.equal(error.recipeId, 'ricetta-esistente');
      return true;
    }
  );

  const recipes = await context.DB.getAllRecipes();
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].name, 'Versione originale');
  assert.equal(recipes[0].ingredients[0].name, 'Pane');
});

test('una collisione non altera foto miniatura o coda della ricetta esistente', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();
  await context.SyncPreparation.prepareDevice();

  const firstImage = 'data:image/png;base64,QUFB';
  const firstThumbnail = 'data:image/jpeg;base64,VEhVTUIx';
  const secondImage = 'data:image/png;base64,QkJC';
  const secondThumbnail = 'data:image/jpeg;base64,VEhVTUIy';
  const recipeId = 'ricetta-foto-esistente';

  await context.DB.addRecipe({
    id: recipeId,
    name: 'Versione originale con foto',
    category: 'altro',
    ingredients: [{ name: 'Pane' }],
    steps: [{ text: 'Servi' }],
    image: firstImage,
    imageThumbnail: firstThumbnail
  }, { preserveId: true });
  const queueBeforeCollision = plain(
    await context.SyncPreparation.getPendingChanges()
  );

  await assert.rejects(
    () => context.DB.addRecipe({
      id: recipeId,
      name: 'Versione concorrente con foto',
      category: 'altro',
      ingredients: [{ name: 'Farina' }],
      steps: [{ text: 'Impasta' }],
      image: secondImage,
      imageThumbnail: secondThumbnail
    }, { preserveId: true }),
    error => error.code === 'RECIPE_ALREADY_EXISTS'
  );

  const stored = await getStoredRecords(context, recipeId);
  assert.equal(stored.recipe.name, 'Versione originale con foto');
  assert.equal(stored.recipe.imageThumbnail, firstThumbnail);
  assert.equal(stored.image.data, firstImage);
  assert.deepEqual(
    plain(await context.SyncPreparation.getPendingChanges()),
    queueBeforeCollision
  );
});

test('il preferito non altera data di modifica o foto della ricetta', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const fullImage = 'data:image/jpeg;base64,Rk9UT19QUkVGRVJJVE8=';
  const id = await context.DB.addRecipe({
    name: 'Ricetta preferita',
    category: 'altro',
    ingredients: [{ name: 'Pane' }],
    steps: [{ text: 'Servi' }],
    image: fullImage,
    isFavorite: false
  });
  const before = await getStoredRecords(context, id);

  assert.equal(await context.DB.toggleFavorite(id), true);
  const after = await getStoredRecords(context, id);
  assert.equal(after.recipe.isFavorite, true);
  assert.equal(after.recipe.updatedAt, before.recipe.updatedAt);
  assert.equal(after.image.data, fullImage);
});

test('impedisce di superare il limite delle categorie personalizzate', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const categories = Array.from({ length: context.DB.MAX_CUSTOM_CATEGORIES }, (_, index) => ({
    id: 'categoria-' + index,
    label: 'Categoria ' + index,
    icon: '🍴',
    color: '#E85D3A',
    isCustom: true
  }));
  await context.DB.setSetting('customCategories', JSON.stringify(categories));

  await assert.rejects(
    () => context.DB.addCustomCategory({
      id: 'categoria-extra',
      label: 'Categoria extra',
      icon: '🍴',
      color: '#E85D3A',
      isCustom: true
    }),
    /al massimo 100 categorie/
  );
});

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

test('merge rileva e applica un cambiamento limitato al preferito', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const original = importableRecipe({
    id: 'solo-preferito',
    image: 'data:image/jpeg;base64,Rk9UT19JTlRBVFRB'
  });
  await context.DB.importData(JSON.stringify(original));
  const favoriteBackup = {
    ...original,
    isFavorite: true
  };

  const preview = await context.DB.previewImport(JSON.stringify(favoriteBackup));
  assert.equal(preview.updates, 1);
  assert.equal(preview.duplicates, 0);

  const summary = await context.DB.importData(JSON.stringify(favoriteBackup), { mode: 'merge' });
  const recipe = await context.DB.getRecipe(original.id);
  assert.equal(summary.updated, 1);
  assert.equal(summary.skipped, 0);
  assert.equal(recipe.isFavorite, true);
  assert.equal(recipe.image, original.image);
  assert.equal(recipe.updatedAt, original.updatedAt);
});

test('merge rileva la sostituzione e la rimozione della sola foto', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const firstImage = 'data:image/jpeg;base64,UFJJTUFfRk9UTw==';
  const secondImage = 'data:image/jpeg;base64,U0VDT05EQV9GT1RP';
  const original = importableRecipe({
    id: 'solo-foto',
    image: firstImage,
    updatedAt: 1000
  });
  await context.DB.importData(JSON.stringify(original));

  const changedPhoto = {
    ...original,
    image: secondImage,
    updatedAt: 2000
  };
  const changePreview = await context.DB.previewImport(JSON.stringify(changedPhoto));
  assert.equal(changePreview.updates, 1);
  assert.equal(changePreview.duplicates, 0);
  assert.equal((await context.DB.importData(JSON.stringify(changedPhoto))).updated, 1);
  assert.equal((await context.DB.getRecipe(original.id)).image, secondImage);

  const removedPhoto = {
    ...changedPhoto,
    image: null,
    updatedAt: 3000
  };
  const removalPreview = await context.DB.previewImport(JSON.stringify(removedPhoto));
  assert.equal(removalPreview.updates, 1);
  assert.equal(removalPreview.duplicates, 0);
  assert.equal((await context.DB.importData(JSON.stringify(removedPhoto))).updated, 1);

  const stored = await getStoredRecords(context, original.id);
  assert.equal(stored.recipe.hasImage, false);
  assert.equal(stored.image, undefined);
  assert.equal((await context.DB.getRecipe(original.id)).image, null);
});

test('merge mantiene la foto locale quando un backup fotografico è più vecchio', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const recent = importableRecipe({
    id: 'foto-conflitto',
    image: 'data:image/jpeg;base64,Rk9UT19SRUNFTlRF',
    updatedAt: 3000
  });
  await context.DB.importData(JSON.stringify(recent));
  const older = {
    ...recent,
    image: 'data:image/jpeg;base64,Rk9UT19WRUNDSUlB',
    updatedAt: 2000
  };

  const preview = await context.DB.previewImport(JSON.stringify(older));
  const summary = await context.DB.importData(JSON.stringify(older));
  assert.equal(preview.conflicts, 1);
  assert.equal(preview.updates, 0);
  assert.equal(summary.conflicts, 1);
  assert.equal(summary.updated, 0);
  assert.equal((await context.DB.getRecipe(recent.id)).image, recent.image);
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

test('merge unisce le categorie e preserva la definizione locale nei conflitti ID', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  const localCategory = {
    id: 'di-casa',
    label: 'Di casa',
    icon: 'C',
    color: '#123456',
    isCustom: true
  };
  await context.DB.setSetting('customCategories', JSON.stringify([localCategory]));
  const localRecipeId = await context.DB.addRecipe({
    name: 'Ricetta locale',
    category: localCategory.id,
    ingredients: [{ name: 'Pane' }],
    steps: [{ text: 'Servi' }]
  });

  const backup = JSON.stringify({
    version: 2,
    recipes: [importableRecipe({
      id: 'ricetta-remota',
      name: 'Ricetta remota',
      category: 'dal-mondo'
    })],
    settings: {
      customCategories: JSON.stringify([
        {
          id: localCategory.id,
          label: 'Nome dal backup',
          icon: 'B',
          color: '#ABCDEF',
          isCustom: true
        },
        {
          id: 'dal-mondo',
          label: 'Dal mondo',
          icon: 'M',
          color: '#654321',
          isCustom: true
        }
      ])
    }
  });

  const preview = await context.DB.previewImport(backup);
  const summary = await context.DB.importData(backup, { mode: 'merge' });
  const categories = JSON.parse(await context.DB.getSetting('customCategories'));

  assert.equal(preview.categories, 2);
  assert.equal(summary.categories, 2);
  assert.deepEqual(
    categories.map(category => ({ id: category.id, label: category.label })),
    [
      { id: localCategory.id, label: localCategory.label },
      { id: 'dal-mondo', label: 'Dal mondo' }
    ]
  );
  assert.equal((await context.DB.getRecipe(localRecipeId)).category, localCategory.id);
  assert.equal((await context.DB.getRecipe('ricetta-remota')).category, 'dal-mondo');
});

test('merge conserva una categoria locale usata da una ricetta singola importata', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  await context.DB.setSetting('customCategories', JSON.stringify([
    {
      id: 'famiglia',
      label: 'Famiglia',
      icon: 'F',
      color: '#224466',
      isCustom: true
    }
  ]));
  const recipe = importableRecipe({
    id: 'ricetta-famiglia',
    category: 'famiglia'
  });

  const preview = await context.DB.previewImport(JSON.stringify(recipe));
  const summary = await context.DB.importData(JSON.stringify(recipe), { mode: 'merge' });
  assert.equal(preview.additions, 1);
  assert.equal(summary.imported, 1);
  assert.equal((await context.DB.getRecipe(recipe.id)).category, 'famiglia');
});

test('replace continua a sostituire le categorie personalizzate', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  await context.DB.setSetting('customCategories', JSON.stringify([
    { id: 'locale', label: 'Locale', icon: 'L', color: '#123456', isCustom: true }
  ]));
  const backup = JSON.stringify({
    version: 2,
    recipes: [importableRecipe({
      id: 'ricetta-backup',
      category: 'backup'
    })],
    settings: {
      customCategories: JSON.stringify([
        { id: 'backup', label: 'Backup', icon: 'B', color: '#654321', isCustom: true }
      ])
    }
  });

  await context.DB.importData(backup, { mode: 'replace' });
  const categories = JSON.parse(await context.DB.getSetting('customCategories'));
  assert.deepEqual(categories.map(category => category.id), ['backup']);
  assert.equal((await context.DB.getRecipe('ricetta-backup')).category, 'backup');
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

test('normalizza timestamp importati non validi e mantiene una cronologia coerente', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();
  const startedAt = Date.now();

  await context.DB.importData(JSON.stringify([
    importableRecipe({
      id: 'date-non-valide',
      name: 'Date non valide',
      createdAt: -10,
      updatedAt: Number.MAX_SAFE_INTEGER
    }),
    importableRecipe({
      id: 'date-invertite',
      name: 'Date invertite',
      createdAt: 5000,
      updatedAt: 4000
    }),
    importableRecipe({
      id: 'solo-modifica',
      name: 'Solo data modifica',
      createdAt: null,
      updatedAt: 3000
    })
  ]));

  const invalid = await context.DB.getRecipe('date-non-valide');
  const reversed = await context.DB.getRecipe('date-invertite');
  const updatedOnly = await context.DB.getRecipe('solo-modifica');
  assert.ok(invalid.createdAt >= startedAt && invalid.createdAt <= Date.now());
  assert.equal(invalid.updatedAt, invalid.createdAt);
  assert.equal(reversed.createdAt, 5000);
  assert.equal(reversed.updatedAt, 5000);
  assert.equal(updatedOnly.createdAt, 3000);
  assert.equal(updatedOnly.updatedAt, 3000);
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

test('elimina una categoria e riassegna le ricette nella stessa operazione', async t => {
  const context = createContext();
  t.after(() => deleteDatabase(context));
  await context.DB.init();

  await context.DB.setSetting('customCategories', JSON.stringify([
    { id: 'veloci', label: 'Veloci', icon: '⚡', color: '#0EA5E9', isCustom: true }
  ]));
  const recipeId = await context.DB.addRecipe({
    name: 'Toast veloce',
    category: 'veloci',
    ingredients: [{ name: 'Pane' }],
    steps: [{ text: 'Tosta' }]
  });

  const result = await context.DB.deleteCustomCategory('veloci');
  assert.equal(result.movedRecipes, 1);
  assert.deepEqual(JSON.parse(await context.DB.getSetting('customCategories')), []);
  assert.equal((await context.DB.getRecipe(recipeId)).category, 'altro');
  await assert.rejects(context.DB.deleteCustomCategory('primi'), /non valida/);
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
