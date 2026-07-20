const CACHE_NAME = "qalam-ahmar-v3"; // v2 -> v3: عشان نضيف خطوط Cairo للكاش
const CORE_ASSETS = [
  "/index.html",
  "/assets/css/main.css",
  "/assets/css/rtl.css",
  "/pages/teacher-dashboard.html",
  "/js/teacher/dashboard.js",
  "/firebase-config.js",
  "/manifest.json",
  "/assets/fonts/cairo-arabic-400-normal.woff2",
  "/assets/fonts/cairo-arabic-600-normal.woff2",
  "/assets/fonts/cairo-arabic-700-normal.woff2",
  "/assets/fonts/cairo-latin-400-normal.woff2",
  "/assets/fonts/cairo-latin-600-normal.woff2",
  "/assets/fonts/cairo-latin-700-normal.woff2"
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
  // نتعامل بس مع طلبات الصفحات والملفات من نفس الموقع (GET)
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => response)
      .catch(async () => {
        const cached = await caches.match(event.request);
        // لو لقينا نسخة في الكاش نرجعها، لو مفيش نرجّع خطأ بسيط بدل ما نكسر الصفحة
        return cached || new Response("غير متصل بالإنترنت", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      })
  );
});