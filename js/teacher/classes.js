// ============================================
// Classes Logic - إدارة السنوات والمجموعات
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, collection, addDoc, deleteDoc, updateDoc,
         query, where, getDocs, arrayUnion, arrayRemove }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { renderSkeleton, renderErrorState } from "../shared/states.js";
import { showToast, showConfirm } from "../shared/ui.js";
import "../shared/theme.js";

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
        const confirmed = await showConfirm({
          title: "حذف السنة الدراسية",
          message: `متأكد إنك عايز تمسح "${grade.gradeName}"؟`,
          confirmLabel: "حذف",
          danger: true,
        });
        if (!confirmed) return;
        await deleteDoc(doc(db, "grades", gradeDoc.id));
        showToast("تم حذف السنة الدراسية بنجاح", "success");
        await loadGrades();
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
        openGroupDetail(groupDoc.id, group);
      });

      card.querySelector(".entity-delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        const confirmed = await showConfirm({
          title: "حذف المجموعة",
          message: `متأكد إنك عايز تمسح "${group.groupName}"؟`,
          confirmLabel: "حذف",
          danger: true,
        });
        if (!confirmed) return;
        await deleteDoc(doc(db, "groups", groupDoc.id));
        showToast("تم حذف المجموعة بنجاح", "success");
        await loadGroups();
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

// ============================================
// تفاصيل المجموعة: طلبات الانضمام + الطلاب المنضمّين
// ============================================

// ------- حالة الشاشة -------
let currentGroupId = null;            // id المجموعة المفتوحة
let currentGroupData = null;          // آخر نسخة من بيانات المجموعة
let selectedPendingIds = new Set();   // الطلبات المحدّدة (قبول/رفض جماعي)
let searchTerm = "";                  // نص البحث
const userCache = new Map();          // كاش بيانات الطلاب (يقلّل القراءات)

// ------- تنضيف النصوص لمنع HTML injection -------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ------- بناء المودال مرة واحدة -------
function ensureGroupDetailModal() {
  if (document.getElementById("groupDetailModal")) return;

  const overlay = document.createElement("div");
  overlay.id = "groupDetailModal";
  overlay.className = "gd-overlay hidden";
  overlay.innerHTML = `
    <div class="gd-modal">
      <div class="gd-header">
        <h2 id="gdTitle">تفاصيل المجموعة</h2>
        <button id="gdClose" class="gd-close" title="إغلاق">✕</button>
      </div>

      <div id="gdMessage" class="gd-message"></div>

      <input type="search" id="gdSearch" class="gd-search"
             placeholder="ابحث باسم الطالب أو الكود..." autocomplete="off" />

      <section class="gd-section">
        <div class="gd-section-head">
          <h3>⏳ طلبات الانضمام (<span id="gdPendingCount">0</span>)</h3>
        </div>
        <div id="gdBulkBar" class="gd-bulk hidden">
          <label class="gd-select-all">
            <input type="checkbox" id="gdSelectAll" /> تحديد الكل
          </label>
          <button id="gdAcceptSelected" class="gd-btn gd-btn-accept" disabled>قبول المحدّدين</button>
          <button id="gdRejectSelected" class="gd-btn gd-btn-reject" disabled>رفض المحدّدين</button>
          <button id="gdAcceptAll" class="gd-btn gd-btn-primary">قبول الكل</button>
        </div>
        <div id="gdPendingList" class="gd-list"></div>
      </section>

      <section class="gd-section">
        <div class="gd-section-head">
          <h3>✅ الطلاب المنضمّين (<span id="gdMembersCount">0</span>)</h3>
        </div>
        <div id="gdMembersList" class="gd-list"></div>
      </section>
    </div>
  `;
  document.body.appendChild(overlay);

  // إغلاق
  overlay.querySelector("#gdClose").addEventListener("click", closeGroupDetail);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeGroupDetail(); // الضغط على الخلفية يقفل
  });

  // البحث
  overlay.querySelector("#gdSearch").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderGroupDetail();
  });

  // تحديد الكل (للمعروض فقط)
  overlay.querySelector("#gdSelectAll").addEventListener("change", (e) => {
    const visibleIds = getVisiblePendingIds();
    if (e.target.checked) visibleIds.forEach((id) => selectedPendingIds.add(id));
    else visibleIds.forEach((id) => selectedPendingIds.delete(id));
    renderGroupDetail();
  });

  // الأزرار الجماعية
  overlay.querySelector("#gdAcceptSelected").addEventListener("click", () => acceptStudents([...selectedPendingIds]));
  overlay.querySelector("#gdRejectSelected").addEventListener("click", () => rejectStudents([...selectedPendingIds]));
  overlay.querySelector("#gdAcceptAll").addEventListener("click", () => acceptStudents(currentGroupData?.pendingRequests || []));
}

// ------- فتح الشاشة -------
async function openGroupDetail(groupId, groupData) {
  ensureGroupDetailModal();
  currentGroupId = groupId;
  currentGroupData = groupData;
  selectedPendingIds.clear();
  searchTerm = "";

  document.getElementById("gdTitle").textContent = `تفاصيل: ${groupData.groupName}`;
  document.getElementById("gdSearch").value = "";
  showGdMessage("");
  document.getElementById("groupDetailModal").classList.remove("hidden");

  await renderGroupDetail();
}

// ------- إغلاق الشاشة + تحديث الكروت في الخلفية -------
function closeGroupDetail() {
  const modal = document.getElementById("groupDetailModal");
  if (modal) modal.classList.add("hidden");
  loadGroups(); // عشان أرقام الطلبات/الطلاب على الكروت تتحدث
}

// ------- جلب بيانات الطلاب (اللي مش في الكاش) -------
async function ensureUsersLoaded(ids) {
  const missing = ids.filter((id) => !userCache.has(id));
  if (missing.length === 0) return;

  const snaps = await Promise.all(missing.map((id) => getDoc(doc(db, "users", id))));
  snaps.forEach((snap, i) => {
    const id = missing[i];
    if (snap.exists()) {
      const d = snap.data();
      userCache.set(id, { fullName: d.fullName || "طالب بدون اسم", studentId: d.studentId || "—" });
    } else {
      userCache.set(id, { fullName: "طالب محذوف", studentId: "—" });
    }
  });
}

// ------- فلترة البحث -------
function matchesSearch(id) {
  if (!searchTerm) return true;
  const u = userCache.get(id);
  if (!u) return true;
  return u.fullName.toLowerCase().includes(searchTerm)
      || String(u.studentId).toLowerCase().includes(searchTerm);
}
function getVisiblePendingIds() {
  return (currentGroupData?.pendingRequests || []).filter(matchesSearch);
}

// ------- الرسم -------
async function renderGroupDetail() {
  const pending = currentGroupData?.pendingRequests || [];
  const members = currentGroupData?.studentIds || [];

  try {
    await ensureUsersLoaded([...pending, ...members]);
  } catch (error) {
    console.error("Load students error:", error);
    showGdMessage("تعذر تحميل بيانات الطلاب. راجع Security Rules (صلاحية قراءة users).", "error");
  }

  drawPending(pending);
  drawMembers(members);
  updateBulkBar(pending);
}

function drawPending(pending) {
  const list = document.getElementById("gdPendingList");
  document.getElementById("gdPendingCount").textContent = pending.length;

  if (pending.length === 0) {
    list.innerHTML = `<p class="gd-empty">مفيش طلبات انتظار حاليًا 🎉</p>`;
    return;
  }
  const visible = pending.filter(matchesSearch);
  if (visible.length === 0) {
    list.innerHTML = `<p class="gd-empty">مفيش نتيجة للبحث</p>`;
    return;
  }

  list.innerHTML = "";
  visible.forEach((id) => {
    const u = userCache.get(id) || { fullName: "…", studentId: "—" };
    const row = document.createElement("div");
    row.className = "gd-row";
    row.innerHTML = `
      <label class="gd-row-check">
        <input type="checkbox" class="gd-pending-check" ${selectedPendingIds.has(id) ? "checked" : ""} />
      </label>
      <div class="gd-row-info">
        <span class="gd-row-name">${escapeHtml(u.fullName)}</span>
        <span class="gd-row-code">${escapeHtml(u.studentId)}</span>
      </div>
      <div class="gd-row-actions">
        <button class="gd-btn gd-btn-accept gd-accept-one">قبول</button>
        <button class="gd-btn gd-btn-reject gd-reject-one">رفض</button>
      </div>
    `;
    row.querySelector(".gd-pending-check").addEventListener("change", (e) => {
      if (e.target.checked) selectedPendingIds.add(id);
      else selectedPendingIds.delete(id);
      updateBulkBar(currentGroupData?.pendingRequests || []);
    });
    row.querySelector(".gd-accept-one").addEventListener("click", () => acceptStudents([id]));
    row.querySelector(".gd-reject-one").addEventListener("click", () => rejectStudents([id]));
    list.appendChild(row);
  });
}

function drawMembers(members) {
  const list = document.getElementById("gdMembersList");
  document.getElementById("gdMembersCount").textContent = members.length;

  if (members.length === 0) {
    list.innerHTML = `<p class="gd-empty">لسه مفيش طلاب في المجموعة دي</p>`;
    return;
  }
  const visible = members.filter(matchesSearch);
  if (visible.length === 0) {
    list.innerHTML = `<p class="gd-empty">مفيش نتيجة للبحث</p>`;
    return;
  }

  list.innerHTML = "";
  visible.forEach((id) => {
    const u = userCache.get(id) || { fullName: "…", studentId: "—" };
    const row = document.createElement("div");
    row.className = "gd-row";
    row.innerHTML = `
      <div class="gd-row-info">
        <span class="gd-row-name">${escapeHtml(u.fullName)}</span>
        <span class="gd-row-code">${escapeHtml(u.studentId)}</span>
      </div>
      <div class="gd-row-actions">
        <button class="gd-btn gd-btn-reject gd-remove-one">إزالة</button>
      </div>
    `;
    row.querySelector(".gd-remove-one").addEventListener("click", () => removeMember(id));
    list.appendChild(row);
  });
}

function updateBulkBar(pending) {
  const bar = document.getElementById("gdBulkBar");
  if (pending.length === 0) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");

  const hasSelection = selectedPendingIds.size > 0;
  document.getElementById("gdAcceptSelected").disabled = !hasSelection;
  document.getElementById("gdRejectSelected").disabled = !hasSelection;

  const visible = getVisiblePendingIds();
  document.getElementById("gdSelectAll").checked =
    visible.length > 0 && visible.every((id) => selectedPendingIds.has(id));
}

// ------- العمليات (كلها updateDoc واحدة = آمنة وسريعة) -------
async function acceptStudents(ids) {
  if (!ids || ids.length === 0) return;
  await runGroupAction(
    { pendingRequests: arrayRemove(...ids), studentIds: arrayUnion(...ids) },
    `تم قبول ${ids.length} طالب ✅`
  );
}
async function rejectStudents(ids) {
  if (!ids || ids.length === 0) return;
  const confirmed = await showConfirm({
    title: "رفض الطلبات",
    message: `متأكد إنك عايز ترفض ${ids.length} طلب؟`,
    confirmLabel: "رفض",
    danger: true,
  });
  if (!confirmed) return;
  await runGroupAction(
    { pendingRequests: arrayRemove(...ids) },
    `تم رفض ${ids.length} طلب`
  );
}
async function removeMember(id) {
  const confirmed = await showConfirm({
    title: "إزالة الطالب",
    message: "متأكد إنك عايز تشيل الطالب من المجموعة؟",
    confirmLabel: "إزالة",
    danger: true,
  });
  if (!confirmed) return;
  await runGroupAction({ studentIds: arrayRemove(id) }, "تم إزالة الطالب من المجموعة");
}

async function runGroupAction(updates, successMsg) {
  setGdBusy(true);
  showGdMessage("جاري التنفيذ...", "info");
  try {
    await updateDoc(doc(db, "groups", currentGroupId), updates);

    const fresh = await getDoc(doc(db, "groups", currentGroupId));
    currentGroupData = fresh.exists() ? fresh.data() : { pendingRequests: [], studentIds: [] };

    selectedPendingIds.clear();
    await renderGroupDetail();
    showGdMessage(successMsg, "success");
  } catch (error) {
    console.error("Group action error:", error);
    showGdMessage("حصل خطأ أثناء التنفيذ، حاول تاني", "error");
  } finally {
    setGdBusy(false);
    updateBulkBar(currentGroupData?.pendingRequests || []);
  }
}

// ------- تعطيل كل الأزرار وقت التنفيذ -------
function setGdBusy(isBusy) {
  const modal = document.getElementById("groupDetailModal");
  if (!modal) return;
  modal.querySelectorAll("button").forEach((btn) => {
    if (btn.id === "gdClose") return; // نسيب زرار الإغلاق شغال
    btn.disabled = isBusy;
  });
}

// ------- رسائل الحالة -------
function showGdMessage(text, type = "") {
  const el = document.getElementById("gdMessage");
  if (!el) return;
  el.textContent = text || "";
  el.className = "gd-message" + (type ? " " + type : "");
  el.style.display = text ? "block" : "none";
}