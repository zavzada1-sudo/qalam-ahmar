// ============================================
// Login Logic - تسجيل دخول موحّد (مدرس/طالب)
// ============================================

import { auth, db } from "../../firebase-config.js";
import { signInWithEmailAndPassword, sendPasswordResetEmail, signOut } 
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, updateDoc } 
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { reserveStudentCode, isValidCodeFormat } from "../shared/student-code.js";

const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const errorEl = document.getElementById("loginError");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");
const togglePasswordBtn = document.getElementById("togglePassword");

// ------- إظهار / إخفاء كلمة المرور -------
togglePasswordBtn.addEventListener("click", () => {
  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  togglePasswordBtn.textContent = isHidden ? "🙈" : "👁️";
});

// ------- دالة مساعدة لعرض الأخطاء -------
function showError(message, isSuccess = false) {
  errorEl.textContent = message;
  errorEl.style.color = isSuccess ? "green" : "#c0392b";
}

// ------- ترجمة أكواد أخطاء Firebase لرسائل مفهومة -------
function translateFirebaseError(code) {
  switch (code) {
    case "auth/invalid-email":
      return "صيغة البريد الإلكتروني غير صحيحة";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "البريد الإلكتروني أو كلمة المرور غير صحيحة";
    case "auth/too-many-requests":
      return "محاولات كتيرة غلط، حاول تاني بعد شوية";
    case "auth/user-disabled":
      return "هذا الحساب معطل، تواصل مع الدعم";
    default:
      return "حدث خطأ، حاول مرة أخرى";
  }
}

// ============================================
// تجهيز كود الطالب لو مش موجود
//
// بيشتغل للطلاب اللي اتسجّلوا قبل ما نضيف نظام الأكواد،
// أو اللي عندهم كود بالشكل القديم (زي STD1234).
//
// مهم: ده لازم يتم من حساب الطالب نفسه، لأن قاعدة users
// بتسمح للمستخدم يكتب في مستنده هو بس (المدرس مش مسموحله).
// ============================================
async function ensureStudentCodeOnLogin(uid, userData) {
  // عنده كود بالشكل الصح؟ مفيش حاجة نعملها
  if (isValidCodeFormat(userData.studentId)) return;

  try {
    const newCode = await reserveStudentCode(uid);
    await updateDoc(doc(db, "users", uid), { studentId: newCode });
  } catch (error) {
    // مش بنوقف تسجيل الدخول لو فشل التوليد —
    // الطالب يدخل عادي وهنحاول تاني المرة الجاية
    console.error("[login] تعذر توليد كود الطالب:", error.code, error.message);
  }
}

// ------- تسجيل الدخول -------
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  // تعطيل الزرار ومنع الضغط المتكرر
  loginBtn.disabled = true;
  loginBtn.textContent = "جاري الدخول...";

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const userDoc = await getDoc(doc(db, "users", credential.user.uid));

    if (!userDoc.exists()) {
      showError("الحساب غير مكتمل البيانات، تواصل مع الدعم");
      await signOut(auth);
      return;
    }

    const userData = userDoc.data();
    const role = userData.role;

    if (role === "teacher") {
      window.location.href = "pages/teacher-dashboard.html";
    } else if (role === "student") {
      // نتأكد إن عنده كود قبل ما ندخّله
      await ensureStudentCodeOnLogin(credential.user.uid, userData);
      window.location.href = "pages/student-home.html";
    }

  } catch (error) {
    showError(translateFirebaseError(error.code));
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "دخول";
  }
});

// ------- نسيت كلمة المرور -------
forgotPasswordLink.addEventListener("click", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();

  if (!email) {
    showError("اكتب بريدك الإلكتروني الأول عشان نبعتلك رابط الاستعادة");
    return;
  }

  forgotPasswordLink.style.pointerEvents = "none"; // منع الضغط المتكرر

  try {
    await sendPasswordResetEmail(auth, email);
    showError("تم إرسال رابط إعادة تعيين كلمة المرور لبريدك الإلكتروني", true);
  } catch (error) {
    showError(translateFirebaseError(error.code));
  } finally {
    setTimeout(() => { forgotPasswordLink.style.pointerEvents = "auto"; }, 3000);
  }
});