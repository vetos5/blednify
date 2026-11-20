/*
 * Blednify web app: offline shell (registered by src/core/offline-shell.ts, production web builds only).
 *
 * Without it, the iPhone home-screen app opened with no connection shows Safari's error page instead of the app
 * (its playlists, likes and settings live on the phone). Rules:
 * - Pages (navigations): network first, so every online launch gets the latest index.html and with it the latest
 *   bundles; no update prompt and no stale app pinned by the cache. Without an answer within NAV_TIMEOUT_MS (no
 *   connection, or a home server that can't be reached from here) the last shell is served instead. Each fresh
 *   shell is stored, and the bundles it names are fetched into the cache right away, so the next offline start has
 *   everything even if this one ran before the worker was installed.
 * - Hashed files (/_expo/, /assets/): immutable, so cache first; the cache keeps the newest MAX_ASSETS of them.
 * - Everything else (the API, streams, artwork, other origins) is left to the network untouched.
 * Cached responses keep their headers, so the shell stays cross-origin isolated (COOP/COEP) when served from here.
 */
const SHELL_CACHE = 'blednify-shell-v1';
const ASSET_CACHE = 'blednify-assets-v1';
const SHELL_KEY = '/';
const NAV_TIMEOUT_MS = 4000;
const MAX_ASSETS = 200;

const isHashed = (path) => path.startsWith('/_expo/') || path.startsWith('/assets/');

/** Same-origin hashed files an index.html loads (its script and link tags). */
function shellAssets(html) {
  const out = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/(?:_expo|assets)\/[^"]+)"/g)) out.add(m[1]);
  return [...out];
}

async function trimAssets() {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  // Oldest first (insertion order); old builds' bundles go before the ones in use.
  for (const req of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(req);
}

async function storeShell(res) {
  const shell = await caches.open(SHELL_CACHE);
  await shell.put(SHELL_KEY, res.clone());
  const assets = await caches.open(ASSET_CACHE);
  for (const path of shellAssets(await res.text())) {
    if (await assets.match(path)) continue;
    try {
      const r = await fetch(path);
      if (r.ok) await assets.put(path, r);
    } catch {
      // Offline again; the next launch fills it in.
    }
  }
  await trimAssets();
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function page(event) {
  const network = fetch(event.request);
  try {
    const res = await withTimeout(network, NAV_TIMEOUT_MS);
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) event.waitUntil(storeShell(res.clone()));
    return res;
  } catch {
    const cached = await (await caches.open(SHELL_CACHE)).match(SHELL_KEY);
    // Nothing stored yet: keep waiting on the network (it may just be slow) and let it fail as it would have.
    return cached || network;
  }
}

async function hashed(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.status === 200) await cache.put(request, res.clone());
  return res;
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('blednify-') && n !== SHELL_CACHE && n !== ASSET_CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') event.respondWith(page(event));
  else if (isHashed(url.pathname) && !req.headers.has('range')) event.respondWith(hashed(req));
});
