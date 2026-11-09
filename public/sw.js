// Lets the app open with no internet. It only stores the app's own files.
// Business data and API calls are never touched or stored here.
const CACHE = 'thirumala-app-v1';
const INDEX = '/index.html';
const NAV_TIMEOUT_MS = 4000;

const assetsIn = html => {
  const found = [];
  const re = /(?:src|href)=["'](\/?assets\/[^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) found.push('/' + m[1].replace(/^\//, ''));
  return found;
};

const fetchIndex = async () => {
  const res = await fetch(INDEX, { cache: 'no-store' });
  if (!res.ok) throw new Error('index not available');
  return res;
};

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetchIndex();
      const html = await res.clone().text();
      await cache.put(INDEX, res);
      await Promise.all(assetsIn(html).map(url => cache.add(url).catch(() => undefined)));
    })()
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

// The page tells us which files it loaded before this worker was in control
self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_URLS' || !Array.isArray(event.data.urls)) return;
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(
        event.data.urls.map(async url => {
          if (!(await cache.match(url, { ignoreVary: true }))) await cache.add(url).catch(() => undefined);
        })
      )
    )
  );
});

// Old code files are removed once a new version of the app is in use
const removeOldCode = async (cache, html) => {
  const current = new Set(assetsIn(html).map(u => new URL(u, self.location.origin).pathname));
  const keys = await cache.keys();
  await Promise.all(
    keys.map(req => {
      const path = new URL(req.url).pathname;
      const isCode = /^\/assets\/.*\.(js|css)$/.test(path);
      return isCode && !current.has(path) ? cache.delete(req) : undefined;
    })
  );
};

const handleNavigation = async () => {
  const cache = await caches.open(CACHE);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS);
    const res = await fetch(INDEX, { cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('bad response');
    const html = await res.clone().text();
    await cache.put(INDEX, res.clone());
    removeOldCode(cache, html).catch(() => undefined);
    return res;
  } catch (err) {
    const cached = await cache.match(INDEX, { ignoreVary: true });
    if (cached) return cached;
    throw err;
  }
};

const cacheFirst = async request => {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') await cache.put(request, res.clone());
  return res;
};

const networkFirst = async request => {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    throw err;
  }
};

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation());
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
