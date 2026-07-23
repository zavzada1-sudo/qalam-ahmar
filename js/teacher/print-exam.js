// ============================================
// Print Exam Logic - طباعة الامتحان
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import "../shared/theme.js";
import "../shared/offline-banner.js";

const loadingView = document.getElementById("loadingView");
const errorView = document.getElementById("errorView");
const printView = document.getElementById("printView");
const errorTitle = document.getElementById("errorTitle");
const errorMessage = document.getElementById("errorMessage");

const printExamTitle = document.getElementById("printExamTitle");
const printExamMeta = document.getElementById("printExamMeta");
const qrCodeContainer = document.getElementById("qrCodeContainer");
const printQuestionsList = document.getElementById("printQuestionsList");
const answerKeyList = document.getElementById("answerKeyList");
const printBtn = document.getElementById("printBtn");

const ARABIC_LABELS = ["أ", "ب", "ج", "د", "هـ", "و"];
const ENGLISH_LABELS = ["A", "B", "C", "D", "E", "F"];

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function showError(title, message) {
  loadingView.classList.add("hidden");
  errorView.classList.remove("hidden");
  errorTitle.textContent = title;
  errorMessage.textContent = message;
}

function getOptionLabel(style, index) {
  if (style === "arabic") return ARABIC_LABELS[index] || (index + 1);
  if (style === "english") return ENGLISH_LABELS[index] || (index + 1);
  return String(index + 1);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "../index.html"; return; }

  const params = new URLSearchParams(window.location.search);
  const examId = params.get("examId");
  if (!examId) {
    showError("رابط غير صحيح", "مفيش امتحان محدد في الرابط");
    return;
  }

  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists() || userDoc.data().role !== "teacher") {
      showError("غير مسموح", "الصفحة دي للمدرسين فقط");
      return;
    }

    const examSnap = await getDoc(doc(db, "exams", examId));
    if (!examSnap.exists()) {
      showError("غير موجود", "الامتحان ده مش موجود أو اتحذف");
      return;
    }
    const exam = examSnap.data();

    // مهم: نتأكد إن ده امتحان المدرس نفسه بس
    if (exam.teacherId !== user.uid) {
      showError("غير مصرح", "الامتحان ده مش بتاعك");
      return;
    }

    renderPrintPage(examId, exam);

  } catch (error) {
    console.error("Load print exam error:", error);
    showError("حصلت مشكلة", "تعذر تحميل الامتحان");
  }
});

function renderPrintPage(examId, exam) {
  printExamTitle.textContent = exam.title || "بدون عنوان";

  const metaParts = [];
  if (exam.totalPoints) metaParts.push(`${exam.totalPoints} درجة`);
  if (exam.timeLimit) metaParts.push(`${exam.timeLimit} دقيقة`);
  metaParts.push(`${(exam.questions || []).length} سؤال`);
  printExamMeta.textContent = metaParts.join(" · ");

  // توليد QR
  const examUrl = `${window.location.origin}/pages/student-exam.html?examId=${examId}`;
  new QRCode(qrCodeContainer, {
    text: examUrl,
    width: 130,
    height: 130,
    colorDark: "#2c3e50",
    colorLight: "#ffffff"
  });

  const labelStyle = exam.labelStyle || "arabic";
  const questions = exam.questions || [];

  printQuestionsList.innerHTML = "";
  answerKeyList.innerHTML = "";

  questions.forEach((q, i) => {
    const card = document.createElement("div");
    card.className = "print-question";
    card.innerHTML = `
      <div class="print-question-text">
        <strong>${i + 1}.</strong> ${escapeHtml(q.questionText)}
        ${q.points ? `<span class="print-points">(${q.points} درجة)</span>` : ""}
      </div>
      ${q.imageUrl ? `<img class="print-question-image" src="${escapeHtml(q.imageUrl)}" alt="صورة">` : ""}
      <div class="print-options">
        ${q.options.map((opt, optIndex) => `
          <span class="print-option">
            <span class="print-option-circle">${getOptionLabel(labelStyle, optIndex)}</span>
            ${escapeHtml(opt)}
          </span>
        `).join("")}
      </div>
    `;
    printQuestionsList.appendChild(card);

    const correctLabel = getOptionLabel(labelStyle, q.correctAnswerIndex);
    const keyItem = document.createElement("span");
    keyItem.className = "answer-key-item";
    keyItem.textContent = `${i + 1}: ${correctLabel}`;
    answerKeyList.appendChild(keyItem);
  });

  loadingView.classList.add("hidden");
  printView.classList.remove("hidden");
}

printBtn.addEventListener("click", () => window.print());