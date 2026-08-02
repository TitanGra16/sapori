const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(
  path.join(projectRoot, 'js', 'print', 'print-recipe-view.js'),
  'utf8'
);

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function loadView() {
  const window = {
    Utils: {
      escapeHtml,
      getCategoryInfo: () => ({ icon: '🍽️', label: 'Altro' }),
      getDifficultyEmoji: () => '●',
      formatTime: minutes => `${minutes} min`,
      showToast: () => {}
    },
    PrintService: {}
  };
  const context = vm.createContext({ window, globalThis: window, console });
  vm.runInContext(source, context, { filename: 'print-recipe-view.js' });
  return window.PrintRecipeView;
}

test('espone il renderer stampabile dal modulo dedicato', () => {
  const view = loadView();

  assert.equal(typeof view.buildHTML, 'function');
  assert.equal(typeof view.print, 'function');
  const html = view.buildHTML({
    name: 'Pane <rustico>',
    category: 'altro',
    description: 'Descrizione',
    ingredients: [{ name: 'Farina', quantity: '100', unit: 'g', notes: '' }],
    steps: [{ text: 'Impasta', notes: '' }],
    prepTime: 10,
    cookTime: 20,
    servings: 4,
    difficulty: 'facile',
    notes: '',
    storage: '',
    image: null
  });

  assert.match(html, /class="print-recipe-sheet"/);
  assert.match(html, /Pane &lt;rustico&gt;/);
  assert.doesNotMatch(html, /Stampato il|file:\/\/\//);
});

test('views mantiene soltanto la delega al modulo di stampa', () => {
  const viewsSource = fs.readFileSync(path.join(projectRoot, 'js', 'views.js'), 'utf8');
  const index = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

  assert.doesNotMatch(viewsSource, /function\s+buildPrintableRecipeHTML/);
  assert.match(viewsSource, /buildPrintableRecipeHTML:\s*PrintRecipeView\.buildHTML/);
  assert.match(index, /\.\/js\/print\/print-recipe-view\.js/);
});
