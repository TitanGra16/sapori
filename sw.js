const APP_SHELL_REVISION = 'e5f95479c26149bec994965242c01ec66b2dd702b3c0f566d50c02a0cfce2011';

const SCOPE_URL = new URL(self.registration.scope);
const CACHE_PREFIX = 'sapori-' + encodeURIComponent(SCOPE_URL.pathname) + '-';
const CACHE_NAME = CACHE_PREFIX + 'v60-' + APP_SHELL_REVISION.slice(0, 12);
const SHELL_URL = new URL('./index.html', SCOPE_URL).href;

const APP_SHELL = [
  './index.html',
  './manifest.json',
  './css/variables.css',
  './css/base.css',
  './css/components.css',
  './css/pages/cooking.css',
  './css/animations.css',
  './css/pages/account.css',
  './css/pages/drafts.css',
  './css/pages/draft-library.css',
  './css/pages/data-protection.css',
  './css/print/print.css',
  './js/bootstrap-theme.js',
  './js/drafts/draft-store.js',
  './js/drafts/draft-manager.js',
  './js/drafts/draft-schema.js',
  './js/drafts/draft-identity.js',
  './js/drafts/draft-catalog.js',
  './js/data/storage-health.js',
  './js/sync/sync-preparation.js',
  './js/print/print-service.js',
  './js/print/cookbook-builder.js',
  './js/print/print-progress-view.js',
  './js/print/print-recipe-view.js',
  './js/db.js',
  './js/utils.js',
  './js/theme.js',
  './js/recipes.js',
  './js/icons.js',
  './js/account/account-view.js',
  './js/views.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png'
];

const STATIC_ASSET_URLS = new Set(
  APP_SHELL.map(asset => new URL(asset, SCOPE_URL).href)
);

function errorResponse() {
  return typeof Response.error === 'function'
    ? Response.error()
    : new Response('', { status: 503 });
}

async function matchCurrentCache(request) {
  try {
    return await caches.match(request, { cacheName: CACHE_NAME });
  } catch (error) {
    // Un problema temporaneo di CacheStorage non deve impedire l'uso online.
    return undefined;
  }
}

async function handleNavigation(request) {
  const cachedShell = await matchCurrentCache(SHELL_URL);
  if (cachedShell) return cachedShell;

  // L'installazione della shell è atomica. La rete viene usata solo come
  // ultima risorsa se la cache è stata rimossa o danneggiata.
  try {
    return await fetch(request);
  } catch (error) {
    return errorResponse();
  }
}

async function handleAsset(request) {
  const cached = await matchCurrentCache(request);
  if (cached) return cached;

  // Non scrivere mai nella cache di una revisione già installata: HTML, CSS e
  // JavaScript devono provenire tutti dalla stessa versione della shell.
  try {
    return await fetch(request);
  } catch (error) {
    return errorResponse();
  }
}

self.addEventListener('install', event => {
  const requests = APP_SHELL.map(asset => new Request(
    new URL(asset, SCOPE_URL),
    { cache: 'reload' }
  ));

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(requests))
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .catch(() => [])
      .then(keys => Promise.allSettled(
        keys
          .filter(key => (
            (key.startsWith(CACHE_PREFIX) || /^sapori-v\d+(?:-[a-f0-9]{12})?$/.test(key)) &&
            key !== CACHE_NAME
          ))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (
    requestUrl.origin !== SCOPE_URL.origin ||
    !requestUrl.pathname.startsWith(SCOPE_URL.pathname)
  ) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  // Endpoint applicativi e URL non dichiarati restano interamente alla rete.
  if (!STATIC_ASSET_URLS.has(requestUrl.href)) return;

  event.respondWith(handleAsset(request));
});
