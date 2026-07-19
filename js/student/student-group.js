// ============================================
// Student Group Page - عرض امتحانات وواجبات المجموعة
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// ------- عناصر الصفحة -------
const logoutBtn = document.getElementById("logoutBtn");
const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

const groupTitle = document.getElementById("groupTitle");
const groupSubtitle = document.getElementById("groupSubtitle");
const crumbGroup = document.getElementById("crumbGroup");

const examsList = document.getElementById("examsList");
const assignmentsList = document.getElementById("assignmentsList");
const examsTabCount = document.getElementById("examsTabCount");
const assignmentsTabCount = document.getElementById("assignmentsTabCount");
const examsTab = document.getElementById("examsTab");
const assignmentsTab = document.getElementById("assignmentsTab");
const materialsList = document.getElementById("materialsList");
const materialsTabCount = document.getElementById("materialsTabCount");
const materialsTab = document.getElementById("materialsTab");


// ------- الحالة -------
let currentStudentId = null;
let groupId = null;

// أنواع تُحسب كامتحان
const EXAM_TYPES = new Set(["exam", "quiz"]);
// أنواع تُحسب كواجب
const ASSIGNMENT_TYPES = new Set(["assignment", "worksheet"]);

// ------- القائمة الجانبية (موبايل) -------
if (menuToggle) menuToggle.addEventListener("click", () => {
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("show");
});
if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", () => {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("show");
});

// ------- تنضيف النصوص -------
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ------- تبويبات -------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    examsTab.classList.toggle("hidden", tab !== "exams");
    assignmentsTab.classList.toggle("hidden", tab !== "assignments");
    materialsTab.classList.toggle("hidden", tab !== "materials");
  });
});

// ============================================
// حماية + تحميل
// ============================================

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "../index.html"; return; }

  const params = new URLSearchParams(window.location.search);
  groupId = params.get("groupId");
  if (!groupId) {
    showFatalError("رابط غير صحيح");
    return;
  }

  try {
    // نتأكد إنه طالب
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists() || userDoc.data().role !== "student") {
      window.location.href = "../index.html";
      return;
    }
    currentStudentId = user.uid;

    // نجيب المجموعة ونتأكد إنه عضو فيها
    const groupSnap = await getDoc(doc(db, "groups", groupId));
    if (!groupSnap.exists()) {
      showFatalError("المجموعة دي مش موجودة");
      return;
    }
    const group = groupSnap.data();
    if (!(group.studentIds || []).includes(currentStudentId)) {
      showFatalError("إنت مش في المجموعة دي");
      return;
    }

    // اسم المدرس
    let teacherName = "المدرس";
    try {
      const teacherSnap = await getDoc(doc(db, "users", group.teacherId));
      if (teacherSnap.exists()) teacherName = teacherSnap.data().fullName || "المدرس";
    } catch (error) { /* تجاهل */ }

    groupTitle.textContent = group.groupName;
    groupSubtitle.textContent = `مع ${teacherName}`;
    crumbGroup.textContent = group.groupName;

    await loadExamsAndAssignments();
    await loadMaterials();

  } catch (error) {
    console.error("Load group page error:", error);
    showFatalError("تعذر تحميل الصفحة، حدّث وحاول تاني");
  }
});

function showFatalError(msg) {
  examsList.innerHTML = `<p class="message error">${escapeHtml(msg)}</p>`;
  assignmentsList.innerHTML = "";
}

// ============================================
// جلب الامتحانات والواجبات
// ============================================

async function loadExamsAndAssignments() {
  try {
    // 1) كل الامتحانات المنشورة المرتبطة بالمجموعة دي
    const examsSnap = await getDocs(query(
      collection(db, "exams"),
      where("groupIds", "array-contains", groupId),
      where("status", "==", "published")
    ));

    // 2) كل الـ submissions بتاعت الطالب (عشان نعرف حل ولا لأ)
    const subsSnap = await getDocs(query(
      collection(db, "submissions"),
      where("studentId", "==", currentStudentId)
    ));
    const submittedExamIds = new Map(); // examId -> submission
    subsSnap.forEach((s) => submittedExamIds.set(s.data().examId, s.data()));

    // 3) نقسّم على تبويبين
    const exams = [];
    const assignments = [];
    examsSnap.forEach((examDoc) => {
      const exam = { id: examDoc.id, ...examDoc.data() };
      const submission = submittedExamIds.get(examDoc.id) || null;

      if (EXAM_TYPES.has(exam.type)) {
        exams.push({ exam, submission });
      } else if (ASSIGNMENT_TYPES.has(exam.type)) {
        assignments.push({ exam, submission });
      }
    });

    // ترتيب: الأحدث أول
    const sortByCreatedAt = (a, b) => {
      const da = new Date(a.exam.createdAt || 0).getTime();
      const dbb = new Date(b.exam.createdAt || 0).getTime();
      return dbb - da;
    };
    exams.sort(sortByCreatedAt);
    assignments.sort(sortByCreatedAt);

    examsTabCount.textContent = exams.length;
    assignmentsTabCount.textContent = assignments.length;

    renderList(examsList, exams, "امتحانات");
    renderList(assignmentsList, assignments, "واجبات");

  } catch (error) {
    console.error("Load exams/assignments error:", error);
    showFatalError("تعذر تحميل الامتحانات، حدّث وحاول تاني");
  }
}

// ============================================
// عرض الكروت
// ============================================

function renderList(container, items, label) {
  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-icon">🌱</div>
        <h3>مفيش ${label} متاحة</h3>
        <p>ارجع بعدين لما مدرسك يضيف ${label} جديدة.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = "";
  items.forEach(({ exam, submission }) => {
    container.appendChild(buildCard(exam, submission));
  });
}

function buildCard(exam, submission) {
  const now = new Date();
  const from = exam.availableFrom ? new Date(exam.availableFrom) : null;
  const to = exam.availableTo ? new Date(exam.availableTo) : null;

  // تحديد الحالة
  let status;
  if (submission) {
    status = "done"; // خلاص حله
  } else if (from && from > now) {
    status = "notStarted"; // لسه ما بدأش
  } else if (to && to < now) {
    status = "closed"; // اتقفل
  } else {
    status = "available"; // متاح
  }

  const card = document.createElement("div");
  card.className = "entity-card assignment-card";

  const timeInfo = [];
  if (exam.timeLimit) timeInfo.push(`⏱️ ${exam.timeLimit} دقيقة`);
  if (exam.totalPoints) timeInfo.push(`🎯 ${exam.totalPoints} درجة`);
  if (exam.questionsCount) timeInfo.push(`📝 ${exam.questionsCount} سؤال`);

  let statusHtml = "";
  let actionHtml = "";

  if (status === "done") {
    const score = submission.score ?? "—";
    const total = submission.totalPoints ?? "—";
    statusHtml = `<span class="join-status member">✓ حليته: ${score} من ${total}</span>`;
    actionHtml = `<button class="btn btn-outline btn-block card-action" data-action="result">شوف نتيجتك</button>`;
  } else if (status === "notStarted") {
    statusHtml = `<span class="join-status pending">⏳ يبدأ في ${from.toLocaleString("ar-EG")}</span>`;
    actionHtml = `<button class="btn btn-outline btn-block" disabled>لسه ما بدأش</button>`;
  } else if (status === "closed") {
    statusHtml = `<span class="join-status pending">⛔ اتقفل في ${to.toLocaleString("ar-EG")}</span>`;
    actionHtml = `<button class="btn btn-outline btn-block" disabled>الوقت خلص</button>`;
  } else {
    statusHtml = `<span class="join-status available">🟢 متاح دلوقتي</span>`;
    if (to) {
      statusHtml += `<span class="deadline-hint">آخر موعد: ${to.toLocaleString("ar-EG")}</span>`;
    }
    actionHtml = `<button class="btn btn-primary btn-block card-action" data-action="start">🚀 ابدأ الحل</button>`;
  }

  card.innerHTML = `
    <h3>${escapeHtml(exam.title || "بدون عنوان")}</h3>
    ${timeInfo.length ? `<p class="card-meta">${timeInfo.join(" · ")}</p>` : ""}
    ${statusHtml}
    <div style="margin-top: 12px;">${actionHtml}</div>
  `;

  const actionBtn = card.querySelector(".card-action");
  if (actionBtn) {
    actionBtn.addEventListener("click", () => {
      const action = actionBtn.dataset.action;
      if (action === "start") {
        window.location.href = `student-exam.html?examId=${exam.id}`;
      } else if (action === "result") {
        window.location.href = `results.html?examId=${exam.id}`;
      }
    });
  }

  return card;
}
// ============================================
// المواد التعليمية
// ============================================

const MATERIAL_ICONS = { pdf: "📄", doc: "📝", video: "🎥", link: "🔗" };

async function loadMaterials() {
  try {
    const snap = await getDocs(query(
      collection(db, "materials"),
      where("groupIds", "array-contains", groupId)
    ));

    const materials = [];
    snap.forEach((m) => materials.push({ id: m.id, ...m.data() }));
    materials.sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );

    materialsTabCount.textContent = materials.length;

    if (materials.length === 0) {
      materialsList.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-icon">📚</div>
          <h3>مفيش مواد متاحة</h3>
          <p>ارجع بعدين لما مدرسك يضيف ملازم أو ملفات.</p>
        </div>
      `;
      return;
    }

    materialsList.innerHTML = "";
    materials.forEach((material) => {
      const card = document.createElement("div");
      card.className = "entity-card";
      card.innerHTML = `
        <div class="entity-card-icon">${MATERIAL_ICONS[material.fileType] || "📄"}</div>
        <h3>${escapeHtml(material.title)}</h3>
        ${material.description ? `<p class="card-meta">${escapeHtml(material.description)}</p>` : ""}
        <a href="${escapeHtml(material.fileUrl)}" target="_blank" rel="noopener noreferrer"
           class="btn btn-primary btn-block" style="margin-top: 12px;">فتح / تحميل ↗</a>
      `;
      materialsList.appendChild(card);
    });

  } catch (error) {
    console.error("Load materials error:", error);
    materialsList.innerHTML = `<p class="message error">تعذر تحميل المواد</p>`;
  }
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