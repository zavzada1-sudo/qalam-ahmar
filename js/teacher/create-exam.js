// ============================================
// Create Exam Logic - إنشاء امتحان (Wizard خطوتين)
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, addDoc, updateDoc, collection, query, where, getDocs }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// ============================================
// ⚠️ ضع الـ API Key بتاعك من imgbb.com هنا
// ============================================
const IMGBB_API_KEY = "6ed0a8bea361b328173b3a4a4a10d10e";

// ------- عناصر الصفحة -------
const logoutBtn = document.getElementById("logoutBtn");
const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

const step1View = document.getElementById("step1View");
const step2View = document.getElementById("step2View");
const stepIndicator1 = document.getElementById("stepIndicator1");
const stepIndicator2 = document.getElementById("stepIndicator2");
const formMessage = document.getElementById("formMessage");

const examTitleInput = document.getElementById("examTitle");
const examTypeInput = document.getElementById("examType");
const examTimeLimitInput = document.getElementById("examTimeLimit");
const examFromInput = document.getElementById("examFrom");
const examToInput = document.getElementById("examTo");
const examLabelStyleInput = document.getElementById("examLabelStyle");
const groupsChecklist = document.getElementById("groupsChecklist");
const nextStepBtn = document.getElementById("nextStepBtn");

const questionsContainer = document.getElementById("questionsContainer");
const questionsCountEl = document.getElementById("questionsCount");
const totalPointsLabel = document.getElementById("totalPointsLabel");
const addQuestionBtn = document.getElementById("addQuestionBtn");
const backStepBtn = document.getElementById("backStepBtn");
const saveDraftBtn = document.getElementById("saveDraftBtn");
const publishBtn = document.getElementById("publishBtn");

// ------- متغيرات الحالة -------
let currentTeacherId = null;
let selectedGroupIds = new Set();
let questions = [];       // كل الأسئلة
let qidCounter = 0; 
let editingExamId = null;   // لو موجود = إحنا بنعدّل امتحان مش بننشئ جديد
let originalQrToken = null; // نحافظ على نفس qrToken وقت التعديل      // معرّف مؤقت فريد لكل سؤال (للتعامل مع DOM بس)

const ARABIC_LABELS = ["أ", "ب", "ج", "د", "هـ", "و"];
const ENGLISH_LABELS = ["A", "B", "C", "D", "E", "F"];
const MAX_OPTIONS = 6;
const MIN_OPTIONS = 2;
const MAX_IMAGE_MB = 5;

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
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ============================================
// الحفظ التلقائي المحلي (يحمي من الريفريش/قطع النت)
// ============================================

function getStorageKey() {
  return `qalam_exam_draft_${currentTeacherId}_${editingExamId || "new"}`;
}

function saveDraftToStorage() {
  if (!currentTeacherId) return;
  try {
    const state = {
      title: examTitleInput.value,
      type: examTypeInput.value,
      timeLimit: examTimeLimitInput.value,
      from: examFromInput.value,
      to: examToInput.value,
      labelStyle: examLabelStyleInput.value,
      groupIds: [...selectedGroupIds],
      questions,
      qidCounter,
      currentStep: step2View.classList.contains("hidden") ? 1 : 2,
      savedAt: Date.now()
    };
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
  } catch (error) {
    console.error("Autosave error:", error);
  }
}

function clearDraftStorage() {
  if (!currentTeacherId) return;
  try { localStorage.removeItem(getStorageKey()); } catch (error) { /* تجاهل */ }
}

function loadDraftFromStorage() {
  if (!currentTeacherId) return null;
  try {
    const raw = localStorage.getItem(getStorageKey());
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("Load draft error:", error);
    return null;
  }
}

// حفظ تلقائي بعد أي كتابة (بتأخير بسيط عشان منكتبش على القرص كل حرف)
let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveDraftToStorage, 400);
}
document.querySelector(".dashboard-content").addEventListener("input", scheduleAutosave);
document.querySelector(".dashboard-content").addEventListener("change", scheduleAutosave);

function restoreDraft(draft) {
  examTitleInput.value = draft.title || "";
  examTypeInput.value = draft.type || "exam";
  examTimeLimitInput.value = draft.timeLimit || "";
  examFromInput.value = draft.from || "";
  examToInput.value = draft.to || "";
  examLabelStyleInput.value = draft.labelStyle || "arabic";

  selectedGroupIds = new Set(draft.groupIds || []);
  groupsChecklist.querySelectorAll(".group-checkbox").forEach((cb) => {
    cb.checked = selectedGroupIds.has(cb.value);
  });
  groupsChecklist.querySelectorAll(".grade-select-all").forEach((cb) => {
    syncGradeSelectAll(cb.dataset.grade);
  });

  questions = draft.questions || [];
  qidCounter = draft.qidCounter || questions.length;

  if (draft.currentStep === 2) {
    step1View.classList.add("hidden");
    step2View.classList.remove("hidden");
    stepIndicator1.classList.remove("active");
    stepIndicator2.classList.add("active");
    renderAllQuestions();
    updateSummary();
  }

  showFormMessage("تم استرجاع آخر نسخة غير محفوظة ✅", "success");
}

// ------- حماية الصفحة -------
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "../index.html"; return; }
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!userDoc.exists() || userDoc.data().role !== "teacher") {
    window.location.href = "../index.html";
    return;
  }
  currentTeacherId = user.uid;

  const params = new URLSearchParams(window.location.search);
  editingExamId = params.get("examId");

  await loadGroupsChecklist();

  if (editingExamId) {
    document.getElementById("pageMainTitle").textContent = "تعديل الامتحان";
    document.getElementById("pageSubtitleText").textContent = "عدّل بيانات الامتحان أو أسئلته";

    const localDraft = loadDraftFromStorage();
    if (localDraft) {
      const wantsRestore = confirm("لقينا تعديلات لسه ماتحفظتش على الامتحان ده، عايز تكمل منها؟");
      if (wantsRestore) { restoreDraft(localDraft); return; }
      else clearDraftStorage();
    }

    await loadExamForEditing();
  } else {
    const draft = loadDraftFromStorage();
    if (draft && (draft.title || (draft.questions && draft.questions.length > 0))) {
      const wantsRestore = confirm("لقينا امتحان لسه ماتحفظش من قبل، عايز تكمل منه؟");
      if (wantsRestore) restoreDraft(draft);
      else clearDraftStorage();
    }
  }
});

// ------- تحميل بيانات امتحان موجود للتعديل -------
async function loadExamForEditing() {
  try {
    const examSnap = await getDoc(doc(db, "exams", editingExamId));
    if (!examSnap.exists() || examSnap.data().teacherId !== currentTeacherId) {
      showFormMessage("الامتحان ده مش موجود أو مش بتاعك", "error");
      return;
    }
    const exam = examSnap.data();
    originalQrToken = exam.qrToken || null;

    examTitleInput.value = exam.title || "";
    examTypeInput.value = exam.type || "exam";
    examLabelStyleInput.value = exam.labelStyle || "arabic";
    examTimeLimitInput.value = exam.timeLimit || "";
    examFromInput.value = exam.availableFrom ? toLocalInputValue(exam.availableFrom) : "";
    examToInput.value = exam.availableTo ? toLocalInputValue(exam.availableTo) : "";

    selectedGroupIds = new Set(exam.groupIds || []);
    groupsChecklist.querySelectorAll(".group-checkbox").forEach((cb) => {
      cb.checked = selectedGroupIds.has(cb.value);
    });
    groupsChecklist.querySelectorAll(".grade-select-all").forEach((cb) => {
      syncGradeSelectAll(cb.dataset.grade);
    });

    questions = (exam.questions || []).map((q) => ({
      qid: ++qidCounter,
      questionText: q.questionText || "",
      imageUrl: q.imageUrl || "",
      imageUploading: false,
      options: q.options || ["", ""],
      correctAnswerIndex: q.correctAnswerIndex || 0,
      points: q.points ?? 1,
      teacherComment: q.teacherComment || "",
      resourceUrl: q.resourceUrl || ""
    }));

    renderAllQuestions();
    updateSummary();

  } catch (error) {
    console.error("Load exam for editing error:", error);
    showFormMessage("تعذر تحميل الامتحان، حاول تحديث الصفحة", "error");
  }
}

// ------- تحويل ISO string لصيغة datetime-local -------
function toLocalInputValue(isoString) {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================
// الخطوة 1: تحميل واختيار المجموعات
// ============================================

async function loadGroupsChecklist() {
  groupsChecklist.innerHTML = `<p class="loading-text">جاري التحميل...</p>`;
  try {
    const [gradesSnap, groupsSnap] = await Promise.all([
      getDocs(query(collection(db, "grades"), where("teacherId", "==", currentTeacherId))),
      getDocs(query(collection(db, "groups"), where("teacherId", "==", currentTeacherId)))
    ]);

    if (gradesSnap.empty || groupsSnap.empty) {
      groupsChecklist.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">👥</div>
          <h3>لسه معملتش سنوات أو مجموعات</h3>
          <p>لازم يكون عندك مجموعة واحدة على الأقل عشان تنشئ امتحان.</p>
          <a href="classes.html" class="btn btn-primary">الذهاب للفصول والطلاب</a>
        </div>
      `;
      nextStepBtn.disabled = true;
      return;
    }

    const gradesMap = new Map();
    gradesSnap.forEach((g) => gradesMap.set(g.id, { gradeName: g.data().gradeName, groups: [] }));
    groupsSnap.forEach((g) => {
      const data = g.data();
      if (gradesMap.has(data.gradeId)) {
        gradesMap.get(data.gradeId).groups.push({ id: g.id, groupName: data.groupName });
      }
    });

    groupsChecklist.innerHTML = "";
    gradesMap.forEach((grade, gradeId) => {
      if (grade.groups.length === 0) return;

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
              <input type="checkbox" class="group-checkbox" value="${g.id}" data-grade="${gradeId}">
              ${escapeHtml(g.groupName)}
            </label>
          `).join("")}
        </div>
      `;
      groupsChecklist.appendChild(section);
    });

    groupsChecklist.querySelectorAll(".group-checkbox").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        if (e.target.checked) selectedGroupIds.add(e.target.value);
        else selectedGroupIds.delete(e.target.value);
        syncGradeSelectAll(e.target.dataset.grade);
      });
    });

    groupsChecklist.querySelectorAll(".grade-select-all").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const gradeId = e.target.dataset.grade;
        const items = groupsChecklist.querySelectorAll(`.group-checkbox[data-grade="${gradeId}"]`);
        items.forEach((item) => {
          item.checked = e.target.checked;
          if (e.target.checked) selectedGroupIds.add(item.value);
          else selectedGroupIds.delete(item.value);
        });
      });
    });

  } catch (error) {
    console.error("Load groups checklist error:", error);
    groupsChecklist.innerHTML = `<p class="message error">تعذر تحميل المجموعات</p>`;
  }
}

function syncGradeSelectAll(gradeId) {
  const items = [...groupsChecklist.querySelectorAll(`.group-checkbox[data-grade="${gradeId}"]`)];
  const allChecked = items.length > 0 && items.every((i) => i.checked);
  const headerBox = groupsChecklist.querySelector(`.grade-select-all[data-grade="${gradeId}"]`);
  if (headerBox) headerBox.checked = allChecked;
}

// ------- الانتقال للخطوة 2 -------
nextStepBtn.addEventListener("click", () => {
  showFormMessage("");

  if (!examTitleInput.value.trim()) {
    showFormMessage("اكتب عنوان الامتحان الأول", "error");
    examTitleInput.focus();
    return;
  }
  if (selectedGroupIds.size === 0) {
    showFormMessage("اختار مجموعة واحدة على الأقل", "error");
    return;
  }

  step1View.classList.add("hidden");
  step2View.classList.remove("hidden");
  stepIndicator1.classList.remove("active");
  stepIndicator2.classList.add("active");

  if (questions.length === 0) addQuestion();
  saveDraftToStorage();
});

backStepBtn.addEventListener("click", () => {
  step2View.classList.add("hidden");
  step1View.classList.remove("hidden");
  stepIndicator2.classList.remove("active");
  stepIndicator1.classList.add("active");
  saveDraftToStorage();
});

// إعادة رسم الأسئلة لما شكل الاختيارات العام يتغيّر
examLabelStyleInput.addEventListener("change", () => {
  if (questions.length > 0) renderAllQuestions();
});

// ============================================
// الخطوة 2: بناء الأسئلة
// ============================================

function addQuestion() {
  questions.push({
    qid: ++qidCounter,
    questionText: "",
    imageUrl: "",
    imageUploading: false,
    options: ["", ""],
    correctAnswerIndex: 0,
    points: 1,
    teacherComment: "",
    resourceUrl: ""
  });
  renderAllQuestions();
  updateSummary();
  saveDraftToStorage();
}

addQuestionBtn.addEventListener("click", addQuestion);

function getOptionLabel(index) {
  const style = examLabelStyleInput.value;
  if (style === "arabic") return ARABIC_LABELS[index] || (index + 1);
  if (style === "english") return ENGLISH_LABELS[index] || (index + 1);
  return String(index + 1);
}

function updateSummary() {
  questionsCountEl.textContent = questions.length;
  const total = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);
  totalPointsLabel.textContent = total;
}

function renderAllQuestions() {
  questionsContainer.innerHTML = "";
  if (questions.length === 0) {
    questionsContainer.innerHTML = `<p class="gd-empty">لسه مفيش أسئلة، دوس "إضافة سؤال"</p>`;
    return;
  }
  questions.forEach((q, index) => {
    questionsContainer.appendChild(buildQuestionCard(index));
  });
}

function refreshOneQuestion(index) {
  const oldCard = questionsContainer.querySelector(`[data-qid="${questions[index].qid}"]`);
  const newCard = buildQuestionCard(index);
  if (oldCard) oldCard.replaceWith(newCard);
  else renderAllQuestions();
}

function buildQuestionCard(index) {
  const q = questions[index];
  const card = document.createElement("div");
  card.className = "profile-card question-card";
  card.dataset.qid = q.qid;

  card.innerHTML = `
    <div class="question-card-head">
      <strong>سؤال #${index + 1}</strong>
      <div class="question-card-actions">
        <button type="button" class="gd-btn gd-btn-primary q-move-up" ${index === 0 ? "disabled" : ""} title="تحريك لأعلى">↑</button>
        <button type="button" class="gd-btn gd-btn-primary q-move-down" ${index === questions.length - 1 ? "disabled" : ""} title="تحريك لأسفل">↓</button>
        <button type="button" class="gd-btn gd-btn-primary q-duplicate" title="تكرار السؤال">⧉</button>
        <button type="button" class="gd-btn gd-btn-reject q-delete" title="حذف السؤال">🗑️</button>
      </div>
    </div>

    <div class="form-group">
      <label>نص السؤال</label>
      <textarea class="q-text" rows="2" placeholder="اكتب نص السؤال هنا">${escapeHtml(q.questionText)}</textarea>
    </div>

    <div class="form-group">
      <label>صورة السؤال (اختياري)</label>
      <div class="q-image-area">
        ${q.imageUrl
          ? `<div class="q-image-preview">
               <img src="${escapeHtml(q.imageUrl)}" alt="صورة السؤال">
               <button type="button" class="gd-btn gd-btn-reject q-remove-image">إزالة الصورة</button>
             </div>`
          : `<label class="q-image-upload-btn">
               📷 رفع صورة
               <input type="file" class="q-image-input" accept="image/*" hidden>
             </label>`
        }
        ${q.imageUploading ? `<span class="q-uploading">جاري الرفع...</span>` : ""}
      </div>
    </div>

    <div class="form-group">
      <label>الاختيارات (حدد دائرة الإجابة الصحيحة)</label>
      <div class="q-options-list">
        ${q.options.map((opt, optIndex) => `
          <div class="q-option-row">
            <input type="radio" name="correct-${q.qid}" class="q-correct-radio"
                   value="${optIndex}" ${q.correctAnswerIndex === optIndex ? "checked" : ""}>
            <span class="q-option-label">${getOptionLabel(optIndex)}</span>
            <input type="text" class="q-option-text" data-index="${optIndex}"
                   value="${escapeHtml(opt)}" placeholder="نص الاختيار">
            ${q.options.length > MIN_OPTIONS
              ? `<button type="button" class="gd-btn gd-btn-reject q-remove-option" data-index="${optIndex}">✕</button>`
              : ""
            }
          </div>
        `).join("")}
      </div>
      ${q.options.length < MAX_OPTIONS
        ? `<button type="button" class="gd-btn gd-btn-primary q-add-option" style="margin-top: 8px;">+ إضافة اختيار</button>`
        : ""
      }
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>الدرجة</label>
        <input type="number" class="q-points" min="0" step="0.5" value="${q.points}">
      </div>
    </div>

    <div class="form-group">
      <label>تعليق المدرس (اختياري - يظهر للطالب لو غلط)</label>
      <textarea class="q-comment" rows="2" placeholder="مثال: راجع درس المعادلات">${escapeHtml(q.teacherComment)}</textarea>
    </div>

    <div class="form-group">
      <label>رابط مصدر إضافي (اختياري - يوتيوب/PDF)</label>
      <input type="url" class="q-resource" value="${escapeHtml(q.resourceUrl)}" placeholder="https://...">
    </div>
  `;

  attachQuestionCardEvents(card, index);
  return card;
}

function attachQuestionCardEvents(card, index) {
  card.querySelector(".q-text").addEventListener("input", (e) => {
    questions[index].questionText = e.target.value;
  });

  card.querySelector(".q-comment").addEventListener("input", (e) => {
    questions[index].teacherComment = e.target.value;
  });

  card.querySelector(".q-resource").addEventListener("input", (e) => {
    questions[index].resourceUrl = e.target.value;
  });

  card.querySelector(".q-points").addEventListener("input", (e) => {
    questions[index].points = e.target.value;
    updateSummary();
  });

  card.querySelectorAll(".q-option-text").forEach((input) => {
    input.addEventListener("input", (e) => {
      const optIndex = Number(e.target.dataset.index);
      questions[index].options[optIndex] = e.target.value;
    });
  });

  card.querySelectorAll(".q-correct-radio").forEach((radio) => {
    radio.addEventListener("change", (e) => {
      questions[index].correctAnswerIndex = Number(e.target.value);
    });
  });

  const addOptionBtn = card.querySelector(".q-add-option");
  if (addOptionBtn) addOptionBtn.addEventListener("click", () => {
    if (questions[index].options.length < MAX_OPTIONS) {
      questions[index].options.push("");
      refreshOneQuestion(index);
      saveDraftToStorage();
    }
  });

  card.querySelectorAll(".q-remove-option").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const optIndex = Number(e.target.dataset.index);
      questions[index].options.splice(optIndex, 1);
      if (questions[index].correctAnswerIndex >= questions[index].options.length) {
        questions[index].correctAnswerIndex = 0;
      }
      refreshOneQuestion(index);
      saveDraftToStorage();
    });
  });

  const imageInput = card.querySelector(".q-image-input");
  if (imageInput) imageInput.addEventListener("change", (e) => handleImageUpload(e, index));

  const removeImageBtn = card.querySelector(".q-remove-image");
  if (removeImageBtn) removeImageBtn.addEventListener("click", () => {
    questions[index].imageUrl = "";
    refreshOneQuestion(index);
    saveDraftToStorage();
  });

  card.querySelector(".q-delete").addEventListener("click", () => {
    if (questions.length <= 1) {
      showFormMessage("لازم يكون فيه سؤال واحد على الأقل", "error");
      return;
    }
    if (!confirm("متأكد إنك عايز تحذف السؤال ده؟")) return;
    questions.splice(index, 1);
    renderAllQuestions();
    updateSummary();
    saveDraftToStorage();
  });

  card.querySelector(".q-duplicate").addEventListener("click", () => {
    const copy = JSON.parse(JSON.stringify(questions[index]));
    copy.qid = ++qidCounter;
    questions.splice(index + 1, 0, copy);
    renderAllQuestions();
    updateSummary();
    saveDraftToStorage();
  });

  const upBtn = card.querySelector(".q-move-up");
  if (upBtn) upBtn.addEventListener("click", () => {
    if (index === 0) return;
    [questions[index - 1], questions[index]] = [questions[index], questions[index - 1]];
    renderAllQuestions();
    saveDraftToStorage();
  });
  const downBtn = card.querySelector(".q-move-down");
  if (downBtn) downBtn.addEventListener("click", () => {
    if (index === questions.length - 1) return;
    [questions[index + 1], questions[index]] = [questions[index], questions[index + 1]];
    renderAllQuestions();
    saveDraftToStorage();
  });
}

// ============================================
// رفع الصور على ImgBB
// ============================================

async function handleImageUpload(event, index) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showFormMessage("لازم تختار ملف صورة بس", "error");
    return;
  }
  if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
    showFormMessage(`حجم الصورة أكبر من ${MAX_IMAGE_MB} ميجا، اختار صورة أصغر`, "error");
    return;
  }

  questions[index].imageUploading = true;
  refreshOneQuestion(index);

  try {
    const formData = new FormData();
    formData.append("image", file);

    const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
      method: "POST",
      body: formData
    });
    const result = await response.json();

    if (!result.success) throw new Error(result.error?.message || "فشل الرفع");

    questions[index].imageUrl = result.data.url;
    showFormMessage("");
  } catch (error) {
    console.error("Image upload error:", error);
    showFormMessage("تعذر رفع الصورة، حاول تاني", "error");
  } finally {
    questions[index].imageUploading = false;
    refreshOneQuestion(index);
    saveDraftToStorage();
  }
}

// ============================================
// الحفظ (مسودة / نشر)
// ============================================

saveDraftBtn.addEventListener("click", () => saveExam("draft"));
publishBtn.addEventListener("click", () => saveExam("published"));

function validateQuestions() {
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.questionText.trim()) return `اكتب نص السؤال رقم ${i + 1}`;
    if (q.options.some((opt) => !opt.trim())) return `فيه اختيار فاضي في السؤال رقم ${i + 1}`;
    if (q.imageUploading) return `استنى رفع الصورة في السؤال رقم ${i + 1} يخلص`;
  }
  return null;
}

async function saveExam(status) {
  showFormMessage("");

  const validationError = validateQuestions();
  if (validationError) {
    showFormMessage(validationError, "error");
    return;
  }

  setSavingState(true);
  showFormMessage("جاري الحفظ...", "info");

  try {
    const totalPoints = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);

    const examDoc = {
      teacherId: currentTeacherId,
      title: examTitleInput.value.trim(),
      type: examTypeInput.value,
      labelStyle: examLabelStyleInput.value,
      timeLimit: examTimeLimitInput.value ? Number(examTimeLimitInput.value) : null,
      availableFrom: examFromInput.value ? new Date(examFromInput.value).toISOString() : null,
      availableTo: examToInput.value ? new Date(examToInput.value).toISOString() : null,
      groupIds: [...selectedGroupIds],
      status,
      totalPoints,
      questionsCount: questions.length,
      createdAt: new Date().toISOString(),
      questions: questions.map((q) => ({
        questionText: q.questionText.trim(),
        imageUrl: q.imageUrl || null,
        options: q.options.map((opt) => opt.trim()),
        correctAnswerIndex: q.correctAnswerIndex,
        points: Number(q.points) || 0,
        teacherComment: q.teacherComment.trim() || null,
        resourceUrl: q.resourceUrl.trim() || null
      }))
    };

    let savedExamId = editingExamId;

    if (editingExamId) {
      examDoc.qrToken = originalQrToken || generateQrToken();
      await updateDoc(doc(db, "exams", editingExamId), examDoc);
    } else {
      examDoc.qrToken = generateQrToken();
      const newDocRef = await addDoc(collection(db, "exams"), examDoc);
      savedExamId = newDocRef.id;
    }

    clearDraftStorage();

    if (status === "published") {
      showPublishQrModal(savedExamId);
    } else {
      showFormMessage("تم حفظ المسودة ✅", "success");
      setTimeout(() => { window.location.href = "teacher-dashboard.html"; }, 1200);
    }

  } catch (error) {
    console.error("Save exam error:", error);
    showFormMessage("حصل خطأ أثناء الحفظ، حاول تاني", "error");
  } finally {
    setSavingState(false);
  }
}

function generateQrToken() {
  return "q_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function setSavingState(isSaving) {
  saveDraftBtn.disabled = isSaving;
  publishBtn.disabled = isSaving;
}

// ------- رسائل الحالة -------
function showFormMessage(text, type = "") {
  formMessage.textContent = text || "";
  formMessage.className = "gd-message" + (type ? " " + type : "");
  formMessage.style.display = text ? "block" : "none";
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

// ============================================
// مودال QR بعد النشر
// ============================================

function showPublishQrModal(examId) {
  const modal = document.getElementById("publishQrModal");
  const qrContainer = document.getElementById("qrCodeContainer");
  qrContainer.innerHTML = "";

  const examUrl = `${window.location.origin}/pages/student-exam.html?examId=${examId}`;

  new QRCode(qrContainer, {
    text: examUrl,
    width: 220,
    height: 220,
    colorDark: "#2c3e50",
    colorLight: "#ffffff"
  });

  document.getElementById("printFromModalBtn").onclick = () => {
    window.open(`print-exam.html?examId=${examId}`, "_blank");
  };
  document.getElementById("backToDashboardBtn").onclick = () => {
    window.location.href = "teacher-dashboard.html";
  };

  modal.classList.remove("hidden");
}