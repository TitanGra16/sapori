'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  parseAppShell,
  resolveAssetFile
} = require('./check-project.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIRECTORY = path.resolve(PROJECT_ROOT, 'dist');
const STAGING_DIRECTORY = path.resolve(
  PROJECT_ROOT,
  `.dist-cloudflare-${process.pid}-${crypto.randomUUID()}`
);
const PREVIOUS_OUTPUT_DIRECTORY = path.resolve(
  PROJECT_ROOT,
  `.dist-cloudflare-previous-${process.pid}-${crypto.randomUUID()}`
);

const ROOT_FILES = Object.freeze([
  'index.html',
  'manifest.json',
  'sw.js'
]);

const PUBLISHABLE_ASSET_RULES = Object.freeze({
  css: new Set(['.css']),
  js: new Set(['.js']),
  icons: new Set(['.png'])
});

const CLOUDFLARE_HEADERS = path.resolve(
  PROJECT_ROOT,
  'deploy',
  'cloudflare',
  '_headers'
);

function isInsideProject(target) {
  const relative = path.relative(PROJECT_ROOT, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertSafeBuildPath(target, expectedName) {
  if (!isInsideProject(target) || path.dirname(target) !== PROJECT_ROOT || path.basename(target) !== expectedName) {
    throw new Error(`Percorso di build non sicuro: ${target}`);
  }
}

function assertRegularFile(source, label) {
  if (!fs.existsSync(source)) {
    throw new Error(`File richiesto mancante: ${label}`);
  }

  const stats = fs.lstatSync(source);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`La sorgente deve essere un file regolare: ${label}`);
  }
}

function resolvePublishableAsset(asset) {
  const resolved = resolveAssetFile(PROJECT_ROOT, asset);
  const relative = path.relative(PROJECT_ROOT, resolved.file);
  const segments = relative.split(path.sep);
  const rootDirectory = segments[0];
  const allowedExtensions = PUBLISHABLE_ASSET_RULES[rootDirectory];
  const extension = path.extname(resolved.file).toLowerCase();

  if (!allowedExtensions || !allowedExtensions.has(extension) ||
      segments.some(segment => segment.startsWith('.'))) {
    throw new Error(`Asset non autorizzato nella build pubblica: ${asset}`);
  }
  assertRegularFile(resolved.file, asset);
  return { source: resolved.file, relative };
}

function copyPublishableAsset(asset, destinationRoot) {
  const resolved = resolvePublishableAsset(asset);
  const destination = path.resolve(destinationRoot, resolved.relative);
  if (!destination.startsWith(destinationRoot + path.sep)) {
    throw new Error(`Destinazione asset non sicura: ${asset}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(resolved.source, destination, fs.constants.COPYFILE_EXCL);
}

function removeGeneratedDirectory(target) {
  if (!fs.existsSync(target)) return;

  const stats = fs.lstatSync(target);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`La destinazione esistente non e una cartella reale: ${target}`);
  }

  fs.rmSync(target, { recursive: true, force: false });
}

function buildSite() {
  assertSafeBuildPath(OUTPUT_DIRECTORY, 'dist');
  assertSafeBuildPath(STAGING_DIRECTORY, path.basename(STAGING_DIRECTORY));
  assertSafeBuildPath(PREVIOUS_OUTPUT_DIRECTORY, path.basename(PREVIOUS_OUTPUT_DIRECTORY));

  for (const file of ROOT_FILES) {
    assertRegularFile(path.resolve(PROJECT_ROOT, file), file);
  }
  assertRegularFile(CLOUDFLARE_HEADERS, 'deploy/cloudflare/_headers');
  const appShell = parseAppShell(
    fs.readFileSync(path.resolve(PROJECT_ROOT, 'sw.js'), 'utf8')
  );
  // "./" è l'alias HTTP di index.html usato dal service worker per evitare
  // il redirect /index.html -> / di Cloudflare. index.html viene già copiato
  // tra i file radice e non deve essere trattato come asset di sottocartella.
  const rootFiles = new Set([
    './',
    ...ROOT_FILES.map(file => `./${file}`)
  ]);
  const publishableAssets = appShell.filter(asset => !rootFiles.has(asset));

  if (fs.existsSync(STAGING_DIRECTORY)) {
    throw new Error(`La cartella temporanea esiste gia: ${STAGING_DIRECTORY}`);
  }

  fs.mkdirSync(STAGING_DIRECTORY);

  try {
    for (const file of ROOT_FILES) {
      fs.copyFileSync(
        path.resolve(PROJECT_ROOT, file),
        path.resolve(STAGING_DIRECTORY, file),
        fs.constants.COPYFILE_EXCL
      );
    }

    for (const asset of publishableAssets) {
      copyPublishableAsset(asset, STAGING_DIRECTORY);
    }

    fs.copyFileSync(
      CLOUDFLARE_HEADERS,
      path.resolve(STAGING_DIRECTORY, '_headers'),
      fs.constants.COPYFILE_EXCL
    );

    const hasPreviousOutput = fs.existsSync(OUTPUT_DIRECTORY);
    if (hasPreviousOutput) {
      const outputStats = fs.lstatSync(OUTPUT_DIRECTORY);
      if (outputStats.isSymbolicLink() || !outputStats.isDirectory()) {
        throw new Error(`La destinazione esistente non e una cartella reale: ${OUTPUT_DIRECTORY}`);
      }
      fs.renameSync(OUTPUT_DIRECTORY, PREVIOUS_OUTPUT_DIRECTORY);
    }

    try {
      fs.renameSync(STAGING_DIRECTORY, OUTPUT_DIRECTORY);
    } catch (error) {
      if (hasPreviousOutput && !fs.existsSync(OUTPUT_DIRECTORY)) {
        fs.renameSync(PREVIOUS_OUTPUT_DIRECTORY, OUTPUT_DIRECTORY);
      }
      throw error;
    }

    if (hasPreviousOutput) {
      removeGeneratedDirectory(PREVIOUS_OUTPUT_DIRECTORY);
    }
  } catch (error) {
    if (fs.existsSync(STAGING_DIRECTORY)) {
      fs.rmSync(STAGING_DIRECTORY, { recursive: true, force: true });
    }
    if (fs.existsSync(PREVIOUS_OUTPUT_DIRECTORY) && !fs.existsSync(OUTPUT_DIRECTORY)) {
      fs.renameSync(PREVIOUS_OUTPUT_DIRECTORY, OUTPUT_DIRECTORY);
    }
    throw error;
  }

  console.log(
    `Build Cloudflare pronta in dist: ${ROOT_FILES.length} file radice, ` +
    `${publishableAssets.length} asset autorizzati e _headers.`
  );
}

if (require.main === module) {
  try {
    buildSite();
  } catch (error) {
    console.error(`Build Cloudflare non riuscita: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  OUTPUT_DIRECTORY,
  PUBLISHABLE_ASSET_RULES,
  ROOT_FILES,
  buildSite
};
