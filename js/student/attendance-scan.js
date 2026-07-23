// ============================================
// Attendance Scan - صفحة الهبوط بعد سكان الـ QR
// ============================================
//
// الطالب بيوصل هنا من الرابط:
//   attendance-scan.html?t=<teacherId>&k=<attendanceToken>
//
// خطوات التحقق بالترتيب:
//  1. الطالب مسجّل دخول؟ (لو لأ → صفحة الدخول)
//  2. التوكن في الرابط بيطابق توكن المدرس الحالي؟ (يمنع الأكواد القديمة)
//  3. المدرس فاتح الحضور دلوقتي وبتاريخ النهاردة؟
//  4. الطالب في المجموعة المفتوحة؟
//     ← ده متفروض في Firestore Rules، فلو مش فيها الكتابة نفسها هتترفض.
//       إحنا بنمسك الرفض ونعرض رسالة مفهومة.
//  5. مسجّل قبل كده النهاردة؟
//
// الـ QR دايمًا بيسجّل "حاضر" — "متأخر" من المدرس بس.
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import "../shared/theme.js";
import "../shared/offline-banner.js";

// ------- عناصر الصفحة -------
const loadingEl     = document.getElementById("loadingState");
const resultEl      = document.getElementById("resultState");
const resultIcon    = document.getElementById("resultIcon");
const resultTitle   = document.getElementById("resultTitle");
const resultMessage = document.getElementById("resultMessage");
const resultDetails = document.getElementById("resultDetails");
const detailName    = document.getElementById("detailName");
const detailGroup   = document.getElementById("detailGroup");
const detailDate    = document.getElementById("detailDate");
const homeLink      = document.getElementById("homeLink");

// ------- قراءة الرابط -------
const params    = new URLSearchParams(window.location.search);
const teacherId = params.get("t");
const token     = params.get("k");

// ============================================
// البداية
// ============================================
onAuthStateChanged(auth, async (user) => {
  // ---- الرابط ناقص؟ ----
  if (!teacherId || !token) {
    showResult({
      type: "error",
      icon: "❌",
      title: "الكود مش صحيح",
      message: "الرابط ناقص أو مش مكتمل. جرّب تعمل سكان للكود تاني."
    });
    return;
  }

  // ---- مش مسجّل دخول؟ ----
  if (!user) {
    // نحفظ الرابط عشان نرجّعه هنا بعد الدخول
    try {
      localStorage.setItem("qalam_redirect_after_login", window.location.href);
    } catch (e) {
      console.warn("Cannot save redirect:", e);
    }

    showResult({
      type: "warn",
      icon: "🔒",
      title: "سجّل دخولك الأول",
      message: "لازم تسجّل دخول بحسابك عشان نعرف نسجّل حضورك.",
      buttonText: "تسجيل الدخول",
      buttonHref: "../index.html"
    });
    return;
  }

  try {
    await registerAttendance(user);
  } catch (error) {
    console.error("Scan attendance error:", error);

    // الرفض من الـ Rules معناه إن الطالب مش في المجموعة المفتوحة
    if (error.code === "permission-denied") {
      showResult({
        type: "error",
        icon: "🚫",
        title: "إنت مش في المجموعة دي",
        message:
          "الحضور المفتوح دلوقتي لمجموعة تانية غير مجموعتك. " +
          "كلّم المدرس عشان يسجّلك يدويًا بكودك."
      });
      return;
    }

    showResult({
      type: "error",
      icon: "⚠️",
      title: "حصلت مشكلة",
      message: "تعذر تسجيل حضورك. تأكد من الإنترنت وجرّب تاني."
    });
  }
});

// ============================================
// منطق التسجيل
// ============================================
async function registerAttendance(user) {
  // ---- 1. نقرا مستند المدرس ----
  // قاعدة users بتسمح للطالب يقرا مستندات المدرسين
  const teacherSnap = await getDoc(doc(db, "users", teacherId));

  if (!teacherSnap.exists() || teacherSnap.data().role !== "teacher") {
    showResult({
      type: "error",
      icon: "❌",
      title: "الكود مش صحيح",
      message: "الكود ده مش مربوط بمدرس. تأكد إنك عملت سكان للكود الصح."
    });
    return;
  }

  const teacher = teacherSnap.data();

  // ---- 2. التوكن بيطابق؟ ----
  if (!teacher.attendanceToken || teacher.attendanceToken !== token) {
    showResult({
      type: "error",
      icon: "🔄",
      title: "الكود ده قديم",
      message:
        "المدرس جدّد كود الحضور، فالكود اللي عملتله سكان بطل يشتغل. " +
        "اعمل سكان للكود الجديد المعلّق."
    });
    return;
  }

  // ---- 3. الحضور مفتوح دلوقتي؟ ----
  const active = teacher.activeAttendance;
  const today  = todayStr();

  if (!active || active.date !== today) {
    showResult({
      type: "warn",
      icon: "⏳",
      title: "الحضور مقفول دلوقتي",
      message:
        "المدرس لسه مافتحش الحضور، أو قفله خلاص. " +
        "استنى لحد ما يفتحه وجرّب تاني."
    });
    return;
  }

  // ---- 4. نقرا بيانات الطالب نفسه ----
  const studentSnap = await getDoc(doc(db, "users", user.uid));

  if (!studentSnap.exists()) {
    showResult({
      type: "error",
      icon: "⚠️",
      title: "الحساب غير مكتمل",
      message: "بيانات حسابك ناقصة. كلّم المدرس."
    });
    return;
  }

  const student = studentSnap.data();

  if (student.role !== "student") {
    showResult({
      type: "warn",
      icon: "👨‍🏫",
      title: "الصفحة دي للطلبة",
      message: "إنت داخل بحساب مش حساب طالب، فمش هينفع تسجّل حضور."
    });
    return;
  }

  // ---- 5. مسجّل قبل كده النهاردة؟ ----
  const recordId = `${active.groupId}_${today}_${user.uid}`;
  const existingSnap = await getDoc(doc(db, "attendance", recordId));

  if (existingSnap.exists()) {
    const existing = existingSnap.data();

    showResult({
      type: "success",
      icon: "✅",
      title: "حضورك مسجّل بالفعل",
      message:
        existing.status === "late"
          ? "إنت مسجّل النهاردة كـ (متأخر)."
          : "إنت سجّلت حضورك النهاردة قبل كده.",
      details: {
        name:  student.fullName || "—",
        group: active.groupName || "—",
        date:  formatArabicDate(today)
      }
    });
    return;
  }

  // ---- 6. نكتب السجل ----
  // لو الطالب مش في المجموعة، Firestore Rules هترفض الكتابة دي
  // وهنمسك الرفض في الـ catch برّه
  await setDoc(doc(db, "attendance", recordId), {
    teacherId:       teacherId,
    gradeId:         active.gradeId || "",
    groupId:         active.groupId,
    groupName:       active.groupName || "",
    date:            today,
    studentUid:      user.uid,
    studentName:     student.fullName || "",
    studentCode:     student.studentId || "",
    status:          "present",   // الـ QR دايمًا حاضر
    method:          "qr",
    fromOtherGroup:  false,
    otherGroupNames: [],
    recordedAt:      serverTimestamp()
  });

  showResult({
    type: "success",
    icon: "🎉",
    title: "تم تسجيل حضورك",
    message: "حضورك اتسجّل بنجاح. يوم موفق!",
    details: {
      name:  student.fullName || "—",
      group: active.groupName || "—",
      date:  formatArabicDate(today)
    }
  });
}

// ============================================
// عرض النتيجة
// ============================================
function showResult({ type, icon, title, message, details, buttonText, buttonHref }) {
  loadingEl.classList.add("hidden");
  resultEl.classList.remove("hidden");

  resultIcon.textContent    = icon;
  resultTitle.textContent   = title;
  resultTitle.className     = `scan-title ${type}`;
  resultMessage.textContent = message;

  if (details) {
    detailName.textContent  = details.name;
    detailGroup.textContent = details.group;
    detailDate.textContent  = details.date;
    resultDetails.classList.remove("hidden");
  }

  if (buttonText) homeLink.textContent = buttonText;
  if (buttonHref) homeLink.href = buttonHref;
}

// ============================================
// دوال مساعدة
// ============================================

// تاريخ النهاردة YYYY-MM-DD بالتوقيت المحلي
function todayStr() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

// عرض التاريخ بشكل مقروء بالعربي
function formatArabicDate(dateStr) {
  try {
    const date = new Date(`${dateStr}T00:00:00`);
    return date.toLocaleDateString("ar-EG", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  } catch (e) {
    return dateStr;
  }
}