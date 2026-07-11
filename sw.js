const CACHE_NAME = 'sapori-v16';

const STATIC_ASSETS = [
  './',
  './index.html',
  './test.html',
  './manifest.json',
  './css/variables.css',
  './css/base.css',
  './css/components.css',
  './css/animations.css',
  './js/db.js',
  './js/utils.js',
  './js/theme.js',
  './js/recipes.js',
  './js/icons.js',
  './js/views.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install — pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch — network-first for navigation, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Navigation requests: network-first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request)
      .then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
      .catch(() => {
        // Fallback for HTML navigation
        if (request.headers.get('accept') && request.headers.get('accept').includes('text/html')) {
          return caches.match('./index.html');
        }
      })
  );
});
