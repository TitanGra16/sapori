const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  calculateShellRevision,
  extractLocalAssetsFromHtml,
  normalizeAssetBytes,
  parseAppShell,
  resolveAssetFile
} = require('../../scripts/check-project.cjs');

test('legge APP_SHELL con apici misti, commenti e query string', () => {
  const source = `
    const APP_SHELL = [
      './index.html',
      // Il numero di versione fa parte della chiave della richiesta.
      "./js/app.js?v=7",
      './icons/icona\\u002d192.png'
    ];
  `;

  assert.deepEqual(parseAppShell(source), [
    './index.html',
    './js/app.js?v=7',
    './icons/icona-192.png'
  ]);
});

test('estrae asset HTML tra apici singoli o doppi mantenendo le query', () => {
  const html = `
    <link href='./css/base.css?v=2&amp;tema=chiaro'>
    <script src="./js/app.js?v=3#avvio"></script>
    <a href="./#ricette">Ricette</a>
    <img src="https://example.test/esterna.png">
    <img data-src="./icons/non-caricata.png">
  `;

  assert.deepEqual(extractLocalAssetsFromHtml(html), [
    './css/base.css?v=2&tema=chiaro',
    './js/app.js?v=3'
  ]);
});

test('risolve la radice pubblica sul contenuto locale di index.html', () => {
  const resolved = resolveAssetFile(path.resolve(__dirname, '../..'), './');
  assert.equal(path.basename(resolved.file), 'index.html');
  assert.equal(resolved.pathname, '/index.html');
});

test('normalizza CRLF e CR senza alterare gli asset binari', () => {
  const windowsText = Buffer.from('prima\r\nseconda\rterza\n', 'utf8');
  const unixText = Buffer.from('prima\nseconda\nterza\n', 'utf8');
  const binary = Buffer.from([0, 13, 10, 255]);

  assert.deepEqual(
    normalizeAssetBytes('/js/app.js', windowsText),
    unixText
  );
  assert.equal(normalizeAssetBytes('/icons/icon.png', binary), binary);
});

test('la revisione della shell è identica con EOL diversi', t => {
  const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sapori-shell-lf-'));
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sapori-shell-crlf-'));
  t.after(() => {
    fs.rmSync(firstRoot, { recursive: true, force: true });
    fs.rmSync(secondRoot, { recursive: true, force: true });
  });

  for (const directory of [firstRoot, secondRoot]) {
    fs.mkdirSync(path.join(directory, 'js'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'icons'), { recursive: true });
  }
  fs.writeFileSync(path.join(firstRoot, 'js', 'app.js'), 'uno\ndue\n');
  fs.writeFileSync(path.join(secondRoot, 'js', 'app.js'), 'uno\r\ndue\r\n');
  fs.writeFileSync(path.join(firstRoot, 'icons', 'icon.png'), Buffer.from([0, 13, 10, 255]));
  fs.writeFileSync(path.join(secondRoot, 'icons', 'icon.png'), Buffer.from([0, 13, 10, 255]));

  const assets = ['./js/app.js?v=4', './icons/icon.png'];
  assert.equal(
    calculateShellRevision(firstRoot, assets),
    calculateShellRevision(secondRoot, assets)
  );
});

test('rifiuta asset che escono dalla cartella del progetto', () => {
  assert.throws(
    () => resolveAssetFile(path.resolve('progetto'), './../segreto.txt'),
    /fuori dal progetto/
  );
});
