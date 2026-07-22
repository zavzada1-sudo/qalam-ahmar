// ============================================
// Trend Chart - رسم بياني بسيط لتطور الدرجات
// ============================================
// رسم SVG خام (من غير أي مكتبة خارجية زي Chart.js) عشان:
//  1. يشتغل أوفلاين مع الـ PWA من غير أي طلب لأي CDN خارجي.
//  2. يفضل خفيف جدًا على الأداء (مفيش تحميل مكتبة كبيرة).
//
// بيرسم:
//  - خط بيوصل بين الدرجات الفعلية بترتيبها الزمني (نقطة لكل تقييم).
//  - خط متقطع (اختياري) يمثل "خط الاتجاه العام" — بنفس معادلة الانحدار
//    (Least Squares) المستخدمة في حساب نسبة التحسّن، عشان الرقم اللي
//    شايفينه في الملخص والخط المرسوم يحكوا نفس القصة بالظبط.
//
// ⚠️ الوقت بيتصاعد من اليسار لليمين دايمًا (زي أي رسم بياني عادي)
// حتى لو الصفحة نفسها RTL — ده معيار متعارف عليه لكل الرسوم البيانية
// ومش بيتأثر باتجاه اللغة.
//
// الاستخدام:
//   import { renderTrendChart } from "../shared/chart.js";
//   renderTrendChart(containerElement, [60, 65, 70, 82], { labels: ["1/3", "8/3", "15/3", "22/3"] });
// ============================================

export function renderTrendChart(container, values, options = {}) {
  if (!container) return;

  const { labels = null, width = 600, height = 200 } = options;

  // نتأكد إن القيم كلها أرقام فعلية
  const points = (values || []).filter((v) => typeof v === "number" && !isNaN(v));

  if (points.length === 0) {
    container.innerHTML = `
      <p class="chart-empty-text">مفيش تقييمات مصححة كفاية لعرض رسم بياني</p>
    `;
    return;
  }

  const n = points.length;

  // مساحات فاضية حوالين الرسمة (عشان أرقام المحاور والتسميات)
  const padding = { top: 24, right: 16, bottom: labels ? 34 : 16, left: 34 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // تحويل رقم الترتيب/القيمة لإحداثيات SVG
  const xAt = (i) => padding.left + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW);
  const yAt = (v) => padding.top + chartH - (clamp01(v) / 100) * chartH;

  // ---- خطوط الشبكة الأفقية (0 / 25 / 50 / 75 / 100) ----
  const gridSvg = [0, 25, 50, 75, 100].map((v) => `
    <line x1="${padding.left}" y1="${yAt(v)}" x2="${width - padding.right}" y2="${yAt(v)}"
          stroke="#eee" stroke-width="1" />
    <text x="${padding.left - 8}" y="${yAt(v) + 4}" font-size="10"
          fill="#999" text-anchor="end">${v}</text>
  `).join("");

  // ---- خط الدرجات الفعلية (محتاج نقطتين على الأقل عشان يترسم خط) ----
  let dataLineSvg = "";
  if (n >= 2) {
    const linePoints = points.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
    dataLineSvg = `
      <polyline points="${linePoints}" fill="none"
                stroke="#c0392b" stroke-width="2.5"
                stroke-linejoin="round" stroke-linecap="round" />
    `;
  }

  // ---- خط الاتجاه المتقطع (نفس حد calcImprovement: محتاج 4 نقط فأكتر) ----
  let trendLineSvg = "";
  if (n >= 4) {
    const trend = calcTrendLine(points);
    if (trend) {
      const y1 = clamp01(trend.intercept + trend.slope * 1);
      const y2 = clamp01(trend.intercept + trend.slope * n);
      trendLineSvg = `
        <line x1="${xAt(0)}" y1="${yAt(y1)}" x2="${xAt(n - 1)}" y2="${yAt(y2)}"
              stroke="#888" stroke-width="2" stroke-dasharray="6,4" />
      `;
    }
  }

  // ---- النقط الفعلية + قيمها فوقها ----
  const dotsSvg = points.map((v, i) => `
    <circle cx="${xAt(i)}" cy="${yAt(v)}" r="4"
            fill="#c0392b" stroke="#fff" stroke-width="1.5" />
    <text x="${xAt(i)}" y="${yAt(v) - 10}" font-size="10"
          fill="#444" text-anchor="middle">${v}%</text>
  `).join("");

  // ---- تسميات المحور السيني (اختياري، زي تواريخ التقييمات) ----
  let xLabelsSvg = "";
  if (labels && labels.length === n) {
    xLabelsSvg = labels.map((label, i) => `
      <text x="${xAt(i)}" y="${height - padding.bottom + 16}" font-size="9"
            fill="#999" text-anchor="middle">${escapeChartText(label)}</text>
    `).join("");
  }

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="trend-chart-svg"
         preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="رسم بياني لتطور الدرجات">
      ${gridSvg}
      ${trendLineSvg}
      ${dataLineSvg}
      ${dotsSvg}
      ${xLabelsSvg}
    </svg>
  `;
}

// ============================================
// معادلة خط الانحدار (Least Squares) — نفس منطق calcImprovement بالظبط
// ============================================
function calcTrendLine(values) {
  const n = values.length;
  if (n < 2) return null;

  const sumX  = values.reduce((sum, _, i) => sum + (i + 1), 0);
  const sumY  = values.reduce((sum, y) => sum + y, 0);
  const sumXY = values.reduce((sum, y, i) => sum + (i + 1) * y, 0);
  const sumX2 = values.reduce((sum, _, i) => sum + (i + 1) * (i + 1), 0);

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

// نحصر القيمة بين 0 و100 (احتياطي لو خط الاتجاه طلّع رقم بره المدى)
function clamp01(v) {
  return Math.max(0, Math.min(100, v));
}

// تنضيف النصوص جوّه الـ SVG (تسميات المحور) لمنع HTML injection
function escapeChartText(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}