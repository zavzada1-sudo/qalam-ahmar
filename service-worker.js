// ==================== إعدادات الكاش ====================
// v3 -> v4: إضافة Runtime Caching (تخزين الملفات تلقائيًا أثناء الاستخدام، مش بس وقت التثبيت)

const STATIC_CACHE = "qalam-ahmar-static-v4";   // الملفات الأساسية اللي بتتخزن وقت التثبيت (App Shell)
const RUNTIME_CACHE = "qalam-ahmar-runtime-v4"; // الملفات اللي بتتخزن تلقائيًا أول ما المستخدم يفتحها

// الملفات الأساسية اللي المفروض الموقع يشتغل بيها حتى أول مرة يفتح فيها أوفلاين
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

// دومينات بيانات حية: نسيبها تروح للنت مباشرة من غير أي تدخل من الـ Service Worker
// السبب: امتحانات/درجات/حضور لازم تكون فريش دايمًا، وFirestore أصلًا عنده Offline Persistence خاص بيه
const NETWORK_ONLY_HOSTS = [
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "www.googleapis.com"
];

// دومينات خارجية آمنة نكاشها Runtime (مكتبات/صور ثابتة نادرًا ما تتغير)
const RUNTIME_CACHEABLE_HOSTS = [
  "www.gstatic.com",      // Firebase SDK (نسخة مثبتة بالرقم في الرابط نفسه)
  "cdnjs.cloudflare.com", // مكتبة QRCode.js
  "i.ibb.co"              // صور الطلاب/المواد المرفوعة على ImgBB
];

// ==================== التثبيت ====================
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
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

// ==================== التفعيل (تنظيف الكاش القديم) ====================
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== STATIC_CACHE && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// ==================== استراتيجية Network First ====================
// بيحاول ياخد نسخة جديدة من النت، ولو فشل (مفيش نت) يرجّع آخر نسخة متخزنة
// مستخدمة لصفحات الـ HTML عشان المستخدم ياخد آخر تحديث لما يكون أونلاين
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    return (
      cached ||
      new Response("غير متصل بالإنترنت", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      })
    );
  }
}

// ==================== استراتيجية Stale While Revalidate ====================
// بيرجّع النسخة المتخزنة فورًا (سريع)، وفي نفس الوقت بيجيب نسخة جديدة في الخلفية
// ويحدّث بيها الكاش عشان تبقى جاهزة للمرة الجاية
// مستخدمة لملفات CSS/JS/خطوط/صور والمكتبات الخارجية الثابتة
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);

  const networkFetch = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null); // لو النت فشل، هنعتمد على المتخزن (لو موجود)

  return (
    cached ||
    (await networkFetch) ||
    new Response("تعذر تحميل الملف", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    })
  );
}

// ==================== معالج الطلبات ====================
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // نتعامل بس مع طلبات GET (POST/PUT وغيرها بتتسيب طبيعي)
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 1) بيانات Firebase الحية: نسيبها تروح للنت مباشرة بدون أي تدخل من الـ Service Worker
  if (NETWORK_ONLY_HOSTS.includes(url.hostname)) {
    return;
  }

  // 2) صفحات HTML (التنقل بين الصفحات): Network First
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(networkFirst(request));
    return;
  }

  // 3) ملفات الموقع نفسه + المكتبات الخارجية المسموحة: Stale While Revalidate
  const isSameOrigin = url.origin === self.location.origin;
  const isAllowedExternal = RUNTIME_CACHEABLE_HOSTS.includes(url.hostname);
  if (isSameOrigin || isAllowedExternal) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 4) أي حاجة تانية غير متوقعة: تتسيب تتعامل بشكل طبيعي بدون أي كاش
});