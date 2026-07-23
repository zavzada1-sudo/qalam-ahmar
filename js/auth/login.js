// ============================================
// Login Logic - تسجيل دخول موحّد (مدرس/طالب)
// ============================================

import { auth, db } from "../../firebase-config.js";
import { signInWithEmailAndPassword, sendPasswordResetEmail, signOut } 
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc } 
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import "../shared/theme.js";
import "../shared/offline-banner.js";




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

// ------- التوجيه بعد الدخول (مع مراعاة رابط سكان محفوظ) -------
// لو الطالب كان بيعمل سكان لـ QR الحضور وهو مش مسجّل دخول، صفحة
// attendance-scan.js بتحفظ رابطها هنا قبل ما تودّيه لصفحة الدخول.
// لو لقيناه، نمسحه فورًا (عشان ميتكررش استخدامه) ونوديه هناك بدل
// الصفحة الرئيسية. الفحص ده لازم يبقى للطالب بس، مش المدرس.
function redirectAfterLogin(role) {
  if (role === "student") {
    let redirectUrl = null;
    try {
      redirectUrl = localStorage.getItem("qalam_redirect_after_login");
      if (redirectUrl) localStorage.removeItem("qalam_redirect_after_login");
    } catch (e) {
      console.warn("Cannot read redirect:", e);
    }

    if (redirectUrl) {
      window.location.href = redirectUrl;
      return;
    }

    window.location.href = "pages/student-home.html";
    return;
  }

  if (role === "teacher") {
    window.location.href = "pages/teacher-dashboard.html";
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

    const role = userDoc.data().role;
    redirectAfterLogin(role);

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