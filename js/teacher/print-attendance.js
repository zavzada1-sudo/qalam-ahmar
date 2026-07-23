// ============================================
// Print Attendance - كشف الحضور والغياب للطباعة
// ============================================
//
// بيدعم نوعين:
//  1. يوم واحد: عمود واحد بحالة كل طالب
//  2. فترة: عمود لكل يوم كان فيه حصة + إحصائيات ونسبة حضور
//
// مبدأ مهم: بنجيب "الحصص" من attendanceSessions مش من سجلات الحضور،
// عشان نفرّق بين:
//   - يوم مكانش فيه حصة أصلاً (مش بيتحسب غياب)
//   - يوم كان فيه حصة وكل الطلبة غابوا
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc, getDoc, collection, query, where, getDocs, documentId
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import { showToast } from "../shared/ui.js";
import "../shared/theme.js";
import "../shared/offline-banner.js";

// ------- عناصر الصفحة -------
const loadingEl     = document.getElementById("loadingState");
const errorEl       = document.getElementById("errorState");
const errorTextEl   = document.getElementById("errorText");
const contentEl     = document.getElementById("contentWrapper");

const gradeSelect   = document.getElementById("gradeSelect");
const groupSelect   = document.getElementById("groupSelect");
const modeSelect    = document.getElementById("modeSelect");

const singleDateWrap= document.getElementById("singleDateWrap");
const fromWrap      = document.getElementById("fromWrap");
const toWrap        = document.getElementById("toWrap");

const dateInput     = document.getElementById("dateInput");
const fromInput     = document.getElementById("fromInput");
const toInput       = document.getElementById("toInput");

const generateBtn   = document.getElementById("generateBtn");
const printBar      = document.getElementById("printBar");
const printBtn      = document.getElementById("printBtn");

const reportArea    = document.getElementById("reportArea");
const reportTitle   = document.getElementById("reportTitle");
const reportMeta    = document.getElementById("reportMeta");
const reportSummary = document.getElementById("reportSummary");
const reportTable   = document.getElementById("reportTable");
const reportEmpty   = document.getElementById("reportEmpty");
const startPrompt   = document.getElementById("startPrompt");

// ------- الحالة -------
let currentTeacherId = null;
let teacherData      = null;
let allGrades        = [];
let allGroups        = [];

// ============================================
// البداية
// ============================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../index.html";
    return;
  }

  try {
    currentTeacherId = user.uid;

    const userSnap = await getDoc(doc(db, "users", currentTeacherId));

    if (!userSnap.exists()) {
      showError("الحساب غير مكتمل.");
      return;
    }

    teacherData = userSnap.data();

    if (teacherData.role !== "teacher") {
      showError("الصفحة دي للمدرسين بس.");
      return;
    }

    await loadGradesAndGroups();

    // القيم الافتراضية للتواريخ
    const today = todayStr();
    dateInput.value = today;
    toInput.value   = today;
    fromInput.value = daysAgoStr(30);

    // لو جايين من صفحة الحضور بمجموعة محددة، نختارها تلقائي
    applyUrlParams();

    loadingEl.classList.add("hidden");
    contentEl.classList.remove("hidden");

  } catch (error) {
    console.error("Print attendance init error:", error);
    showError("تعذر تحميل الصفحة.");
  }
});

// ============================================
// تحميل السنين والمجموعات
// ============================================
async function loadGradesAndGroups() {
  const [gradesSnap, groupsSnap] = await Promise.all([
    getDocs(query(collection(db, "grades"), where("teacherId", "==", currentTeacherId))),
    getDocs(query(collection(db, "groups"), where("teacherId", "==", currentTeacherId)))
  ]);

  allGrades = [];
  gradesSnap.forEach((d) => allGrades.push({ id: d.id, ...d.data() }));

  allGroups = [];
  groupsSnap.forEach((d) => allGroups.push({ id: d.id, ...d.data() }));

  gradeSelect.innerHTML = `<option value="">اختر السنة...</option>`;
  allGrades.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.gradeName || "بدون اسم";
    gradeSelect.appendChild(opt);
  });
}

// ============================================
// قراءة الباراميترات من الرابط (جاي من صفحة الحضور)
// ============================================
function applyUrlParams() {
  const params  = new URLSearchParams(window.location.search);
  const gradeId = params.get("gradeId");
  const groupId = params.get("groupId");
  const date    = params.get("date");

  if (gradeId) {
    gradeSelect.value = gradeId;
    populateGroups(gradeId);
  }

  if (groupId) groupSelect.value = groupId;
  if (date)    dateInput.value = date;
}

// ============================================
// ملء المجموعات حسب السنة
// ============================================
function populateGroups(gradeId) {
  groupSelect.innerHTML = `<option value="">اختر المجموعة...</option>`;
  groupSelect.disabled = !gradeId;

  if (!gradeId) return;

  allGroups
    .filter((g) => g.gradeId === gradeId)
    .forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = g.groupName || "بدون اسم";
      groupSelect.appendChild(opt);
    });
}

gradeSelect.addEventListener("change", () => {
  populateGroups(gradeSelect.value);
});

// ============================================
// تبديل نوع الكشف (يوم / فترة)
// ============================================
modeSelect.addEventListener("change", () => {
  const isRange = modeSelect.value === "range";

  singleDateWrap.classList.toggle("hidden", isRange);
  fromWrap.classList.toggle("hidden", !isRange);
  toWrap.classList.toggle("hidden", !isRange);
});

// ============================================
// توليد الكشف
// ============================================
generateBtn.addEventListener("click", generateReport);

async function generateReport() {
  const groupId = groupSelect.value;

  if (!groupId) {
    showToast("اختر المجموعة الأول.", "error");
    return;
  }

  const isRange = modeSelect.value === "range";
  let fromDate, toDate;

  if (isRange) {
    fromDate = fromInput.value;
    toDate   = toInput.value;

    if (!fromDate || !toDate) {
      showToast("حدد تاريخ البداية والنهاية.", "error");
      return;
    }

    if (fromDate > toDate) {
      showToast("تاريخ البداية لازم يكون قبل تاريخ النهاية.", "error");
      return;
    }
  } else {
    fromDate = toDate = dateInput.value;

    if (!fromDate) {
      showToast("حدد التاريخ.", "error");
      return;
    }
  }

  const group = allGroups.find((g) => g.id === groupId);
  if (!group) {
    showToast("مش لاقي المجموعة.", "error");
    return;
  }

  setButtonLoading(generateBtn, true);
  startPrompt.classList.add("hidden");

  try {
    // ---- نجيب الحصص والسجلات والطلبة ----
    const [sessions, records, students] = await Promise.all([
      fetchSessions(groupId, fromDate, toDate),
      fetchRecords(groupId, fromDate, toDate),
      fetchUsersByIds(group.studentIds || [])
    ]);

    // الأيام اللي هنعرضها = أيام الحصص
    // احتياطي: لو مفيش جلسات مسجّلة بس فيه سجلات حضور، ناخد تواريخ السجلات
    let dates = sessions.map((s) => s.date);

    if (dates.length === 0 && records.length > 0) {
      dates = [...new Set(records.map((r) => r.date))];
    }

    dates = [...new Set(dates)].sort();

    if (dates.length === 0) {
      reportArea.classList.add("hidden");
      printBar.classList.add("hidden");
      reportEmpty.classList.remove("hidden");
      return;
    }

    reportEmpty.classList.add("hidden");

    renderReport({ group, students, records, dates, fromDate, toDate, isRange });

    reportArea.classList.remove("hidden");
    printBar.classList.remove("hidden");

  } catch (error) {
    console.error("Generate report error:", error);

    // خطأ الفهرس الناقص بيجي بالكود ده، ورسالته فيها لينك إنشاء الفهرس
    if (error.code === "failed-precondition") {
      showToast(
        "محتاج فهرس (Index) في Firestore. افتح Console (F12) واضغط اللينك اللي في رسالة الخطأ.",
        "error"
      );
      console.warn("👇 اضغط اللينك ده عشان تعمل الفهرس:\n", error.message);
      return;
    }

    showToast("تعذر توليد الكشف.", "error");
  } finally {
    setButtonLoading(generateBtn, false);
  }
}

// ============================================
// جلب الحصص في الفترة
// ============================================
async function fetchSessions(groupId, fromDate, toDate) {
  const snap = await getDocs(query(
    collection(db, "attendanceSessions"),
    where("teacherId", "==", currentTeacherId),   // لازم يطابق الـ Rules
    where("groupId", "==", groupId),
    where("date", ">=", fromDate),
    where("date", "<=", toDate)
  ));

  const sessions = [];
  snap.forEach((d) => sessions.push({ id: d.id, ...d.data() }));
  return sessions;
}

// ============================================
// جلب سجلات الحضور في الفترة
// ============================================
async function fetchRecords(groupId, fromDate, toDate) {
  const snap = await getDocs(query(
    collection(db, "attendance"),
    where("teacherId", "==", currentTeacherId),
    where("groupId", "==", groupId),
    where("date", ">=", fromDate),
    where("date", "<=", toDate)
  ));

  const records = [];
  snap.forEach((d) => records.push({ id: d.id, ...d.data() }));
  return records;
}

// ============================================
// جلب بيانات الطلبة
// ============================================
async function fetchUsersByIds(ids) {
  if (!ids || ids.length === 0) return [];

  const results = [];

  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const snap = await getDocs(
      query(collection(db, "users"), where(documentId(), "in", chunk))
    );
    snap.forEach((d) => results.push({ uid: d.id, ...d.data() }));
  }

  results.sort((a, b) =>
    (a.fullName || "").localeCompare(b.fullName || "", "ar")
  );

  return results;
}

// ============================================
// بناء التقرير
// ============================================
function renderReport({ group, students, records, dates, fromDate, toDate, isRange }) {
  // ---- خريطة سريعة: "uid_date" → الحالة ----
  const statusMap = new Map();
  records.forEach((r) => {
    statusMap.set(`${r.studentUid}_${r.date}`, r.status);
  });

  // ---- الطلبة الغرباء اللي اتسجّلوا وهم مش في المجموعة ----
  const groupUids = new Set(students.map((s) => s.uid));
  const foreignMap = new Map();

  records.forEach((r) => {
    if (groupUids.has(r.studentUid)) return;
    if (!foreignMap.has(r.studentUid)) {
      foreignMap.set(r.studentUid, {
        uid:  r.studentUid,
        name: r.studentName || "بدون اسم",
        code: r.studentCode || "—",
        foreign: true
      });
    }
  });

  const allRows = [
    ...students.map((s) => ({
      uid:  s.uid,
      name: s.fullName || "بدون اسم",
      code: s.studentId || "—",
      foreign: false
    })),
    ...foreignMap.values()
  ];

  // ---- العنوان والبيانات ----
  reportTitle.textContent = isRange
    ? "كشف الحضور والغياب (فترة)"
    : "كشف الحضور والغياب";

  const periodText = isRange
    ? `من ${formatArabicDate(fromDate)} إلى ${formatArabicDate(toDate)}`
    : formatArabicDate(fromDate);

  reportMeta.textContent =
    `أ/ ${teacherData.fullName || ""} · ${group.groupName || ""} · ${periodText}` +
    ` · عدد الحصص: ${dates.length}`;

  // ---- الملخص ----
  let totalPresent = 0;
  let totalLate = 0;
  let totalAbsent = 0;

  students.forEach((s) => {
    dates.forEach((d) => {
      const status = statusMap.get(`${s.uid}_${d}`);
      if (status === "present") totalPresent++;
      else if (status === "late") totalLate++;
      else totalAbsent++;
    });
  });

  const totalSlots = students.length * dates.length;
  const attendanceRate = totalSlots > 0
    ? Math.round(((totalPresent + totalLate) / totalSlots) * 100)
    : 0;

  reportSummary.innerHTML = `
    <div class="report-summary-item">
      <strong>${students.length}</strong><span>عدد الطلبة</span>
    </div>
    <div class="report-summary-item">
      <strong>${dates.length}</strong><span>عدد الحصص</span>
    </div>
    <div class="report-summary-item">
      <strong>${totalPresent}</strong><span>مرات حضور</span>
    </div>
    <div class="report-summary-item">
      <strong>${totalLate}</strong><span>مرات تأخير</span>
    </div>
    <div class="report-summary-item">
      <strong>${totalAbsent}</strong><span>مرات غياب</span>
    </div>
    <div class="report-summary-item">
      <strong>${attendanceRate}%</strong><span>نسبة الحضور</span>
    </div>
  `;

  // ---- الجدول ----
  const showTotals = isRange && dates.length > 1;

  // رأس الجدول
  let head = `
    <thead>
      <tr>
        <th style="width:34px">#</th>
        <th>اسم الطالب</th>
        <th style="width:64px">الكود</th>
  `;

  dates.forEach((d) => {
    head += `<th>${formatShortDate(d)}</th>`;
  });

  if (showTotals) {
    head += `
        <th style="width:44px">حضور</th>
        <th style="width:44px">تأخير</th>
        <th style="width:44px">غياب</th>
        <th style="width:52px">النسبة</th>
    `;
  }

  head += `</tr></thead>`;

  // جسم الجدول
  let body = `<tbody>`;

  allRows.forEach((row, index) => {
    let presentCount = 0;
    let lateCount = 0;
    let absentCount = 0;

    let cells = "";

    dates.forEach((d) => {
      const status = statusMap.get(`${row.uid}_${d}`);

      if (status === "present") {
        presentCount++;
        cells += `<td class="mark-present">✓</td>`;
      } else if (status === "late") {
        lateCount++;
        cells += `<td class="mark-late">م</td>`;
      } else {
        absentCount++;
        cells += `<td class="mark-absent">✗</td>`;
      }
    });

    const rate = dates.length > 0
      ? Math.round(((presentCount + lateCount) / dates.length) * 100)
      : 0;

    const nameCell = row.foreign
      ? `${escapeHtml(row.name)} <small style="color:#e67e22">(من مجموعة تانية)</small>`
      : escapeHtml(row.name);

    body += `
      <tr>
        <td>${index + 1}</td>
        <td class="cell-name">${nameCell}</td>
        <td class="cell-code">${escapeHtml(row.code)}</td>
        ${cells}
        ${showTotals ? `
          <td class="mark-present">${presentCount}</td>
          <td class="mark-late">${lateCount}</td>
          <td class="mark-absent">${absentCount}</td>
          <td>${rate}%</td>
        ` : ""}
      </tr>
    `;
  });

  body += `</tbody>`;

  reportTable.innerHTML = head + body;
}

// ============================================
// الطباعة
// ============================================
printBtn.addEventListener("click", () => {
  window.print();
});

// ============================================
// دوال مساعدة
// ============================================

function todayStr() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function daysAgoStr(days) {
  const now = new Date();
  now.setDate(now.getDate() - days);
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

// تاريخ كامل بالعربي
function formatArabicDate(dateStr) {
  try {
    const date = new Date(`${dateStr}T00:00:00`);
    return date.toLocaleDateString("ar-EG", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  } catch (e) {
    return dateStr;
  }
}

// تاريخ مختصر لعناوين الأعمدة (يوم/شهر)
function formatShortDate(dateStr) {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

function setButtonLoading(btn, isLoading) {
  if (isLoading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = "لحظة...";
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.originalText || "اعرض الكشف";
    btn.disabled = false;
  }
}

function showError(message) {
  loadingEl.classList.add("hidden");
  contentEl.classList.add("hidden");
  errorEl.classList.remove("hidden");
  errorTextEl.textContent = message;
}

function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}