const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

test('mantiene media query e layout di stampa nel foglio dedicato', () => {
  const components = read('css/components.css');
  const print = read('css/print/print.css');

  assert.doesNotMatch(components, /@media\s+print/i);
  assert.doesNotMatch(components, /@page\b/i);
  assert.doesNotMatch(components, /\.print-recipe-sheet(?:\b|__)/);
  assert.match(print, /@media\s+print/i);
  assert.match(print, /@page\s+sapori-recipe/i);
  assert.match(print, /\.print-recipe-sheet__title/);
  assert.match(
    print,
    /@media\s+print[\s\S]*?\.print-recipe-sheet\s*\{[\s\S]*?display:\s*block\s*!important/i,
    'La scheda deve essere un blocco in stampa per frammentarsi senza perdere contenuto'
  );
});

test('non conserva selettori per i metadati rimossi dai PDF', () => {
  const print = read('css/print/print.css');

  assert.doesNotMatch(print, /\.print-recipe-sheet__footer/);
  assert.doesNotMatch(print, /\.print-cover-meta/);
});
