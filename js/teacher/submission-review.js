// ============================================
// Submission Review Logic - مراجعة تسليم طالب واحد + تصحيح المقالي يدويًا
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, query, where, getDocs }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { showToast } from "../shared/ui.js";

import "../shared/theme.js";
import "../shared/offline-banner.js";

// ------- قراءة الرابط: submission-review.html?examId=xxx&studentId=yyy -------
const urlParams = new URLSearchParams(window.location.search);
const examId = urlParams.get("examId");
let studentId = urlParams.get("studentId");

// ------- عناصر الصفحة -------
const loadingEl = document.getElementById("loadingState");
const errorEl = document.getElementById("errorState");
const errorTextEl = document.getElementById("errorText");
const contentEl = document.getElementById("contentWrapper");

const backToGradesLink = document.getElementById("backToGradesLink");
const studentNameEl = document.getElementById("studentName");
const studentMetaEl = document.getElementById("studentMeta");
const statusBadgeEl = document.getElementById("statusBadge");

const summaryMcqEl = document.getElementById("summaryMcq");
const summaryEssayEl = document.getElementById("summaryEssay");
const summaryTotalEl = document.getElementById("summaryTotal");
const summaryPercentageEl = document.getElementById("summaryPercentage");

const answersListEl = document.getElementById("answersList");

const saveBtn = document.getElementById("saveBtn");
const prevStudentBtn = document.getElementById("prevStudentBtn");
const nextStudentBtn = document.getElementById("nextStudentBtn");
const navPositionEl = document.getElementById("navPosition");

// ------- الحالة -------
let currentTeacherId = null;
let exam = null;
let submission = null;
let submissionId = null;
let allSubmissions = [];   // كل تسليمات الامتحان (مرتبة) — للتنقل بين الطلاب
let essayGrades = [];      // الدرجات اللي المدرس بيحطها دلوقتي
let hasUnsavedChanges = false;
let isSaving = false;

const ARABIC_LABELS = ["أ", "ب", "ج", "د", "هـ", "و"];
const ENGLISH_LABELS = ["A", "B", "C", "D", "E", "F"];

// ------- لو الرابط ناقص -------
if (!examId || !studentId) {
  window.location.href = "teacher-dashboard.html";
}

// ------- تنضيف النصوص لمنع XSS -------
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function showError(message) {
  loadingEl.classList.add("hidden");
  contentEl.classList.add("hidden");
  errorEl.classList.remove("hidden");
  errorTextEl.textContent = message;
}

function showContent() {
  loadingEl.classList.add("hidden");
  errorEl.classList.add("hidden");
  contentEl.classList.remove("hidden");
}

// ============================================
// حماية الصفحة + التحميل
// ============================================

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "../index.html"; return; }

  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists() || userDoc.data().role !== "teacher") {
      window.location.href = "../index.html";
      return;
    }
    currentTeacherId = user.uid;

    backToGradesLink.href = `grades.html?examId=${encodeURIComponent(examId)}`;
    await loadData();

  } catch (error) {
    console.error("[submission-review] auth error:", error.code, error.message);
    showError("حصلت مشكلة في التحقق من حسابك، حاول تحديث الصفحة");
  }
});

async function loadData() {
  // ---- 1. الامتحان ----
  try {
    const examDoc = await getDoc(doc(db, "exams", examId));
    if (!examDoc.exists()) {
      showError("الامتحان ده مش موجود أو اتمسح");
      return;
    }
    exam = examDoc.data();

    if (exam.teacherId !== currentTeacherId) {
      showError("مش من صلاحيتك تشوف الامتحان ده");
      return;
    }
  } catch (error) {
    console.error("[submission-review] فشل في قراءة exams:", error.code, error.message);
    showError("تعذر تحميل بيانات الامتحان، حاول تحديث الصفحة");
    return;
  }

  // ---- 2. كل تسليمات الامتحان (للتنقل بين الطلاب) ----
  // ملحوظة: getDocs مش onSnapshot عمدًا — المدرس بيصحح دلوقتي،
  // ومش عايزين البيانات تتغير تحت إيده وهو بيكتب درجة.
  try {
    const subsSnap = await getDocs(query(
      collection(db, "submissions"),
      where("examId", "==", examId),
      where("teacherId", "==", currentTeacherId)
    ));

    allSubmissions = subsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // ترتيب أبجدي ثابت عشان "التالي/السابق" يبقى متوقع
    allSubmissions.sort((a, b) =>
      String(a.studentName || "").localeCompare(String(b.studentName || ""), "ar"));

  } catch (error) {
    console.error("[submission-review] فشل في قراءة submissions:", error.code, error.message);
    showError("تعذر تحميل التسليمات، حاول تحديث الصفحة");
    return;
  }

  // ---- 3. تسليم الطالب المطلوب ----
  const found = allSubmissions.find((s) => s.studentId === studentId);
  if (!found) {
    showError("الطالب ده لسه ما سلّمش الامتحان");
    return;
  }

  submission = found;
  submissionId = found.id;

  // ---- 4. تجهيز درجات المقالي ----
  // لو المدرس صحّح قبل كده، بنحمّل درجاته. لو لأ، بنبدأ فاضي.
  essayGrades = Array.isArray(submission.essayGrades)
    ? JSON.parse(JSON.stringify(submission.essayGrades))
    : [];

  hasUnsavedChanges = false;

  renderAll();
  showContent();
}

// ============================================
// حساب درجة الجزء الاختياري
// ============================================
// لو التصحيح التلقائي اتسجّل قبل كده بنستخدمه زي ما هو.
// لو الطالب سلّم وما فتحش صفحة النتيجة (status لسه queued)، بنحسبه هنا
// عشان المدرس يقدر يراجع من غير ما يستنى الطالب.
function getMcqResult() {
  if (typeof submission.mcqScore === "number" && typeof submission.mcqTotalPoints === "number") {
    return { mcqScore: submission.mcqScore, mcqTotalPoints: submission.mcqTotalPoints };
  }

  const questions = exam.questions || [];
  const answers = submission.answers || [];
  let mcqScore = 0;
  let mcqTotalPoints = 0;

  questions.forEach((q, i) => {
    if (q.type === "essay") return;
    mcqTotalPoints += Number(q.points) || 0;
    const picked = answers[i]?.selectedIndex;
    if (picked !== null && picked !== undefined && picked === q.correctAnswerIndex) {
      mcqScore += Number(q.points) || 0;
    }
  });

  return { mcqScore, mcqTotalPoints };
}

// ------- درجة سؤال مقالي معيّن (اللي المدرس حاططها دلوقتي) -------
function getEssayGrade(questionIndex) {
  return essayGrades.find((g) => g.questionIndex === questionIndex) || null;
}

// ------- مجموع درجات المقالي -------
function getEssayScore() {
  return essayGrades.reduce((sum, g) => sum + (Number(g.score) || 0), 0);
}

// ------- فهارس كل الأسئلة المقالية -------
function getEssayIndexes() {
  return (exam.questions || [])
    .map((q, i) => (q.type === "essay" ? i : -1))
    .filter((i) => i !== -1);
}

// ------- هل كل المقالي اتصحح؟ -------
function areAllEssaysGraded() {
  return getEssayIndexes().every((i) => {
    const g = getEssayGrade(i);
    return g && typeof g.score === "number";
  });
}

// ============================================
// العرض
// ============================================

function renderAll() {
  renderHeader();
  renderSummary();
  renderAnswers();
  renderNavigation();
}

function renderHeader() {
  studentNameEl.textContent = submission.studentName || "طالب";
  studentMetaEl.textContent = [
    exam.title || "بدون عنوان",
    submission.submittedAt ? `سلّم في ${formatDate(submission.submittedAt)}` : "",
    submission.totalTimeSpent ? `استغرق ${formatDuration(submission.totalTimeSpent)}` : ""
  ].filter(Boolean).join(" · ");

  const allGraded = areAllEssaysGraded();
  if (getEssayIndexes().length === 0) {
    statusBadgeEl.className = "grade-badge graded";
    statusBadgeEl.textContent = "تم التصحيح";
  } else if (allGraded) {
    statusBadgeEl.className = "grade-badge graded";
    statusBadgeEl.textContent = "تم التصحيح بالكامل";
  } else {
    statusBadgeEl.className = "grade-badge pending";
    statusBadgeEl.textContent = "محتاج مراجعة";
  }
}

function renderSummary() {
  const { mcqScore, mcqTotalPoints } = getMcqResult();
  const essayScore = getEssayScore();
  const totalPoints = Number(exam.totalPoints) || 0;
  const totalScore = mcqScore + essayScore;
  const percentage = totalPoints > 0 ? Math.round((totalScore / totalPoints) * 100) : 0;

  summaryMcqEl.textContent = `${mcqScore}/${mcqTotalPoints}`;
  summaryEssayEl.textContent = `${essayScore}/${totalPoints - mcqTotalPoints}`;
  summaryTotalEl.textContent = `${totalScore}/${totalPoints}`;
  summaryPercentageEl.textContent = `${percentage}%`;
}

function getOptionLabel(index) {
  const style = exam.labelStyle || "arabic";
  if (style === "arabic") return ARABIC_LABELS[index] || (index + 1);
  if (style === "english") return ENGLISH_LABELS[index] || (index + 1);
  return String(index + 1);
}

function renderAnswers() {
  answersListEl.innerHTML = "";
  const questions = exam.questions || [];
  const answers = submission.answers || [];

  questions.forEach((q, i) => {
    const card = q.type === "essay"
      ? buildEssayCard(q, answers[i], i)
      : buildMcqCard(q, answers[i], i);
    answersListEl.appendChild(card);
  });
}

// ------- كارت سؤال اختياري (للعرض فقط، متصحّح تلقائيًا) -------
function buildMcqCard(q, answer, i) {
  const picked = answer?.selectedIndex;
  const correctIndex = q.correctAnswerIndex;
  const isUnanswered = picked === null || picked === undefined;
  const isCorrect = !isUnanswered && picked === correctIndex;

  const statusClass = isCorrect ? "correct" : (isUnanswered ? "unanswered" : "wrong");
  const statusLabel = isCorrect
    ? `✅ صح (${q.points})`
    : (isUnanswered ? "➖ مش متجاوب (0)" : "❌ غلط (0)");

  const card = document.createElement("div");
  card.className = `review-card ${statusClass}`;
  card.innerHTML = `
    <div class="review-head">
      <span class="review-num">سؤال ${i + 1}</span>
      <span class="review-status">${statusLabel}</span>
    </div>
    <div class="review-question">${escapeHtml(q.questionText)}</div>
    ${q.imageUrl ? `<img class="review-image" src="${escapeHtml(q.imageUrl)}" alt="صورة السؤال">` : ""}

    <div class="review-options">
      ${(q.options || []).map((opt, optIndex) => {
        let optClass = "review-option";
        if (optIndex === correctIndex) optClass += " correct";
        if (!isUnanswered && optIndex === picked && picked !== correctIndex) optClass += " wrong";
        if (!isUnanswered && optIndex === picked && picked === correctIndex) optClass += " picked-correct";

        return `
          <div class="${optClass}">
            <span class="review-option-label">${getOptionLabel(optIndex)}</span>
            <span class="review-option-text">${escapeHtml(opt)}</span>
            ${optIndex === correctIndex ? '<span class="review-mark">✓ الإجابة الصح</span>' : ""}
            ${!isUnanswered && optIndex === picked && picked !== correctIndex ? '<span class="review-mark wrong">إجابة الطالب</span>' : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
  return card;
}

// ------- كارت سؤال مقالي (قابل للتصحيح) -------
function buildEssayCard(q, answer, i) {
  const grade = getEssayGrade(i);
  const hasText = Boolean(answer?.textAnswer);
  const hasImage = Boolean(answer?.imageUrl);
  const isUnanswered = !hasText && !hasImage;
  const maxPoints = Number(q.points) || 0;

  const card = document.createElement("div");
  card.className = `review-card ${grade && typeof grade.score === "number" ? "graded-essay" : "pending"}`;
  card.dataset.qindex = i;

  card.innerHTML = `
    <div class="review-head">
      <span class="review-num">سؤال ${i + 1} (مقالي) — من ${maxPoints} درجة</span>
      <span class="review-status">${grade && typeof grade.score === "number" ? `✔ اتصحح (${grade.score})` : "⏳ محتاج تصحيح"}</span>
    </div>

    <div class="review-question">${escapeHtml(q.questionText)}</div>
    ${q.imageUrl ? `<img class="review-image" src="${escapeHtml(q.imageUrl)}" alt="صورة السؤال">` : ""}

    ${q.modelAnswer ? `
      <div class="sr-model-answer">
        <strong>📋 الإجابة النموذجية:</strong>
        <div>${escapeHtml(q.modelAnswer)}</div>
      </div>
    ` : ""}

    <div class="sr-student-answer-label">إجابة الطالب:</div>
    ${hasText ? `<div class="review-essay-answer">${escapeHtml(answer.textAnswer)}</div>` : ""}
    ${hasImage ? `<img class="sr-answer-image" src="${escapeHtml(answer.imageUrl)}" alt="صورة إجابة الطالب">` : ""}
    ${isUnanswered ? `<div class="review-essay-answer">لم يجب الطالب على هذا السؤال</div>` : ""}

    <div class="sr-grading-box">
      <div class="sr-grading-row">
        <label for="score-${i}">الدرجة (من ${maxPoints})</label>
        <input type="number" id="score-${i}" class="sr-score-input"
               min="0" max="${maxPoints}" step="0.5"
               value="${grade && typeof grade.score === "number" ? grade.score : ""}"
               placeholder="0">
        <button type="button" class="btn btn-outline sr-full-mark-btn">الدرجة كاملة</button>
        <button type="button" class="btn btn-outline sr-zero-mark-btn">صفر</button>
      </div>

      <div class="sr-grading-row sr-feedback-row">
        <label for="feedback-${i}">ملاحظة للطالب (اختياري)</label>
        <textarea id="feedback-${i}" class="sr-feedback-input" rows="2"
          placeholder="مثال: إجابة كويسة بس ناقصها ذكر السبب">${escapeHtml(grade?.feedback || "")}</textarea>
      </div>
    </div>
  `;

  attachEssayCardEvents(card, i, maxPoints);
  return card;
}

function attachEssayCardEvents(card, qIndex, maxPoints) {
  const scoreInput = card.querySelector(".sr-score-input");
  const feedbackInput = card.querySelector(".sr-feedback-input");

  scoreInput.addEventListener("input", () => {
    const raw = scoreInput.value.trim();

    if (raw === "") {
      removeEssayGrade(qIndex);
    } else {
      let value = Number(raw);
      if (isNaN(value)) return;
      // نمنع درجة أكبر من درجة السؤال أو أقل من صفر
      if (value > maxPoints) { value = maxPoints; scoreInput.value = maxPoints; }
      if (value < 0) { value = 0; scoreInput.value = 0; }
      setEssayGrade(qIndex, value, feedbackInput.value);
    }

    markUnsaved();
    renderSummary();
    renderHeader();
  });

  feedbackInput.addEventListener("input", () => {
    const existing = getEssayGrade(qIndex);
    // الملاحظة لوحدها من غير درجة مش بتتحفظ — لازم درجة الأول
    if (existing) {
      existing.feedback = feedbackInput.value.trim() || null;
      markUnsaved();
    }
  });

  card.querySelector(".sr-full-mark-btn").addEventListener("click", () => {
    scoreInput.value = maxPoints;
    setEssayGrade(qIndex, maxPoints, feedbackInput.value);
    markUnsaved();
    renderSummary();
    renderHeader();
    refreshEssayCardStatus(card, qIndex);
  });

  card.querySelector(".sr-zero-mark-btn").addEventListener("click", () => {
    scoreInput.value = 0;
    setEssayGrade(qIndex, 0, feedbackInput.value);
    markUnsaved();
    renderSummary();
    renderHeader();
    refreshEssayCardStatus(card, qIndex);
  });
}

// تحديث شارة حالة الكارت من غير إعادة رسم الكارت كله
// (عشان منضيّعش اللي المدرس كاتبه في خانة الملاحظة)
function refreshEssayCardStatus(card, qIndex) {
  const grade = getEssayGrade(qIndex);
  const statusEl = card.querySelector(".review-status");
  const isGraded = grade && typeof grade.score === "number";

  statusEl.textContent = isGraded ? `✔ اتصحح (${grade.score})` : "⏳ محتاج تصحيح";
  card.classList.toggle("graded-essay", Boolean(isGraded));
  card.classList.toggle("pending", !isGraded);
}

function setEssayGrade(questionIndex, score, feedback) {
  const existing = getEssayGrade(questionIndex);
  if (existing) {
    existing.score = score;
    existing.feedback = (feedback || "").trim() || null;
    existing.gradedBy = "teacher";
  } else {
    essayGrades.push({
      questionIndex,
      score,
      feedback: (feedback || "").trim() || null,
      gradedBy: "teacher"
    });
  }
}

function removeEssayGrade(questionIndex) {
  essayGrades = essayGrades.filter((g) => g.questionIndex !== questionIndex);
}

// ============================================
// التنقل بين الطلاب
// ============================================

function getCurrentIndex() {
  return allSubmissions.findIndex((s) => s.studentId === studentId);
}

function renderNavigation() {
  const index = getCurrentIndex();
  navPositionEl.textContent = `الطالب ${index + 1} من ${allSubmissions.length}`;
  prevStudentBtn.disabled = index <= 0;
  nextStudentBtn.disabled = index >= allSubmissions.length - 1;
}

async function goToStudent(offset) {
  const index = getCurrentIndex() + offset;
  if (index < 0 || index >= allSubmissions.length) return;

  if (hasUnsavedChanges) {
    const proceed = window.confirm("فيه تعديلات لسه ما اتحفظتش. متأكد إنك عايز تنتقل من غير حفظ؟");
    if (!proceed) return;
  }

  studentId = allSubmissions[index].studentId;

  // نحدّث الرابط من غير إعادة تحميل الصفحة
  const newUrl = `${window.location.pathname}?examId=${encodeURIComponent(examId)}&studentId=${encodeURIComponent(studentId)}`;
  window.history.replaceState({}, "", newUrl);

  submission = allSubmissions[index];
  submissionId = submission.id;
  essayGrades = Array.isArray(submission.essayGrades)
    ? JSON.parse(JSON.stringify(submission.essayGrades))
    : [];
  hasUnsavedChanges = false;

  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

prevStudentBtn.addEventListener("click", () => goToStudent(-1));
nextStudentBtn.addEventListener("click", () => goToStudent(1));

// ============================================
// الحفظ
// ============================================

function markUnsaved() {
  hasUnsavedChanges = true;
  saveBtn.textContent = "💾 حفظ التصحيح *";
}

saveBtn.addEventListener("click", saveGrading);

async function saveGrading() {
  if (isSaving) return;
  isSaving = true;
  saveBtn.disabled = true;
  saveBtn.textContent = "جاري الحفظ...";

  try {
    const { mcqScore, mcqTotalPoints } = getMcqResult();
    const essayScore = getEssayScore();
    const totalPoints = Number(exam.totalPoints) || 0;
    const totalScore = mcqScore + essayScore;
    const percentage = totalPoints > 0 ? Math.round((totalScore / totalPoints) * 100) : 0;

    // لو كل المقالي اتصحح، الحالة تبقى نهائية. لو لسه، تفضل محتاجة مراجعة.
    const allGraded = areAllEssaysGraded();

    const updateData = {
      essayGrades,
      mcqScore,
      mcqTotalPoints,
      score: totalScore,
      totalPoints,
      percentage,
      status: allGraded ? "graded" : "pending_review",
      reviewedAt: new Date().toISOString()
    };

    await updateDoc(doc(db, "submissions", submissionId), updateData);

    // نحدّث النسخة المحلية عشان التنقل بين الطلاب يفضل متسق
    Object.assign(submission, updateData);
    const inList = allSubmissions.find((s) => s.id === submissionId);
    if (inList) Object.assign(inList, updateData);

    hasUnsavedChanges = false;
    showToast(allGraded ? "تم حفظ التصحيح بالكامل ✅" : "تم حفظ التصحيح (لسه فيه أسئلة محتاجة مراجعة)", "success");
    renderHeader();

  } catch (error) {
    console.error("[submission-review] فشل الحفظ:", error.code, error.message);
    showToast("تعذر حفظ التصحيح، حاول تاني", "error");
  } finally {
    isSaving = false;
    saveBtn.disabled = false;
    saveBtn.textContent = "💾 حفظ التصحيح";
  }
}

// تحذير لو المدرس حاول يقفل الصفحة وفيه تعديلات ما اتحفظتش
window.addEventListener("beforeunload", (e) => {
  if (!hasUnsavedChanges) return;
  e.preventDefault();
  e.returnValue = "";
});

// ============================================
// دوال مساعدة
// ============================================

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(isoString) {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ar-EG", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}