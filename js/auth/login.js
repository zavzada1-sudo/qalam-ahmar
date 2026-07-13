// ============================================
// Login Logic - تسجيل دخول موحّد (مدرس/طالب)
// ============================================

import { auth, db } from "../../firebase-config.js";
import { signInWithEmailAndPassword, sendPasswordResetEmail, signOut } 
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc } 
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const loginForm = document.getElementById("loginForm");
const errorEl = document.getElementById("loginError");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");

// ------- تسجيل الدخول -------
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  errorEl.textContent = "";

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const userDoc = await getDoc(doc(db, "users", credential.user.uid));

    if (!userDoc.exists()) {
      errorEl.textContent = "الحساب غير مكتمل البيانات، تواصل مع الدعم";
      await signOut(auth);
      return;
    }

    const role = userDoc.data().role;
    if (role === "teacher") {
      window.location.href = "pages/teacher-dashboard.html";
    } else if (role === "student") {
      window.location.href = "pages/student-exam.html";
    }
  } catch (error) {
    errorEl.textContent = "البريد الإلكتروني أو كلمة المرور غير صحيحة";
  }
});

// ------- نسيت كلمة المرور -------
forgotPasswordLink.addEventListener("click", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();

  if (!email) {
    errorEl.textContent = "اكتب بريدك الإلكتروني الأول عشان نبعتلك رابط الاستعادة";
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    errorEl.style.color = "green";
    errorEl.textContent = "تم إرسال رابط إعادة تعيين كلمة المرور لبريدك الإلكتروني";
  } catch (error) {
    errorEl.style.color = "red";
    errorEl.textContent = "لم نجد حساب مسجل بهذا البريد الإلكتروني";
  }
});