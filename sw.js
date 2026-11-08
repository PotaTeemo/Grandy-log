// 오프라인에서도 앱이 열리도록 파일을 저장해 둡니다.
// 앱을 수정한 뒤에는 VERSION 숫자를 올려 주세요.
const VERSION = 'carlog-v6';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'sync.js', 'firebase-config.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 인터넷이 되면 최신 파일, 안 되면 저장된 파일 사용
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // 내 앱 파일과 Firebase 프로그램 파일만 저장 (클라우드 통신은 건드리지 않음)
  const url = new URL(e.request.url);
  if (url.origin !== location.origin && url.hostname !== 'www.gstatic.com') return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
