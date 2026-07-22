// ============================================
// Student Profile Logic - صفحة حسابي للطالب
// ============================================
// نفس منطق عرض رقم الطالب/ولي الأمر الموجود في teacher-profile.js
// بالظبط (نفس أسماء الحقول ونفس طريقة بناء لينكات الاتصال/واتساب).
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { showToast } from "../shared/ui.js";

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

const profileAvatar = document.getElementById("profileAvatar");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profileCode = document.getElementById("profileCode");
const copyCodeBtn = document.getElementById("copyCodeBtn");

const phoneItem = document.getElementById("phoneItem");
const profilePhone = document.getElementById("profilePhone");

const parentCallItem = document.getElementById("parentCallItem");
const profileParentCall = document.getElementById("profileParentCall");

const parentWhatsappItem = document.getElementById("parentWhatsappItem");
const profileParentWhatsapp = document.getElementById("profileParentWhatsapp");

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

    fillProfileInfo(userDoc.data());
    await loadMyGroups();

    loadingState.classList.add("hidden");
    contentWrapper.classList.remove("hidden");

  } catch (error) {
    console.error("Student profile load error:", error);
    showError("تعذر تحميل بياناتك، حدّث الصفحة");
  }
});

// ------- عرض البيانات الأساسية -------
function fillProfileInfo(data) {
  const name = data.fullName || "طالب";
  profileName.textContent = name;
  profileAvatar.textContent = name.charAt(0);
  profileEmail.textContent = data.email || "—";
  profileCode.textContent = data.studentId || "—";

  // رقم الطالب نفسه (لو موجود)
  if (data.phone) {
    profilePhone.href = `tel:${data.phone}`;
    profilePhone.textContent = data.phone;
    phoneItem.classList.remove("hidden");
  }

  // رقم ولي الأمر - مكالمات
  if (data.parentPhoneCall) {
    profileParentCall.href = `tel:${data.parentPhoneCall}`;
    profileParentCall.textContent = data.parentPhoneCall;
    parentCallItem.classList.remove("hidden");
  }

  // رقم ولي الأمر - واتساب
  // (نفس منطق teacher-profile.js: لو مفيش رقم واتساب منفصل، نستخدم رقم المكالمات)
  const waSource = data.parentPhoneWhatsapp || data.parentPhoneCall;
  if (waSource) {
    const waNumber = waSource.replace(/\D/g, "");
    profileParentWhatsapp.href = `https://wa.me/${waNumber}`;
    profileParentWhatsapp.textContent = data.parentPhoneWhatsapp || data.parentPhoneCall;
    parentWhatsappItem.classList.remove("hidden");
  }
}

// ------- نسخ كود الطالب -------
copyCodeBtn.addEventListener("click", async () => {
  const code = profileCode.textContent.trim();
  if (!code || code === "—") return;
  try {
    await navigator.clipboard.writeText(code);
    const original = copyCodeBtn.textContent;
    copyCodeBtn.textContent = "تم النسخ ✓";
    setTimeout(() => (copyCodeBtn.textContent = original), 1500);
  } catch (error) {
    console.error("Copy error:", error);
    showToast("مقدرناش ننسخ تلقائيًا، انسخ الكود يدويًا", "error");
  }
});

// ------- تحميل مجموعات الطالب (المنضم ليها فعليًا بس) -------
async function loadMyGroups() {
  try {
    const memberSnap = await getDocs(query(
      collection(db, "groups"),
      where("studentIds", "array-contains", currentStudentId)
    ));

    const groups = [];
    memberSnap.forEach((g) => groups.push({ id: g.id, ...g.data() }));

    if (groups.length === 0) {
      groupsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎒</div>
          <h3>لسه مش منضم لأي مدرس</h3>
          <p>اضغط على "الانضمام لمدرس" من القائمة الجانبية عشان تبدأ.</p>
        </div>
      `;
      return;
    }

    await ensureNamesLoaded(groups);

    groupsList.innerHTML = groups.map((group) => {
      const teacherName = teacherCache.get(group.teacherId) || "المدرس";
      const gradeName = gradeCache.get(group.gradeId) || "";
      return `
        <div class="sp-group-row">
          <span class="sp-group-name">${escapeHtml(group.groupName)}</span>
          <span class="sp-group-meta">مع ${escapeHtml(teacherName)}${gradeName ? " · " + escapeHtml(gradeName) : ""}</span>
        </div>
      `;
    }).join("");

  } catch (error) {
    console.error("Load my groups error:", error);
    groupsList.innerHTML = `<p class="message error">تعذر تحميل المجموعات، حدّث الصفحة</p>`;
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

// ------- حالة الخطأ -------
function showError(message) {
  loadingState.classList.add("hidden");
  contentWrapper.classList.add("hidden");
  errorState.classList.remove("hidden");
  errorText.textContent = message;
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