const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppScripts } = require('../helpers/load-app.cjs');

function loadSchema(withRecipes = true, additions = {}) {
  const files = withRecipes
    ? ['js/recipes.js', 'js/drafts/draft-schema.js']
    : ['js/drafts/draft-schema.js'];
  return loadAppScripts(files, additions);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('normalizza una bozza completa conservando contenuto e metadati utili', () => {
  const { DraftSchema } = loadSchema();
  const image = 'data:image/png;base64,AAAA';
  const thumbnail = 'data:image/jpeg;base64,BBBB';
  const result = DraftSchema.normalize({
    version: 1,
    activeTab: 'tab-prep',
    baseContentVersion: 7,
    baseUpdatedAt: 1234,
    recipe: {
      id: 'ricetta-1',
      name: 'Pane',
      category: 'lievitati-casa',
      description: 'Descrizione',
      notes: 'Note',
      storage: 'Due giorni',
      ingredients: [{ name: 'Farina', quantity: 500, unit: 'g', notes: '00' }],
      steps: ['Impasta'],
      prepTime: '15',
      cookTime: 30,
      difficulty: 'facile',
      servings: '6',
      image,
      imageThumbnail: thumbnail,
      isFavorite: true,
      contentVersion: 7,
      favoriteVersion: 3,
      imageVersion: 2,
      createdAt: 1000,
      updatedAt: 1234
    }
  });

  assert.equal(result.version, 1);
  assert.equal(result.activeTab, 'tab-prep');
  assert.equal(result.baseContentVersion, 7);
  assert.equal(result.baseUpdatedAt, 1234);
  assert.deepEqual(plain(result.recipe.ingredients), [
    { name: 'Farina', quantity: '500', unit: 'g', notes: '00' }
  ]);
  assert.deepEqual(plain(result.recipe.steps), [
    { text: 'Impasta', notes: '' }
  ]);
  assert.equal(result.recipe.category, 'lievitati-casa');
  assert.equal(result.recipe.image, image);
  assert.equal(result.recipe.imageThumbnail, thumbnail);
  assert.equal(result.recipe.contentVersion, 7);
  assert.equal(result.recipe.favoriteVersion, 3);
  assert.equal(result.recipe.imageVersion, 2);
});

test('accetta una ricetta incompleta e crea righe vuote utilizzabili dal form', () => {
  const { DraftSchema } = loadSchema();
  const result = DraftSchema.normalize({ recipe: { name: 'P' } });

  assert.equal(result.recipe.name, 'P');
  assert.equal(result.recipe.category, 'altro');
  assert.equal(result.recipe.difficulty, 'media');
  assert.equal(result.recipe.servings, 4);
  assert.deepEqual(plain(result.recipe.ingredients), [
    { name: '', quantity: '', unit: '', notes: '' }
  ]);
  assert.deepEqual(plain(result.recipe.steps), [
    { text: '', notes: '' }
  ]);
});

test('normalizza elementi nulli o malformati senza perdere gli indici delle righe', () => {
  const { DraftSchema } = loadSchema();
  const result = DraftSchema.normalize({
    recipe: {
      ingredients: [
        null,
        'farina',
        { name: 42, quantity: Infinity, unit: {}, notes: false }
      ],
      steps: [
        null,
        { text: 42, notes: true },
        'Servi'
      ]
    }
  });

  assert.deepEqual(plain(result.recipe.ingredients), [
    { name: '', quantity: '', unit: '', notes: '' },
    { name: '', quantity: '', unit: '', notes: '' },
    { name: '42', quantity: '', unit: '', notes: 'false' }
  ]);
  assert.deepEqual(plain(result.recipe.steps), [
    { text: '', notes: '' },
    { text: '42', notes: 'true' },
    { text: 'Servi', notes: '' }
  ]);
});

test('applica i limiti di Recipes a stringhe e numero di righe', () => {
  const { DraftSchema, Recipes } = loadSchema();
  const ingredients = Array.from(
    { length: Recipes.LIMITS.ingredients + 5 },
    () => ({ name: 'x'.repeat(Recipes.LIMITS.ingredientName + 10) })
  );
  const steps = Array.from(
    { length: Recipes.LIMITS.steps + 5 },
    () => ({ text: 'y'.repeat(Recipes.LIMITS.stepText + 10) })
  );
  const result = DraftSchema.normalize({
    recipe: {
      name: 'n'.repeat(Recipes.LIMITS.name + 10),
      description: 'd'.repeat(Recipes.LIMITS.description + 10),
      ingredients,
      steps
    }
  });

  assert.equal(result.recipe.name.length, Recipes.LIMITS.name);
  assert.equal(result.recipe.description.length, Recipes.LIMITS.description);
  assert.equal(result.recipe.ingredients.length, Recipes.LIMITS.ingredients);
  assert.equal(
    result.recipe.ingredients[0].name.length,
    Recipes.LIMITS.ingredientName
  );
  assert.equal(result.recipe.steps.length, Recipes.LIMITS.steps);
  assert.equal(result.recipe.steps[0].text.length, Recipes.LIMITS.stepText);
});

test('usa limiti autonomi quando Recipes non è disponibile', () => {
  const { DraftSchema } = loadSchema(false);
  const result = DraftSchema.normalize({
    recipe: {
      name: 'x'.repeat(200),
      ingredients: [{ name: 'Farina' }],
      steps: [{ text: 'Impasta' }]
    }
  });

  assert.equal(result.recipe.name.length, 120);
  assert.equal(result.recipe.ingredients[0].name, 'Farina');
  assert.equal(result.recipe.steps[0].text, 'Impasta');
});

test('scarta numeri, selezioni e immagini non sicuri con valori prevedibili', () => {
  const { DraftSchema } = loadSchema();
  const result = DraftSchema.normalize({
    activeTab: 'tab-sconosciuta',
    baseContentVersion: -2,
    baseUpdatedAt: Infinity,
    recipe: {
      id: '../ricetta',
      category: '<script>',
      difficulty: 'estrema',
      prepTime: -1,
      cookTime: Infinity,
      servings: 0,
      contentVersion: -4,
      createdAt: 'non-data',
      image: 'javascript:alert(1)',
      imageThumbnail: 'data:image/png;base64,AAAA'
    }
  });

  assert.equal(result.activeTab, 'tab-info');
  assert.equal(result.baseContentVersion, 0);
  assert.equal(result.baseUpdatedAt, null);
  assert.equal(result.recipe.id, null);
  assert.equal(result.recipe.category, 'altro');
  assert.equal(result.recipe.difficulty, 'media');
  assert.equal(result.recipe.prepTime, 0);
  assert.equal(result.recipe.cookTime, 0);
  assert.equal(result.recipe.servings, 4);
  assert.equal(result.recipe.contentVersion, 0);
  assert.equal(result.recipe.createdAt, null);
  assert.equal(result.recipe.image, null);
  assert.equal(result.recipe.imageThumbnail, null);
});

test('in modifica protegge identità e metadati della ricetta originale', () => {
  const { DraftSchema } = loadSchema();
  const baseRecipe = {
    id: 'ricetta-originale',
    name: 'Originale',
    category: 'primi',
    ingredients: [{ name: 'Farina' }],
    steps: [{ text: 'Impasta' }],
    isFavorite: true,
    favoriteVersion: 8,
    createdAt: 111,
    updatedAt: 222,
    contentVersion: 4
  };
  const result = DraftSchema.normalize({
    recipe: {
      id: 'ricetta-diversa',
      name: 'Modificata',
      isFavorite: false,
      favoriteVersion: 1,
      createdAt: 999,
      contentVersion: 4
    }
  }, { mode: 'edit', baseRecipe });

  assert.equal(result.recipe.id, 'ricetta-originale');
  assert.equal(result.recipe.name, 'Modificata');
  assert.equal(result.recipe.isFavorite, true);
  assert.equal(result.recipe.favoriteVersion, 8);
  assert.equal(result.recipe.createdAt, 111);
  assert.equal(result.recipe.ingredients[0].name, 'Farina');
  assert.equal(result.recipe.steps[0].text, 'Impasta');
  assert.equal(result.baseUpdatedAt, 222);
});

test('recupera anche un vecchio payload che contiene direttamente la ricetta', () => {
  const { DraftSchema } = loadSchema();
  const result = DraftSchema.normalize({
    id: 'ricetta-legacy',
    name: 'Bozza precedente',
    ingredients: [{ name: 'Pane' }],
    steps: ['Servi']
  });

  assert.equal(result.recipe.id, 'ricetta-legacy');
  assert.equal(result.recipe.name, 'Bozza precedente');
  assert.equal(result.recipe.ingredients[0].name, 'Pane');
  assert.equal(result.recipe.steps[0].text, 'Servi');
});

test('non modifica il payload e restituisce strutture nuove', () => {
  const { DraftSchema } = loadSchema();
  const payload = {
    recipe: {
      name: 'Pane',
      ingredients: [{ name: 'Farina' }],
      steps: [{ text: 'Impasta' }]
    }
  };
  const before = JSON.stringify(payload);
  const result = DraftSchema.normalize(payload);

  result.recipe.ingredients[0].name = 'Cambiata';
  result.recipe.steps[0].text = 'Cambiato';
  assert.equal(JSON.stringify(payload), before);
});

test('produce un errore tipizzato soltanto per payload totalmente invalidi', () => {
  const { DraftSchema } = loadSchema();
  class DraftFinto {}

  for (const invalid of [null, undefined, 'bozza', [], new Date(), new DraftFinto()]) {
    assert.throws(
      () => DraftSchema.normalize(invalid),
      error => (
        error.name === 'DraftSchemaError' &&
        error.code === 'INVALID_DRAFT_PAYLOAD' &&
        error.recoverable === false
      )
    );
  }

  assert.doesNotThrow(() => DraftSchema.normalize({ recipe: null }));
  const attempted = DraftSchema.tryNormalize(null);
  assert.equal(attempted.valid, false);
  assert.equal(attempted.data, null);
  assert.equal(attempted.error.code, 'INVALID_DRAFT_PAYLOAD');
});

test('ignora proprietà recuperabili il cui getter genera un errore', () => {
  const { DraftSchema } = loadSchema();
  const recipe = { name: 'Pane' };
  Object.defineProperty(recipe, 'notes', {
    enumerable: true,
    get() {
      throw new Error('dato corrotto');
    }
  });

  const result = DraftSchema.normalize({ recipe });
  assert.equal(result.recipe.name, 'Pane');
  assert.equal(result.recipe.notes, '');
});
