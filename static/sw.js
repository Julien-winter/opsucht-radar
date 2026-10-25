// Bump this whenever the shell changes. Cache-first assets otherwise keep an
// old app.js in Android WebViews and can hide new consent/UI fixes.
const CACHE = 'opsucht-radar-shell-v3';
const SHELL = [
  '/',
  '/static/index.html',
  '/static/style.css',
  '/static/overrides.css',
  '/static/theme.css',
  '/static/layout.css',
  '/static/merchant.css',
  '/static/app.js',
  '/static/opsucht-favicon.png',
  '/static/opsucht-logo.png',
  '/static/opsucht-mark.svg',
  '/static/stoneplatten-icon.png',
  '/static/manifest.webmanifest'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  // API responses are live data; never let the shell worker serve stale prices.
  if (url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put('/', copy));
      return response;
    }).catch(() => caches.match('/')));
    return;
  }
  const asset = /\.(?:js|css|html|webmanifest|svg)$/i.test(url.pathname);
  if (asset) {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
      return response;
    }).catch(() => caches.match(request)));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
    return response;
  })));
});
