// ============================================
// Student Join Logic - انضمام الطالب لمدرس
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, query, where, getDocs, arrayUnion }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { showToast, showConfirm } from "../shared/ui.js";
import { renderSkeleton, renderErrorState } from "../shared/states.js";

import "../shared/theme.js";
import "../shared/offline-banner.js";

// ------- عناصر الصفحة -------
const logoutBtn = document.getElementById("logoutBtn");
const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

const findTeacherView = document.getElementById("findTeacherView");
const gradesView = document.getElementById("gradesView");
const groupsView = document.getElementById("groupsView");

const findTeacherForm = document.getElementById("findTeacherForm");
const teacherCodeInput = document.getElementById("teacherCodeInput");
const findBtn = document.getElementById("findBtn");
const findError = document.getElementById("findError");

const welcomeBanner = document.getElementById("welcomeBanner");
const gradesList = document.getElementById("gradesList");
const groupsList = document.getElementById("groupsList");
const currentGradeName = document.getElementById("currentGradeName");
const breadcrumb = document.getElementById("breadcrumb");

// ------- متغيرات الحالة -------
let currentStudentId = null;
let foundTeacherId = null;
let foundTeacherName = null;
let selectedGradeId = null;

// ------- القائمة الجانبية (موبايل) -------
if (menuToggle) menuToggle.addEventListener("click", () => {
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("show");
});
if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", () => {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("show");
});

// ------- حماية الصفحة: لازم طالب مسجل دخول -------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../index.html";
    return;
  }

  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!userDoc.exists() || userDoc.data().role !== "student") {
    window.location.href = "../index.html";
    return;
  }

  currentStudentId = user.uid;
});

// ============================================
// المرحلة 1: البحث عن المدرس بالـ ID
// ============================================

findTeacherForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  findError.textContent = "";

  const code = teacherCodeInput.value.trim();
  if (!code) return;

  findBtn.disabled = true;
  findBtn.textContent = "جاري البحث...";

  try {
    // ندور على مدرس عنده teacherCode ده
    const teacherQuery = query(
      collection(db, "users"),
      where("teacherCode", "==", code),
      where("role", "==", "teacher")
    );
    const snapshot = await getDocs(teacherQuery);

    if (snapshot.empty) {
      findError.textContent = "مفيش مدرس بالـ ID ده، اتأكد من الرقم";
      return;
    }

    // لقينا المدرس
    const teacherDoc = snapshot.docs[0];
    foundTeacherId = teacherDoc.id;
    foundTeacherName = teacherDoc.data().fullName || "المدرس";

    // ننتقل لعرض السنوات
    showGradesView();

  } catch (error) {
    console.error("Find teacher error:", error);
    findError.textContent = "حدث خطأ، حاول مرة أخرى";
  } finally {
    findBtn.disabled = false;
    findBtn.textContent = "بحث";
  }
});

// ============================================
// المرحلة 2: عرض سنوات المدرس
// ============================================

async function showGradesView() {
  findTeacherView.classList.add("hidden");
  gradesView.classList.remove("hidden");
  groupsView.classList.add("hidden");

  welcomeBanner.textContent = `👋 أهلاً بك مع ${foundTeacherName}`;
  breadcrumb.innerHTML = `<span class="breadcrumb-item active">السنوات الدراسية</span>`;

  gradesList.innerHTML = `<p class="loading-text">جاري التحميل...</p>`;

  try {
    const gradesQuery = query(
      collection(db, "grades"),
      where("teacherId", "==", foundTeacherId)
    );
    const snapshot = await getDocs(gradesQuery);

    if (snapshot.empty) {
      gradesList.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-icon">📚</div>
          <h3>المدرس لسه معملش سنوات دراسية</h3>
          <p>ارجع بعدين لما المدرس يجهز مجموعاته.</p>
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
      `;
      card.addEventListener("click", () => showGroupsView(gradeDoc.id, grade.gradeName));
      gradesList.appendChild(card);
    });

  } catch (error) {
    console.error("Load grades error:", error);
    gradesList.innerHTML = `<p class="message error">تعذر تحميل السنوات</p>`;
  }
}

// ============================================
// المرحلة 3: عرض المجموعات + طلب الانضمام
// ============================================

async function showGroupsView(gradeId, gradeName) {
  selectedGradeId = gradeId;

  gradesView.classList.add("hidden");
  groupsView.classList.remove("hidden");
  currentGradeName.textContent = `مجموعات ${gradeName}`;

  breadcrumb.innerHTML = `
    <span class="breadcrumb-item" id="crumbBack">السنوات الدراسية</span>
    <span class="breadcrumb-separator">›</span>
    <span class="breadcrumb-item active">${gradeName}</span>
  `;
  document.getElementById("crumbBack").addEventListener("click", () => showGradesView());

  groupsList.innerHTML = `<p class="loading-text">جاري التحميل...</p>`;

  try {
    const groupsQuery = query(
      collection(db, "groups"),
      where("teacherId", "==", foundTeacherId),
      where("gradeId", "==", gradeId)
    );
    const snapshot = await getDocs(groupsQuery);

    if (snapshot.empty) {
      groupsList.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-icon">👥</div>
          <h3>مفيش مجموعات في السنة دي</h3>
        </div>
      `;
      return;
    }

    groupsList.innerHTML = "";
    snapshot.forEach((groupDoc) => {
      const group = groupDoc.data();
      const groupId = groupDoc.id;
      const isMember = (group.studentIds || []).includes(currentStudentId);
      const isPending = (group.pendingRequests || []).includes(currentStudentId);

      // نحدد حالة الطالب في المجموعة دي
      let statusHtml = "";
      if (isMember) {
        statusHtml = `<span class="join-status member">✓ منضم</span>`;
      } else if (isPending) {
        statusHtml = `<span class="join-status pending">⏳ بانتظار الموافقة</span>`;
      } else {
        statusHtml = `<span class="join-status available">اضغط للانضمام</span>`;
      }

      const card = document.createElement("div");
      card.className = "entity-card";
      card.innerHTML = `
        <div class="entity-card-icon">👥</div>
        <h3>${group.groupName}</h3>
        ${statusHtml}
      `;

      // التعامل مع الضغط حسب الحالة
      card.addEventListener("click", async () => {
        if (isMember) {
          showToast("إنت منضم للمجموعة دي بالفعل ✅ (صفحة المجموعة هنعملها قريب)", "info");
        } else if (isPending) {
          showToast("طلبك لسه بانتظار موافقة المدرس ⏳", "info");
        } else {
          await requestJoin(groupId, group.groupName);
        }
      });

      groupsList.appendChild(card);
    });

  } catch (error) {
    console.error("Load groups error:", error);
    groupsList.innerHTML = `<p class="message error">تعذر تحميل المجموعات</p>`;
  }
}

// ------- طلب الانضمام لمجموعة -------
async function requestJoin(groupId, groupName) {
  const confirmed = await showConfirm({
    title: "طلب الانضمام",
    message: `عايز تطلب الانضمام لـ "${groupName}"؟`,
    confirmLabel: "إرسال الطلب",
  });
  if (!confirmed) return;

  try {
    await updateDoc(doc(db, "groups", groupId), {
      pendingRequests: arrayUnion(currentStudentId)
    });
    showToast("تم إرسال طلب الانضمام ✅ استنى موافقة المدرس", "success");
    // نعيد تحميل المجموعات عشان تتحدث الحالة
    showGroupsView(selectedGradeId, currentGradeName.textContent.replace("مجموعات ", ""));
  } catch (error) {
    console.error("Join request error:", error);
    showToast("حدث خطأ، حاول مرة أخرى", "error");
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