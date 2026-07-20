// ============================================
// State Views - عناصر موحّدة لحالات التحميل والخطأ
// بديل عن نص "جاري التحميل..." + رسالة خطأ موحّدة مع زرار "حاول تاني"
//
// الاستخدام:
//   import { renderSkeleton, renderErrorState } from "../shared/states.js";
//
//   // وقت بدء التحميل:
//   renderSkeleton(examsListEl, { type: "card", count: 4 });
//
//   // لو فشل التحميل:
//   renderErrorState(examsListEl, {
//     message: "تعذر تحميل الامتحانات",
//     onRetry: () => loadTeacherExams(teacherId)
//   });
// ============================================

// ------- حقن الـ CSS مرة واحدة بس -------
function injectStyles() {
  if (document.getElementById("qa-states-styles")) return;
  const style = document.createElement("style");
  style.id = "qa-states-styles";
  style.textContent = `
    @keyframes qa-shimmer {
      0% { background-position: -200px 0; }
      100% { background-position: 200px 0; }
    }
    .qa-skel {
      background: linear-gradient(90deg,
        var(--bg-subtle, #f0f0f2) 25%,
        var(--border, #e5e7eb) 37%,
        var(--bg-subtle, #f0f0f2) 63%);
      background-size: 400px 100%;
      animation: qa-shimmer 1.4s ease infinite;
      border-radius: var(--radius-sm, 8px);
    }
    .qa-skel-card {
      background: var(--surface, #fff);
      border-radius: var(--radius, 12px);
      padding: 18px;
      box-shadow: var(--shadow, 0 4px 16px rgba(0,0,0,.06));
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .qa-skel-line { height: 12px; }
    .qa-skel-line.qa-w-40 { width: 40%; }
    .qa-skel-line.qa-w-60 { width: 60%; }
    .qa-skel-line.qa-w-80 { width: 80%; }
    .qa-skel-icon { width: 32px; height: 32px; border-radius: 8px; margin-bottom: 4px; }

    .qa-skel-row {
      display: flex;
      align-items: center;
      gap: 12px;
      border: 1px solid var(--border, #eee);
      border-radius: 10px;
      padding: 10px 12px;
      background: var(--surface, #fff);
    }
    .qa-skel-avatar { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; }
    .qa-skel-row-lines { flex: 1; display: flex; flex-direction: column; gap: 6px; }

    .qa-skel-stat {
      border-radius: var(--radius, 12px);
      padding: 20px;
      height: 76px;
      background: linear-gradient(90deg,
        var(--bg-subtle, #f0f0f2) 25%,
        var(--border, #e5e7eb) 37%,
        var(--bg-subtle, #f0f0f2) 63%);
      background-size: 400px 100%;
      animation: qa-shimmer 1.4s ease infinite;
    }

    .qa-error-state {
      background: var(--surface, #fff);
      border-radius: var(--radius, 12px);
      padding: 40px 20px;
      text-align: center;
      box-shadow: var(--shadow, 0 4px 16px rgba(0,0,0,.06));
      grid-column: 1 / -1;
    }
    .qa-error-icon { font-size: 40px; margin-bottom: 10px; }
    .qa-error-message { color: var(--text-muted, #6b7280); margin-bottom: 16px; font-size: 14px; }

    @media (prefers-reduced-motion: reduce) {
      .qa-skel, .qa-skel-stat { animation: none; }
    }
  `;
  document.head.appendChild(style);
}

// ------- قوالب السكيلتون -------
function skeletonCardHtml() {
  return `
    <div class="qa-skel-card">
      <div class="qa-skel qa-skel-icon"></div>
      <div class="qa-skel qa-skel-line qa-w-80"></div>
      <div class="qa-skel qa-skel-line qa-w-40"></div>
    </div>
  `;
}

function skeletonRowHtml() {
  return `
    <div class="qa-skel-row">
      <div class="qa-skel qa-skel-avatar"></div>
      <div class="qa-skel-row-lines">
        <div class="qa-skel qa-skel-line qa-w-60"></div>
        <div class="qa-skel qa-skel-line qa-w-40"></div>
      </div>
    </div>
  `;
}

function skeletonStatHtml() {
  return `<div class="qa-skel-stat"></div>`;
}

/**
 * عرض عناصر سكيلتون مكان محتوى شاشة بتتحمّل
 * @param {HTMLElement} container
 * @param {{type?: "card"|"row"|"stat", count?: number}} options
 */
export function renderSkeleton(container, { type = "card", count = 3 } = {}) {
  injectStyles();
  if (!container) return;
  const templates = { card: skeletonCardHtml, row: skeletonRowHtml, stat: skeletonStatHtml };
  const build = templates[type] || skeletonCardHtml;
  container.innerHTML = Array.from({ length: count }, build).join("");
}

/**
 * عرض حالة خطأ موحّدة مع زرار "حاول تاني" اختياري
 * @param {HTMLElement} container
 * @param {{message?: string, onRetry?: Function}} options
 */
export function renderErrorState(container, { message = "حصلت مشكلة، حاول تاني", onRetry } = {}) {
  injectStyles();
  if (!container) return;
  container.innerHTML = `
    <div class="qa-error-state">
      <div class="qa-error-icon">⚠️</div>
      <p class="qa-error-message"></p>
      ${onRetry ? `<button type="button" class="btn btn-primary qa-retry-btn">حاول تاني</button>` : ""}
    </div>
  `;
  container.querySelector(".qa-error-message").textContent = message;
  if (onRetry) {
    container.querySelector(".qa-retry-btn").addEventListener("click", onRetry);
  }
}