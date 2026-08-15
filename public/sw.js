const CACHE_NAME = 'shopping-list-static-v4';
const STATIC_ASSETS = [
  '/styles.css?v=4',
  '/manifest.json',
  '/icons/icon.svg',
  '/sound.js?v=4',
  '/notify.js?v=4'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isStatic = url.pathname.endsWith('.css') ||
                   url.pathname.endsWith('.js') ||
                   url.pathname.endsWith('.svg') ||
                   url.pathname.endsWith('.json') ||
                   url.pathname.endsWith('.png');

  if (isStatic) {
    // 常に最新をサーバーから取得し、キャッシュを更新する（Network First）
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, resClone);
          });
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // HTMLページやAPIは常にサーバー直結
    event.respondWith(fetch(event.request));
  }
});

