const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppScripts } = require('../helpers/load-app.cjs');

function makeRecipe(overrides = {}) {
  return {
    id: 'recipe-1',
    name: 'Pasta al pomodoro',
    category: 'primi',
    description: '',
    notes: '',
    ingredients: [{ name: 'Pomodoro', quantity: '200', unit: 'g', notes: '' }],
    steps: [{ text: 'Cuoci la pasta', notes: '' }],
    prepTime: 10,
    cookTime: 20,
    difficulty: 'facile',
    servings: 4,
    createdAt: 1,
    ...overrides
  };
}

test('la validazione rifiuta righe vuote e numeri fuori limite', () => {
  const { Recipes } = loadAppScripts(['js/recipes.js']);
  const result = Recipes.validate(makeRecipe({
    name: ' ',
    prepTime: 1.5,
    servings: 0,
    ingredients: [{ name: '' }],
    steps: [{ text: '' }]
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.name);
  assert.ok(result.errors.prepTime);
  assert.ok(result.errors.servings);
  assert.ok(result.errors.ingredient_0);
  assert.ok(result.errors.step_0);
});

test('la ricerca ignora gli accenti e include note e passaggi', () => {
  const { Recipes } = loadAppScripts(['js/recipes.js']);
  const recipes = [
    makeRecipe({ id: 'a', name: 'Crème brûlée', notes: 'Ricetta della nonna' }),
    makeRecipe({ id: 'b', name: 'Risotto', steps: [{ text: 'Mantecare lentamente', notes: 'Usa il burro freddo' }] })
  ];

  assert.deepEqual(
    Array.from(Recipes.filterRecipes(recipes, { search: 'creme' }), recipe => recipe.id),
    ['a']
  );
  assert.deepEqual(
    Array.from(Recipes.filterRecipes(recipes, { search: 'burro freddo' }), recipe => recipe.id),
    ['b']
  );
});

test('l’ordinamento per tempo lascia le durate mancanti in fondo', () => {
  const { Recipes } = loadAppScripts(['js/recipes.js']);
  const recipes = [
    makeRecipe({ id: 'missing', name: 'Senza tempo', prepTime: 0, cookTime: 0 }),
    makeRecipe({ id: 'slow', name: 'Lenta', prepTime: 30, cookTime: 30 }),
    makeRecipe({ id: 'fast', name: 'Veloce', prepTime: 5, cookTime: 5 })
  ];

  assert.deepEqual(
    Array.from(Recipes.filterRecipes(recipes, { sortBy: 'time_asc' }), recipe => recipe.id),
    ['fast', 'slow', 'missing']
  );
  assert.deepEqual(
    Array.from(Recipes.filterRecipes(recipes, { sortBy: 'time_desc' }), recipe => recipe.id),
    ['slow', 'fast', 'missing']
  );
});

test('Svuotafrigo usa token interi e non confonde insalata con sale', () => {
  const { Recipes } = loadAppScripts(['js/utils.js', 'js/recipes.js']);
  const recipes = [
    makeRecipe({ id: 'salad', ingredients: [{ name: 'Insalata' }] }),
    makeRecipe({ id: 'salt', ingredients: [{ name: 'Sale fino' }] })
  ];

  assert.deepEqual(
    Array.from(Recipes.matchPantry(recipes, ['sale']), match => match.recipe.id),
    ['salt']
  );
});

test('le quantità frazionarie vengono scalate correttamente', () => {
  const { Utils } = loadAppScripts(['js/utils.js']);
  assert.equal(Utils.scaleQuantity('1/2 tazza', 3), '1.5 tazza');
  assert.equal(Utils.scaleQuantity('1 1/2 cucchiai', 2), '3 cucchiai');
  assert.equal(Utils.scaleQuantity('200 g', 0.5), '100 g');
  assert.equal(Utils.scaleQuantity('q.b.', 2), 'q.b.');
});

test('l’export conserva note di ricetta, ingredienti e passaggi', () => {
  const { Recipes } = loadAppScripts(['js/recipes.js']);
  const exported = Recipes.formatRecipeForExport(makeRecipe({
    notes: 'Nota ricetta',
    ingredients: [{ name: 'Farina', notes: 'setacciata' }],
    steps: [{ text: 'Mescola', notes: 'senza grumi' }]
  }));

  assert.equal(exported.notes, 'Nota ricetta');
  assert.equal(exported.ingredients[0].notes, 'setacciata');
  assert.equal(exported.steps[0].notes, 'senza grumi');
});
