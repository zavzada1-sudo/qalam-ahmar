// ============================================
// Teacher Profile Logic - الملف الشخصي للمدرس
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut, sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { showToast, showConfirm } from "../shared/ui.js";
import { renderSkeleton, renderErrorState } from "../shared/states.js";

import "../shared/theme.js";

// ------- عناصر الصفحة -------
const logoutBtn = document.getElementById("logoutBtn");
const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

const profileAvatar = document.getElementById("profileAvatar");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profileCode = document.getElementById("profileCode");
const profileSubscription = document.getElementById("profileSubscription");
const copyCodeBtn = document.getElementById("copyCodeBtn");

const studentSearch = document.getElementById("studentSearch");
const studentsList = document.getElementById("studentsList");
const studentsCount = document.getElementById("studentsCount");
const studentsMessage = document.getElementById("studentsMessage");

// ------- متغيرات الحالة -------
let currentTeacherId = null;
let allStudents = [];          // كل طلاب المدرس [{uid, fullName, studentId, email}]
let studentSearchTerm = "";

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
    currentTeacherId = user.uid;
    fillTeacherInfo(userDoc.data());
    await loadStudents();
  } catch (error) {
    console.error("Profile load error:", error);
    showStudentsMessage("تعذر تحميل البيانات، حدّث الصفحة", "error");
  }
});

// ------- عرض بيانات المدرس -------
function fillTeacherInfo(data) {
  const name = data.fullName || "مدرس";
  profileName.textContent = name;
  profileAvatar.textContent = name.charAt(0);
  profileEmail.textContent = data.email || "—";
  profileCode.textContent = data.teacherCode || "لسه ما اخترتش ID";

  const days = getRemainingDays(data.subscriptionEndDate);
  if (days === null) profileSubscription.textContent = "غير محدد";
  else if (days <= 0) profileSubscription.textContent = "منتهي ⛔";
  else profileSubscription.textContent = `${days} يوم`;
}

// ------- حساب الأيام المتبقية (بيتعامل مع أي صيغة تاريخ) -------
function getRemainingDays(subscriptionEndDate) {
  if (!subscriptionEndDate) return null;
  let end;
  if (typeof subscriptionEndDate === "string" || typeof subscriptionEndDate === "number") {
    end = new Date(subscriptionEndDate);
  } else if (typeof subscriptionEndDate.toDate === "function") {
    end = subscriptionEndDate.toDate();               // Firestore Timestamp
  } else if (subscriptionEndDate.seconds) {
    end = new Date(subscriptionEndDate.seconds * 1000);
  } else {
    return null;
  }
  if (isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// ------- نسخ الـ ID -------
copyCodeBtn.addEventListener("click", async () => {
  const code = profileCode.textContent.trim();
  if (!code || code === "—" || code.includes("لسه")) return;
  try {
    await navigator.clipboard.writeText(code);
    const original = copyCodeBtn.textContent;
    copyCodeBtn.textContent = "تم النسخ ✓";
    setTimeout(() => (copyCodeBtn.textContent = original), 1500);
  } catch (error) {
    console.error("Copy error:", error);
    showToast("مقدرناش ننسخ تلقائيًا، انسخ الـ ID يدويًا", "error");
  }
});

// ============================================
// تحميل وعرض الطلاب
// ============================================

async function loadStudents() {
  studentsList.innerHTML = `<p class="loading-text">جاري التحميل...</p>`;
  try {
    // 1) نجيب كل مجموعات المدرس
    const groupsSnap = await getDocs(query(
      collection(db, "groups"),
      where("teacherId", "==", currentTeacherId)
    ));

    // 2) نجمّع كل الـ studentIds من غير تكرار
    const idSet = new Set();
    groupsSnap.forEach((g) => (g.data().studentIds || []).forEach((id) => idSet.add(id)));
    const ids = [...idSet];

    if (ids.length === 0) {
      allStudents = [];
      renderStudents();
      return;
    }

    // 3) نجيب بيانات كل طالب
    const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, "users", id))));
    allStudents = snaps
      .filter((s) => s.exists())
      .map((s) => {
        const d = s.data();
        return {
          uid: s.id,
          fullName: d.fullName || "طالب بدون اسم",
          studentId: d.studentId || "—",
          email: d.email || "",
          phone: d.phone || "",
          parentPhoneCall: d.parentPhoneCall || "",
          parentPhoneWhatsapp: d.parentPhoneWhatsapp || ""
        };
      });

    // ترتيب أبجدي بالاسم
    allStudents.sort((a, b) => a.fullName.localeCompare(b.fullName, "ar"));
    renderStudents();

  } catch (error) {
    console.error("Load students error:", error);
    studentsList.innerHTML = `<p class="message error">تعذر تحميل الطلاب، حدّث الصفحة</p>`;
  }
}

function renderStudents() {
  studentsCount.textContent = allStudents.length;

  if (allStudents.length === 0) {
    studentsList.innerHTML = `<p class="gd-empty">لسه مفيش طلاب منضمّين لمجموعاتك</p>`;
    return;
  }

  const term = studentSearchTerm.toLowerCase();
  const visible = allStudents.filter((s) =>
    !term ||
    s.fullName.toLowerCase().includes(term) ||
    String(s.studentId).toLowerCase().includes(term) ||
    s.email.toLowerCase().includes(term)
  );

  if (visible.length === 0) {
    studentsList.innerHTML = `<p class="gd-empty">مفيش نتيجة للبحث</p>`;
    return;
  }

  studentsList.innerHTML = "";
  visible.forEach((s) => {
    const row = document.createElement("div");
    row.className = "gd-row";
    // سطر رقم الطالب نفسه (لو موجود)
    let studentLine = "";
    if (s.phone) {
      studentLine = `
        <span class="gd-row-parent">
          📞 الطالب:
          <a href="tel:${escapeHtml(s.phone)}">${escapeHtml(s.phone)}</a>
        </span>
      `;
    }

    // سطر رقم ولي الأمر (لو موجود)، مع لينكات مباشرة للاتصال والواتساب
    let parentLine = "";
    if (s.parentPhoneCall) {
      const waNumber = (s.parentPhoneWhatsapp || s.parentPhoneCall).replace(/\D/g, "");
      parentLine = `
        <span class="gd-row-parent">
          👤 ولي الأمر:
          <a href="tel:${escapeHtml(s.parentPhoneCall)}">${escapeHtml(s.parentPhoneCall)}</a>
          <a href="https://wa.me/${escapeHtml(waNumber)}" target="_blank" rel="noopener">📱 واتساب</a>
        </span>
      `;
    }

    row.innerHTML = `
      <div class="gd-row-info">
        <span class="gd-row-name">${escapeHtml(s.fullName)}</span>
        <span class="gd-row-code">${escapeHtml(s.studentId)}${s.email ? " · " + escapeHtml(s.email) : ""}</span>
        ${studentLine}
        ${parentLine}
      </div>
      <div class="gd-row-actions">
        <button class="gd-btn gd-btn-primary">إعادة تعيين الباسورد</button>
      </div>
    `;
    const btn = row.querySelector("button");
    btn.addEventListener("click", () => resetStudentPassword(s.email, s.fullName, btn));
    studentsList.appendChild(row);
  });
}

// ------- البحث -------
studentSearch.addEventListener("input", (e) => {
  studentSearchTerm = e.target.value.trim();
  renderStudents();
});

// ------- إعادة تعيين باسورد الطالب (رابط على إيميله) -------
async function resetStudentPassword(email, name, btn) {
  if (!email) {
    showStudentsMessage(`الطالب "${name}" مالوش إيميل مسجّل`, "error");
    return;
  }

  const confirmed = await showConfirm({
    title: "إعادة تعيين كلمة المرور",
    message: `هيتبعت رابط إعادة تعيين كلمة المرور على إيميل "${name}". تمام؟`,
    confirmLabel: "إرسال",
  });
  if (!confirmed) return;

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "جاري الإرسال...";

  try {
    await sendPasswordResetEmail(auth, email);
    showStudentsMessage(`تم إرسال رابط إعادة التعيين لإيميل "${name}" ✅`, "success");
  } catch (error) {
    console.error("Reset password error:", error);
    let msg = "حصل خطأ، حاول تاني";
    if (error.code === "auth/user-not-found") msg = "مفيش حساب بالإيميل ده";
    else if (error.code === "auth/invalid-email") msg = "الإيميل غير صحيح";
    else if (error.code === "auth/too-many-requests") msg = "طلبات كتير، استنى شوية وحاول تاني";
    showStudentsMessage(msg, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ------- رسائل الحالة -------
function showStudentsMessage(text, type = "") {
  studentsMessage.textContent = text || "";
  studentsMessage.className = "gd-message" + (type ? " " + type : "");
  studentsMessage.style.display = text ? "block" : "none";
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