/* Quiet Pages updater: checks published app files without touching journal data.
 * The journal is stored separately in window.localStorage, not in these caches.
 * Subsequent releases do not require changing this worker or a version number.
 */
const SHELL_CACHE = 'quietpages-shell-auto-v2';
const STAGING_CACHE = 'quietpages-shell-staging-v2';
const SHELL_FILES = [
  './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png'
];
const ROOT_URL = new URL('./', self.registration.scope).href;
const urlFor = (path) => new URL(path, self.registration.scope).href;
let checking = null;
let applying = null;

async function precache() {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(['./', ...SHELL_FILES].map(path => new Request(urlFor(path), {cache:'reload'})));
}

self.addEventListener('install', event => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('quietpages-') &&
      key !== SHELL_CACHE && key !== STAGING_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (request.method !== 'GET' || url.origin !== scope.origin ||
      !url.pathname.startsWith(scope.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Always serve the matched release while the user is writing.
    const key = request.mode === 'navigate' ? urlFor('./index.html') : request;
    const cached = await cache.match(key, {ignoreSearch:true});
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      if (request.mode === 'navigate') {
        const offlinePage = await cache.match(urlFor('./index.html'));
        if (offlinePage) return offlinePage;
      }
      return Response.error();
    }
  })());
});

async function equalResponseBodies(first, second) {
  if (!first || !second) return false;
  const [a, b] = await Promise.all([first.arrayBuffer(), second.arrayBuffer()]);
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a), y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

async function stagePublishedRelease() {
  const current = await caches.open(SHELL_CACHE);
  // Fetch every file directly from the published website, bypassing browser HTTP cache
  // and this worker's cache-first fetch handler.
  const downloads = await Promise.all(SHELL_FILES.map(async path => {
    const url = urlFor(path);
    const response = await fetch(new Request(url, {cache:'no-store'}));
    if (!response.ok || (response.type !== 'basic' && response.type !== 'default')) {
      throw new Error('An application file is temporarily unavailable.');
    }
    return {url, response};
  }));
  let changed = false;
  for (const {url, response} of downloads) {
    const existing = await current.match(url);
    if (!await equalResponseBodies(existing, response.clone())) {
      changed = true;
      break;
    }
  }
  if (!changed) {
    await caches.delete(STAGING_CACHE);
    return false;
  }
  await caches.delete(STAGING_CACHE);
  const staged = await caches.open(STAGING_CACHE);
  for (const {url, response} of downloads) {
    await staged.put(url, response.clone());
    if (url === urlFor('./index.html')) await staged.put(ROOT_URL, response.clone());
  }
  return true;
}

async function applyStagedRelease() {
  if (!await caches.has(STAGING_CACHE)) {
    throw new Error('Update is no longer ready. Check again while online.');
  }
  const staged = await caches.open(STAGING_CACHE);
  const current = await caches.open(SHELL_CACHE);
  const allUrls = [ROOT_URL, ...SHELL_FILES.map(urlFor)];
  // Validate that all files are staged before changing the active cache.
  const files = await Promise.all(allUrls.map(async url => {
    const response = await staged.match(url);
    if (!response) throw new Error('Incomplete update. Check again.');
    return {url, response};
  }));
  for (const {url, response} of files) await current.put(url, response);
  await caches.delete(STAGING_CACHE);
}

self.addEventListener('message', event => {
  const message = event.data || {};
  if (message.type === 'CHECK_FOR_UPDATES') {
    event.waitUntil((async () => {
      try {
        if (!checking) checking = stagePublishedRelease().finally(() => {checking = null;});
        const available = await checking;
        event.source?.postMessage({type: available ? 'UPDATE_AVAILABLE' : 'UPDATE_NONE'});
      } catch (_) {
        event.source?.postMessage({type:'UPDATE_CHECK_FAILED'});
      }
    })());
  }
  if (message.type === 'APPLY_UPDATE') {
    event.waitUntil((async () => {
      try {
        if (checking) await checking;
        if (!applying) applying = applyStagedRelease().finally(() => {applying = null;});
        await applying;
        event.ports[0]?.postMessage({type:'UPDATE_APPLIED'});
      } catch (error) {
        event.ports[0]?.postMessage({type:'UPDATE_APPLY_FAILED', message: error.message});
      }
    })());
  }
});
