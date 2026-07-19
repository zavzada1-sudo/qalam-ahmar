// ============================================
// Exam Grades Logic - شاشة نتائج امتحان معيّن
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs, documentId }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// ------- قراءة examId من الرابط: grades.html?examId=xxx -------
const examId = new URLSearchParams(window.location.search).get("examId");

// ------- عناصر الصفحة -------
const loadingEl      = document.getElementById("loadingState");
const errorEl        = document.getElementById("errorState");
const errorTextEl    = document.getElementById("errorText");
const contentEl      = document.getElementById("contentWrapper");

const examTitleEl    = document.getElementById("examTitle");
const examMetaEl     = document.getElementById("examMeta");

const statSubmitted  = document.getElementById("statSubmitted");
const statAverage    = document.getElementById("statAverage");
const statHighest    = document.getElementById("statHighest");
const statLowest     = document.getElementById("statLowest");

const searchInput    = document.getElementById("searchInput");
const sortSelect     = document.getElementById("sortSelect");
const filterSelect   = document.getElementById("filterSelect");
const studentsListEl = document.getElementById("studentsList");
const listEmptyEl    = document.getElementById("listEmpty");
const exportBtn      = document.getElementById("exportBtn");

// كل صفوف الطلاب بعد الدمج (نحتفظ بيها في الذاكرة للبحث والترتيب بدون إعادة تحميل)
let allRows = [];
let currentExam = null;

// ------- لو مفيش examId في الرابط -------
if (!examId) {
  window.location.href = "teacher-dashboard.html";
}

// ------- حماية الصفحة: لازم مدرس مسجل دخول -------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../index.html";
    return;
  }

  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists() || userDoc.data().role !== "teacher") {
      window.location.href = "../index.html";
      return;
    }
    await loadGrades(user.uid);
  } catch (error) {
    console.error("Grades page auth error:", error);
    showError("حصلت مشكلة في التحقق من حسابك، حاول تحديث الصفحة");
  }
});

// ============================================
// الدالة الرئيسية: تجميع بيانات النتائج
// ============================================
async function loadGrades(teacherId) {
  try {
    // ---- 1. جلب بيانات الامتحان ----
    const examDoc = await getDoc(doc(db, "exams", examId));

    if (!examDoc.exists()) {
      showError("الامتحان ده مش موجود أو اتمسح");
      return;
    }

    const exam = examDoc.data();

    // تأكيد أمني: الامتحان لازم يكون بتاع المدرس اللي داخل
    if (exam.teacherId !== teacherId) {
      showError("مش من صلاحيتك تشوف نتايج الامتحان ده");
      return;
    }

    currentExam = exam;
    renderHeader(exam);

    // ---- 2. جلب طلاب المجموعات المرتبطة بالامتحان ----
    const students = await getStudentsOfGroups(exam.groupIds || []);

    // ---- 3. جلب كل تسليمات الامتحان (استعلام واحد) ----
    const subsSnap = await getDocs(query(
      collection(db, "submissions"),
      where("examId", "==", examId)
    ));

    // نحوّلهم لخريطة: studentId → بيانات التسليم (بحث سريع)
    const submissionsMap = new Map();
    subsSnap.forEach((subDoc) => {
      const sub = subDoc.data();
      submissionsMap.set(sub.studentId, sub);
    });

    // ---- 4. دمج الطلاب مع تسليماتهم ----
    allRows = students.map((student) => {
      const sub = submissionsMap.get(student.id);
      submissionsMap.delete(student.id); // نشيله عشان نعرف مين فاضل
      return buildRow(student.id, student.fullName, student.studentId, sub, exam);
    });

    // أي تسليم فاضل معناه طالب سلّم بس مبقاش في المجموعة دلوقتي
    // (اتنقل أو اتشال) — نعرضه برضه عشان درجته ما تضيعش
    submissionsMap.forEach((sub, studentId) => {
      const row = buildRow(studentId, sub.studentName || "طالب سابق", "—", sub, exam);
      row.isFormerStudent = true;
      allRows.push(row);
    });

    renderStats();
    renderList();
    showContent();

  } catch (error) {
    console.error("Load grades error:", error);
    showError("تعذر تحميل النتايج، حاول تحديث الصفحة");
  }
}

// ------- بناء صف طالب واحد -------
function buildRow(studentId, fullName, studentCode, sub, exam) {
  return {
    studentId,
    fullName: fullName || "بدون اسم",
    studentCode: studentCode || "—",
    submitted: Boolean(sub),
    // الحالات: not_submitted / queued / graded
    status: sub ? (sub.status || "graded") : "not_submitted",
    score: sub ? (sub.score ?? 0) : null,
    totalPoints: sub ? (sub.totalPoints ?? exam.totalPoints ?? 0) : (exam.totalPoints ?? 0),
    percentage: sub && typeof sub.percentage === "number" ? sub.percentage : null,
    timeSpent: sub ? (sub.totalTimeSpent ?? null) : null,
    isFormerStudent: false
  };
}

// ============================================
// جلب طلاب المجموعات المرتبطة بالامتحان
// ============================================
async function getStudentsOfGroups(groupIds) {
  if (!groupIds.length) return [];

  // ---- أ. نجيب كل مجموعة ونجمع منها studentIds ----
  // (بنقرا كل مجموعة لوحدها لأن عددهم صغير عادةً، وده أأمن مع الـ Rules)
  const studentIdSet = new Set();

  for (const groupId of groupIds) {
    try {
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (!groupDoc.exists()) continue;
      (groupDoc.data().studentIds || []).forEach((id) => studentIdSet.add(id));
    } catch (error) {
      console.warn("Skipped group:", groupId, error);
    }
  }

  const studentIds = [...studentIdSet];
  if (!studentIds.length) return [];

  // ---- ب. نجيب بيانات الطلاب من users ----
  // استعلام "in" بيقبل 10 قيم كحد أقصى، فبنقسمهم لدفعات
  const students = [];

  for (const chunk of chunkArray(studentIds, 10)) {
    const snap = await getDocs(query(
      collection(db, "users"),
      where(documentId(), "in", chunk)
    ));
    snap.forEach((userDoc) => {
      students.push({ id: userDoc.id, ...userDoc.data() });
    });
  }

  return students;
}

// تقسيم مصفوفة لدفعات بحجم معيّن
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ============================================
// عرض رأس الصفحة (عنوان الامتحان + معلوماته)
// ============================================
function renderHeader(exam) {
  examTitleEl.textContent = exam.title || "بدون عنوان";
  examMetaEl.textContent = [
    translateExamType(exam.type),
    `${exam.questionsCount || 0} سؤال`,
    `${exam.totalPoints || 0} درجة`,
    translateStatus(exam.status)
  ].join(" · ");
}

function translateExamType(type) {
  const types = {
    exam: "امتحان",
    quiz: "اختبار قصير",
    assignment: "واجب",
    worksheet: "ورقة عمل"
  };
  return types[type] || type || "امتحان";
}

function translateStatus(status) {
  const statuses = { draft: "مسودة", published: "منشور", closed: "مغلق" };
  return statuses[status] || status || "مسودة";
}

// ============================================
// الإحصائيات العامة (كروت فوق)
// ============================================
function renderStats() {
  const total = allRows.length;
  const submittedCount = allRows.filter((r) => r.submitted).length;

  statSubmitted.textContent = `${submittedCount}/${total}`;

  // المتوسط وأعلى/أقل نسبة بتتحسب من المصحّح فعليًا بس
  // (اللي لسه "قيد التصحيح" مش بيدخل الحسبة عشان ما يبوظش المتوسط)
  const percentages = allRows
    .filter((r) => r.status === "graded" && r.percentage !== null)
    .map((r) => r.percentage);

  if (!percentages.length) {
    statAverage.textContent = "—";
    statHighest.textContent = "—";
    statLowest.textContent  = "—";
    return;
  }

  const sum = percentages.reduce((acc, p) => acc + p, 0);
  statAverage.textContent = `${Math.round(sum / percentages.length)}%`;
  statHighest.textContent = `${Math.round(Math.max(...percentages))}%`;
  statLowest.textContent  = `${Math.round(Math.min(...percentages))}%`;
}

// ============================================
// عرض قائمة الطلاب (بحث + فلتر + ترتيب)
// ============================================
function renderList() {
  const rows = getVisibleRows();

  if (!rows.length) {
    studentsListEl.innerHTML = "";
    listEmptyEl.classList.remove("hidden");
    return;
  }

  listEmptyEl.classList.add("hidden");
  studentsListEl.innerHTML = rows.map(buildRowHtml).join("");
}

// تطبيق البحث والفلتر والترتيب على الصفوف
function getVisibleRows() {
  const term = searchInput.value.trim().toLowerCase();
  const filter = filterSelect.value;
  const sortBy = sortSelect.value;

  let rows = allRows.filter((row) => {
    // فلتر الحالة
    if (filter === "submitted" && !row.submitted) return false;
    if (filter === "missing" && row.submitted) return false;

    // البحث بالاسم أو الكود
    if (!term) return true;
    return row.fullName.toLowerCase().includes(term) ||
           String(row.studentCode).toLowerCase().includes(term);
  });

  // نسخة جديدة عشان ما نعدّلش على allRows نفسها
  rows = [...rows];

  if (sortBy === "name") {
    rows.sort((a, b) => a.fullName.localeCompare(b.fullName, "ar"));
  } else if (sortBy === "score_desc") {
    // اللي ما سلّمش يتحط في الآخر دايمًا
    rows.sort((a, b) => (b.percentage ?? -1) - (a.percentage ?? -1));
  } else if (sortBy === "score_asc") {
    rows.sort((a, b) => (a.percentage ?? 1000) - (b.percentage ?? 1000));
  }

  return rows;
}

// بناء HTML لصف طالب واحد (بنستخدم كلاسات gd-row الموجودة في main.css)
function buildRowHtml(row) {
  let badge, score;

  if (!row.submitted) {
    badge = `<span class="grade-badge missing">لسه ما سلّمش</span>`;
    score = `<span class="grade-score-empty">—</span>`;
  } else if (row.status === "queued") {
    badge = `<span class="grade-badge queued">قيد التصحيح</span>`;
    score = `<span class="grade-score-empty">—</span>`;
  } else {
    badge = `<span class="grade-badge graded">تم التصحيح</span>`;
    const pct = row.percentage !== null ? Math.round(row.percentage) : 0;
    score = `<span class="grade-score ${scoreColorClass(pct)}">
               ${row.score}/${row.totalPoints}
               <small>${pct}%</small>
             </span>`;
  }

  const formerTag = row.isFormerStudent
    ? `<span class="grade-badge former" title="سلّم الامتحان لكن مش في المجموعة دلوقتي">خارج المجموعة</span>`
    : "";

  return `
    <div class="gd-row grade-row">
      <div class="gd-row-info">
        <div class="gd-row-name">${escapeHtml(row.fullName)} ${formerTag}</div>
        <div class="gd-row-code">كود الطالب: ${escapeHtml(String(row.studentCode))}</div>
      </div>
      <div class="grade-row-status">${badge}</div>
      <div class="grade-row-score">${score}</div>
      <div class="grade-row-time">${row.timeSpent ? formatDuration(row.timeSpent) : "—"}</div>
    </div>
  `;
}

// لون الدرجة حسب النسبة (أخضر / برتقالي / أحمر)
function scoreColorClass(pct) {
  if (pct >= 65) return "pass";
  if (pct >= 50) return "mid";
  return "fail";
}

// تحويل الثواني لصيغة مقروءة
function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// حماية من XSS في أسماء الطلاب
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

// ============================================
// تصدير النتائج كملف CSV (يفتح في Excel)
// ============================================
exportBtn.addEventListener("click", () => {
  const rows = getVisibleRows();
  if (!rows.length) return;

  const header = ["اسم الطالب", "كود الطالب", "الحالة", "الدرجة", "من", "النسبة %", "الوقت"];

  const statusText = {
    graded: "تم التصحيح",
    queued: "قيد التصحيح",
    not_submitted: "لم يسلم"
  };

  const lines = rows.map((row) => [
    row.fullName,
    row.studentCode,
    statusText[row.status] || row.status,
    row.score ?? "",
    row.totalPoints ?? "",
    row.percentage !== null ? Math.round(row.percentage) : "",
    row.timeSpent ? formatDuration(row.timeSpent) : ""
  ]);

  const csv = [header, ...lines]
    .map((cols) => cols.map(csvCell).join(","))
    .join("\r\n");

  // BOM في الأول عشان Excel يقرا العربي صح
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `نتائج - ${currentExam?.title || "امتحان"}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

// تنظيف خانة الـ CSV (لو فيها فاصلة أو علامة تنصيص)
function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// ============================================
// حالات الشاشة
// ============================================
function showContent() {
  loadingEl.classList.add("hidden");
  errorEl.classList.add("hidden");
  contentEl.classList.remove("hidden");
}

function showError(message) {
  loadingEl.classList.add("hidden");
  contentEl.classList.add("hidden");
  errorTextEl.textContent = message;
  errorEl.classList.remove("hidden");
}

// ------- أحداث البحث والفلتر والترتيب (تحديث فوري) -------
searchInput.addEventListener("input", renderList);
sortSelect.addEventListener("change", renderList);
filterSelect.addEventListener("change", renderList);