const CACHE_NAME = 'shopping-list-static-v2';
const STATIC_ASSETS = [
  '/styles.css',
  '/manifest.json',
  '/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
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
  // GETかつ静的アセット（css, svg, json等）のみキャッシュを優先
  const url = new URL(event.request.url);
  const isStatic = url.pathname.endsWith('.css') ||
                   url.pathname.endsWith('.svg') ||
                   url.pathname.endsWith('.json') ||
                   url.pathname.endsWith('.png');

  if (isStatic) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, resClone);
          });
          return res;
        });
      })
    );
  } else {
    // HTMLページやAPIは常にサーバー（最新データ）を取得
    event.respondWith(fetch(event.request));
  }
});
