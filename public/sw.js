// マネコ家計簿 Service Worker
// 目的: ①ホーム画面追加(PWA)を満たす ②静的アセットをキャッシュしてオフラインでも起動する。
// 家計データは API 経由なので /api/ はキャッシュしない（常に最新・オフライン時は素直に失敗）。
const CACHE = 'maneko-v24';

// アプリの外殻（起動に最低限必要なもの）。?v は index.html と揃える。
const CORE = [
  '/',
  '/index.html',
  '/style.css?v=24',
  '/main.js?v=24',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // 一部が404でも全体を失敗させない（CDN等の取りこぼし対策）
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // 記録の保存など(POST/PUT)は素通し
  const url = new URL(req.url);

  // API は常にネットワーク（キャッシュしない）
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // 別オリジン: フォントだけ stale-while-revalidate、地図タイル等はキャッシュせず素通し
  if (url.origin !== self.location.origin) {
    if (/fonts\.(googleapis|gstatic)\.com$/.test(url.host)) {
      e.respondWith(staleWhileRevalidate(req));
    }
    return;
  }

  // ページ遷移(HTML): ネットワーク優先（新しい ?v を拾う）→ 失敗時キャッシュ（オフライン起動）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // 正常な自オリジンのHTMLだけを app shell として保存する。
          // 5xx/リダイレクト/エラーページを '/' に焼くと、オフライン時にそれが出てしまう。
          if (res.ok && res.type === 'basic' && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // 同一オリジンの静的アセット: stale-while-revalidate（速さ＋裏で更新）
  e.respondWith(staleWhileRevalidate(req));
});

function staleWhileRevalidate(req) {
  return caches.match(req).then((cached) => {
    const network = fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => cached);
    return cached || network;
  });
}
