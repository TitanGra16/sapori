const CACHE_NAME = 'sapori-v54';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/variables.css',
  './css/base.css',
  './css/components.css',
  './css/animations.css',
  './js/bootstrap-theme.js',
  './js/db.js',
  './js/utils.js',
  './js/theme.js',
  './js/recipes.js',
  './js/icons.js',
  './js/views.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png'
];

function isCacheable(response) {
  return Boolean(
    response &&
    response.ok &&
    response.type === 'basic'
  );
}

async function cacheResponse(request, response) {
  if (!isCacheable(response)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    const contentType = response.headers.get('content-type') || '';
    if (isCacheable(response) && contentType.includes('text/html')) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put('./index.html', response.clone());
    }
    return response;
  } catch (error) {
    const cachedShell = await caches.match('./index.html');
    return cachedShell || Response.error();
  }
}

async function handleAsset(event) {
  const request = event.request;
  const cached = await caches.match(request);
  const networkUpdate = fetch(request).then(async response => {
    await cacheResponse(request, response);
    return response;
  });

  if (cached) {
    event.waitUntil(networkUpdate.catch(() => undefined));
    return cached;
  }

  try {
    return await networkUpdate;
  } catch (error) {
    return Response.error();
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
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
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('sapori-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(handleAsset(event));
});
