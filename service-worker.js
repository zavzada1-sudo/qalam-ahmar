// ============================================
// Service Worker - قلم أحمر
// يخلي التطبيق قابل للتثبيت، ويحافظ على شكله لو النت اتقطع لحظيًا
// ملاحظة: بما إن المنصة معتمدة على Firebase (بيانات حية)، مش هنعمل
// "اشتغال كامل بدون نت" دلوقتي، بس نخلي الواجهة تفتح بسرعة ومتثبت
// ============================================

const CACHE_NAME = "qalam-ahmar-v1";
const CORE_ASSETS = [
  "/index.html",
  "/assets/css/main.css",
  "/assets/css/rtl.css",
  "/manifest.json"
];

// وقت التثبيت: نحفظ الملفات الأساسية في الكاش
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// وقت التفعيل: نمسح أي نسخة كاش قديمة
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

// كل طلب: نجرب النت الأول (عشان بيانات Firebase تفضل حديثة)، ولو فشل نرجع للكاش
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});