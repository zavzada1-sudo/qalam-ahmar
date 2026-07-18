// ============================================
// Results Logic - عرض نتيجة الامتحان + التصحيح التلقائي
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, query, where, getDocs, limit }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// ------- عناصر الصفحة -------
const gradingView = document.getElementById("gradingView");
const errorView = document.getElementById("errorView");
const resultsView = document.getElementById("resultsView");
const errorTitle = document.getElementById("errorTitle");
const errorMessage = document.getElementById("errorMessage");

const examTitle = document.getElementById("examTitle");
const scoreValue = document.getElementById("scoreValue");
const scoreTotal = document.getElementById("scoreTotal");
const scorePercentage = document.getElementById("scorePercentage");
const scoreVerdict = document.getElementById("scoreVerdict");
const scoreCircle = document.getElementById("scoreCircle");

const correctCount = document.getElementById("correctCount");
const wrongCount = document.getElementById("wrongCount");
const unansweredCount = document.getElementById("unansweredCount");
const timeSpent = document.getElementById("timeSpent");
const reviewList = document.getElementById("reviewList");

// ------- الحالة -------
let currentStudentId = null;
let examId = null;

const ARABIC_LABELS = ["أ", "ب", "ج", "د", "هـ", "و"];
const ENGLISH_LABELS = ["A", "B", "C", "D", "E", "F"];

// ------- تنضيف النصوص -------
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function showError(title, message) {
  gradingView.classList.add("hidden");
  resultsView.classList.add("hidden");
  errorView.classList.remove("hidden");
  errorTitle.textContent = title;
  errorMessage.textContent = message;
}

// ============================================
// حماية + تحميل
// ============================================

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "../index.html"; return; }

  const params = new URLSearchParams(window.location.search);
  examId = params.get("examId");
  if (!examId) {
    showError("رابط غير صحيح", "مفيش امتحان محدد في الرابط");
    return;
  }

  try {
    // نتأكد إنه طالب
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists() || userDoc.data().role !== "student") {
      showError("غير مسموح", "الصفحة دي للطلاب فقط");
      return;
    }
    currentStudentId = user.uid;

    // نجيب الـ submission بتاعت الطالب في الامتحان ده
    const subQuery = query(
      collection(db, "submissions"),
      where("examId", "==", examId),
      where("studentId", "==", currentStudentId),
      limit(1)
    );
    const subSnap = await getDocs(subQuery);
    if (subSnap.empty) {
      showError("مفيش تسليم", "لسه ما سلّمتش الامتحان ده");
      return;
    }

    const submissionDoc = subSnap.docs[0];
    let submission = submissionDoc.data();
    const submissionId = submissionDoc.id;

    // نجيب الامتحان (بما فيه الإجابات الصحيحة عشان نصحح)
    const examSnap = await getDoc(doc(db, "exams", examId));
    if (!examSnap.exists()) {
      showError("الامتحان غير موجود", "اتحذف الامتحان");
      return;
    }
    const exam = examSnap.data();

    // لو لسه queued، نصححها ونحفظها
    if (submission.status === "queued") {
      const graded = gradeSubmission(exam, submission);
      await updateDoc(doc(db, "submissions", submissionId), {
        status: "graded",
        score: graded.score,
        totalPoints: graded.totalPoints,
        percentage: graded.percentage,
        correctCount: graded.correctCount,
        wrongCount: graded.wrongCount,
        unansweredCount: graded.unansweredCount,
        gradedAt: new Date().toISOString(),
        // ملاحظة: مش بنحفظ الإجابات الصحيحة نفسها في الـ submission
        // عشان لو المدرس عدّل الامتحان مش نحفظ نسخة قديمة، بنقارن دايمًا مع الأصل
      });
      submission = { ...submission, ...graded, status: "graded" };
    }

    // نعرض النتيجة
    renderResults(exam, submission);

  } catch (error) {
    console.error("Load results error:", error);
    showError("حصلت مشكلة", "تعذر تحميل النتيجة، حاول تحديث الصفحة");
  }
});

// ============================================
// التصحيح
// ============================================

function gradeSubmission(exam, submission) {
  const questions = exam.questions || [];
  const answers = submission.answers || [];

  let score = 0;
  let totalPoints = 0;
  let correct = 0;
  let wrong = 0;
  let unanswered = 0;

  questions.forEach((q, i) => {
    const points = Number(q.points) || 0;
    totalPoints += points;

    const studentAnswer = answers[i]?.selectedIndex;

    if (studentAnswer === null || studentAnswer === undefined) {
      unanswered++;
    } else if (studentAnswer === q.correctAnswerIndex) {
      correct++;
      score += points;
    } else {
      wrong++;
    }
  });

  const percentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;

  return { score, totalPoints, percentage, correctCount: correct, wrongCount: wrong, unansweredCount: unanswered };
}

// ============================================
// عرض النتيجة
// ============================================

function getOptionLabel(style, index) {
  if (style === "arabic") return ARABIC_LABELS[index] || (index + 1);
  if (style === "english") return ENGLISH_LABELS[index] || (index + 1);
  return String(index + 1);
}

function getVerdict(percentage) {
  if (percentage >= 90) return { text: "ممتاز 🌟", color: "#27ae60" };
  if (percentage >= 75) return { text: "جيد جدًا 👍", color: "#2ecc71" };
  if (percentage >= 60) return { text: "جيد", color: "#f39c12" };
  if (percentage >= 50) return { text: "مقبول", color: "#e67e22" };
  return { text: "محتاج تراجع 📚", color: "#c0392b" };
}

function formatTime(seconds) {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs} ثانية`;
  return `${mins} دقيقة ${secs > 0 ? `و ${secs} ثانية` : ""}`;
}

function renderResults(exam, submission) {
  examTitle.textContent = exam.title;
  scoreValue.textContent = submission.score;
  scoreTotal.textContent = submission.totalPoints;
  scorePercentage.textContent = `${submission.percentage}%`;

  const verdict = getVerdict(submission.percentage);
  scoreVerdict.textContent = verdict.text;
  scoreVerdict.style.color = verdict.color;
  scoreCircle.style.borderColor = verdict.color;

  correctCount.textContent = submission.correctCount;
  wrongCount.textContent = submission.wrongCount;
  unansweredCount.textContent = submission.unansweredCount;
  timeSpent.textContent = formatTime(submission.totalTimeSpent);

  // مراجعة كل سؤال
  const labelStyle = exam.labelStyle || "arabic";
  const questions = exam.questions || [];
  const answers = submission.answers || [];

  reviewList.innerHTML = "";
  questions.forEach((q, i) => {
    const studentAnswer = answers[i]?.selectedIndex;
    const correctIndex = q.correctAnswerIndex;
    const isUnanswered = studentAnswer === null || studentAnswer === undefined;
    const isCorrect = !isUnanswered && studentAnswer === correctIndex;

    const statusClass = isCorrect ? "correct" : (isUnanswered ? "unanswered" : "wrong");
    const statusLabel = isCorrect ? "✅ صح" : (isUnanswered ? "➖ مش متجاوب" : "❌ غلط");

    const card = document.createElement("div");
    card.className = `review-card ${statusClass}`;
    card.innerHTML = `
      <div class="review-head">
        <span class="review-num">سؤال ${i + 1}</span>
        <span class="review-status">${statusLabel}</span>
      </div>
      <div class="review-question">${escapeHtml(q.questionText)}</div>
      ${q.imageUrl ? `<img class="review-image" src="${escapeHtml(q.imageUrl)}" alt="صورة">` : ""}

      <div class="review-options">
        ${q.options.map((opt, optIndex) => {
          let optClass = "review-option";
          if (optIndex === correctIndex) optClass += " correct";
          if (!isUnanswered && optIndex === studentAnswer && studentAnswer !== correctIndex) optClass += " wrong";
          if (!isUnanswered && optIndex === studentAnswer && studentAnswer === correctIndex) optClass += " picked-correct";

          return `
            <div class="${optClass}">
              <span class="review-option-label">${getOptionLabel(labelStyle, optIndex)}</span>
              <span class="review-option-text">${escapeHtml(opt)}</span>
              ${optIndex === correctIndex ? '<span class="review-mark">✓ الإجابة الصح</span>' : ""}
              ${!isUnanswered && optIndex === studentAnswer && studentAnswer !== correctIndex ? '<span class="review-mark wrong">إجابتك</span>' : ""}
            </div>
          `;
        }).join("")}
      </div>

      ${q.teacherComment && !isCorrect ? `
        <div class="review-comment">
          <strong>💬 تعليق المدرس:</strong> ${escapeHtml(q.teacherComment)}
        </div>
      ` : ""}

      ${q.resourceUrl && !isCorrect ? `
        <div class="review-resource">
          <a href="${escapeHtml(q.resourceUrl)}" target="_blank" rel="noopener noreferrer">📚 مصدر للمراجعة</a>
        </div>
      ` : ""}
    `;
    reviewList.appendChild(card);
  });

  gradingView.classList.add("hidden");
  resultsView.classList.remove("hidden");
}