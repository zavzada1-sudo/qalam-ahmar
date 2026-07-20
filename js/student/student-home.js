// ============================================
// Student Home Logic - الصفحة الرئيسية للطالب
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { renderSkeleton, renderErrorState } from "../shared/states.js";

import "../shared/theme.js";

// ------- عناصر الصفحة -------
const logoutBtn = document.getElementById("logoutBtn");
const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

const welcomeName = document.getElementById("welcomeName");
const groupsList = document.getElementById("groupsList");

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
    welcomeName.textContent = userDoc.data().fullName || "بك";
    await loadMyGroups();
  } catch (error) {
    console.error("Student home load error:", error);
    groupsList.innerHTML = `<p class="message error">تعذر تحميل البيانات، حدّث الصفحة</p>`;
  }
});

// ------- تحميل المجموعات (منضم + بانتظار الموافقة) -------
async function loadMyGroups() {
  groupsList.innerHTML = `<p class="loading-text">جاري التحميل...</p>`;
  try {
    // مجموعات هو عضو فيها
    const memberSnap = await getDocs(query(
      collection(db, "groups"),
      where("studentIds", "array-contains", currentStudentId)
    ));
    // مجموعات لسه بانتظار موافقة المدرس
    const pendingSnap = await getDocs(query(
      collection(db, "groups"),
      where("pendingRequests", "array-contains", currentStudentId)
    ));

    const groups = [];
    memberSnap.forEach((g) => groups.push({ id: g.id, status: "member", ...g.data() }));
    pendingSnap.forEach((g) => groups.push({ id: g.id, status: "pending", ...g.data() }));

    if (groups.length === 0) {
      groupsList.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-icon">🎒</div>
          <h3>لسه مش منضم لأي مدرس</h3>
          <p>اضغط على "الانضمام لمدرس" عشان تبدأ.</p>
          <a href="student-join.html" class="btn btn-primary">＋ الانضمام لمدرس</a>
        </div>
      `;
      return;
    }

    // نجيب أسماء المدرسين والسنوات مرة واحدة
    await ensureNamesLoaded(groups);

    groupsList.innerHTML = "";
    groups.forEach((group) => {
      const teacherName = teacherCache.get(group.teacherId) || "المدرس";
      const gradeName = gradeCache.get(group.gradeId) || "";
      const statusHtml = group.status === "member"
        ? `<span class="join-status member">✓ منضم</span>`
        : `<span class="join-status pending">⏳ بانتظار الموافقة</span>`;

      const card = document.createElement("div");
      card.className = "entity-card";
      card.style.cursor = group.status === "member" ? "pointer" : "default";
      card.innerHTML = `
        <div class="entity-card-icon">👥</div>
        <h3>${escapeHtml(group.groupName)}</h3>
        <p>مع ${escapeHtml(teacherName)}${gradeName ? " · " + escapeHtml(gradeName) : ""}</p>
        ${statusHtml}
      `;

      // بس المنضمين يقدروا يفتحوا الصفحة
      if (group.status === "member") {
        card.addEventListener("click", () => {
          window.location.href = `student-group.html?groupId=${group.id}`;
        });
      }

      groupsList.appendChild(card);
    });

  } catch (error) {
    console.error("Load my groups error:", error);
    groupsList.innerHTML = `<p class="message error">تعذر تحميل المواد، حدّث الصفحة</p>`;
  }
}

// ------- جلب أسماء المدرسين والسنوات (مع كاش) -------
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