// ============================================
// Student Exam Logic - حل الامتحان
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs, addDoc }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { showToast } from "../shared/ui.js";

import "../shared/theme.js";
import "../shared/offline-banner.js";

// ------- عناصر الصفحة -------
const loadingView = document.getElementById("loadingView");
const errorView = document.getElementById("errorView");
const infoView = document.getElementById("infoView");
const examView = document.getElementById("examView");

const errorTitle = document.getElementById("errorTitle");
const errorMessage = document.getElementById("errorMessage");

const examTitleEl = document.getElementById("examTitle");
const examTeacherEl = document.getElementById("examTeacher");
const infoQuestionsCount = document.getElementById("infoQuestionsCount");
const infoTotalPoints = document.getElementById("infoTotalPoints");
const infoTimeLimit = document.getElementById("infoTimeLimit");
const startExamBtn = document.getElementById("startExamBtn");

const questionsList = document.getElementById("questionsList");
const answeredCount = document.getElementById("answeredCount");
const totalCount = document.getElementById("totalCount");
const examTimer = document.getElementById("examTimer");
const timerDisplay = document.getElementById("timerDisplay");
const submitBtn = document.getElementById("submitBtn");
const submitBtnBottom = document.getElementById("submitBtnBottom");

const timeUpModal = document.getElementById("timeUpModal");
const timeUpSubmitBtn = document.getElementById("timeUpSubmitBtn");
const confirmSubmitModal = document.getElementById("confirmSubmitModal");
const confirmSubmitMessage = document.getElementById("confirmSubmitMessage");
const finalSubmitBtn = document.getElementById("finalSubmitBtn");
const cancelSubmitBtn = document.getElementById("cancelSubmitBtn");

// ------- الحالة -------
let currentStudentId = null;
let currentStudentName = null;
let examId = null;
let examData = null;      // كل بيانات الامتحان (بعد إخفاء الإجابات الصحيحة)
let studentAnswers = [];  // إجابة الطالب لكل سؤال (شكلها بيختلف حسب نوع السؤال)
let questionStartTimes = []; // وقت بدء عرض كل سؤال (لحساب الوقت المستغرق)
let examStartTime = null;
let timerInterval = null;
let timeRemaining = null;   // بالثواني
let hasTimeExpired = false;
let isSubmitting = false;

const ARABIC_LABELS = ["أ", "ب", "ج", "د", "هـ", "و"];
const ENGLISH_LABELS = ["A", "B", "C", "D", "E", "F"];

// ============================================
// رفع صور الإجابات المقالية (نفس مفتاح ImgBB المستخدم في create-exam.js)
// ============================================
const IMGBB_API_KEY = "6ed0a8bea361b328173b3a4a4a10d10e";
const MAX_IMAGE_MB = 5;

// ------- تنضيف النصوص لمنع HTML injection -------
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ------- عرض شاشة خطأ -------
function showError(title, message) {
  loadingView.classList.add("hidden");
  infoView.classList.add("hidden");
  examView.classList.add("hidden");
  errorView.classList.remove("hidden");
  errorTitle.textContent = title;
  errorMessage.textContent = message;
}

// ============================================
// حماية الصفحة + التحقق من الأهلية
// ============================================

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "../index.html"; return; }

  // جلب examId من الرابط
  const params = new URLSearchParams(window.location.search);
  examId = params.get("examId");

  if (!examId) {
    showError("رابط غير صحيح", "مفيش امتحان محدد في الرابط");
    return;
  }

  try {
    // 1) التأكد إن المستخدم طالب
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists() || userDoc.data().role !== "student") {
      showError("غير مسموح", "الصفحة دي للطلاب فقط");
      return;
    }
    currentStudentId = user.uid;
    currentStudentName = userDoc.data().fullName || "طالب";

    // 2) جلب الامتحان
    const examSnap = await getDoc(doc(db, "exams", examId));
    if (!examSnap.exists()) {
      showError("الامتحان غير موجود", "الامتحان ده مش موجود أو اتحذف");
      return;
    }
    const rawExam = examSnap.data();

    // 3) التأكد إن الامتحان منشور
    if (rawExam.status !== "published") {
      showError("الامتحان غير متاح", "الامتحان ده لسه مسودة ومش منشور");
      return;
    }

    // 4) التأكد إن الطالب من المجموعات المستهدفة
    const allowed = await checkStudentInGroups(rawExam.groupIds || []);
    if (!allowed) {
      showError("غير مصرح", "الامتحان ده مش لمجموعتك");
      return;
    }

    // 5) التأكد إن الطالب مسلّمش الامتحان قبل كده
    const previousSubmission = await checkPreviousSubmission();
    if (previousSubmission) {
      showError("مسلّم بالفعل", "إنت سلّمت الامتحان ده قبل كده، مقدرش تحله تاني");
      return;
    }

    // 6) التأكد إن الامتحان في وقته
    const availabilityError = checkAvailability(rawExam);
    if (availabilityError) {
      showError("الامتحان غير متاح دلوقتي", availabilityError);
      return;
    }

    // 7) كل حاجة تمام — جهّز البيانات وشل الإجابات الصحيحة
    examData = prepareExamData(rawExam);
    showInfoScreen();

  } catch (error) {
    console.error("Load exam error:", error);
    showError("حصلت مشكلة", "تعذر تحميل الامتحان، حاول تحديث الصفحة");
  }
});

// ------- التأكد إن الطالب في مجموعات الامتحان -------
async function checkStudentInGroups(groupIds) {
  if (!groupIds || groupIds.length === 0) return false;
  const groupSnaps = await Promise.all(groupIds.map((id) => getDoc(doc(db, "groups", id))));
  return groupSnaps.some((snap) => {
    if (!snap.exists()) return false;
    return (snap.data().studentIds || []).includes(currentStudentId);
  });
}

// ------- التأكد إن الطالب مسلّمش قبل كده -------
async function checkPreviousSubmission() {
  const subQuery = query(
    collection(db, "submissions"),
    where("examId", "==", examId),
    where("studentId", "==", currentStudentId)
  );
  const snap = await getDocs(subQuery);
  return !snap.empty;
}

// ------- التأكد من وقت التوفّر -------
function checkAvailability(exam) {
  const now = new Date();
  if (exam.availableFrom && new Date(exam.availableFrom) > now) {
    return `الامتحان يبدأ في ${new Date(exam.availableFrom).toLocaleString("ar-EG")}`;
  }
  if (exam.availableTo && new Date(exam.availableTo) < now) {
    return `الامتحان اتقفل في ${new Date(exam.availableTo).toLocaleString("ar-EG")}`;
  }
  return null;
}

// ------- تجهيز البيانات (شيل الإجابات الصحيحة قبل ما نعرضها) -------
function prepareExamData(raw) {
  return {
    title: raw.title,
    labelStyle: raw.labelStyle || "arabic",
    timeLimit: raw.timeLimit,
    totalPoints: raw.totalPoints || 0,
    teacherId: raw.teacherId,
    questions: (raw.questions || []).map((q) => ({
      type: q.type || "mcq", // امتحانات قديمة من غير type = اختيار من متعدد
      questionText: q.questionText,
      imageUrl: q.imageUrl,
      options: q.options || []
      // ملحوظة: correctAnswerIndex, modelAnswer, teacherComment, resourceUrl, points
      // متشالين هنا عمدًا — الطالب مش محتاجهم دلوقتي، هنستخدمهم في التصحيح لاحقًا
    }))
  };
}

// ============================================
// شاشة معلومات الامتحان
// ============================================

async function showInfoScreen() {
  // جلب اسم المدرس
  try {
    const teacherSnap = await getDoc(doc(db, "users", examData.teacherId));
    const teacherName = teacherSnap.exists() ? teacherSnap.data().fullName : "المدرس";
    examTeacherEl.textContent = `مع ${teacherName}`;
  } catch (error) {
    examTeacherEl.textContent = "";
  }

  examTitleEl.textContent = examData.title;
  infoQuestionsCount.textContent = examData.questions.length;
  infoTotalPoints.textContent = examData.totalPoints;
  infoTimeLimit.textContent = examData.timeLimit ? `${examData.timeLimit} دقيقة` : "مفتوح";

  loadingView.classList.add("hidden");
  infoView.classList.remove("hidden");
}

startExamBtn.addEventListener("click", startExam);

// ============================================
// بدء الامتحان
// ============================================

function startExam() {
  // تجهيز مصفوفة الإجابات — شكل مختلف حسب نوع السؤال
  // اختياري: { selectedIndex: null }
  // مقالي:   { textAnswer: "", imageUrl: "", imageUploading: false }
  studentAnswers = examData.questions.map((q) =>
    q.type === "essay"
      ? { textAnswer: "", imageUrl: "", imageUploading: false }
      : { selectedIndex: null }
  );
  questionStartTimes = examData.questions.map(() => Date.now());
  examStartTime = Date.now();

  infoView.classList.add("hidden");
  examView.classList.remove("hidden");

  totalCount.textContent = examData.questions.length;
  renderQuestions();
  updateAnsweredCount();

  // بدء العدّاد لو فيه وقت محدد
  if (examData.timeLimit) {
    timeRemaining = examData.timeLimit * 60; // بالثواني
    examTimer.classList.remove("hidden");
    updateTimerDisplay();
    timerInterval = setInterval(tickTimer, 1000);
  }

  // تحذير الطالب لو حاول يقفل الصفحة
  window.addEventListener("beforeunload", beforeUnloadHandler);
}

function beforeUnloadHandler(e) {
  if (!isSubmitting) {
    e.preventDefault();
    e.returnValue = "";
  }
}

// ============================================
// عرض الأسئلة
// ============================================

function getOptionLabel(index) {
  if (examData.labelStyle === "arabic") return ARABIC_LABELS[index] || (index + 1);
  if (examData.labelStyle === "english") return ENGLISH_LABELS[index] || (index + 1);
  return String(index + 1);
}

function renderQuestions() {
  questionsList.innerHTML = "";
  examData.questions.forEach((q, qIndex) => {
    questionsList.appendChild(buildQuestionCard(qIndex));
  });
}

// إعادة رسم كارت واحد بس (بنستخدمها بعد رفع/إزالة صورة عشان
// منعيدش رسم كل الأسئلة ونضيّع اللي الطالب كاتبه في باقي الخانات)
function refreshOneQuestion(qIndex) {
  const oldCard = questionsList.querySelector(`[data-qindex="${qIndex}"]`);
  const newCard = buildQuestionCard(qIndex);
  if (oldCard) oldCard.replaceWith(newCard);
}

function buildQuestionCard(qIndex) {
  const q = examData.questions[qIndex];
  const answer = studentAnswers[qIndex];
  const isEssay = q.type === "essay";

  const card = document.createElement("div");
  card.className = "exam-question-card";
  card.dataset.qindex = qIndex;

  // ------- جزء الإجابة: اختيارات أو مقالي -------
  const answerAreaHtml = isEssay
    ? buildEssayAnswerHtml(qIndex, answer)
    : `
      <div class="exam-options">
        ${q.options.map((opt, optIndex) => `
          <label class="exam-option">
            <input type="radio" name="q-${qIndex}" value="${optIndex}"
                   ${answer.selectedIndex === optIndex ? "checked" : ""}
                   ${hasTimeExpired ? "disabled" : ""}>
            <span class="exam-option-label">${getOptionLabel(optIndex)}</span>
            <span class="exam-option-text">${escapeHtml(opt)}</span>
          </label>
        `).join("")}
      </div>
    `;

  card.innerHTML = `
    <div class="exam-question-head">
      <span class="exam-question-num">سؤال ${qIndex + 1}</span>
      ${isEssay ? `<span class="exam-question-type">مقالي</span>` : ""}
    </div>
    <div class="exam-question-text">${escapeHtml(q.questionText)}</div>
    ${q.imageUrl ? `<img class="exam-question-image" src="${escapeHtml(q.imageUrl)}" alt="صورة السؤال">` : ""}
    ${answerAreaHtml}
  `;

  if (isEssay) attachEssayEvents(card, qIndex);
  else attachMcqEvents(card, qIndex);

  return card;
}

// ------- HTML خانة الإجابة المقالية (نص و/أو صورة) -------
function buildEssayAnswerHtml(qIndex, answer) {
  return `
    <div class="essay-answer">
      <p class="essay-hint">اكتب إجابتك في الخانة، أو صوّر ورقتك وارفع الصورة — أو الاتنين مع بعض.</p>

      <textarea class="essay-text" rows="5"
        placeholder="اكتب إجابتك هنا..."
        ${hasTimeExpired ? "disabled" : ""}>${escapeHtml(answer.textAnswer)}</textarea>

      <div class="essay-image-area">
        ${answer.imageUrl
          ? `<div class="essay-image-preview">
               <img src="${escapeHtml(answer.imageUrl)}" alt="صورة إجابتك">
               <button type="button" class="btn btn-outline essay-remove-image"
                 ${hasTimeExpired ? "disabled" : ""}>إزالة الصورة</button>
             </div>`
          : `<label class="essay-upload-btn ${hasTimeExpired ? "disabled" : ""}">
               📷 صوّر ورقتك / ارفع صورة
               <input type="file" class="essay-image-input" accept="image/*"
                 ${hasTimeExpired ? "disabled" : ""} hidden>
             </label>`
        }
        ${answer.imageUploading ? `<span class="essay-uploading">جاري رفع الصورة...</span>` : ""}
      </div>
    </div>
  `;
}

// ------- أحداث السؤال الاختياري -------
function attachMcqEvents(card, qIndex) {
  card.querySelectorAll("input[type='radio']").forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (hasTimeExpired) return; // لو الوقت خلص، ممنوع التغيير
      studentAnswers[qIndex].selectedIndex = Number(e.target.value);
      updateAnsweredCount();
    });
  });
}

// ------- أحداث السؤال المقالي -------
function attachEssayEvents(card, qIndex) {
  // الكتابة: بنحدّث الحالة بس من غير إعادة رسم (عشان منضيّعش مكان المؤشر)
  const textarea = card.querySelector(".essay-text");
  if (textarea) textarea.addEventListener("input", (e) => {
    if (hasTimeExpired) return;
    studentAnswers[qIndex].textAnswer = e.target.value;
    updateAnsweredCount();
  });

  const imageInput = card.querySelector(".essay-image-input");
  if (imageInput) imageInput.addEventListener("change", (e) => handleAnswerImageUpload(e, qIndex));

  const removeImageBtn = card.querySelector(".essay-remove-image");
  if (removeImageBtn) removeImageBtn.addEventListener("click", () => {
    if (hasTimeExpired) return;
    studentAnswers[qIndex].imageUrl = "";
    refreshOneQuestion(qIndex);
    updateAnsweredCount();
  });
}

// ============================================
// رفع صورة إجابة الطالب على ImgBB
// ============================================

async function handleAnswerImageUpload(event, qIndex) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showToast("لازم تختار ملف صورة بس", "error");
    return;
  }
  if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
    showToast(`حجم الصورة أكبر من ${MAX_IMAGE_MB} ميجا، اختار صورة أصغر`, "error");
    return;
  }

  studentAnswers[qIndex].imageUploading = true;
  refreshOneQuestion(qIndex);

  try {
    const formData = new FormData();
    formData.append("image", file);

    const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
      method: "POST",
      body: formData
    });
    const result = await response.json();

    if (!result.success) throw new Error(result.error?.message || "فشل الرفع");

    studentAnswers[qIndex].imageUrl = result.data.url;
    showToast("تم رفع الصورة ✅", "success");
  } catch (error) {
    console.error("Answer image upload error:", error);
    showToast("تعذر رفع الصورة، حاول تاني", "error");
  } finally {
    studentAnswers[qIndex].imageUploading = false;
    refreshOneQuestion(qIndex);
    updateAnsweredCount();
  }
}

// ------- هل السؤال ده متجاوب عليه؟ -------
function isAnswered(qIndex) {
  const answer = studentAnswers[qIndex];
  if (examData.questions[qIndex].type === "essay") {
    return Boolean(answer.textAnswer.trim() || answer.imageUrl);
  }
  return answer.selectedIndex !== null;
}

// ------- هل لسه فيه صور بترفع؟ -------
function hasPendingUploads() {
  return studentAnswers.some((a) => a.imageUploading);
}

function updateAnsweredCount() {
  const answered = examData.questions.filter((_, i) => isAnswered(i)).length;
  answeredCount.textContent = answered;
}

// ============================================
// العدّاد
// ============================================

function tickTimer() {
  timeRemaining--;
  updateTimerDisplay();

  // تحذير أخير عند 60 ثانية
  if (timeRemaining === 60) {
    examTimer.classList.add("warning");
  }

  if (timeRemaining <= 0) {
    clearInterval(timerInterval);
    onTimeExpired();
  }
}

function updateTimerDisplay() {
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  timerDisplay.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function onTimeExpired() {
  hasTimeExpired = true;
  timerDisplay.textContent = "00:00";

  // نعطّل كل خانات الإجابة: اختيارات + الكتابة المقالية + رفع الصور
  questionsList.querySelectorAll("input[type='radio'], textarea, input[type='file']")
    .forEach((el) => { el.disabled = true; });
  questionsList.querySelectorAll(".essay-upload-btn")
    .forEach((el) => el.classList.add("disabled"));
  questionsList.querySelectorAll(".essay-remove-image")
    .forEach((el) => { el.disabled = true; });

  // نظهر مودال "الوقت خلص"
  timeUpModal.classList.remove("hidden");
}

timeUpSubmitBtn.addEventListener("click", () => {
  timeUpModal.classList.add("hidden");
  submitExam();
});

// ============================================
// التسليم
// ============================================

submitBtn.addEventListener("click", requestSubmit);
submitBtnBottom.addEventListener("click", requestSubmit);

function requestSubmit() {
  if (isSubmitting) return;

  // لو لسه فيه صورة بترفع، نستنى عشان ماتضيعش من الإجابة
  if (hasPendingUploads()) {
    showToast("استنى رفع الصورة يخلص الأول", "error");
    return;
  }

  const unanswered = examData.questions.filter((_, i) => !isAnswered(i)).length;
  if (unanswered > 0 && !hasTimeExpired) {
    confirmSubmitMessage.textContent =
      `لسه فيه ${unanswered} سؤال من غير إجابة. هيتم اعتبارهم غلط. متأكد إنك عايز تسلّم؟`;
  } else {
    confirmSubmitMessage.textContent =
      "هتسلّم الامتحان دلوقتي، مش هتقدر تعدّل بعد كده. متأكد؟";
  }
  confirmSubmitModal.classList.remove("hidden");
}

cancelSubmitBtn.addEventListener("click", () => confirmSubmitModal.classList.add("hidden"));

finalSubmitBtn.addEventListener("click", async () => {
  confirmSubmitModal.classList.add("hidden");
  await submitExam();
});

async function submitExam() {
  if (isSubmitting) return;
  isSubmitting = true;

  submitBtn.disabled = true;
  submitBtnBottom.disabled = true;
  submitBtn.textContent = "جاري التسليم...";

  try {
    if (timerInterval) clearInterval(timerInterval);
    window.removeEventListener("beforeunload", beforeUnloadHandler);

    const totalTimeSpent = Math.floor((Date.now() - examStartTime) / 1000);

    // نبني الإجابات — شكل مختلف حسب نوع السؤال
    const answers = studentAnswers.map((ans, i) => {
      if (examData.questions[i].type === "essay") {
        return {
          questionIndex: i,
          type: "essay",
          textAnswer: ans.textAnswer.trim() || null,
          imageUrl: ans.imageUrl || null
        };
      }
      return {
        questionIndex: i,
        type: "mcq",
        selectedIndex: ans.selectedIndex   // null لو ما جاوبش
      };
    });

    // فيه أسئلة مقالية؟ (بيحدد إذا كان الامتحان محتاج مراجعة المدرس بعد التصحيح التلقائي)
    const hasEssayQuestions = examData.questions.some((q) => q.type === "essay");

    // نحفظ الحل في submissions (status: queued — التصحيح بيحصل في results.js)
    await addDoc(collection(db, "submissions"), {
      examId,
      studentId: currentStudentId,
      studentName: currentStudentName,
      teacherId: examData.teacherId,
      answers,
      hasEssayQuestions,
      totalTimeSpent,
      status: "queued",
      submittedAt: new Date().toISOString()
    });

    // نروح لصفحة النتيجة
    window.location.href = `results.html?examId=${examId}`;

  } catch (error) {
    console.error("Submit error:", error);
    showToast("حصلت مشكلة في التسليم، حاول تاني", "error");
    isSubmitting = false;
    submitBtn.disabled = false;
    submitBtnBottom.disabled = false;
    submitBtn.textContent = "تسليم ✓";
  }
}