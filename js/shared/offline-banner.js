// ============================================
// Offline Banner - تنبيه انقطاع الاتصال بالإنترنت
// بيظهر شريط تنبيه أعلى الصفحة لما النت يقطع، ويختفي (مع رسالة
// نجاح مؤقتة) لما الاتصال يرجع تاني.
// الاستخدام: ضيف السطر ده في أول أي ملف JS بيتحمّل في الصفحة
// (جنب سطر استيراد theme.js بالظبط):
//   import "../shared/offline-banner.js";
// ============================================

const BANNER_ID = "qa-offline-banner";
let hideTimer = null;

// ------- حقن الشريط والـ CSS بتاعه (مرة واحدة بس) -------
function ensureBanner() {
  let banner = document.getElementById(BANNER_ID);
  if (banner) return banner;

  const style = document.createElement("style");
  style.textContent = `
    #${BANNER_ID} {
      position: fixed;
      top: 0;
      inset-inline: 0;
      z-index: 9998;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 9px 14px;
      font-size: 13.5px;
      font-weight: 700;
      text-align: center;
      transform: translateY(-100%);
      transition: transform .25s ease;
    }
    #${BANNER_ID}.show { transform: translateY(0); }
    #${BANNER_ID}.offline {
      background: #fdecea;
      color: #c0392b;
      border-bottom: 1px solid #e6a19b;
    }
    #${BANNER_ID}.online {
      background: var(--green-light, #e8f8ef);
      color: var(--green, #27ae60);
      border-bottom: 1px solid #a9e0c1;
    }
    /* الشريط مالوش لازمة في الورقة المطبوعة */
    @media print {
      #${BANNER_ID} { display: none !important; }
    }
  `;
  document.head.appendChild(style);

  banner = document.createElement("div");
  banner.id = BANNER_ID;
  document.body.appendChild(banner);
  return banner;
}

// ------- عرض حالة "أوفلاين" (بتفضل ظاهرة طول ما النت مقطوع) -------
function showOffline() {
  clearTimeout(hideTimer);
  const banner = ensureBanner();
  banner.className = "offline show";
  banner.textContent = "🔌 غير متصل بالإنترنت — البيانات المعروضة ممكن تكون مش محدّثة";
}

// ------- عرض رسالة "رجع الاتصال" لمدة قصيرة، وبعدين تختفي -------
function showOnline() {
  const banner = ensureBanner();
  banner.className = "online show";
  banner.textContent = "✅ رجع الاتصال بالإنترنت";

  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    banner.classList.remove("show");
  }, 2500);
}

// ------- الاستماع لتغيّر حالة الاتصال -------
window.addEventListener("offline", showOffline);
window.addEventListener("online", showOnline);

// ------- التشغيل: لو الصفحة اتفتحت والنت أصلاً مقطوع، نظهر الشريط فورًا -------
function init() {
  if (!navigator.onLine) showOffline();
}

if (document.body) {
  init();
} else {
  document.addEventListener("DOMContentLoaded", init);
}