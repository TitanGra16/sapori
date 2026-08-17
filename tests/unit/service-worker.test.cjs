const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { projectRoot } = require('../helpers/load-app.cjs');

function loadWorker(overrides = {}) {
  const listeners = {};
  const added = [];
  const opened = [];
  const deleted = [];
  const cacheKeys = overrides.cacheKeys || [];
  const scope = overrides.scope || 'https://sapori.test/';
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  let fetchCalls = 0;
  let cachePutCalls = 0;

  const cache = overrides.cache || {
    addAll: async requests => added.push(...requests),
    match: async request => (
      typeof overrides.match === 'function'
        ? overrides.match(request)
        : undefined
    ),
    put: async () => {
      cachePutCalls += 1;
    }
  };
  const cacheStorage = overrides.caches || {
    open: async name => {
      opened.push(name);
      return cache;
    },
    match: async request => cache.match(request),
    keys: async () => cacheKeys.slice(),
    delete: async key => {
      deleted.push(key);
      return true;
    }
  };

  const context = {
    Request,
    Response,
    URL,
    Set,
    console: {
      log: () => {},
      error: () => {},
      warn: () => {}
    },
    caches: cacheStorage,
    fetch: async request => {
      fetchCalls += 1;
      if (typeof overrides.fetch === 'function') return overrides.fetch(request);
      return new Response('rete');
    },
    self: {
      addEventListener: (name, listener) => { listeners[name] = listener; },
      clients: {
        claim: async () => { claimCalls += 1; }
      },
      location: {
        origin: new URL(scope).origin,
        href: new URL('./sw.js', scope).href
      },
      registration: { scope },
      skipWaiting: () => { skipWaitingCalls += 1; }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(`${projectRoot}/sw.js`, 'utf8'), context);

  return {
    listeners,
    added,
    opened,
    deleted,
    cache,
    skipWaitingCalls: () => skipWaitingCalls,
    claimCalls: () => claimCalls,
    fetchCalls: () => fetchCalls,
    cachePutCalls: () => cachePutCalls
  };
}

async function install(worker) {
  let promise;
  worker.listeners.install({ waitUntil: value => { promise = value; } });
  await promise;
}

async function activate(worker) {
  let promise;
  worker.listeners.activate({ waitUntil: value => { promise = value; } });
  await promise;
}

function fetchThroughWorker(worker, request) {
  let responsePromise;
  worker.listeners.fetch({
    request,
    respondWith: value => { responsePromise = value; }
  });
  return responsePromise;
}

test('precachea con reload tutti gli asset nello scope senza attivarsi da solo', async () => {
  const worker = loadWorker({ scope: 'https://sapori.test/ricettario/' });
  await install(worker);

  assert.match(
    worker.opened[0],
    /^sapori-%2Fricettario%2F-v\d+-[a-f0-9]{12}$/
  );
  assert.ok(worker.added.every(request => request instanceof Request));
  assert.ok(worker.added.every(request => request.cache === 'reload'));
  assert.ok(worker.added.some(request => (
    request.url === 'https://sapori.test/ricettario/'
  )));
  assert.ok(!worker.added.some(request => request.url.endsWith('/index.html')));
  assert.ok(worker.added.some(request => (
    request.url === 'https://sapori.test/ricettario/js/bootstrap-theme.js'
  )));
  assert.ok(worker.added.some(request => (
    request.url === 'https://sapori.test/ricettario/icons/icon-maskable-512.png'
  )));
  assert.ok(worker.added.every(request => request.url.startsWith('https://sapori.test/ricettario/')));
  assert.equal(worker.skipWaitingCalls(), 0);
});

test('SKIP_WAITING viene accettato solo tramite messaggio esplicito', () => {
  const worker = loadWorker();
  worker.listeners.message({ data: { type: 'OTHER' } });
  assert.equal(worker.skipWaitingCalls(), 0);
  worker.listeners.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(worker.skipWaitingCalls(), 1);
});

test('la navigazione offline usa la shell dello scope corrente', async () => {
  const scope = 'https://sapori.test/ricettario/';
  const shell = new Response('<!doctype html><title>Sapori</title>', {
    headers: { 'content-type': 'text/html' }
  });
  const worker = loadWorker({
    scope,
    match: async request => (
      request === scope ? shell : undefined
    ),
    fetch: async () => {
      throw new Error('offline');
    }
  });

  const response = await fetchThroughWorker(worker, {
    method: 'GET',
    mode: 'navigate',
    url: `${scope}dettaglio/1`
  });

  assert.match(await response.text(), /Sapori/);
  assert.equal(worker.fetchCalls(), 0);
});

test('una shell mancante usa la rete come ultima risorsa', async () => {
  const worker = loadWorker({
    fetch: async () => new Response('<title>Recuperata dalla rete</title>')
  });

  const response = await fetchThroughWorker(worker, {
    method: 'GET',
    mode: 'navigate',
    url: 'https://sapori.test/ricetta/1'
  });

  assert.match(await response.text(), /Recuperata dalla rete/);
  assert.equal(worker.fetchCalls(), 1);
  assert.equal(worker.cachePutCalls(), 0);
});

test('un errore di CacheStorage non blocca la navigazione online', async () => {
  const worker = loadWorker({
    caches: {
      match: async () => { throw new Error('CacheStorage non disponibile'); }
    },
    fetch: async () => new Response('<title>Risposta dalla rete</title>')
  });

  const response = await fetchThroughWorker(worker, {
    method: 'GET',
    mode: 'navigate',
    url: 'https://sapori.test/ricetta/1'
  });

  assert.match(await response.text(), /Risposta dalla rete/);
  assert.equal(worker.fetchCalls(), 1);
});

test('un errore di CacheStorage non blocca un asset dichiarato online', async () => {
  const worker = loadWorker({
    caches: {
      match: async () => { throw new Error('CacheStorage non disponibile'); }
    },
    fetch: async () => new Response('asset dalla rete')
  });

  const response = await fetchThroughWorker(worker, {
    method: 'GET',
    mode: 'same-origin',
    url: 'https://sapori.test/js/app.js'
  });

  assert.equal(await response.text(), 'asset dalla rete');
  assert.equal(worker.fetchCalls(), 1);
  assert.equal(worker.cachePutCalls(), 0);
});

test('un aggiornamento non sovrascrive gli asset della revisione attiva', async () => {
  const cachedAsset = new Response('versione coerente');
  const worker = loadWorker({
    match: async request => (
      request.url === 'https://sapori.test/js/app.js' ? cachedAsset : undefined
    ),
    fetch: async () => new Response('versione nuova non ancora attiva')
  });

  const response = await fetchThroughWorker(worker, {
    method: 'GET',
    mode: 'same-origin',
    url: 'https://sapori.test/js/app.js'
  });

  assert.equal(await response.text(), 'versione coerente');
  assert.equal(worker.fetchCalls(), 0);
  assert.equal(worker.cachePutCalls(), 0);
});

test('un asset dichiarato ma assente dalla cache usa la rete senza mutare la revisione', async () => {
  const networkResponse = new Response('recuperato');
  const worker = loadWorker({
    fetch: async () => networkResponse
  });

  const response = await fetchThroughWorker(worker, {
    method: 'GET',
    mode: 'same-origin',
    url: 'https://sapori.test/css/base.css'
  });

  assert.equal(response, networkResponse);
  assert.equal(worker.fetchCalls(), 1);
  assert.equal(worker.cachePutCalls(), 0);
});

test('attivando elimina solo vecchie cache dello stesso scope e cache legacy', async () => {
  const cacheKeys = [
    'sapori-%2Fricettario%2F-v59-111111111111',
    'sapori-%2Faltra%2F-v59-222222222222',
    'sapori-v58',
    'cache-di-un-altra-app'
  ];
  const worker = loadWorker({
    scope: 'https://sapori.test/ricettario/',
    cacheKeys
  });

  await install(worker);
  const currentCache = worker.opened[0];
  cacheKeys.push(currentCache);
  await activate(worker);

  assert.ok(!worker.deleted.includes(currentCache));
  assert.deepEqual(worker.deleted.sort(), [
    'sapori-%2Fricettario%2F-v59-111111111111',
    'sapori-v58'
  ]);
  assert.equal(worker.claimCalls(), 1);
});

test('un errore di pulizia non impedisce al worker di prendere il controllo', async () => {
  const worker = loadWorker({
    scope: 'https://sapori.test/ricettario/',
    caches: {
      keys: async () => ['sapori-%2Fricettario%2F-v1-111111111111'],
      delete: async () => { throw new Error('Cache occupata'); }
    }
  });

  await activate(worker);
  assert.equal(worker.claimCalls(), 1);
});

test('un errore nell’elenco cache non impedisce al worker di prendere il controllo', async () => {
  const worker = loadWorker({
    caches: {
      keys: async () => { throw new Error('CacheStorage non disponibile'); }
    }
  });

  await activate(worker);
  assert.equal(worker.claimCalls(), 1);
});

test('non intercetta richieste same-origin non dichiarate o con query diversa', () => {
  const worker = loadWorker();

  assert.equal(fetchThroughWorker(worker, {
    method: 'GET',
    mode: 'same-origin',
    url: 'https://sapori.test/api/ricette'
  }), undefined);
  assert.equal(fetchThroughWorker(worker, {
    method: 'GET',
    mode: 'same-origin',
    url: 'https://sapori.test/js/app.js?v=diversa'
  }), undefined);
  assert.equal(worker.fetchCalls(), 0);
});

test('ignora richieste non GET, origini esterne e navigazioni fuori scope', () => {
  const worker = loadWorker({ scope: 'https://sapori.test/ricettario/' });

  assert.equal(fetchThroughWorker(worker, {
    method: 'POST',
    mode: 'same-origin',
    url: 'https://sapori.test/js/app.js'
  }), undefined);
  assert.equal(fetchThroughWorker(worker, {
    method: 'GET',
    mode: 'cors',
    url: 'https://cdn.example.test/js/app.js'
  }), undefined);
  assert.equal(fetchThroughWorker(worker, {
    method: 'GET',
    mode: 'navigate',
    url: 'https://sapori.test/altra-app/'
  }), undefined);
  assert.equal(worker.fetchCalls(), 0);
});
