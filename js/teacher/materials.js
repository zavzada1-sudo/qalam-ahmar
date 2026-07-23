// ============================================
// Materials Logic - المواد التعليمية (المدرس)
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, addDoc, updateDoc, deleteDoc, collection, query, where, getDocs, onSnapshot }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { showConfirm } from "../shared/ui.js";
import { renderSkeleton, renderErrorState } from "../shared/states.js";

import "../shared/theme.js";
import "../shared/offline-banner.js";

// ------- عناصر الصفحة -------
const logoutBtn = document.getElementById("logoutBtn");
const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

const pageMessage = document.getElementById("pageMessage");
const materialsList = document.getElementById("materialsList");
const materialsCount = document.getElementById("materialsCount");
const addMaterialBtn = document.getElementById("addMaterialBtn");

const materialModal = document.getElementById("materialModal");
const materialModalTitle = document.getElementById("materialModalTitle");
const materialTitle = document.getElementById("materialTitle");
const materialDescription = document.getElementById("materialDescription");
const materialType = document.getElementById("materialType");
const materialUrl = document.getElementById("materialUrl");
const groupsChecklist = document.getElementById("groupsChecklist");
const materialError = document.getElementById("materialError");
const saveMaterialBtn = document.getElementById("saveMaterialBtn");
const cancelMaterialBtn = document.getElementById("cancelMaterialBtn");

// عناصر التنقل بين الصفحات (Pagination) — 🆕
const paginationWrapper = document.getElementById("paginationWrapper");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageInfoEl = document.getElementById("pageInfo");

// ------- الحالة -------
let currentTeacherId = null;
let editingMaterialId = null;      // null = إضافة جديدة
let selectedGroupIds = new Set();
let teacherGroups = [];            // [{id, groupName, gradeName, gradeId}]

let allMaterials = [];   // 🆕 كل المواد (بعد آخر تحديث من onSnapshot)، قبل التقسيم لصفحات
const PAGE_SIZE = 12;    // 🆕 عدد الكروت في كل صفحة
let currentPage = 1;     // 🆕 رقم الصفحة الحالية

const TYPE_ICONS = { pdf: "📄", doc: "📝", video: "🎥", link: "🔗" };
const TYPE_NAMES = { pdf: "ملزمة / PDF", doc: "مستند Word", video: "فيديو", link: "رابط" };

// ------- القائمة الجانبية (موبايل) -------
if (menuToggle) menuToggle.addEventListener("click", () => {
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("show");
});
if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", () => {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("show");
});

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function showPageMessage(text, type = "") {
  pageMessage.textContent = text || "";
  pageMessage.className = "gd-message" + (type ? " " + type : "");
  pageMessage.style.display = text ? "block" : "none";
}

// ------- حماية الصفحة -------
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "../index.html"; return; }

  currentTeacherId = user.uid;

  // بنشغّل التلاتة مع بعض بدل واحدة ورا التانية.
  // كلهم محتاجين الـ uid بس، وده متاح من أول لحظة — فمفيش سبب
  // إن جلب المواد يستنى التحقق من الدور يخلص.
  const [userDoc] = await Promise.all([
    getDoc(doc(db, "users", user.uid)),
    loadTeacherGroups(),
    loadMaterials()
  ]);

  // التحقق من الدور بيحصل بعد ما البيانات وصلت.
  // لو طلع مش مدرس، بنطرده بره فورًا وقواعد Firestore أصلاً
  // كانت هترفض تديله بيانات مش بتاعته.
  if (!userDoc.exists() || userDoc.data().role !== "teacher") {
    window.location.href = "../index.html";
    return;
  }
});

// ============================================
// تحميل مجموعات المدرس (للاختيار في المودال)
// ============================================

async function loadTeacherGroups() {
  try {
    const [gradesSnap, groupsSnap] = await Promise.all([
      getDocs(query(collection(db, "grades"), where("teacherId", "==", currentTeacherId))),
      getDocs(query(collection(db, "groups"), where("teacherId", "==", currentTeacherId)))
    ]);

    const gradeNames = new Map();
    gradesSnap.forEach((g) => gradeNames.set(g.id, g.data().gradeName));

    teacherGroups = [];
    groupsSnap.forEach((g) => {
      const data = g.data();
      teacherGroups.push({
        id: g.id,
        groupName: data.groupName,
        gradeId: data.gradeId,
        gradeName: gradeNames.get(data.gradeId) || "بدون سنة"
      });
    });
  } catch (error) {
    console.error("Load groups error:", error);
  }
}

function renderGroupsChecklist() {
  if (teacherGroups.length === 0) {
    groupsChecklist.innerHTML = `
      <p class="gd-empty">لسه مفيش مجموعات. اعمل مجموعة من صفحة "الفصول والطلاب" الأول.</p>
    `;
    return;
  }

  // نجمّع حسب السنة
  const byGrade = new Map();
  teacherGroups.forEach((g) => {
    if (!byGrade.has(g.gradeId)) byGrade.set(g.gradeId, { gradeName: g.gradeName, groups: [] });
    byGrade.get(g.gradeId).groups.push(g);
  });

  groupsChecklist.innerHTML = "";
  byGrade.forEach((grade, gradeId) => {
    const section = document.createElement("div");
    section.className = "checklist-section";
    section.innerHTML = `
      <label class="checklist-header">
        <input type="checkbox" class="grade-select-all" data-grade="${gradeId}">
        <strong>${escapeHtml(grade.gradeName)}</strong>
      </label>
      <div class="checklist-items">
        ${grade.groups.map((g) => `
          <label class="checklist-item">
            <input type="checkbox" class="group-checkbox" value="${g.id}" data-grade="${gradeId}"
                   ${selectedGroupIds.has(g.id) ? "checked" : ""}>
            ${escapeHtml(g.groupName)}
          </label>
        `).join("")}
      </div>
    `;
    groupsChecklist.appendChild(section);
  });

  // تحديد فردي
  groupsChecklist.querySelectorAll(".group-checkbox").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      if (e.target.checked) selectedGroupIds.add(e.target.value);
      else selectedGroupIds.delete(e.target.value);
      syncGradeSelectAll(e.target.dataset.grade);
    });
  });

  // تحديد كل مجموعات السنة
  groupsChecklist.querySelectorAll(".grade-select-all").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const gradeId = e.target.dataset.grade;
      groupsChecklist.querySelectorAll(`.group-checkbox[data-grade="${gradeId}"]`).forEach((item) => {
        item.checked = e.target.checked;
        if (e.target.checked) selectedGroupIds.add(item.value);
        else selectedGroupIds.delete(item.value);
      });
    });
    syncGradeSelectAll(cb.dataset.grade);
  });
}

function syncGradeSelectAll(gradeId) {
  const items = [...groupsChecklist.querySelectorAll(`.group-checkbox[data-grade="${gradeId}"]`)];
  const header = groupsChecklist.querySelector(`.grade-select-all[data-grade="${gradeId}"]`);
  if (header) header.checked = items.length > 0 && items.every((i) => i.checked);
}

// ============================================
// عرض المواد
// ============================================

// مرجع للاستماع الحالي، عشان نقدر نوقفه لو احتجنا
let unsubscribeMaterials = null;

function loadMaterials() {
  materialsList.innerHTML = `<p class="loading-text">جاري التحميل...</p>`;

  // لو فيه استماع شغال من قبل، نوقفه الأول (يمنع تكرار الاستماع)
  if (unsubscribeMaterials) unsubscribeMaterials();

  // onSnapshot بدل getDocs:
  // بيرجّع البيانات فورًا من الكاش المحلي (لو موجودة من زيارة سابقة)،
  // وبعدين بيتحدّث لوحده لما البيانات توصل من السيرفر.
  // كمان لو أضفت أو مسحت مادة، الشاشة بتتحدث تلقائي من غير إعادة تحميل.
  unsubscribeMaterials = onSnapshot(
    query(
      collection(db, "materials"),
      where("teacherId", "==", currentTeacherId)
    ),
    (snap) => {
      allMaterials = [];
      snap.forEach((m) => allMaterials.push({ id: m.id, ...m.data() }));

      // الأحدث أول
      allMaterials.sort((a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      );

      materialsCount.textContent = allMaterials.length;
      renderMaterialsPage(); // 🆕
    },
    (error) => {
      console.error("Load materials error:", error);
      materialsList.innerHTML = `<p class="message error">تعذر تحميل المواد، حدّث الصفحة</p>`;
    }
  );
}

// ============================================
// 🆕 عرض صفحة واحدة من المواد (Client-side Pagination)
// ============================================
function renderMaterialsPage() {
  if (allMaterials.length === 0) {
    materialsList.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-icon">📚</div>
        <h3>لسه مفيش مواد</h3>
        <p>ضيف أول ملزمة أو ملف لطلابك.</p>
      </div>
    `;
    paginationWrapper.classList.add("hidden");
    return;
  }

  const totalPages = Math.max(1, Math.ceil(allMaterials.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageMaterials = allMaterials.slice(startIdx, startIdx + PAGE_SIZE);

  materialsList.innerHTML = "";
  pageMaterials.forEach((material) => {
    materialsList.appendChild(buildMaterialCard(material));
  });

  renderPagination(allMaterials.length, totalPages);
}

// ============================================
// 🆕 عرض شريط التنقل بين الصفحات
// ============================================
function renderPagination(totalItems, totalPages) {
  if (totalPages <= 1) {
    paginationWrapper.classList.add("hidden");
    return;
  }

  paginationWrapper.classList.remove("hidden");
  pageInfoEl.textContent = `صفحة ${currentPage} من ${totalPages} (${totalItems} مادة)`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
}

prevPageBtn.addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage--;
  renderMaterialsPage();
  materialsList.scrollIntoView({ behavior: "smooth", block: "start" });
});

nextPageBtn.addEventListener("click", () => {
  currentPage++;
  renderMaterialsPage();
  materialsList.scrollIntoView({ behavior: "smooth", block: "start" });
});

function buildMaterialCard(material) {
  const groupNames = (material.groupIds || [])
    .map((id) => teacherGroups.find((g) => g.id === id)?.groupName)
    .filter(Boolean);

  const card = document.createElement("div");
  card.className = "entity-card material-card";
  card.innerHTML = `
    <div class="material-card-actions">
      <button class="gd-btn gd-btn-primary material-edit" title="تعديل">✎</button>
      <button class="gd-btn gd-btn-reject material-delete" title="حذف">🗑️</button>
    </div>
    <div class="entity-card-icon">${TYPE_ICONS[material.fileType] || "📄"}</div>
    <h3>${escapeHtml(material.title)}</h3>
    ${material.description ? `<p class="card-meta">${escapeHtml(material.description)}</p>` : ""}
    <p class="card-meta">
      ${escapeHtml(TYPE_NAMES[material.fileType] || "ملف")}
      ${groupNames.length ? " · " + escapeHtml(groupNames.join("، ")) : " · مفيش مجموعات"}
    </p>
    <a href="${escapeHtml(material.fileUrl)}" target="_blank" rel="noopener noreferrer"
       class="btn btn-outline btn-block" style="margin-top: 10px;">فتح الملف ↗</a>
  `;

  card.querySelector(".material-edit").addEventListener("click", (e) => {
    e.stopPropagation();
    openModal(material);
  });

  card.querySelector(".material-delete").addEventListener("click", async (e) => {
    e.stopPropagation();
    const confirmed = await showConfirm({
      title: "حذف المادة",
      message: `متأكد إنك عايز تمسح "${material.title}"؟`,
      confirmLabel: "حذف",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteDoc(doc(db, "materials", material.id));
      showPageMessage("تم حذف المادة ✅", "success");
    } catch (error) {
      console.error("Delete material error:", error);
      showPageMessage("حصلت مشكلة في الحذف، حاول تاني", "error");
    }
  });

  return card;
}

// ============================================
// المودال (إضافة / تعديل)
// ============================================

function openModal(material = null) {
  editingMaterialId = material ? material.id : null;
  materialError.textContent = "";

  materialModalTitle.textContent = material ? "تعديل المادة" : "إضافة مادة";
  materialTitle.value = material?.title || "";
  materialDescription.value = material?.description || "";
  materialType.value = material?.fileType || "pdf";
  materialUrl.value = material?.fileUrl || "";
  selectedGroupIds = new Set(material?.groupIds || []);

  renderGroupsChecklist();
  materialModal.classList.remove("hidden");
  materialTitle.focus();
}

function closeModal() {
  materialModal.classList.add("hidden");
  editingMaterialId = null;
}

addMaterialBtn.addEventListener("click", () => openModal());
cancelMaterialBtn.addEventListener("click", closeModal);
materialModal.addEventListener("click", (e) => {
  if (e.target === materialModal) closeModal();
});

// ------- الحفظ -------
saveMaterialBtn.addEventListener("click", async () => {
  materialError.textContent = "";

  const title = materialTitle.value.trim();
  const url = materialUrl.value.trim();

  if (!title) {
    materialError.textContent = "اكتب عنوان المادة";
    materialTitle.focus();
    return;
  }
  if (!url) {
    materialError.textContent = "الزق رابط الملف";
    materialUrl.focus();
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    materialError.textContent = "الرابط لازم يبدأ بـ http:// أو https://";
    materialUrl.focus();
    return;
  }
  if (selectedGroupIds.size === 0) {
    materialError.textContent = "اختار مجموعة واحدة على الأقل";
    return;
  }

  saveMaterialBtn.disabled = true;
  saveMaterialBtn.textContent = "جاري الحفظ...";

  try {
    const materialDoc = {
      teacherId: currentTeacherId,
      title,
      description: materialDescription.value.trim() || null,
      fileType: materialType.value,
      source: "link",              // 🔑 هيبقى "storage" لما نفعّل الرفع المباشر
      fileUrl: url,
      groupIds: [...selectedGroupIds],
      updatedAt: new Date().toISOString()
    };

    if (editingMaterialId) {
      await updateDoc(doc(db, "materials", editingMaterialId), materialDoc);
      showPageMessage("تم تعديل المادة ✅", "success");
    } else {
      materialDoc.createdAt = new Date().toISOString();
      await addDoc(collection(db, "materials"), materialDoc);
      showPageMessage("تم إضافة المادة ✅", "success");
    }

    closeModal();

  } catch (error) {
    console.error("Save material error:", error);
    materialError.textContent = "حصلت مشكلة في الحفظ، حاول تاني";
  } finally {
    saveMaterialBtn.disabled = false;
    saveMaterialBtn.textContent = "حفظ";
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