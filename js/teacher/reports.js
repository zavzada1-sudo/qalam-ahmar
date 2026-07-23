// ============================================
// Reports Logic - تقارير أداء الطلبة
// ============================================
//
// الصفحة فيها عرضين:
//  1. تقرير المجموعة: كل الطلبة في جدول واحد (متوسط، تحسّن، حضور)
//  2. تقرير الطالب: تفاصيل كل امتحان + سجل الحضور (بالضغط على أي صف)
//
// ⚠️ ملاحظة مهمة عن التصحيح:
// التسليم بيتصحح في results.js وقت ما الطالب يفتح صفحة نتيجته.
// يعني ممكن يكون فيه تسليمات status: "queued" من غير درجة لحد دلوقتي.
// إحنا بنعرضها "لسه ما اتصححتش" ومش بنحسبها في المتوسط، عشان مانطلعش
// متوسط غلط.
//
// حساب نسبة التحسّن (خط الانحدار / Linear Trend):
// بناخد آخر 10 تقييمات مصححة (بترتيبها الزمني)، ونرسم "خط اتجاه" يمر
// من كل النقط دي (Least Squares Regression) بدل ما نقارن متوسطين بس.
// بعدين نحسب فرق قيمة الخط ده بين أول نقطة وآخر نقطة = مقدار التحسّن الكلي
// خلال الفترة دي. الطريقة دي أدق من "متوسط أول نص/آخر نص" لأنها:
//  - بتاخد كل التقييمات في الحسبة مش بس أول واحد وآخر واحد،
//  - أقل تأثرًا بتقييم شاذ واحد (Outlier) زي درجة واطية استثنائية،
//  - بتلقط الاتجاه العام حتى لو فيه تذبذب في النص.
// محتاجين 4 تقييمات على الأقل عشان الرقم يبقى ليه معنى.
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc, getDoc, collection, query, where, getDocs, documentId
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import { showToast } from "../shared/ui.js";
import { renderSkeleton } from "../shared/states.js";
import { renderTrendChart } from "../shared/chart.js";
import "../shared/theme.js";
import "../shared/offline-banner.js";


// ============================================
// القائمة الجانبية
// ============================================
const logoutBtn       = document.getElementById("logoutBtn");
const menuToggle      = document.getElementById("menuToggle");
const sidebar         = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

if (menuToggle) menuToggle.addEventListener("click", () => {
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("show");
});
if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", () => {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("show");
});

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

// ============================================
// عناصر الصفحة
// ============================================
const loadingEl   = document.getElementById("loadingState");
const errorEl     = document.getElementById("errorState");
const errorTextEl = document.getElementById("errorText");
const contentEl   = document.getElementById("contentWrapper");

const gradeSelect = document.getElementById("gradeSelect");
const groupSelect = document.getElementById("groupSelect");
const pickPrompt  = document.getElementById("pickPrompt");

// عرض المجموعة
const groupView        = document.getElementById("groupView");
const groupReportTitle = document.getElementById("groupReportTitle");
const groupReportMeta  = document.getElementById("groupReportMeta");
const groupSummary     = document.getElementById("groupSummary");
const groupTable       = document.getElementById("groupTable");
const searchInput      = document.getElementById("searchInput");
const sortSelect       = document.getElementById("sortSelect");
const printGroupBtn    = document.getElementById("printGroupBtn");

// عرض الطالب
const studentView        = document.getElementById("studentView");
const studentReportTitle = document.getElementById("studentReportTitle");
const studentReportMeta  = document.getElementById("studentReportMeta");
const studentSummary     = document.getElementById("studentSummary");
const studentTrendChart  = document.getElementById("studentTrendChart");
const studentExamsTable  = document.getElementById("studentExamsTable");
const studentAttendance  = document.getElementById("studentAttendance");
const backBtn            = document.getElementById("backBtn");
const printStudentBtn    = document.getElementById("printStudentBtn");

// ============================================
// الحالة
// ============================================
let currentTeacherId = null;
let teacherData      = null;
let allGrades        = [];
let allGroups        = [];
let selectedGroup    = null;

// بيانات المجموعة المحمّلة حاليًا
let groupStudents    = [];   // [{ uid, fullName, studentId }]
let groupExams       = [];   // [{ id, title, type, totalPoints, createdAt }]
let submissionsByStudent = new Map(); // uid → [تسليمات]
let attendanceByStudent  = new Map(); // uid → Map(date → status)
let sessionDates     = [];   // تواريخ الحصص المسجّلة للمجموعة

// صفوف التقرير المحسوبة
let reportRows = [];

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

    loadingEl.classList.add("hidden");
    contentEl.classList.remove("hidden");

  } catch (error) {
    console.error("Reports init error:", error);
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
// اختيار السنة
// ============================================
gradeSelect.addEventListener("change", () => {
  const gradeId = gradeSelect.value;

  groupSelect.innerHTML = `<option value="">اختر المجموعة...</option>`;
  groupSelect.disabled = !gradeId;

  resetViews();

  if (!gradeId) return;

  allGroups
    .filter((g) => g.gradeId === gradeId)
    .forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = g.groupName || "بدون اسم";
      groupSelect.appendChild(opt);
    });
});

// ============================================
// اختيار المجموعة → تحميل التقرير
// ============================================
groupSelect.addEventListener("change", async () => {
  const groupId = groupSelect.value;

  if (!groupId) {
    resetViews();
    return;
  }

  selectedGroup = allGroups.find((g) => g.id === groupId) || null;
  await loadGroupReport();
});

// ============================================
// تحميل كل بيانات المجموعة
// ============================================
async function loadGroupReport() {
  if (!selectedGroup) return;

  pickPrompt.classList.add("hidden");
  studentView.classList.add("hidden");
  groupView.classList.remove("hidden");

  groupTable.innerHTML = "";
  renderSkeleton(groupSummary, { type: "stat", count: 4 });

  try {
    // 🆕 نجيب الطلبة والامتحانات والحضور بالتوازي (Promise.all) —
    // التلاتة دول مستقلين عن بعض تمامًا، مفيش داعي واحد يستنى التاني.
    // التسليمات لوحدها بعدين لأنها محتاجة IDs الامتحانات الأول.
    const [students, exams, attendanceData] = await Promise.all([
      fetchUsersByIds(selectedGroup.studentIds || []),
      fetchGroupExams(selectedGroup.id),
      fetchAttendance(selectedGroup.id)
    ]);

    groupStudents = students;
    groupExams = exams;
    attendanceByStudent = attendanceData.byStudent;
    sessionDates = attendanceData.dates;

    // ---- التسليمات (محتاجة IDs الامتحانات) ----
    submissionsByStudent = await fetchSubmissions(groupExams.map((e) => e.id));

    // ---- نحسب الصفوف ----
    reportRows = groupStudents.map((student) => buildStudentRow(student));

    renderGroupReport();

  } catch (error) {
    console.error("Load group report error:", error);

    if (error.code === "failed-precondition") {
      showToast(
        "محتاج فهرس (Index) في Firestore. افتح Console (F12) واضغط اللينك اللي في رسالة الخطأ.",
        "error"
      );
      console.warn("👇 اضغط اللينك ده عشان تعمل الفهرس:\n", error.message);
      return;
    }

    showToast("تعذر تحميل التقرير.", "error");
  }
}

// ============================================
// جلب الطلبة
// ============================================
async function fetchUsersByIds(ids) {
  if (!ids || ids.length === 0) return [];

  // 🆕 نبني كل الدفعات (كل دفعة 10 IDs بحد أقصى، حد Firestore) ونطلقهم
  // كلهم مع بعض بـ Promise.all بدل ما كل دفعة تستنى اللي قبلها
  const chunks = [];
  for (let i = 0; i < ids.length; i += 10) {
    chunks.push(ids.slice(i, i + 10));
  }

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      getDocs(query(collection(db, "users"), where(documentId(), "in", chunk)))
    )
  );

  const results = [];
  snaps.forEach((snap) => {
    snap.forEach((d) => results.push({ uid: d.id, ...d.data() }));
  });

  results.sort((a, b) =>
    (a.fullName || "").localeCompare(b.fullName || "", "ar")
  );

  return results;
}

// ============================================
// جلب امتحانات المجموعة
// ============================================
async function fetchGroupExams(groupId) {
  const snap = await getDocs(query(
    collection(db, "exams"),
    where("teacherId", "==", currentTeacherId),
    where("groupIds", "array-contains", groupId)
  ));

  const exams = [];
  snap.forEach((d) => exams.push({ id: d.id, ...d.data() }));

  // ترتيب زمني (الأقدم الأول) — مهم لحساب التحسّن
  exams.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  return exams;
}

// ============================================
// جلب التسليمات لكل امتحانات المجموعة
// ============================================
async function fetchSubmissions(examIds) {
  const map = new Map();

  if (!examIds || examIds.length === 0) return map;

  // 🆕 نفس فكرة fetchUsersByIds: كل دفعات الـ 10 examIds بيتطلقوا
  // مع بعض بدل التتابع
  const chunks = [];
  for (let i = 0; i < examIds.length; i += 10) {
    chunks.push(examIds.slice(i, i + 10));
  }

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      getDocs(query(
        collection(db, "submissions"),
        where("teacherId", "==", currentTeacherId),  // لازم يطابق الـ Rules
        where("examId", "in", chunk)
      ))
    )
  );

  snaps.forEach((snap) => {
    snap.forEach((d) => {
      const sub = { id: d.id, ...d.data() };
      if (!map.has(sub.studentId)) map.set(sub.studentId, []);
      map.get(sub.studentId).push(sub);
    });
  });

  // ترتيب تسليمات كل طالب زمنيًا (الأقدم الأول)
  map.forEach((subs) => {
    subs.sort((a, b) => (a.submittedAt || "").localeCompare(b.submittedAt || ""));
  });

  return map;
}

// ============================================
// جلب الحضور للمجموعة
// ============================================
async function fetchAttendance(groupId) {
  const [sessionsSnap, recordsSnap] = await Promise.all([
    getDocs(query(
      collection(db, "attendanceSessions"),
      where("teacherId", "==", currentTeacherId),
      where("groupId", "==", groupId)
    )),
    getDocs(query(
      collection(db, "attendance"),
      where("teacherId", "==", currentTeacherId),
      where("groupId", "==", groupId)
    ))
  ]);

  // تواريخ الحصص
  const dates = [];
  sessionsSnap.forEach((d) => {
    const date = d.data().date;
    if (date) dates.push(date);
  });

  // خريطة: uid → Map(date → status)
  const byStudent = new Map();
  recordsSnap.forEach((d) => {
    const rec = d.data();
    if (!byStudent.has(rec.studentUid)) byStudent.set(rec.studentUid, new Map());
    byStudent.get(rec.studentUid).set(rec.date, rec.status);
  });

  // احتياطي: لو مفيش جلسات مسجّلة، ناخد تواريخ السجلات
  let finalDates = [...new Set(dates)];
  if (finalDates.length === 0) {
    const fromRecords = new Set();
    byStudent.forEach((dateMap) => {
      dateMap.forEach((_, date) => fromRecords.add(date));
    });
    finalDates = [...fromRecords];
  }

  finalDates.sort();

  return { byStudent, dates: finalDates };
}

// ============================================
// حساب صف الطالب
// ============================================
function buildStudentRow(student) {
  const subs = submissionsByStudent.get(student.uid) || [];

  // نفصل المصحح عن اللي لسه queued
  const graded = subs.filter(
    (s) => s.status === "graded" && typeof s.percentage === "number"
  );
  const pending = subs.filter((s) => s.status !== "graded");

  // المتوسط العام
  const avg = graded.length
    ? Math.round(graded.reduce((sum, s) => sum + s.percentage, 0) / graded.length)
    : null;

  // التحسّن
  const improvement = calcImprovement(graded.map((s) => s.percentage));

  // الحضور
  const attMap = attendanceByStudent.get(student.uid) || new Map();
  let presentCount = 0;
  let lateCount = 0;

  sessionDates.forEach((date) => {
    const status = attMap.get(date);
    if (status === "present") presentCount++;
    else if (status === "late") lateCount++;
  });

  const absentCount = sessionDates.length - presentCount - lateCount;
  const attendanceRate = sessionDates.length
    ? Math.round(((presentCount + lateCount) / sessionDates.length) * 100)
    : null;

  return {
    uid:  student.uid,
    name: student.fullName || "بدون اسم",
    code: student.studentId || "—",
    submittedCount: graded.length,
    pendingCount:   pending.length,
    totalExams:     groupExams.length,
    avg,
    improvement,
    presentCount,
    lateCount,
    absentCount,
    attendanceRate,
    graded,
    pending,
    attMap
  };
}

// ============================================
// حساب نسبة التحسّن (خط الانحدار / Linear Regression Slope)
// ============================================
// بناخد آخر 10 تقييمات (مرتبة زمنيًا، الأقدم أولاً)، ونحسب معادلة
// "أفضل خط مستقيم" يعدّي من كل النقط دي (طريقة Least Squares).
// ميل الخط ده (slope) = مقدار التغيّر المتوقع في كل تقييم واحد.
// عشان نطلع برقم واحد مفهوم زي القديم (فرق نقاط مئوية)، بنضرب الميل
// في عدد الخطوات بين أول وآخر تقييم، فيبقى الناتج = "مقدار التحسّن
// الكلي المتوقع من أول تقييم في الفترة لآخر واحد فيها حسب الاتجاه العام".
function calcImprovement(percentages) {
  if (!percentages || percentages.length < 4) return null;

  const recent = percentages.slice(-10);
  const n = recent.length;

  // x = ترتيب التقييم (1, 2, 3, ...)، y = النسبة المئوية
  const sumX  = recent.reduce((sum, _, i) => sum + (i + 1), 0);
  const sumY  = recent.reduce((sum, y) => sum + y, 0);
  const sumXY = recent.reduce((sum, y, i) => sum + (i + 1) * y, 0);
  const sumX2 = recent.reduce((sum, _, i) => sum + (i + 1) * (i + 1), 0);

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0; // احتياطي رياضي، عمليًا مش هيحصل مع n >= 4

  const slope = (n * sumXY - sumX * sumY) / denominator;

  // التغيّر الكلي المتوقع خلال الفترة (من أول نقطة لآخر نقطة على الخط)
  const totalChange = slope * (n - 1);

  return Math.round(totalChange);
}

// ============================================
// عرض تقرير المجموعة
// ============================================
function renderGroupReport() {
  groupReportTitle.textContent = `تقرير المجموعة — ${selectedGroup.groupName || ""}`;

  const gradeName = allGrades.find((g) => g.id === selectedGroup.gradeId)?.gradeName || "";
  groupReportMeta.textContent =
    `أ/ ${teacherData.fullName || ""} · ${gradeName} · ` +
    `${groupStudents.length} طالب · ${groupExams.length} تقييم · ` +
    `${sessionDates.length} حصة · ${formatArabicDate(todayStr())}`;

  // ---- الملخص ----
  const withAvg = reportRows.filter((r) => r.avg !== null);
  const classAvg = withAvg.length
    ? Math.round(withAvg.reduce((sum, r) => sum + r.avg, 0) / withAvg.length)
    : null;

  const improved = reportRows.filter((r) => r.improvement !== null && r.improvement > 0).length;
  const declined = reportRows.filter((r) => r.improvement !== null && r.improvement < 0).length;

  const withAtt = reportRows.filter((r) => r.attendanceRate !== null);
  const classAttendance = withAtt.length
    ? Math.round(withAtt.reduce((sum, r) => sum + r.attendanceRate, 0) / withAtt.length)
    : null;

  const totalPending = reportRows.reduce((sum, r) => sum + r.pendingCount, 0);

  groupSummary.innerHTML = `
    <div class="rp-summary-item">
      <strong>${groupStudents.length}</strong><span>عدد الطلبة</span>
    </div>
    <div class="rp-summary-item">
      <strong>${classAvg !== null ? classAvg + "%" : "—"}</strong><span>متوسط المجموعة</span>
    </div>
    <div class="rp-summary-item">
      <strong>${classAttendance !== null ? classAttendance + "%" : "—"}</strong><span>نسبة الحضور</span>
    </div>
    <div class="rp-summary-item">
      <strong>${improved}</strong><span>طالب اتحسّن</span>
    </div>
    <div class="rp-summary-item">
      <strong>${declined}</strong><span>طالب اتراجع</span>
    </div>
    ${totalPending > 0 ? `
      <div class="rp-summary-item">
        <strong>${totalPending}</strong><span>تسليم لسه ما اتصححش</span>
      </div>
    ` : ""}
  `;

  renderGroupTable();
}

// ============================================
// جدول المجموعة (مع البحث والترتيب)
// ============================================
function renderGroupTable() {
  const term = (searchInput.value || "").trim().toLowerCase();
  const sortBy = sortSelect.value;

  let rows = reportRows.filter((r) => {
    if (!term) return true;
    return `${r.name} ${r.code}`.toLowerCase().includes(term);
  });

  // الترتيب (القيم الفاضية دايمًا في الآخر)
  rows = [...rows].sort((a, b) => {
    switch (sortBy) {
      case "avg_desc":     return nullLast(b.avg, a.avg);
      case "avg_asc":      return nullLast(a.avg, b.avg, true);
      case "improve_desc": return nullLast(b.improvement, a.improvement);
      case "improve_asc":  return nullLast(a.improvement, b.improvement, true);
      case "attend_asc":   return nullLast(a.attendanceRate, b.attendanceRate, true);
      default:             return a.name.localeCompare(b.name, "ar");
    }
  });

  if (rows.length === 0) {
    groupTable.innerHTML = `
      <tbody><tr><td style="padding:20px; color:#888;">مفيش طلبة مطابقين للبحث</td></tr></tbody>
    `;
    return;
  }

  let html = `
    <thead>
      <tr>
        <th style="width:34px">#</th>
        <th>اسم الطالب</th>
        <th style="width:64px">الكود</th>
        <th style="width:76px">التقييمات</th>
        <th style="width:64px">المتوسط</th>
        <th style="width:70px">التحسّن</th>
        <th style="width:56px">حاضر</th>
        <th style="width:56px">متأخر</th>
        <th style="width:56px">غايب</th>
        <th style="width:64px">الحضور</th>
      </tr>
    </thead>
    <tbody>
  `;

  rows.forEach((row, index) => {
    html += `
      <tr class="rp-clickable" data-uid="${row.uid}">
        <td>${index + 1}</td>
        <td class="cell-name">
          ${escapeHtml(row.name)}
          ${row.pendingCount > 0
            ? `<small style="color:#e67e22"> (${row.pendingCount} لسه ما اتصححش)</small>`
            : ""}
        </td>
        <td class="cell-code">${escapeHtml(row.code)}</td>
        <td>${row.submittedCount} / ${row.totalExams}</td>
        <td class="${scoreClass(row.avg)}">${row.avg !== null ? row.avg + "%" : "—"}</td>
        <td>${formatTrend(row.improvement)}</td>
        <td>${row.presentCount}</td>
        <td>${row.lateCount}</td>
        <td>${row.absentCount}</td>
        <td class="${scoreClass(row.attendanceRate)}">
          ${row.attendanceRate !== null ? row.attendanceRate + "%" : "—"}
        </td>
      </tr>
    `;
  });

  html += `</tbody>`;
  groupTable.innerHTML = html;
}

// البحث والترتيب
searchInput.addEventListener("input", renderGroupTable);
sortSelect.addEventListener("change", renderGroupTable);

// ============================================
// الضغط على صف طالب → تقريره التفصيلي
// ============================================
groupTable.addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-uid]");
  if (!tr) return;

  const row = reportRows.find((r) => r.uid === tr.dataset.uid);
  if (row) renderStudentReport(row);
});

// ============================================
// تقرير الطالب الواحد
// ============================================
function renderStudentReport(row) {
  groupView.classList.add("hidden");
  studentView.classList.remove("hidden");
  window.scrollTo(0, 0);

  studentReportTitle.textContent = `تقرير الطالب — ${row.name}`;

  const gradeName = allGrades.find((g) => g.id === selectedGroup.gradeId)?.gradeName || "";
  studentReportMeta.textContent =
    `كود الطالب: ${row.code} · ${gradeName} · ${selectedGroup.groupName || ""} · ` +
    `أ/ ${teacherData.fullName || ""} · ${formatArabicDate(todayStr())}`;

  // ---- الملخص ----
  studentSummary.innerHTML = `
    <div class="rp-summary-item">
      <strong class="${scoreClass(row.avg)}">${row.avg !== null ? row.avg + "%" : "—"}</strong>
      <span>المتوسط العام</span>
    </div>
    <div class="rp-summary-item">
      <strong>${formatTrend(row.improvement)}</strong><span>التحسّن</span>
    </div>
    <div class="rp-summary-item">
      <strong>${row.submittedCount} / ${row.totalExams}</strong><span>التقييمات المسلّمة</span>
    </div>
    <div class="rp-summary-item">
      <strong class="${scoreClass(row.attendanceRate)}">
        ${row.attendanceRate !== null ? row.attendanceRate + "%" : "—"}
      </strong>
      <span>نسبة الحضور</span>
    </div>
    <div class="rp-summary-item">
      <strong>${row.absentCount}</strong><span>مرات الغياب</span>
    </div>
  `;

  // ---- جدول الامتحانات ----
  // ---- الرسم البياني لتطور الدرجات ----
  renderScoreChart(row);

  // ---- جدول الامتحانات ----
  renderStudentExams(row);

  // ---- سجل الحضور ----
  renderStudentAttendance(row);
}

// رسم بياني لتطور آخر 10 درجات مصححة (بنفس منطق حساب التحسّن)
function renderScoreChart(row) {
  if (!studentTrendChart) return;

  const recentGraded = row.graded.slice(-10);
  const values = recentGraded.map((s) => s.percentage);
  const labels = recentGraded.map((s) => formatShortDateTime(s.submittedAt));

  renderTrendChart(studentTrendChart, values, { labels });
}

// جدول امتحانات الطالب
function renderStudentExams(row) {
  if (groupExams.length === 0) {
    studentExamsTable.innerHTML = `
      <tbody><tr><td style="padding:16px; color:#888;">مفيش تقييمات للمجموعة دي لسه</td></tr></tbody>
    `;
    return;
  }

  // خريطة سريعة: examId → التسليم
  const subsByExam = new Map();
  [...row.graded, ...row.pending].forEach((s) => subsByExam.set(s.examId, s));

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

  groupExams.forEach((exam, index) => {
    const sub = subsByExam.get(exam.id);

    let scoreCell = `<td class="val-none">لم يسلّم</td>`;
    let percentCell = `<td class="val-none">—</td>`;
    let dateCell = `<td class="val-none">—</td>`;

    if (sub && sub.status === "graded" && typeof sub.percentage === "number") {
      scoreCell = `<td>${sub.score} / ${sub.totalPoints}</td>`;
      percentCell = `<td class="${scoreClass(sub.percentage)}">${sub.percentage}%</td>`;
      dateCell = `<td>${formatShortDateTime(sub.submittedAt)}</td>`;
    } else if (sub) {
      scoreCell = `<td style="color:#e67e22">لسه ما اتصححش</td>`;
      percentCell = `<td class="val-none">—</td>`;
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
  studentExamsTable.innerHTML = html;
}

// سجل حضور الطالب
function renderStudentAttendance(row) {
  if (sessionDates.length === 0) {
    studentAttendance.innerHTML = `
      <p style="color:#888; font-size:13px;">مفيش حصص حضور مسجّلة للمجموعة دي لسه.</p>
    `;
    return;
  }

  studentAttendance.innerHTML = sessionDates.map((date) => {
    const status = row.attMap.get(date) || "absent";
    const label = status === "present" ? "حاضر"
                : status === "late"    ? "متأخر"
                : "غايب";

    return `
      <div class="rp-att-day ${status}">
        <strong>${label}</strong>
        ${formatShortDate(date)}
      </div>
    `;
  }).join("");
}

// ============================================
// الرجوع لتقرير المجموعة
// ============================================
backBtn.addEventListener("click", () => {
  studentView.classList.add("hidden");
  groupView.classList.remove("hidden");
  window.scrollTo(0, 0);
});

// ============================================
// الطباعة
// ============================================
printGroupBtn.addEventListener("click", () => window.print());
printStudentBtn.addEventListener("click", () => window.print());

// ============================================
// دوال مساعدة
// ============================================

// تصفير العروض
function resetViews() {
  selectedGroup = null;
  reportRows = [];

  groupView.classList.add("hidden");
  studentView.classList.add("hidden");
  pickPrompt.classList.remove("hidden");
}

// ترتيب بيحط القيم الفاضية (null) في الآخر دايمًا
function nullLast(a, b, ascending = false) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return ascending ? a - b : a - b;
}

// لون النسبة
function scoreClass(value) {
  if (value === null || value === undefined) return "val-none";
  if (value >= 75) return "val-good";
  if (value >= 50) return "val-mid";
  return "val-bad";
}

// عرض التحسّن بسهم ولون
function formatTrend(value) {
  if (value === null || value === undefined) {
    return `<span class="trend-flat">—</span>`;
  }
  if (value > 0)  return `<span class="trend-up">↑ ${value}</span>`;
  if (value < 0)  return `<span class="trend-down">↓ ${Math.abs(value)}</span>`;
  return `<span class="trend-flat">ثابت</span>`;
}

// ترجمة نوع التقييم
function translateExamType(type) {
  const types = {
    exam: "امتحان",
    quiz: "اختبار قصير",
    assignment: "واجب",
    worksheet: "ورقة عمل"
  };
  return types[type] || "امتحان";
}

function todayStr() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function formatArabicDate(dateStr) {
  try {
    const date = new Date(`${dateStr}T00:00:00`);
    return date.toLocaleDateString("ar-EG", {
      day: "numeric", month: "long", year: "numeric"
    });
  } catch (e) {
    return dateStr;
  }
}

// تاريخ مختصر (يوم/شهر)
function formatShortDate(dateStr) {
  const parts = String(dateStr).split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

// تاريخ التسليم (بيجي ISO كامل)
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