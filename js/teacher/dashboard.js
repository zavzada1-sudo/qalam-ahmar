// ============================================
// Teacher Dashboard Logic - لوحة تحكم المدرس
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const teacherNameEl = document.getElementById("teacherName");
const logoutBtn = document.getElementById("logoutBtn");
const examsListEl = document.getElementById("examsList");

// ------- حماية الصفحة: لازم يكون المستخدم مسجل دخول ومدرس -------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // مفيش حد مسجل دخول أصلاً → رجّعه لصفحة الدخول
    window.location.href = "../index.html";
    return;
  }

  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));

    if (!userDoc.exists() || userDoc.data().role !== "teacher") {
      // الحساب مش مدرس (طالب مثلاً) → رجّعه لصفحة الدخول
      window.location.href = "../index.html";
      return;
    }

    // عرض اسم المدرس في الأعلى
    teacherNameEl.textContent = userDoc.data().fullName || "مدرس";

    // تحميل امتحانات المدرس
    await loadTeacherExams(user.uid);

  } catch (error) {
    console.error("Dashboard load error:", error);
    teacherNameEl.textContent = "حدث خطأ في تحميل البيانات";
  }
});

// ------- جلب امتحانات المدرس من Firestore -------
async function loadTeacherExams(teacherId) {
  try {
    const examsQuery = query(
      collection(db, "exams"),
      where("teacherId", "==", teacherId)
    );
    const snapshot = await getDocs(examsQuery);

    if (snapshot.empty) {
      examsListEl.innerHTML = `
        <div class="empty-state">
          <p>لسه مفيش امتحانات إنت عملتها.</p>
          <a href="create-exam.html" class="btn-primary">إنشاء أول امتحان</a>
        </div>
      `;
      return;
    }

    examsListEl.innerHTML = "";
    snapshot.forEach((examDoc) => {
      const exam = examDoc.data();
      const card = document.createElement("div");
      card.className = "exam-card";
      card.innerHTML = `
        <h3>${exam.title}</h3>
        <span class="exam-type">${translateExamType(exam.type)}</span>
        <span class="exam-status status-${exam.status}">${translateStatus(exam.status)}</span>
      `;
      examsListEl.appendChild(card);
    });

  } catch (error) {
    console.error("Error loading exams:", error);
    examsListEl.innerHTML = `<p class="error-message">تعذر تحميل الامتحانات، حاول تحديث الصفحة</p>`;
  }
}

// ------- ترجمة القيم التقنية لنصوص مفهومة -------
function translateExamType(type) {
  const types = {
    exam: "امتحان",
    quiz: "اختبار قصير",
    assignment: "واجب",
    worksheet: "ورقة عمل"
  };
  return types[type] || type;
}

function translateStatus(status) {
  const statuses = {
    draft: "مسودة",
    published: "منشور",
    closed: "مغلق"
  };
  return statuses[status] || status;
}

// ------- تسجيل الخروج -------
logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  logoutBtn.textContent = "جاري تسجيل الخروج...";

  try {
    await signOut(auth);
    window.location.href = "../index.html";
  } catch (error) {
    console.error("Logout error:", error);
    logoutBtn.disabled = false;
    logoutBtn.textContent = "تسجيل الخروج";
  }
});