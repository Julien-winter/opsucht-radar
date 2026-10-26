// Bump this whenever the shell changes. Cache-first assets otherwise keep an
// old app.js in Android WebViews and can hide new consent/UI fixes.
const CACHE = 'opsucht-radar-shell-v7';
const REMOTE_ICON_HOSTS = new Set(['img.mc-api.io', 'items.opsucht.net', 'mc-api.io']);
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
self.addEventListener('message', event => {
  const message = event.data || {};
  if (message.type !== 'CACHE_ICONS' || !Array.isArray(message.urls)) return;
  const urls = message.urls.filter(value => {
    try { const url = new URL(String(value), self.location.origin); return REMOTE_ICON_HOSTS.has(url.hostname); }
    catch { return false; }
  }).slice(0, 500);
  event.waitUntil(caches.open(CACHE).then(async cache => {
    for (const value of urls) {
      try {
        const request = new Request(value, {mode: 'no-cors'});
        if (await cache.match(request)) continue;
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') await cache.put(request, response);
      } catch {}
    }
  }));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  const sameOrigin = url.origin === self.location.origin;
  const remoteIcon = !sameOrigin && REMOTE_ICON_HOSTS.has(url.hostname);
  // Only cache our own shell/API and the explicitly allow-listed item icons.
  // Other cross-origin requests remain untouched.
  if (!sameOrigin && !remoteIcon) return;
  if (remoteIcon) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok || response.type === 'opaque') {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request))));
    return;
  }
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
