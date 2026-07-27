const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..', '..');

function loadAppScripts(files, additions = {}) {
  const context = {
    Blob,
    DOMException,
    Intl,
    Response,
    TextDecoder,
    TextEncoder,
    URL,
    clearInterval,
    clearTimeout,
    console,
    crypto: globalThis.crypto,
    queueMicrotask,
    setInterval,
    setTimeout,
    structuredClone,
    ...additions
  };

  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  for (const file of files) {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }

  return context;
}

module.exports = { loadAppScripts, projectRoot };
