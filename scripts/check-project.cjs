const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const TEXT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.map',
  '.svg',
  '.txt',
  '.webmanifest',
  '.xml'
]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function skipWhitespaceAndComments(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source.startsWith('//', index)) {
      const lineEnd = source.indexOf('\n', index + 2);
      return lineEnd === -1
        ? source.length
        : skipWhitespaceAndComments(source, lineEnd + 1);
    }
    if (source.startsWith('/*', index)) {
      const commentEnd = source.indexOf('*/', index + 2);
      if (commentEnd === -1) throw new Error('Commento APP_SHELL non terminato');
      index = commentEnd + 2;
      continue;
    }
    break;
  }
  return index;
}

function decodeEscape(source, index) {
  const escaped = source[index];
  const simple = {
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
    0: '\0'
  };
  if (Object.hasOwn(simple, escaped)) {
    return { value: simple[escaped], next: index + 1 };
  }
  if (escaped === 'u') {
    const digits = source.slice(index + 1, index + 5);
    if (!/^[a-f0-9]{4}$/i.test(digits)) {
      throw new Error('Escape Unicode APP_SHELL non valido');
    }
    return {
      value: String.fromCharCode(Number.parseInt(digits, 16)),
      next: index + 5
    };
  }
  return { value: escaped, next: index + 1 };
}

function parseStringArray(source, start) {
  const values = [];
  let index = start;
  let expectValue = true;

  while (index < source.length) {
    index = skipWhitespaceAndComments(source, index);
    const current = source[index];

    if (current === ']') return { values, end: index + 1 };
    if (!expectValue && current === ',') {
      expectValue = true;
      index += 1;
      continue;
    }
    if (!expectValue || (current !== '"' && current !== "'")) {
      throw new Error('APP_SHELL deve contenere solo stringhe separate da virgole');
    }

    const quote = current;
    let value = '';
    let closed = false;
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === quote) {
        closed = true;
        index += 1;
        break;
      }
      if (character === '\\') {
        const decoded = decodeEscape(source, index + 1);
        value += decoded.value;
        index = decoded.next;
        continue;
      }
      value += character;
      index += 1;
    }
    if (!closed) throw new Error('Stringa APP_SHELL non terminata');
    values.push(value);
    expectValue = false;
  }

  throw new Error('APP_SHELL non terminata');
}

function parseAppShell(serviceWorker) {
  const declaration = /\bconst\s+APP_SHELL\s*=\s*\[/.exec(serviceWorker);
  if (!declaration) throw new Error('APP_SHELL non trovata nel service worker');
  const parsed = parseStringArray(serviceWorker, declaration.index + declaration[0].length);
  return parsed.values;
}

function decodeHtmlAttribute(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function normalizeAssetReference(value) {
  const decoded = decodeHtmlAttribute(value.trim());
  if (!decoded.startsWith('./')) return null;
  const hashIndex = decoded.indexOf('#');
  const withoutHash = hashIndex === -1 ? decoded : decoded.slice(0, hashIndex);
  return withoutHash === './' ? null : withoutHash;
}

function extractLocalAssetsFromHtml(html) {
  const assets = [];
  const attributePattern = /(?:^|[\s<])(?:src|href)\s*=\s*(["'])(.*?)\1/gis;
  for (const match of html.matchAll(attributePattern)) {
    const asset = normalizeAssetReference(match[2]);
    if (asset) assets.push(asset);
  }
  return assets;
}

function resolveAssetFile(rootDirectory, asset) {
  let rawPath;
  try {
    rawPath = decodeURIComponent(asset.split(/[?#]/, 1)[0]);
  } catch (error) {
    assert.fail(`Asset con codifica URL non valida: ${asset}`);
  }
  assert.ok(
    !rawPath.split('/').includes('..'),
    `Asset fuori dal progetto: ${asset}`
  );

  const parsed = new URL(asset, 'https://sapori.invalid/');
  assert.equal(parsed.origin, 'https://sapori.invalid', `Asset non locale: ${asset}`);

  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch (error) {
    assert.fail(`Asset con codifica URL non valida: ${asset}`);
  }

  const relative = pathname.replace(/^\/+/, '').split('/').join(path.sep);
  const file = path.resolve(rootDirectory, relative);
  assert.ok(
    file.startsWith(rootDirectory + path.sep),
    `Asset fuori dal progetto: ${asset}`
  );
  return { file, pathname };
}

function normalizeAssetBytes(pathname, bytes) {
  if (!TEXT_EXTENSIONS.has(path.extname(pathname).toLowerCase())) return bytes;
  return Buffer.from(bytes.toString('utf8').replace(/\r\n?|\u2028|\u2029/g, '\n'), 'utf8');
}

function calculateShellRevision(rootDirectory, appShell) {
  const shellHash = crypto.createHash('sha256');
  for (const asset of appShell.slice().sort()) {
    const { file, pathname } = resolveAssetFile(rootDirectory, asset);
    shellHash.update(asset, 'utf8');
    shellHash.update(Buffer.from([0]));
    shellHash.update(normalizeAssetBytes(pathname, fs.readFileSync(file)));
    shellHash.update(Buffer.from([0]));
  }
  return shellHash.digest('hex');
}

function runChecks() {
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
  assert.doesNotMatch(
    index,
    /<script(?![^>]*\bsrc=)[^>]*>/i,
    'index.html contiene uno script inline'
  );

  const variables = fs.readFileSync(path.join(root, 'css', 'variables.css'), 'utf8');
  assert.doesNotMatch(variables, /fonts\.googleapis\.com/i, 'I font devono funzionare offline');

  function pngSize(file) {
    const bytes = fs.readFileSync(file);
    assert.equal(
      bytes.subarray(0, 8).toString('hex'),
      '89504e470d0a1a0a',
      `${file} non è un PNG`
    );
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }

  for (const icon of manifest.icons) {
    const { file } = resolveAssetFile(root, icon.src);
    const expected = icon.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(file), expected, `${icon.src} ha dimensioni errate`);
  }

  const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.doesNotMatch(serviceWorker, /test\.html/);
  assert.match(serviceWorker, /js\/bootstrap-theme\.js/);
  assert.match(serviceWorker, /SKIP_WAITING/);
  assert.match(
    serviceWorker,
    /const CACHE_PREFIX = 'sapori-' \+ encodeURIComponent\(SCOPE_URL\.pathname\) \+ '-';/,
    'Il nome cache deve essere isolato per scope'
  );
  assert.match(
    serviceWorker,
    /const CACHE_NAME = CACHE_PREFIX \+ 'v\d+-' \+ APP_SHELL_REVISION\.slice\(0, 12\);/,
    'CACHE_NAME deve includere scope, versione e revisione della shell'
  );
  assert.match(
    serviceWorker,
    /\{\s*cache:\s*['"]reload['"]\s*\}/,
    'Il precache deve ignorare la cache HTTP'
  );
  assert.doesNotMatch(
    serviceWorker,
    /\.put\s*\(/,
    'La cache di revisione deve restare immutabile dopo il precache'
  );

  const appShell = parseAppShell(serviceWorker);
  assert.ok(appShell.length > 0, 'APP_SHELL è vuota');
  assert.equal(new Set(appShell).size, appShell.length, 'APP_SHELL contiene percorsi duplicati');
  assert.ok(!appShell.includes('./'), 'APP_SHELL non deve duplicare index.html tramite "./"');
  for (const asset of appShell) {
    assert.ok(asset.startsWith('./'), `Percorso APP_SHELL non relativo: ${asset}`);
  }

  const revisionMatch = serviceWorker.match(
    /const APP_SHELL_REVISION = '([a-f0-9]{64})';/
  );
  assert.ok(revisionMatch, 'APP_SHELL_REVISION SHA-256 non trovata');

  const requiredShellAssets = new Set([
    './index.html',
    ...extractLocalAssetsFromHtml(index),
    ...manifest.icons.map(icon => normalizeAssetReference(icon.src)).filter(Boolean)
  ]);

  for (const asset of appShell) {
    const { file } = resolveAssetFile(root, asset);
    assert.ok(
      fs.existsSync(file) && fs.statSync(file).isFile(),
      `Asset APP_SHELL mancante o non valido: ${asset}`
    );
    assert.ok(requiredShellAssets.has(asset), `Asset APP_SHELL non referenziato: ${asset}`);
  }
  for (const asset of requiredShellAssets) {
    assert.ok(appShell.includes(asset), `Asset locale assente da APP_SHELL: ${asset}`);
  }

  const calculatedRevision = calculateShellRevision(root, appShell);
  assert.equal(
    revisionMatch[1],
    calculatedRevision,
    `APP_SHELL_REVISION non aggiornata: usa ${calculatedRevision}`
  );

  console.log(
    `Controlli statici superati: ${scriptFiles.length} script, ` +
    `${manifest.icons.length} icone, shell ${calculatedRevision.slice(0, 12)}.`
  );
}

if (require.main === module) runChecks();

module.exports = {
  calculateShellRevision,
  extractLocalAssetsFromHtml,
  normalizeAssetBytes,
  normalizeAssetReference,
  parseAppShell,
  resolveAssetFile
};
