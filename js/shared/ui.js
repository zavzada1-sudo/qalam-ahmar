// ============================================
// UI Utilities - نظام موحّد للتنبيهات والنوافذ المنبثقة
// بديل عن alert() / confirm() الافتراضية بتاعة المتصفح
//
// الاستخدام:
//   import { showToast, showConfirm, showAlert } from "../shared/ui.js";
//   showToast("تم حفظ الامتحان بنجاح", "success");
//   const ok = await showConfirm({ title: "حذف الامتحان", message: "...", danger: true });
// ============================================

// ------- حقن الـ CSS مرة واحدة بس، حتى لو الملف اتعمله import في أكتر من صفحة -------
function injectStyles() {
  if (document.getElementById("qa-ui-styles")) return;
  const style = document.createElement("style");
  style.id = "qa-ui-styles";
  style.textContent = `
    /* ---------- Toast ---------- */
    #qa-toast-container {
      position: fixed;
      top: 16px;
      inset-inline-end: 16px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: min(360px, calc(100vw - 32px));
      pointer-events: none;
    }
    .qa-toast {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 14px 16px;
      border-radius: var(--radius-md, 10px);
      background: var(--color-surface, #fff);
      box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.15));
      border-inline-start: 4px solid var(--qa-toast-accent, #2563eb);
      font-size: 14px;
      line-height: 1.5;
      color: var(--color-text, #1f2937);
      animation: qa-toast-in 0.25s ease-out;
    }
    .qa-toast.qa-toast-out { animation: qa-toast-out 0.2s ease-in forwards; }
    .qa-toast-success { --qa-toast-accent: #16a34a; }
    .qa-toast-error   { --qa-toast-accent: #dc2626; }
    .qa-toast-warning { --qa-toast-accent: #d97706; }
    .qa-toast-info    { --qa-toast-accent: #2563eb; }
    .qa-toast-icon { font-size: 18px; line-height: 1; flex-shrink: 0; }
    .qa-toast-msg { flex: 1; }
    .qa-toast-close {
      background: none; border: none; cursor: pointer; font-size: 16px;
      line-height: 1; color: var(--color-text-muted, #9ca3af); padding: 0 0 0 8px;
      flex-shrink: 0;
    }
    .qa-toast-close:hover { color: var(--color-text, #1f2937); }

    @keyframes qa-toast-in {
      from { opacity: 0; transform: translateY(-8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes qa-toast-out {
      from { opacity: 1; transform: translateY(0); }
      to   { opacity: 0; transform: translateY(-8px); }
    }

    /* ---------- Modal (Confirm / Alert) ---------- */
    .qa-modal-overlay {
      position: fixed; inset: 0; background: rgba(17, 24, 39, 0.5);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; padding: 16px; animation: qa-fade-in 0.15s ease-out;
    }
    .qa-modal {
      background: var(--color-surface, #fff);
      border-radius: var(--radius-lg, 14px);
      max-width: 420px; width: 100%;
      padding: 24px; box-shadow: var(--shadow-lg, 0 20px 40px rgba(0,0,0,0.2));
      animation: qa-modal-in 0.2s ease-out;
    }
    .qa-modal h3 { margin: 0 0 10px; font-size: 18px; color: var(--color-text, #111827); }
    .qa-modal p { margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: var(--color-text-muted, #4b5563); }
    .qa-modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
    .qa-modal-btn {
      padding: 10px 18px; border-radius: var(--radius-md, 8px); font-size: 14px;
      font-weight: 600; cursor: pointer; border: 1px solid transparent;
    }
    .qa-modal-btn-cancel {
      background: var(--color-bg-subtle, #f3f4f6); color: var(--color-text, #1f2937);
    }
    .qa-modal-btn-cancel:hover { background: var(--color-bg-subtle-hover, #e5e7eb); }
    .qa-modal-btn-confirm { background: var(--color-primary, #2563eb); color: #fff; }
    .qa-modal-btn-confirm:hover { filter: brightness(0.92); }
    .qa-modal-btn-danger { background: var(--color-danger, #dc2626); color: #fff; }
    .qa-modal-btn-danger:hover { filter: brightness(0.92); }

    @keyframes qa-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes qa-modal-in {
      from { opacity: 0; transform: scale(0.96) translateY(4px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }

    @media (prefers-reduced-motion: reduce) {
      .qa-toast, .qa-toast.qa-toast-out, .qa-modal-overlay, .qa-modal { animation: none !important; }
    }
  `;
  document.head.appendChild(style);
}

// ------- Toast -------
const TOAST_ICONS = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" };

function getToastContainer() {
  let container = document.getElementById("qa-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "qa-toast-container";
    document.body.appendChild(container);
  }
  return container;
}

/**
 * إظهار رسالة Toast مؤقتة
 * @param {string} message - نص الرسالة
 * @param {"success"|"error"|"warning"|"info"} type
 * @param {number} duration - المدة بالميلي ثانية قبل الاختفاء التلقائي (0 = يفضل لحد ما يتقفل يدويًا)
 * @returns {Function} دالة تقدر تناديها لو عايز تقفل الـ Toast بدري
 */
export function showToast(message, type = "success", duration = 4000) {
  injectStyles();
  const container = getToastContainer();

  const toast = document.createElement("div");
  toast.className = `qa-toast qa-toast-${type}`;
  // الأخطاء لازم قارئ الشاشة يقولها فورًا، الباقي يستنى دوره عشان ميقاطعش
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML = `
    <span class="qa-toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
    <span class="qa-toast-msg"></span>
    <button type="button" class="qa-toast-close" aria-label="إغلاق">×</button>
  `;
  toast.querySelector(".qa-toast-msg").textContent = message; // textContent يمنع أي XSS

  const remove = () => {
    toast.classList.add("qa-toast-out");
    setTimeout(() => toast.remove(), 200);
  };

  toast.querySelector(".qa-toast-close").addEventListener("click", remove);
  container.appendChild(toast);

  if (duration > 0) setTimeout(remove, duration);
  return remove;
}

// ------- بناء المودال (مشترك بين Confirm و Alert) -------
function buildModal({ title, message, confirmLabel, cancelLabel, danger, showCancel }) {
  injectStyles();

  const overlay = document.createElement("div");
  overlay.className = "qa-modal-overlay";

  const modal = document.createElement("div");
  modal.className = "qa-modal";
  modal.setAttribute("role", "alertdialog");
  modal.setAttribute("aria-modal", "true");

  modal.innerHTML = `
    ${title ? `<h3></h3>` : ""}
    <p></p>
    <div class="qa-modal-actions">
      ${showCancel ? `<button type="button" class="qa-modal-btn qa-modal-btn-cancel"></button>` : ""}
      <button type="button" class="qa-modal-btn ${danger ? "qa-modal-btn-danger" : "qa-modal-btn-confirm"}"></button>
    </div>
  `;
  if (title) modal.querySelector("h3").textContent = title;
  modal.querySelector("p").textContent = message;
  const cancelBtn = modal.querySelector(".qa-modal-btn-cancel");
  if (cancelBtn) cancelBtn.textContent = cancelLabel;
  const confirmBtn = modal.querySelector(".qa-modal-btn-danger, .qa-modal-btn-confirm");
  confirmBtn.textContent = confirmLabel;

  overlay.appendChild(modal);
  return { overlay, cancelBtn, confirmBtn };
}

/**
 * نافذة تأكيد بديلة عن confirm()
 * @returns {Promise<boolean>} true لو المستخدم أكّد، false لو ألغى
 */
export function showConfirm({
  title = "",
  message,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    const { overlay, cancelBtn, confirmBtn } = buildModal({
      title, message, confirmLabel, cancelLabel, danger, showCancel: true,
    });

    function close(result) {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
      resolve(result);
    }

    function onKeydown(e) {
      if (e.key === "Escape") close(false);
      if (e.key === "Tab") {
        // المودال فيه زرارين بس، فنحبس التركيز بينهم
        e.preventDefault();
        const next = document.activeElement === confirmBtn ? cancelBtn : confirmBtn;
        next.focus();
      }
    }

    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
    document.addEventListener("keydown", onKeydown);

    document.body.appendChild(overlay);
    // الأفعال الخطيرة: التركيز الافتراضي على "إلغاء" عشان ميحصلش حذف بالغلط بـ Enter
    (danger ? cancelBtn : confirmBtn).focus();
  });
}

/**
 * نافذة تنبيه بديلة عن alert() — زرار واحد بس
 * @returns {Promise<void>}
 */
export function showAlert({ title = "", message, confirmLabel = "تمام" } = {}) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    const { overlay, confirmBtn } = buildModal({
      title, message, confirmLabel, danger: false, showCancel: false,
    });

    function close() {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
      resolve();
    }
    function onKeydown(e) { if (e.key === "Escape" || e.key === "Enter") close(); }

    confirmBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKeydown);

    document.body.appendChild(overlay);
    confirmBtn.focus();
  });
}