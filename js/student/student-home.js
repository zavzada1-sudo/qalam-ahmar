// ============================================
// Student Home Logic - الصفحة الرئيسية للطالب
// ============================================
// 🆕 استخدام onSnapshot بدل getDocs: تحديث لحظي (لو المدرس وافق على
// طلب انضمام مثلاً، القائمة بتتحدث تلقائي من غير ما الطالب يعمل Refresh)
// + استفادة من الكاش المحلي المفعّل في firebase-config.js.
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, onSnapshot }
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

// آخر نتيجة معروفة من كل Listener (بيتحدثوا مستقلين عن بعض)
let memberGroups = [];
let pendingGroups = [];
let unsubscribeMember = null;
let unsubscribePending = null;

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
    listenToMyGroups();
  } catch (error) {
    console.error("Student home load error:", error);
    groupsList.innerHTML = `<p class="message error">تعذر تحميل البيانات، حدّث الصفحة</p>`;
  }
});

// ------- الاستماع اللحظي للمجموعات (منضم + بانتظار الموافقة) -------
function listenToMyGroups() {
  groupsList.innerHTML = `<p class="loading-text">جاري التحميل...</p>`;

  // مجموعات هو عضو فيها
  const memberQuery = query(
    collection(db, "groups"),
    where("studentIds", "array-contains", currentStudentId)
  );
  unsubscribeMember = onSnapshot(memberQuery, (snap) => {
    memberGroups = [];
    snap.forEach((g) => memberGroups.push({ id: g.id, status: "member", ...g.data() }));
    renderGroups();
  }, (error) => {
    console.error("Member groups listener error:", error);
    groupsList.innerHTML = `<p class="message error">تعذر تحميل المواد، حدّث الصفحة</p>`;
  });

  // مجموعات لسه بانتظار موافقة المدرس
  const pendingQuery = query(
    collection(db, "groups"),
    where("pendingRequests", "array-contains", currentStudentId)
  );
  unsubscribePending = onSnapshot(pendingQuery, (snap) => {
    pendingGroups = [];
    snap.forEach((g) => pendingGroups.push({ id: g.id, status: "pending", ...g.data() }));
    renderGroups();
  }, (error) => {
    console.error("Pending groups listener error:", error);
    // مش خطأ فادح — نسيب المنضم فيها يفضل ظاهر حتى لو دي فشلت
  });
}

// ------- عرض المجموعات (بيتنادى من الاتنين Listener) -------
async function renderGroups() {
  const groups = [...memberGroups, ...pendingGroups];

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

  try {
    await ensureNamesLoaded(groups);
  } catch (error) {
    console.error("Load names error:", error);
    // مش هنوقف العرض — الاسم هيبان "المدرس" الافتراضي بدل الاسم الحقيقي
  }

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
}

// ------- جلب أسماء المدرسين والسنوات (مع كاش، مرة واحدة لكل ID) -------
async function ensureNamesLoaded(groups) {
  const teacherIds = new Set();
  const gradeIds = new Set();
  groups.forEach((g) => {
    if (g.teacherId && !teacherCache.has(g.teacherId)) teacherIds.add(g.teacherId);
    if (g.gradeId && !gradeCache.has(g.gradeId)) gradeIds.add(g.gradeId);
  });

  if (teacherIds.size === 0 && gradeIds.size === 0) return; // كله متكشّف قبل كده

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

// ------- إلغاء الاستماع لما الطالب يسيب الصفحة (توفير موارد) -------
window.addEventListener("beforeunload", () => {
  if (unsubscribeMember) unsubscribeMember();
  if (unsubscribePending) unsubscribePending();
});

// ------- تسجيل الخروج -------
logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    if (unsubscribeMember) unsubscribeMember();
    if (unsubscribePending) unsubscribePending();
    await signOut(auth);
    window.location.href = "../index.html";
  } catch (error) {
    console.error("Logout error:", error);
    logoutBtn.disabled = false;
  }
});