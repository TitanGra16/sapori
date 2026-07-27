const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

const scriptFiles = [
  ...walk(path.join(root, 'js')).filter(file => file.endsWith('.js')),
  path.join(root, 'sw.js')
];

for (const file of scriptFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${path.relative(root, file)}: ${result.stderr}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(index, /Content-Security-Policy/);
assert.doesNotMatch(index, /<script(?![^>]*\bsrc=)[^>]*>/i, 'index.html contiene uno script inline');

const variables = fs.readFileSync(path.join(root, 'css', 'variables.css'), 'utf8');
assert.doesNotMatch(variables, /fonts\.googleapis\.com/i, 'I font devono funzionare offline');

function pngSize(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} non è un PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

for (const icon of manifest.icons) {
  const file = path.resolve(root, icon.src);
  const expected = icon.sizes.split('x').map(Number);
  assert.deepEqual(pngSize(file), expected, `${icon.src} ha dimensioni errate`);
}

const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
assert.doesNotMatch(serviceWorker, /test\.html/);
assert.match(serviceWorker, /js\/bootstrap-theme\.js/);
assert.match(serviceWorker, /SKIP_WAITING/);

console.log(`Controlli statici superati: ${scriptFiles.length} script, ${manifest.icons.length} icone.`);
