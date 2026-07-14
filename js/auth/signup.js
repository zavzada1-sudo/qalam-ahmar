// ============================================
// Signup Logic - إنشاء حساب مدرس/طالب
// ============================================

import { auth, db } from "../../firebase-config.js";
import { createUserWithEmailAndPassword } 
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, setDoc } 
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

let selectedRole = "teacher"; // القيمة الافتراضية

// ------- التبديل بين تابي "مدرس" و "طالب" -------
const teacherTab = document.getElementById("teacherTab");
const studentTab = document.getElementById("studentTab");

teacherTab.addEventListener("click", () => {
  selectedRole = "teacher";
  teacherTab.classList.add("active");
  studentTab.classList.remove("active");
});

studentTab.addEventListener("click", () => {
  selectedRole = "student";
  studentTab.classList.add("active");
  teacherTab.classList.remove("active");
});

// ------- إظهار / إخفاء كلمة المرور (لأي حقل باسورد) -------
function setupPasswordToggle(toggleBtnId, inputId) {
  const toggleBtn = document.getElementById(toggleBtnId);
  const input = document.getElementById(inputId);

  toggleBtn.addEventListener("click", () => {
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    toggleBtn.textContent = isHidden ? "🙈" : "👁️";
  });
}

setupPasswordToggle("togglePassword", "password");
setupPasswordToggle("toggleConfirmPassword", "confirmPassword");

// ------- دالة لتوليد Student ID عشوائي وفريد -------
function generateStudentId() {
  const randomNum = Math.floor(1000 + Math.random() * 9000); // رقم من 4 خانات
  return `STD${randomNum}`;
}

// ------- دالة مساعدة لعرض الأخطاء -------
const errorEl = document.getElementById("signupError");
function showError(message, isSuccess = false) {
  errorEl.textContent = message;
  errorEl.style.color = isSuccess ? "green" : "#c0392b";
}

// ------- ترجمة أكواد أخطاء Firebase لرسائل مفهومة -------
function translateFirebaseError(code) {
  switch (code) {
    case "auth/email-already-in-use":
      return "هذا البريد الإلكتروني مسجل بالفعل";
    case "auth/weak-password":
      return "كلمة المرور ضعيفة جدًا (6 أحرف على الأقل)";
    case "auth/invalid-email":
      return "صيغة البريد الإلكتروني غير صحيحة";
    default:
      return "حدث خطأ: " + code;
  }
}

// ------- إنشاء الحساب -------
const signupForm = document.getElementById("signupForm");
const signupBtn = document.getElementById("signupBtn");

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");

  const fullName = document.getElementById("fullName").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (password !== confirmPassword) {
    showError("كلمة المرور غير متطابقة");
    return;
  }

  signupBtn.disabled = true;
  signupBtn.textContent = "جاري إنشاء الحساب...";

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);

    // بيانات المستخدم الأساسية
    const userData = {
      fullName,
      email,
      phone,
      role: selectedRole,
      createdAt: new Date().toISOString()
    };

    // لو الحساب طالب، نضيف Student ID تلقائي
    if (selectedRole === "student") {
      userData.studentId = generateStudentId();
    }

    await setDoc(doc(db, "users", credential.user.uid), userData);

    // التوجيه حسب نوع الحساب
    if (selectedRole === "teacher") {
      window.location.href = "teacher-dashboard.html";
    } else {
      window.location.href = "student-exam.html";
    }

  } catch (error) {
    showError(translateFirebaseError(error.code));
    console.error("Signup error:", error); // عشان نقدر نشخص أي مشكلة من الـ Console
  } finally {
    signupBtn.disabled = false;
    signupBtn.textContent = "إنشاء حساب";
  }
});