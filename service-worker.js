const CACHE_NAME = "qalam-ahmar-v2";
const CORE_ASSETS = [
  "/index.html",
  "/assets/css/main.css",
  "/assets/css/rtl.css",
  "/pages/teacher-dashboard.html",
  "/js/teacher/dashboard.js",
  "/firebase-config.js",
  "/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // نحاول نخزن كل ملف على حدة، ولو واحد فشل نكمل الباقي من غير ما نوقف كل حاجة
      return Promise.all(
        CORE_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`⚠️ تعذر تخزين الملف: ${url}`, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});