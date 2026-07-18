// ============================================
// Create Exam Logic - إنشاء امتحان (Wizard خطوتين)
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, addDoc, collection, query, where, getDocs }
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
const examLabelStyleInput = document.getElementById("examLabelStyle");
const examFromInput = document.getElementById("examFrom");
const examToInput = document.getElementById("examTo");
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
let qidCounter = 0;       // معرّف مؤقت فريد لكل سؤال (للتعامل مع DOM بس)

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

// ------- حماية الصفحة -------
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "../index.html"; return; }
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!userDoc.exists() || userDoc.data().role !== "teacher") {
    window.location.href = "../index.html";
    return;
  }
  currentTeacherId = user.uid;
  await loadGroupsChecklist();
});

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

    // نبني خريطة: gradeId -> {gradeName, groups: []}
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

    // تحديد فردي
    groupsChecklist.querySelectorAll(".group-checkbox").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        if (e.target.checked) selectedGroupIds.add(e.target.value);
        else selectedGroupIds.delete(e.target.value);
        syncGradeSelectAll(e.target.dataset.grade);
      });
    });

    // تحديد كل مجموعات السنة دفعة واحدة
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

  if (questions.length === 0) addQuestion(); // نبدأله بسؤال واحد جاهز
});

// إعادة رسم كل الأسئلة لما شكل الاختيارات العام يتغيّر
examLabelStyleInput.addEventListener("change", () => {
  if (questions.length > 0) renderAllQuestions();
});

backStepBtn.addEventListener("click", () => {
  step2View.classList.add("hidden");
  step1View.classList.remove("hidden");
  stepIndicator2.classList.remove("active");
  stepIndicator1.classList.add("active");
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
}

addQuestionBtn.addEventListener("click", addQuestion);

function getOptionLabel(index) {
  if (labelStyle === "arabic") return ARABIC_LABELS[index] || (index + 1);
  if (labelStyle === "english") return ENGLISH_LABELS[index] || (index + 1);
  return String(index + 1);
}

function updateSummary() {
  questionsCountEl.textContent = questions.length;
  const total = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);
  totalPointsLabel.textContent = total;
}

// ------- رسم كل الأسئلة (بيتنفذ بس عند تغييرات هيكلية) -------
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

// ------- إعادة رسم سؤال واحد بس (يحافظ على تركيز باقي الحقول) -------
function refreshOneQuestion(index) {
  const oldCard = questionsContainer.querySelector(`[data-qid="${questions[index].qid}"]`);
  const newCard = buildQuestionCard(index);
  if (oldCard) oldCard.replaceWith(newCard);
  else renderAllQuestions();
}

// ------- بناء كارت سؤال واحد -------
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

// ------- ربط الأحداث بكارت السؤال -------
function attachQuestionCardEvents(card, index) {
  const q = questions[index];

  // نص السؤال (من غير إعادة رسم عشان مايفقدش التركيز)
  card.querySelector(".q-text").addEventListener("input", (e) => {
    questions[index].questionText = e.target.value;
  });

  // تعليق المدرس
  card.querySelector(".q-comment").addEventListener("input", (e) => {
    questions[index].teacherComment = e.target.value;
  });

  // رابط المصدر
  card.querySelector(".q-resource").addEventListener("input", (e) => {
    questions[index].resourceUrl = e.target.value;
  });

  // الدرجة
  card.querySelector(".q-points").addEventListener("input", (e) => {
    questions[index].points = e.target.value;
    updateSummary();
  });


  // نصوص الاختيارات
  card.querySelectorAll(".q-option-text").forEach((input) => {
    input.addEventListener("input", (e) => {
      const optIndex = Number(e.target.dataset.index);
      questions[index].options[optIndex] = e.target.value;
    });
  });

  // اختيار الإجابة الصحيحة
  card.querySelectorAll(".q-correct-radio").forEach((radio) => {
    radio.addEventListener("change", (e) => {
      questions[index].correctAnswerIndex = Number(e.target.value);
    });
  });

  // إضافة اختيار
  const addOptionBtn = card.querySelector(".q-add-option");
  if (addOptionBtn) addOptionBtn.addEventListener("click", () => {
    if (questions[index].options.length < MAX_OPTIONS) {
      questions[index].options.push("");
      refreshOneQuestion(index);
    }
  });

  // حذف اختيار
  card.querySelectorAll(".q-remove-option").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const optIndex = Number(e.target.dataset.index);
      questions[index].options.splice(optIndex, 1);
      if (questions[index].correctAnswerIndex >= questions[index].options.length) {
        questions[index].correctAnswerIndex = 0;
      }
      refreshOneQuestion(index);
    });
  });

  // رفع صورة
  const imageInput = card.querySelector(".q-image-input");
  if (imageInput) imageInput.addEventListener("change", (e) => handleImageUpload(e, index));

  // إزالة صورة
  const removeImageBtn = card.querySelector(".q-remove-image");
  if (removeImageBtn) removeImageBtn.addEventListener("click", () => {
    questions[index].imageUrl = "";
    refreshOneQuestion(index);
  });

  // حذف السؤال
  card.querySelector(".q-delete").addEventListener("click", () => {
    if (questions.length <= 1) {
      showFormMessage("لازم يكون فيه سؤال واحد على الأقل", "error");
      return;
    }
    if (!confirm("متأكد إنك عايز تحذف السؤال ده؟")) return;
    questions.splice(index, 1);
    renderAllQuestions();
    updateSummary();
  });

  // تكرار السؤال
  card.querySelector(".q-duplicate").addEventListener("click", () => {
    const copy = JSON.parse(JSON.stringify(questions[index]));
    copy.qid = ++qidCounter;
    questions.splice(index + 1, 0, copy);
    renderAllQuestions();
    updateSummary();
  });

  // تحريك لأعلى / لأسفل
  const upBtn = card.querySelector(".q-move-up");
  if (upBtn) upBtn.addEventListener("click", () => {
    if (index === 0) return;
    [questions[index - 1], questions[index]] = [questions[index], questions[index - 1]];
    renderAllQuestions();
  });
  const downBtn = card.querySelector(".q-move-down");
  if (downBtn) downBtn.addEventListener("click", () => {
    if (index === questions.length - 1) return;
    [questions[index + 1], questions[index]] = [questions[index], questions[index + 1]];
    renderAllQuestions();
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
      qrToken: generateQrToken(),
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

    await addDoc(collection(db, "exams"), examDoc);

    showFormMessage(status === "published" ? "تم نشر الامتحان بنجاح ✅" : "تم حفظ المسودة ✅", "success");
    setTimeout(() => { window.location.href = "teacher-dashboard.html"; }, 1200);

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