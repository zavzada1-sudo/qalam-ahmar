// ============================================
// Student Reports Logic - تقارير الطالب لنفسه
// ============================================
// نفس منطق حساب التحسّن (خط الانحدار) الموجود في js/teacher/reports.js
// بالظبط، ونفس رسمة js/shared/chart.js. الفرق بس إن هنا بنعرض تقرير
// لكل مجموعة الطالب منضم ليها (ممكن يبقى أكتر من مدرس واحد).
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc, getDoc, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import { showToast } from "../shared/ui.js";
import { renderTrendChart } from "../shared/chart.js";
import "../shared/theme.js";

// ------- عناصر الصفحة -------
const logoutBtn = document.getElementById("logoutBtn");
const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

const loadingState = document.getElementById("loadingState");
const errorState = document.getElementById("errorState");
const errorText = document.getElementById("errorText");
const contentWrapper = document.getElementById("contentWrapper");
const reportsContainer = document.getElementById("reportsContainer");
const printBtn = document.getElementById("printBtn");

// ------- متغيرات الحالة -------
let currentStudentId = null;
const teacherCache = new Map(); // teacherId -> اسم المدرس
const gradeCache = new Map();   // gradeId -> اسم السنة

// ------- القائمة الجانبية (موبايل) -------
if (menuToggle) menuToggle.addEventListener("click", () => {
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("show");
});
if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", () => {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("show");
});

printBtn.addEventListener("click", () => window.print());

// ------- تنضيف النصوص لمنع HTML injection -------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ------- حماية الصفحة: لازم طالب مسجل دخول -------
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "../index.html"; return; }
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists() || userDoc.data().role !== "student") {
      window.location.href = "../index.html";
      return;
    }
    currentStudentId = user.uid;

    await loadAndRenderReports();

    loadingState.classList.add("hidden");
    contentWrapper.classList.remove("hidden");

  } catch (error) {
    console.error("Student reports init error:", error);

    if (error.code === "failed-precondition") {
      // محتاج فهرس (Index) مركّب في Firestore — نفس الحالة اللي بتظهر
      // عند المدرس، الحل نفسه: نضغط اللينك في رسالة الخطأ الخام بالكونسول
      showToast("محتاج إعداد إضافي في قاعدة البيانات، افتح Console (F12)", "error");
      console.warn("👇 اضغط اللينك ده عشان تعمل الفهرس المطلوب:\n", error.message);
      loadingState.classList.add("hidden");
      errorState.classList.remove("hidden");
      errorText.textContent = "محتاج إعداد إضافي في قاعدة البيانات، شوف الـ Console";
      return;
    }

    showError("تعذر تحميل تقاريرك، حدّث الصفحة");
  }
});

function showError(message) {
  loadingState.classList.add("hidden");
  contentWrapper.classList.add("hidden");
  errorState.classList.remove("hidden");
  errorText.textContent = message;
}

// ============================================
// تحميل المجموعات وبناء تقرير لكل واحدة
// ============================================
async function loadAndRenderReports() {
  const memberSnap = await getDocs(query(
    collection(db, "groups"),
    where("studentIds", "array-contains", currentStudentId)
  ));

  const groups = [];
  memberSnap.forEach((g) => groups.push({ id: g.id, ...g.data() }));

  if (groups.length === 0) {
    printBtn.classList.add("hidden");
    reportsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <h3>لسه مفيش تقارير</h3>
        <p>لازم تكون منضم لمدرس الأول عشان تشوف تقاريرك هنا.</p>
        <a href="student-join.html" class="btn btn-primary">＋ الانضمام لمدرس</a>
      </div>
    `;
    return;
  }

  await ensureNamesLoaded(groups);

  // نبني تقرير كل مجموعة بالتوازي (كل مجموعة مستقلة عن التانية)
  const reports = await Promise.all(groups.map((g) => buildGroupReport(g)));

  reportsContainer.innerHTML = "";
  reports.forEach((report) => renderGroupSection(reportsContainer, report));
}

// جلب أسماء المدرسين والسنوات (مع كاش)
async function ensureNamesLoaded(groups) {
  const teacherIds = new Set();
  const gradeIds = new Set();
  groups.forEach((g) => {
    if (g.teacherId && !teacherCache.has(g.teacherId)) teacherIds.add(g.teacherId);
    if (g.gradeId && !gradeCache.has(g.gradeId)) gradeIds.add(g.gradeId);
  });

  const teacherSnaps = await Promise.all(
    [...teacherIds].map((id) => getDoc(doc(db, "users", id)))
  );
  teacherSnaps.forEach((s) => {
    if (s.exists()) teacherCache.set(s.id, s.data().fullName || "المدرس");
  });

  const gradeSnaps = await Promise.all(
    [...gradeIds].map((id) => getDoc(doc(db, "grades", id)))
  );
  gradeSnaps.forEach((s) => {
    if (s.exists()) gradeCache.set(s.id, s.data().gradeName || "");
  });
}

// ============================================
// جلب بيانات مجموعة واحدة (امتحانات + تسليمات + حضور)
// ============================================

async function fetchGroupExams(group) {
  const snap = await getDocs(query(
    collection(db, "exams"),
    where("teacherId", "==", group.teacherId),
    where("groupIds", "array-contains", group.id)
  ));
  const exams = [];
  snap.forEach((d) => exams.push({ id: d.id, ...d.data() }));
  // ترتيب زمني (الأقدم أولاً) — لعرض الجدول بالترتيب الصح
  exams.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  return exams;
}

// بيرجّع: map (examId -> تسليم، لعرض الجدول) + list (كل التسليمات
// مرتبة بترتيب وقت التسليم الفعلي، لحساب التحسّن — بنفس ترتيب
// teacher/reports.js بالظبط عشان الرقمين يتطابقوا)
async function fetchMySubmissions(examIds) {
  const map = new Map();
  const list = [];

  if (!examIds || examIds.length === 0) return { map, list };

  for (let i = 0; i < examIds.length; i += 10) {
    const chunk = examIds.slice(i, i + 10);
    const snap = await getDocs(query(
      collection(db, "submissions"),
      where("studentId", "==", currentStudentId),
      where("examId", "in", chunk)
    ));
    snap.forEach((d) => {
      const sub = { id: d.id, ...d.data() };
      map.set(sub.examId, sub);
      list.push(sub);
    });
  }

  list.sort((a, b) => (a.submittedAt || "").localeCompare(b.submittedAt || ""));
  return { map, list };
}

async function fetchGroupAttendance(group) {
  const [sessionsSnap, recordsSnap] = await Promise.all([
    getDocs(query(
      collection(db, "attendanceSessions"),
      where("groupId", "==", group.id)
    )),
    getDocs(query(
      collection(db, "attendance"),
      where("groupId", "==", group.id),
      where("studentUid", "==", currentStudentId)
    ))
  ]);

  const dates = [];
  sessionsSnap.forEach((d) => {
    const date = d.data().date;
    if (date) dates.push(date);
  });

  const attMap = new Map(); // date -> status
  recordsSnap.forEach((d) => {
    const r = d.data();
    attMap.set(r.date, r.status);
  });

  // احتياطي: لو مفيش جلسات مسجّلة أصلاً، ناخد تواريخ سجلات الطالب نفسه
  let finalDates = [...new Set(dates)];
  if (finalDates.length === 0) finalDates = [...attMap.keys()];
  finalDates.sort();

  return { dates: finalDates, attMap };
}

// ============================================
// بناء تقرير مجموعة واحدة
// ============================================
async function buildGroupReport(group) {
  const exams = await fetchGroupExams(group);
  const { map: submissionsByExam, list: allSubs } =
    await fetchMySubmissions(exams.map((e) => e.id));
  const { dates, attMap } = await fetchGroupAttendance(group);

  const graded = allSubs.filter(
    (s) => s.status === "graded" && typeof s.percentage === "number"
  );
  const pending = allSubs.filter((s) => s.status !== "graded");

  const avg = graded.length
    ? Math.round(graded.reduce((sum, s) => sum + s.percentage, 0) / graded.length)
    : null;

  const improvement = calcImprovement(graded.map((s) => s.percentage));

  let presentCount = 0;
  let lateCount = 0;
  dates.forEach((date) => {
    const status = attMap.get(date);
    if (status === "present") presentCount++;
    else if (status === "late") lateCount++;
  });
  const absentCount = dates.length - presentCount - lateCount;
  const attendanceRate = dates.length
    ? Math.round(((presentCount + lateCount) / dates.length) * 100)
    : null;

  return {
    group,
    exams,
    submissionsByExam,
    graded,
    pendingCount: pending.length,
    avg,
    improvement,
    presentCount,
    lateCount,
    absentCount,
    attendanceRate,
    sessionDates: dates,
    attMap
  };
}

// ============================================
// حساب نسبة التحسّن (خط الانحدار) — نفس منطق teacher/reports.js بالظبط
// ============================================
function calcImprovement(percentages) {
  if (!percentages || percentages.length < 4) return null;

  const recent = percentages.slice(-10);
  const n = recent.length;

  const sumX  = recent.reduce((sum, _, i) => sum + (i + 1), 0);
  const sumY  = recent.reduce((sum, y) => sum + y, 0);
  const sumXY = recent.reduce((sum, y, i) => sum + (i + 1) * y, 0);
  const sumX2 = recent.reduce((sum, _, i) => sum + (i + 1) * (i + 1), 0);

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const totalChange = slope * (n - 1);

  return Math.round(totalChange);
}

// ============================================
// عرض تقرير مجموعة واحدة
// ============================================
function renderGroupSection(container, report) {
  const { group } = report;
  const teacherName = teacherCache.get(group.teacherId) || "المدرس";
  const gradeName = gradeCache.get(group.gradeId) || "";

  const section = document.createElement("div");
  section.className = "rp-report";
  const chartId = `chart-${group.id}`;
  const tableId = `table-${group.id}`;
  const attId = `att-${group.id}`;

  section.innerHTML = `
    <div class="rp-doc-head">
      <h2>${escapeHtml(group.groupName || "المجموعة")}</h2>
      <p>مع أ/ ${escapeHtml(teacherName)}${gradeName ? " · " + escapeHtml(gradeName) : ""}</p>
    </div>

    <div class="rp-summary">
      <div class="rp-summary-item">
        <strong class="${scoreClass(report.avg)}">${report.avg !== null ? report.avg + "%" : "—"}</strong>
        <span>المتوسط العام</span>
      </div>
      <div class="rp-summary-item">
        <strong>${formatTrend(report.improvement)}</strong>
        <span>التحسّن</span>
      </div>
      <div class="rp-summary-item">
        <strong>${report.graded.length} / ${report.exams.length}</strong>
        <span>التقييمات المسلّمة</span>
      </div>
      <div class="rp-summary-item">
        <strong class="${scoreClass(report.attendanceRate)}">
          ${report.attendanceRate !== null ? report.attendanceRate + "%" : "—"}
        </strong>
        <span>نسبة الحضور</span>
      </div>
      <div class="rp-summary-item">
        <strong>${report.absentCount}</strong>
        <span>مرات الغياب</span>
      </div>
      ${report.pendingCount > 0 ? `
        <div class="rp-summary-item">
          <strong>${report.pendingCount}</strong>
          <span>لسه ما اتصححش</span>
        </div>
      ` : ""}
    </div>

    <h3 class="rp-section-title">تطور الدرجات (آخر 10 تقييمات)</h3>
    <div class="rp-chart" id="${chartId}"></div>

    <h3 class="rp-section-title">الامتحانات والواجبات</h3>
    <div class="rp-table-wrap">
      <table class="rp-table" id="${tableId}"></table>
    </div>

    <h3 class="rp-section-title">سجل الحضور</h3>
    <div class="rp-attendance" id="${attId}"></div>
  `;

  container.appendChild(section);

  // ---- الرسم البياني ----
  const recentGraded = report.graded.slice(-10);
  const chartValues = recentGraded.map((s) => s.percentage);
  const chartLabels = recentGraded.map((s) => formatChartLabel(s.submittedAt));
  renderTrendChart(document.getElementById(chartId), chartValues, { labels: chartLabels });

  // ---- جدول الامتحانات ----
  renderExamsTable(document.getElementById(tableId), report);

  // ---- سجل الحضور ----
  renderAttendanceGrid(document.getElementById(attId), report);
}

function renderExamsTable(tableEl, report) {
  const { exams, submissionsByExam } = report;

  if (exams.length === 0) {
    tableEl.innerHTML = `
      <tbody><tr><td style="padding:16px; color:#888;">مفيش تقييمات للمجموعة دي لسه</td></tr></tbody>
    `;
    return;
  }

  let html = `
    <thead>
      <tr>
        <th style="width:34px">#</th>
        <th>التقييم</th>
        <th style="width:80px">النوع</th>
        <th style="width:84px">الدرجة</th>
        <th style="width:64px">النسبة</th>
        <th style="width:92px">التاريخ</th>
      </tr>
    </thead>
    <tbody>
  `;

  exams.forEach((exam, index) => {
    const sub = submissionsByExam.get(exam.id);

    let scoreCell = `<td class="val-none">لم يسلّم</td>`;
    let percentCell = `<td class="val-none">—</td>`;
    let dateCell = `<td class="val-none">—</td>`;

    if (sub && sub.status === "graded" && typeof sub.percentage === "number") {
      scoreCell = `<td>${sub.score} / ${sub.totalPoints}</td>`;
      percentCell = `<td class="${scoreClass(sub.percentage)}">${sub.percentage}%</td>`;
      dateCell = `<td>${formatShortDateTime(sub.submittedAt)}</td>`;
    } else if (sub) {
      scoreCell = `<td style="color:#e67e22">لسه ما اتصححش</td>`;
      dateCell = `<td>${formatShortDateTime(sub.submittedAt)}</td>`;
    }

    html += `
      <tr>
        <td>${index + 1}</td>
        <td class="cell-name">${escapeHtml(exam.title || "بدون عنوان")}</td>
        <td>${translateExamType(exam.type)}</td>
        ${scoreCell}
        ${percentCell}
        ${dateCell}
      </tr>
    `;
  });

  html += `</tbody>`;
  tableEl.innerHTML = html;
}

function renderAttendanceGrid(attEl, report) {
  if (report.sessionDates.length === 0) {
    attEl.innerHTML = `<p style="color:#888; font-size:13px;">مفيش حصص حضور مسجّلة للمجموعة دي لسه.</p>`;
    return;
  }

  attEl.innerHTML = report.sessionDates.map((date) => {
    const status = report.attMap.get(date) || "absent";
    const label = status === "present" ? "حاضر" : status === "late" ? "متأخر" : "غايب";
    return `
      <div class="rp-att-day ${status}">
        <strong>${label}</strong>
        ${formatShortDate(date)}
      </div>
    `;
  }).join("");
}

// ============================================
// دوال مساعدة للعرض
// ============================================

function scoreClass(value) {
  if (value === null || value === undefined) return "val-none";
  if (value >= 75) return "val-good";
  if (value >= 50) return "val-mid";
  return "val-bad";
}

function formatTrend(value) {
  if (value === null || value === undefined) return `<span class="trend-flat">—</span>`;
  if (value > 0) return `<span class="trend-up">↑ ${value}</span>`;
  if (value < 0) return `<span class="trend-down">↓ ${Math.abs(value)}</span>`;
  return `<span class="trend-flat">ثابت</span>`;
}

function translateExamType(type) {
  const types = {
    exam: "امتحان",
    quiz: "اختبار قصير",
    assignment: "واجب",
    worksheet: "ورقة عمل"
  };
  return types[type] || "امتحان";
}

// تاريخ مختصر لتواريخ الحصص الخام "YYYY-MM-DD"
function formatShortDate(dateStr) {
  const parts = String(dateStr).split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

// تاريخ التسليم الكامل (بيجي ISO كامل مع الوقت)
function formatShortDateTime(isoStr) {
  if (!isoStr) return "—";
  try {
    const date = new Date(isoStr);
    return date.toLocaleDateString("ar-EG", {
      day: "numeric", month: "numeric", year: "2-digit"
    });
  } catch (e) {
    return "—";
  }
}

// تسمية مختصرة (يوم/شهر) لمحاور الرسم البياني
function formatChartLabel(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// ------- تسجيل الخروج -------
logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await signOut(auth);
    window.location.href = "../index.html";
  } catch (error) {
    console.error("Logout error:", error);
    logoutBtn.disabled = false;
  }
});