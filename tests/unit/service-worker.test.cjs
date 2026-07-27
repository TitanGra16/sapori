const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { projectRoot } = require('../helpers/load-app.cjs');

function loadWorker(overrides = {}) {
  const listeners = {};
  const added = [];
  let skipWaitingCalls = 0;
  const cache = {
    addAll: async assets => added.push(...assets),
    put: async () => {}
  };
  const context = {
    Response,
    URL,
    caches: {
      open: async () => cache,
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined
    },
    fetch: async () => new Response('ok'),
    self: {
      addEventListener: (name, listener) => { listeners[name] = listener; },
      clients: { claim: async () => {} },
      location: { origin: 'https://sapori.test' },
      skipWaiting: () => { skipWaitingCalls += 1; }
    },
    ...overrides
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(`${projectRoot}/sw.js`, 'utf8'), context);
  return { context, listeners, added, cache, skipWaitingCalls: () => skipWaitingCalls };
}

test('install pre-cachea la shell ma non forza l’attivazione', async () => {
  const worker = loadWorker();
  let installation;
  worker.listeners.install({ waitUntil: promise => { installation = promise; } });
  await installation;

  assert.ok(worker.added.includes('./index.html'));
  assert.ok(worker.added.includes('./js/bootstrap-theme.js'));
  assert.ok(worker.added.includes('./icons/icon-maskable-512.png'));
  assert.ok(!worker.added.includes('./test.html'));
  assert.equal(worker.skipWaitingCalls(), 0);
});

test('SKIP_WAITING viene accettato solo tramite messaggio esplicito', () => {
  const worker = loadWorker();
  worker.listeners.message({ data: { type: 'OTHER' } });
  assert.equal(worker.skipWaitingCalls(), 0);
  worker.listeners.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(worker.skipWaitingCalls(), 1);
});

test('la navigazione offline usa la shell HTML', async () => {
  const shell = new Response('<!doctype html><title>Sapori</title>', {
    headers: { 'content-type': 'text/html' }
  });
  const worker = loadWorker({
    fetch: async () => { throw new Error('offline'); },
    caches: {
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      keys: async () => [],
      delete: async () => true,
      match: async request => request === './index.html' ? shell : undefined
    }
  });

  let responsePromise;
  worker.listeners.fetch({
    request: {
      method: 'GET',
      mode: 'navigate',
      url: 'https://sapori.test/detail/1'
    },
    respondWith: promise => { responsePromise = promise; }
  });
  const response = await responsePromise;
  assert.match(await response.text(), /Sapori/);
});
