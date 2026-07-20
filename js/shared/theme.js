// ============================================
// Theme Toggle - الوضع الداكن/الفاتح
// بيضيف زرار عائم بيبدّل بين الوضعين، وبيحفظ اختيار المستخدم في المتصفح
// الاستخدام: ضيف السطر ده في أول أي ملف JS بيتحمّل في الصفحة:
//   import "../shared/theme.js";
// ============================================

const STORAGE_KEY = "qalam_theme";

// ------- تحديد الوضع المفضّل: الافتراضي دايمًا فاتح، إلا لو المستخدم اختار داكن قبل كده -------
function getPreferredTheme() {
  return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
}

// ------- تطبيق الوضع على الصفحة -------
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("qa-theme-toggle");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
}

// ------- حقن زرار التبديل العائم -------
function injectToggleButton() {
  if (document.getElementById("qa-theme-toggle")) return;

  const style = document.createElement("style");
  style.textContent = `
    #qa-theme-toggle {
      position: fixed;
      bottom: 92px;
      inset-inline-start: 20px;
      z-index: 500;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 1px solid var(--border, #e5e7eb);
      background: var(--surface, #fff);
      box-shadow: var(--shadow, 0 4px 16px rgba(0,0,0,.1));
      font-size: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform .15s ease;
    }
    #qa-theme-toggle:hover { transform: scale(1.08); }
    @media (max-width: 768px) {
      #qa-theme-toggle { bottom: 84px; inset-inline-start: 16px; width: 40px; height: 40px; font-size: 17px; }
    }
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.id = "qa-theme-toggle";
  btn.type = "button";
  btn.title = "تبديل الوضع الداكن/الفاتح";
  btn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  });
  document.body.appendChild(btn);
}

// ------- التشغيل -------
// نطبّق الثيم فورًا وقت تحميل السكريبت (قبل ما ننتظر أي حاجة) عشان نقلل وميض التغيير
applyTheme(getPreferredTheme());

// الزرار محتاج document.body يكون موجود، فبنتأكد الأول
if (document.body) {
  injectToggleButton();
} else {
  document.addEventListener("DOMContentLoaded", injectToggleButton);
}