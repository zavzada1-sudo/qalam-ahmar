// ============================================
// Teacher Profile Logic - الملف الشخصي للمدرس
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut, sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs, writeBatch }
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

// عناصر تحديد موعد الدفع (بند جديد)
const selectAllCheckbox = document.getElementById("selectAllCheckbox");
const selectedCount = document.getElementById("selectedCount");
const paymentActionsBar = document.getElementById("paymentActionsBar");
const setPaymentBtn = document.getElementById("setPaymentBtn");
const clearPaymentBtn = document.getElementById("clearPaymentBtn");

// عناصر التنقل بين الصفحات (Pagination) — 🆕
const paginationWrapper = document.getElementById("paginationWrapper");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageInfoEl = document.getElementById("pageInfo");

// ------- متغيرات الحالة -------
let currentTeacherId = null;
let allStudents = [];            // كل طلاب المدرس [{uid, fullName, studentId, email}]
let studentSearchTerm = "";
let paymentsByStudent = new Map(); // studentUid -> بيانات موعد الدفع
let selectedStudents = new Set();  // uids المحددين حاليًا (Checkbox)

const PAGE_SIZE = 30;   // 🆕 عدد الطلبة المعروضين في كل صفحة (Client-side Pagination)
let currentPage = 1;    // 🆕 رقم الصفحة الحالية

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

    // تحميل الطلاب ومواعيد الدفع بالتوازي، وبعدين نعرض الاتنين مع بعض
    const [studentsOk] = await Promise.all([loadStudents(), loadPayments()]);
    if (studentsOk) renderStudents();

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

// بيرجّع true/false حسب نجاح التحميل (عشان اللي بينادي الدالة يعرف
// هل يكمّل يعرض الطلاب ولا الشاشة فيها رسالة خطأ فعلاً)
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
      return true;
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
    return true;

  } catch (error) {
    console.error("Load students error:", error);
    studentsList.innerHTML = `<p class="message error">تعذر تحميل الطلاب، حدّث الصفحة</p>`;
    return false;
  }
}

// القايمة الظاهرة حاليًا بعد فلترة البحث (مستخدمة في أكتر من مكان)
// ⚠️ دي القايمة المفلترة بالكامل (كل الصفحات مع بعض) — مش بس صفحة العرض الحالية
// لازم تفضل كده عشان "تحديد الكل" والـ Batch Write يشتغلوا على كل النتائج المطابقة
function getVisibleStudents() {
  const term = studentSearchTerm.toLowerCase();
  return allStudents.filter((s) =>
    !term ||
    s.fullName.toLowerCase().includes(term) ||
    String(s.studentId).toLowerCase().includes(term) ||
    s.email.toLowerCase().includes(term)
  );
}

function renderStudents() {
  studentsCount.textContent = allStudents.length;

  if (allStudents.length === 0) {
    studentsList.innerHTML = `<p class="gd-empty">لسه مفيش طلاب منضمّين لمجموعاتك</p>`;
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    paginationWrapper.classList.add("hidden"); // 🆕
    return;
  }

  // القايمة المفلترة بالكامل (بتُستخدم في تحديد الكل والـ Batch Write)
  const visible = getVisibleStudents();

  if (visible.length === 0) {
    studentsList.innerHTML = `<p class="gd-empty">مفيش نتيجة للبحث</p>`;
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    paginationWrapper.classList.add("hidden"); // 🆕
    return;
  }

  // تحديث حالة "تحديد الكل" بناءً على *كل* القايمة المفلترة (مش بس الصفحة الحالية)
  const allVisibleSelected = visible.every((s) => selectedStudents.has(s.uid));
  const someVisibleSelected = visible.some((s) => selectedStudents.has(s.uid));
  selectAllCheckbox.checked = allVisibleSelected;
  selectAllCheckbox.indeterminate = !allVisibleSelected && someVisibleSelected;

  // ============================================
  // 🆕 Pagination: نقسّم *عرض الصفوف بس* لصفحات — منطق التحديد فوق فضل شغال على "visible" كاملة
  // ============================================
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageStudents = visible.slice(startIdx, startIdx + PAGE_SIZE);

  studentsList.innerHTML = "";
  pageStudents.forEach((s) => {
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

    // شارة موعد الدفع (لو محدد)
    const paymentBadge = paymentBadgeHtml(paymentsByStudent.get(s.uid));

    row.innerHTML = `
      <label class="pm-checkbox-wrap">
        <input type="checkbox" class="pm-student-checkbox" ${selectedStudents.has(s.uid) ? "checked" : ""}>
      </label>
      <div class="gd-row-info">
        <span class="gd-row-name">${escapeHtml(s.fullName)}</span>
        <span class="gd-row-code">${escapeHtml(s.studentId)}${s.email ? " · " + escapeHtml(s.email) : ""}</span>
        ${studentLine}
        ${parentLine}
        ${paymentBadge}
      </div>
      <div class="gd-row-actions">
        <button class="gd-btn gd-btn-primary">إعادة تعيين الباسورد</button>
      </div>
    `;

    const resetBtn = row.querySelector(".gd-row-actions button");
    resetBtn.addEventListener("click", () => resetStudentPassword(s.email, s.fullName, resetBtn));

    const checkbox = row.querySelector(".pm-student-checkbox");
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedStudents.add(s.uid);
      else selectedStudents.delete(s.uid);
      updateSelectionUI();

      // نحدّث حالة "تحديد الكل" من غير ما نعيد رسم القايمة كلها
      // (بناءً على كل القايمة المفلترة، مش بس الصفحة الحالية)
      const stillVisible = getVisibleStudents();
      const allSel = stillVisible.every((st) => selectedStudents.has(st.uid));
      const someSel = stillVisible.some((st) => selectedStudents.has(st.uid));
      selectAllCheckbox.checked = allSel;
      selectAllCheckbox.indeterminate = !allSel && someSel;
    });

    studentsList.appendChild(row);
  });

  renderPagination(visible.length, totalPages); // 🆕
}

// ============================================
// 🆕 عرض شريط التنقل بين الصفحات (Pagination)
// ============================================
function renderPagination(totalItems, totalPages) {
  if (totalPages <= 1) {
    paginationWrapper.classList.add("hidden");
    return;
  }

  paginationWrapper.classList.remove("hidden");
  pageInfoEl.textContent = `صفحة ${currentPage} من ${totalPages} (${totalItems} طالب)`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
}

prevPageBtn.addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage--;
  renderStudents();
  studentsList.scrollIntoView({ behavior: "smooth", block: "start" });
});

nextPageBtn.addEventListener("click", () => {
  currentPage++;
  renderStudents();
  studentsList.scrollIntoView({ behavior: "smooth", block: "start" });
});

// ------- البحث -------
studentSearch.addEventListener("input", (e) => {
  studentSearchTerm = e.target.value.trim();
  currentPage = 1; // 🆕 أي بحث جديد يرجعنا لأول صفحة
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

// ============================================
// نظام تحديد موعد الدفع (Payments) — بند جديد
// ============================================

// تحميل كل مواعيد الدفع اللي المدرس ده حدّدها (استعلام واحد بس)
async function loadPayments() {
  paymentsByStudent = new Map();
  try {
    const snap = await getDocs(query(
      collection(db, "payments"),
      where("teacherId", "==", currentTeacherId)
    ));
    snap.forEach((d) => {
      const data = d.data();
      paymentsByStudent.set(data.studentUid, data);
    });
  } catch (error) {
    console.error("Load payments error:", error);
    // مش خطأ فادح — الصفحة تكمل شغلها من غير شارات الدفع
  }
}

// شارة موعد الدفع جنب اسم الطالب (فاضية لو مفيش موعد محدد)
function paymentBadgeHtml(payment) {
  if (!payment || !payment.nextPaymentDate) return "";

  const days = daysUntil(payment.nextPaymentDate);
  if (days === null) return "";

  let text, cls;
  if (days < 0) { text = `متأخر ${Math.abs(days)} يوم`; cls = "overdue"; }
  else if (days === 0) { text = "الدفع اليوم"; cls = "overdue"; }
  else { text = `باقي ${days} يوم`; cls = ""; }

  return `
    <span class="pm-badge ${cls}">
      💰 ${text} (${formatShortDate(payment.nextPaymentDate)})
    </span>
  `;
}

// عدد الأيام المتبقية لتاريخ معيّن (سالب = متأخر، صفر = النهارده)
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
}

// تاريخ مختصر (يوم/شهر)
function formatShortDate(dateStr) {
  const parts = String(dateStr).split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

// ------- تحديث ظهور شريط الإجراءات وعدّاد المحدَّدين -------
function updateSelectionUI() {
  const count = selectedStudents.size;
  if (count > 0) {
    selectedCount.textContent = `${count} محدد`;
    selectedCount.classList.remove("hidden");
    paymentActionsBar.classList.remove("hidden");
  } else {
    selectedCount.classList.add("hidden");
    paymentActionsBar.classList.add("hidden");
  }
}

function clearSelection() {
  selectedStudents.clear();
  updateSelectionUI();
  renderStudents();
}

// ------- تحديد الكل (بالنسبة لكل القايمة المفلترة بالبحث — مش بس الصفحة الحالية) -------
selectAllCheckbox.addEventListener("change", () => {
  const visible = getVisibleStudents();
  if (selectAllCheckbox.checked) {
    visible.forEach((s) => selectedStudents.add(s.uid));
  } else {
    visible.forEach((s) => selectedStudents.delete(s.uid));
  }
  updateSelectionUI();
  renderStudents();
});

// ------- زرارات شريط الإجراءات -------
setPaymentBtn.addEventListener("click", openSetPaymentModal);
clearPaymentBtn.addEventListener("click", openClearPaymentModal);

// ------- مودال تحديد موعد الدفع -------
// مودال مخصص (مش من ui.js العام) لأنه محتاج حقول إدخال (تاريخ/مبلغ/ملاحظة)
// بخلاف showConfirm/showAlert اللي بتعرض نص بس. نفس روح تصميم ui.js.
function showPaymentFormModal({ title }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "pm-modal-overlay";

    // تاريخ افتراضي: بعد 30 يوم من النهارده (المدرس يقدر يغيّره بسهولة)
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 30);
    const defaultDateStr = defaultDate.toISOString().slice(0, 10);

    overlay.innerHTML = `
      <div class="pm-modal" role="dialog" aria-modal="true">
        <h3></h3>

        <div class="pm-form-group">
          <label for="pmDateInput">موعد الدفع القادم *</label>
          <input type="date" id="pmDateInput" value="${defaultDateStr}" required>
        </div>

        <div class="pm-form-group">
          <label for="pmAmountInput">المبلغ (اختياري)</label>
          <input type="number" id="pmAmountInput" placeholder="مثلاً 150" min="0">
        </div>

        <div class="pm-form-group">
          <label for="pmNoteInput">ملاحظة (اختياري)</label>
          <input type="text" id="pmNoteInput" placeholder="مثلاً: نص الشهر">
        </div>

        <div class="pm-modal-actions">
          <button type="button" class="btn btn-outline" id="pmCancelBtn">إلغاء</button>
          <button type="button" class="btn btn-primary" id="pmSaveBtn">حفظ</button>
        </div>
      </div>
    `;
    overlay.querySelector("h3").textContent = title;

    const dateInput = overlay.querySelector("#pmDateInput");
    const amountInput = overlay.querySelector("#pmAmountInput");
    const noteInput = overlay.querySelector("#pmNoteInput");
    const cancelBtn = overlay.querySelector("#pmCancelBtn");
    const saveBtn = overlay.querySelector("#pmSaveBtn");

    function close(result) {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      resolve(result);
    }

    function onKeydown(e) {
      if (e.key === "Escape") close(null);
    }

    saveBtn.addEventListener("click", () => {
      if (!dateInput.value) {
        dateInput.focus();
        return;
      }
      close({
        date: dateInput.value,
        amount: amountInput.value ? Number(amountInput.value) : null,
        note: noteInput.value.trim()
      });
    });

    cancelBtn.addEventListener("click", () => close(null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    document.addEventListener("keydown", onKeydown);

    document.body.appendChild(overlay);
    dateInput.focus();
  });
}

// تحديد موعد دفع لكل الطلبة المحددين دفعة واحدة (Batch Write)
async function openSetPaymentModal() {
  const uids = [...selectedStudents];
  if (uids.length === 0) return;

  const result = await showPaymentFormModal({
    title: `تحديد موعد الدفع (${uids.length} ${uids.length === 1 ? "طالب" : "طلبة"})`
  });
  if (!result) return;

  try {
    const batch = writeBatch(db);
    uids.forEach((uid) => {
      const student = allStudents.find((s) => s.uid === uid);
      const paymentId = `${currentTeacherId}_${uid}`;
      batch.set(doc(db, "payments", paymentId), {
        teacherId: currentTeacherId,
        studentUid: uid,
        studentName: student ? student.fullName : "",
        studentCode: student ? student.studentId : "",
        nextPaymentDate: result.date,
        amount: result.amount,
        note: result.note,
        updatedAt: new Date().toISOString()
      });
    });
    await batch.commit();

    showToast(`تم تحديد موعد الدفع لـ ${uids.length} طالب ✅`, "success");
    await loadPayments();
    clearSelection();

  } catch (error) {
    console.error("Set payment error:", error);
    showToast("تعذر حفظ موعد الدفع، حاول تاني", "error");
  }
}

// إلغاء موعد الدفع لكل الطلبة المحددين دفعة واحدة
async function openClearPaymentModal() {
  const uids = [...selectedStudents];
  if (uids.length === 0) return;

  const confirmed = await showConfirm({
    title: "إلغاء موعد الدفع",
    message: `هيتم إلغاء موعد الدفع المحدد لـ ${uids.length} طالب. متأكد؟`,
    confirmLabel: "إلغاء الموعد",
    danger: true
  });
  if (!confirmed) return;

  try {
    const batch = writeBatch(db);
    uids.forEach((uid) => {
      const paymentId = `${currentTeacherId}_${uid}`;
      batch.delete(doc(db, "payments", paymentId));
    });
    await batch.commit();

    showToast("تم إلغاء موعد الدفع ✅", "success");
    await loadPayments();
    clearSelection();

  } catch (error) {
    console.error("Clear payment error:", error);
    showToast("تعذر إلغاء موعد الدفع، حاول تاني", "error");
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