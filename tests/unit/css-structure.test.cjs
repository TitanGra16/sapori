const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

test('mantiene la modalità cucina nel foglio di pagina dedicato', () => {
  const components = read('css/components.css');
  const cooking = read('css/pages/cooking.css');
  const index = read('index.html');
  const serviceWorker = read('sw.js');

  assert.doesNotMatch(components, /\.cooking-modal(?:\b|__)/);
  assert.match(cooking, /\.cooking-modal\s*\{/);
  assert.match(cooking, /\.cooking-modal__step-text/);
  assert.match(cooking, /@media\s*\(max-width:\s*600px\)/);
  assert.match(index, /href="\.\/css\/pages\/cooking\.css"/);
  assert.match(serviceWorker, /'\.\/css\/pages\/cooking\.css'/);
});
