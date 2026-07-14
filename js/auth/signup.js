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

// ------- دالة لتوليد Student ID عشوائي وفريد -------
function generateStudentId() {
  const randomNum = Math.floor(1000 + Math.random() * 9000); // رقم من 4 خانات
  return `STD${randomNum}`;
}

// ------- إنشاء الحساب -------
const signupForm = document.getElementById("signupForm");
const errorEl = document.getElementById("signupError");

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";

  const fullName = document.getElementById("fullName").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (password !== confirmPassword) {
    errorEl.textContent = "كلمة المرور غير متطابقة";
    return;
  }

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
    if (error.code === "auth/email-already-in-use") {
      errorEl.textContent = "هذا البريد الإلكتروني مسجل بالفعل";
    } else if (error.code === "auth/weak-password") {
      errorEl.textContent = "كلمة المرور ضعيفة جدًا (6 أحرف على الأقل)";
    } else {
      errorEl.textContent = "حدث خطأ، حاول مرة أخرى";
    }
  }
});