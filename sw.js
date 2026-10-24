/**
 * The guide's service worker: what lets it open with no network, and lets a
 * downloaded gallery play from the phone instead of from the museum's wifi.
 *
 * Three kinds of request, three answers:
 *
 *   the app itself    index.html, js/, css/ - NETWORK FIRST. A deploy shows
 *                     up on the next load; the cached copy is only for when
 *                     the network is gone or slower than SLOW_MS.
 *   libraries         A-Frame, MindAR, the Firebase SDK - CACHE FIRST. Their
 *                     URLs carry an exact version, so they can never change.
 *   exhibit files     tracker, photos, videos, narration, models, release
 *                     manifests - CACHE FIRST, in a cache js/offline.js fills
 *                     with a progress bar. Every one of these URLs is
 *                     immutable: cloud files are named by a hash of their
 *                     bytes, and the repo bundle's carry its export stamp.
 *
 * <video> asks for byte ranges, and Safari will not play a video answered
 * with a plain 200, so a range request for a cached file is answered with
 * the slice it asked for.
 *
 * Never touched: the Studio, the photobooth wall and the old portal (they
 * want live data, always), Firebase's own APIs, and anything but GET.
 */
const SHELL_VERSION = 'shell-2026-10-24a';
const SHELL_CACHE = 'ar-' + SHELL_VERSION;
const ASSET_CACHE = 'ar-assets-v1';     // shared with js/offline.js - keep the name in step
const SLOW_MS = 3500;

const SCOPE = new URL(self.registration.scope);
const SHELL = [
  './', './index.html',
  './css/theme.css', './css/splash.css', './css/style.css', './css/shell.css',
  './js/logger.js', './js/config.js', './js/cloud/config.js', './js/content.js',
  './js/placement.js', './js/i18n.js', './js/offline.js', './js/capture.js',
  './js/app.js', './js/shell.js', './manifest.webmanifest', './assets/icons/icon.svg',
  // The repo bundle's index: fetched before this worker is in control on a
  // first visit, so it has to be fetched here too or an offline second visit
  // would have the files and no list of them.
  './assets/content/content.json',
];
const LIBRARIES = [
  'https://cdn.jsdelivr.net/npm/aframe@1.5.0/dist/aframe-master.min.js',
  'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // One at a time and forgiving: a missing icon must not stop the guide from
    // working offline.
    await Promise.all(SHELL.concat(LIBRARIES).map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith('ar-shell-') && n !== SHELL_CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

// ------------------------------------------------------------------ routing
function bypass(url) {
  if (url.origin === SCOPE.origin) {
    const inside = url.pathname.slice(SCOPE.pathname.length);
    return /^(studio|photobooth)(\/|$)/.test(inside) || inside === 'admin.html' || inside === 'sw.js';
  }
  // Firebase's APIs answer with live data or tokens; never from a cache.
  return /(^|\.)(firestore|identitytoolkit|securetoken|firebaseinstallations|firebaseappcheck|content-firebaseappcheck)\.googleapis\.com$/.test(url.hostname)
    || /recaptcha|google\.com$/.test(url.hostname)
    || (url.port === '8080' || url.port === '9099');     // the emulators
}

function isExhibitFile(url) {
  // Cloud Storage, real or emulated: /v0/b/<bucket>/o/<folder>%2F...
  if (/\/v0\/b\/[^/]+\/o\/(exhibits|tracker|releases|site)%2F/.test(url.pathname)) return true;
  // The repo bundle's files, once they carry an export stamp.
  return url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname + 'assets/content/') &&
         url.searchParams.has('v');
}

function isLibrary(url) {
  return (url.hostname === 'cdn.jsdelivr.net' && /@\d+\.\d+\.\d+/.test(url.pathname)) ||
         (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (bypass(url)) return;

  if (isExhibitFile(url)) { event.respondWith(exhibitFile(event)); return; }
  if (isLibrary(url)) { event.respondWith(cacheFirst(request, SHELL_CACHE)); return; }
  if (url.origin === SCOPE.origin) { event.respondWith(networkFirst(event)); }
});

// ------------------------------------------------------------------ strategies
async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone()).catch(() => {});
  return response;
}

/** Fresh when the network answers in time; the cached copy when it does not. */
async function networkFirst(event) {
  const request = event.request;
  const cache = await caches.open(SHELL_CACHE);
  const network = fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') {
      event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    }
    return response;
  });

  const cachedLater = new Promise((resolve) => setTimeout(resolve, SLOW_MS))
    .then(() => fallback(cache, request));
  try {
    const first = await Promise.race([network, cachedLater]);
    if (first) return first;
    return await network;      // nothing cached to fall back on: wait it out
  } catch (err) {
    const cached = await fallback(cache, request);
    if (cached) return cached;
    throw err;
  }
}

async function fallback(cache, request) {
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  // The guide is one page; any navigation inside it can be answered by it.
  if (request.mode === 'navigate') return cache.match('./index.html');
  // ?v= stamps and the like: the same file under a different query.
  return cache.match(request, { ignoreSearch: true, ignoreVary: true });
}

/**
 * An exhibit file, from the phone if it is there, from the network (and then
 * kept) if not - fetched whole even when a <video> asked for a range, so the
 * next play has all of it.
 */
async function exhibitFile(event) {
  const request = event.request;
  const cache = await caches.open(ASSET_CACHE);
  let response = await cache.match(request.url, { ignoreVary: true });

  if (!response) {
    try {
      response = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
    } catch (err) {
      // CORS not configured on the bucket, or offline: let the browser try it
      // its own way rather than failing outright.
      return fetch(request);
    }
    if (response.status === 200) event.waitUntil(cache.put(request.url, response.clone()).catch(() => {}));
  }

  const range = request.headers.get('range');
  if (range && response.status === 200) return slice(response, range);
  return response;
}

async function slice(response, header) {
  const blob = await response.blob();
  const size = blob.size;
  const m = /bytes=(\d*)-(\d*)/.exec(header);
  let start = 0;
  let end = size - 1;
  if (m && m[1]) {
    start = Number(m[1]);
    if (m[2]) end = Math.min(Number(m[2]), size - 1);
  } else if (m && m[2]) {
    start = Math.max(0, size - Number(m[2]));        // the last N bytes
  }
  if (start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
