const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppScripts } = require('../helpers/load-app.cjs');

function createIdentity() {
  return loadAppScripts(['js/drafts/draft-identity.js']).DraftIdentity;
}

function recipe(overrides = {}) {
  return {
    name: 'Torta',
    category: 'dolci',
    description: 'Descrizione',
    notes: 'Nota',
    storage: 'In frigorifero',
    ingredients: [
      { name: 'Farina', quantity: '200', unit: 'g', notes: '' }
    ],
    steps: [{ text: 'Mescolare', notes: '' }],
    prepTime: 10,
    cookTime: 30,
    difficulty: 'facile',
    servings: 4,
    image: null,
    ...overrides
  };
}

test('deriva dalla stessa bozza un ID ricetta stabile e sicuro', () => {
  const identity = createIdentity();
  const first = identity.recipeIdForDraft('create-sessione-1');
  const second = identity.recipeIdForDraft('create-sessione-1');

  assert.equal(first, second);
  assert.match(first, /^[a-z0-9][a-z0-9_-]{0,127}$/i);
  assert.notEqual(first, identity.recipeIdForDraft('create-sessione-2'));
  assert.notEqual(first, identity.copyRecipeIdForDraft('create-sessione-1'));
});

test('mantiene deterministici e nei limiti anche gli ID bozza più lunghi', () => {
  const identity = createIdentity();
  const longDraftId = 'a'.repeat(128);
  const result = identity.recipeIdForDraft(longDraftId);

  assert.equal(result, identity.recipeIdForDraft(longDraftId));
  assert.match(result, /^[a-z0-9][a-z0-9_-]{0,127}$/i);
  assert.ok(result.length <= 128);
});

test('rifiuta identificatori di bozza non sicuri', () => {
  const identity = createIdentity();
  assert.throws(
    () => identity.recipeIdForDraft('../bozza'),
    /ID bozza non valido/
  );
});

test('il confronto distruttivo distingue maiuscole e contenuti diversi', () => {
  const identity = createIdentity();

  assert.equal(identity.sameContent(recipe(), recipe()), true);
  assert.equal(
    identity.sameContent(recipe(), recipe({ name: 'torta' })),
    false
  );
  assert.equal(
    identity.sameContent(recipe(), recipe({ storage: 'A temperatura ambiente' })),
    false
  );
});

test('la versione coincide soltanto con la stessa foto completa', () => {
  const identity = createIdentity();
  const firstImage = 'data:image/png;base64,QUFB';
  const secondImage = 'data:image/png;base64,QkJC';

  assert.equal(
    identity.sameRecipeVersion(
      recipe({ image: firstImage }),
      recipe({ image: firstImage })
    ),
    true
  );
  assert.equal(
    identity.sameRecipeVersion(
      recipe({ image: firstImage }),
      recipe({ image: secondImage })
    ),
    false
  );
  assert.equal(
    identity.sameRecipeVersion(recipe(), recipe({ image: firstImage })),
    false
  );
});
