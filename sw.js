// Stale-while-revalidate: the app opens instantly from cache and quietly updates
// in the background, so a plain refresh is enough to pick up changes. No version
// bumping needed for edits to the files below.
const CACHE = "metron-v3";
const SHELL = [
  "./", "./index.html", "./styles.css", "./chords.js", "./app.js",
  "./manifest.webmanifest",
  "./assets/pretendard-subset.woff2",
  "./assets/icon-192.png", "./assets/icon-512.png", "./assets/icon-180.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req).then(hit => {
        const net = fetch(req).then(res => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    )
  );
});
