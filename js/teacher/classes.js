// ============================================
// Classes Logic - إدارة السنوات والمجموعات
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, collection, addDoc, deleteDoc, query, where, getDocs }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// ------- عناصر الصفحة -------
const logoutBtn = document.getElementById("logoutBtn");
const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

const gradesView = document.getElementById("gradesView");
const groupsView = document.getElementById("groupsView");
const gradesList = document.getElementById("gradesList");
const groupsList = document.getElementById("groupsList");
const currentGradeName = document.getElementById("currentGradeName");

const addGradeBtn = document.getElementById("addGradeBtn");
const addGroupBtn = document.getElementById("addGroupBtn");

const breadcrumb = document.getElementById("breadcrumb");
const crumbGrades = document.getElementById("crumbGrades");

// عناصر الشاشة المنبثقة
const addModal = document.getElementById("addModal");
const addForm = document.getElementById("addForm");
const addInput = document.getElementById("addInput");
const addModalTitle = document.getElementById("addModalTitle");
const addSaveBtn = document.getElementById("addSaveBtn");
const addCancelBtn = document.getElementById("addCancelBtn");
const addError = document.getElementById("addError");

// ------- متغيرات الحالة -------
let currentTeacherId = null;
let selectedGradeId = null;
let selectedGradeName = null;
let modalMode = null; // "grade" أو "group"

// ------- القائمة الجانبية (موبايل) -------
if (menuToggle) menuToggle.addEventListener("click", () => {
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("show");
});
if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", () => {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("show");
});

// ------- حماية الصفحة -------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../index.html";
    return;
  }

  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!userDoc.exists() || userDoc.data().role !== "teacher") {
    window.location.href = "../index.html";
    return;
  }

  currentTeacherId = user.uid;
  await loadGrades();
});

// ============================================
// المستوى 1: السنوات الدراسية
// ============================================

async function loadGrades() {
  gradesList.innerHTML = `<p class="loading-text">جاري التحميل...</p>`;

  try {
    const gradesQuery = query(
      collection(db, "grades"),
      where("teacherId", "==", currentTeacherId)
    );
    const snapshot = await getDocs(gradesQuery);

    if (snapshot.empty) {
      gradesList.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-icon">📚</div>
          <h3>لسه مفيش سنوات دراسية</h3>
          <p>ابدأ بإضافة أول سنة دراسية (زي: أولى ثانوي).</p>
        </div>
      `;
      return;
    }

    gradesList.innerHTML = "";
    snapshot.forEach((gradeDoc) => {
      const grade = gradeDoc.data();
      const card = document.createElement("div");
      card.className = "entity-card";
      card.innerHTML = `
        <div class="entity-card-icon">📚</div>
        <h3>${grade.gradeName}</h3>
        <p>اضغط لعرض المجموعات</p>
        <button class="entity-delete" title="حذف">🗑️</button>
      `;

      // فتح المجموعات عند الضغط على الكارت
      card.addEventListener("click", () => {
        openGroups(gradeDoc.id, grade.gradeName);
      });

      // حذف السنة (مع منع فتح المجموعات)
      card.querySelector(".entity-delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm(`متأكد إنك عايز تمسح "${grade.gradeName}"؟`)) {
          await deleteDoc(doc(db, "grades", gradeDoc.id));
          await loadGrades();
        }
      });

      gradesList.appendChild(card);
    });

  } catch (error) {
    console.error("Load grades error:", error);
    gradesList.innerHTML = `<p class="message error">تعذر تحميل السنوات، حاول تحديث الصفحة</p>`;
  }
}

// ============================================
// المستوى 2: المجموعات
// ============================================

async function openGroups(gradeId, gradeName) {
  selectedGradeId = gradeId;
  selectedGradeName = gradeName;

  // إظهار شاشة المجموعات وإخفاء السنوات
  gradesView.classList.add("hidden");
  groupsView.classList.remove("hidden");
  currentGradeName.textContent = `مجموعات ${gradeName}`;

  // تحديث شريط التنقل
  breadcrumb.innerHTML = `
    <span class="breadcrumb-item" id="crumbBack">السنوات الدراسية</span>
    <span class="breadcrumb-separator">›</span>
    <span class="breadcrumb-item active">${gradeName}</span>
  `;
  document.getElementById("crumbBack").addEventListener("click", backToGrades);

  await loadGroups();
}

function backToGrades() {
  groupsView.classList.add("hidden");
  gradesView.classList.remove("hidden");
  breadcrumb.innerHTML = `<span class="breadcrumb-item active">السنوات الدراسية</span>`;
}

async function loadGroups() {
  groupsList.innerHTML = `<p class="loading-text">جاري التحميل...</p>`;

  try {
    const groupsQuery = query(
      collection(db, "groups"),
      where("teacherId", "==", currentTeacherId),
      where("gradeId", "==", selectedGradeId)
    );
    const snapshot = await getDocs(groupsQuery);

    if (snapshot.empty) {
      groupsList.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-icon">👥</div>
          <h3>لسه مفيش مجموعات</h3>
          <p>ابدأ بإضافة أول مجموعة (زي: مجموعة الاتنين والخميس).</p>
        </div>
      `;
      return;
    }

    groupsList.innerHTML = "";
    snapshot.forEach((groupDoc) => {
      const group = groupDoc.data();
      const studentsCount = (group.studentIds || []).length;
      const pendingCount = (group.pendingRequests || []).length;

      const card = document.createElement("div");
      card.className = "entity-card";
      card.innerHTML = `
        ${pendingCount > 0 ? `<span class="pending-badge">${pendingCount}</span>` : ""}
        <div class="entity-card-icon">👥</div>
        <h3>${group.groupName}</h3>
        <p>${studentsCount} طالب${pendingCount > 0 ? ` · ${pendingCount} طلب انتظار` : ""}</p>
        <button class="entity-delete" title="حذف">🗑️</button>
      `;

      // (لاحقًا) فتح تفاصيل المجموعة والطلاب
      card.addEventListener("click", () => {
        alert("صفحة تفاصيل المجموعة والطلاب هنعملها في الخطوة الجاية 👍");
      });

      card.querySelector(".entity-delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm(`متأكد إنك عايز تمسح "${group.groupName}"؟`)) {
          await deleteDoc(doc(db, "groups", groupDoc.id));
          await loadGroups();
        }
      });

      groupsList.appendChild(card);
    });

  } catch (error) {
    console.error("Load groups error:", error);
    groupsList.innerHTML = `<p class="message error">تعذر تحميل المجموعات، حاول تحديث الصفحة</p>`;
  }
}

// ============================================
// الشاشة المنبثقة (إضافة سنة / مجموعة)
// ============================================

function openModal(mode) {
  modalMode = mode;
  addError.textContent = "";
  addInput.value = "";
  addModalTitle.textContent = mode === "grade" ? "إضافة سنة دراسية" : "إضافة مجموعة";
  addInput.placeholder = mode === "grade" ? "مثال: أولى ثانوي" : "مثال: مجموعة الاتنين والخميس";
  addModal.classList.remove("hidden");
  addInput.focus();
}

function closeModal() {
  addModal.classList.add("hidden");
}

addGradeBtn.addEventListener("click", () => openModal("grade"));
addGroupBtn.addEventListener("click", () => openModal("group"));
addCancelBtn.addEventListener("click", closeModal);

// الحفظ
addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  addError.textContent = "";

  const name = addInput.value.trim();
  if (name.length < 2) {
    addError.textContent = "الاسم قصير جدًا";
    return;
  }

  addSaveBtn.disabled = true;
  addSaveBtn.textContent = "جاري الحفظ...";

  try {
    if (modalMode === "grade") {
      await addDoc(collection(db, "grades"), {
        teacherId: currentTeacherId,
        gradeName: name,
        createdAt: new Date().toISOString()
      });
      closeModal();
      await loadGrades();
    } else {
      await addDoc(collection(db, "groups"), {
        teacherId: currentTeacherId,
        gradeId: selectedGradeId,
        groupName: name,
        studentIds: [],
        pendingRequests: [],
        createdAt: new Date().toISOString()
      });
      closeModal();
      await loadGroups();
    }
  } catch (error) {
    console.error("Add error:", error);
    addError.textContent = "حدث خطأ، حاول مرة أخرى";
  } finally {
    addSaveBtn.disabled = false;
    addSaveBtn.textContent = "حفظ";
  }
});

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