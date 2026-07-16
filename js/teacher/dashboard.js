// ============================================
// Teacher Dashboard Logic - لوحة تحكم المدرس
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// عناصر الصفحة
const teacherNameEl = document.getElementById("teacherName");
const teacherInitialEl = document.getElementById("teacherInitial");
const logoutBtn = document.getElementById("logoutBtn");
const examsListEl = document.getElementById("examsList");

// عناصر الإحصائيات
const classesCountEl = document.getElementById("classesCount");
const studentsCountEl = document.getElementById("studentsCount");
const assessmentsCountEl = document.getElementById("assessmentsCount");
const pendingCountEl = document.getElementById("pendingCount");

// عناصر قائمة الموبايل
const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

// ------- فتح وقفل القائمة الجانبية على الموبايل -------
function openSidebar() {
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("show");
}
function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("show");
}
if (menuToggle) menuToggle.addEventListener("click", openSidebar);
if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", closeSidebar);

// ------- حماية الصفحة: لازم مدرس مسجل دخول -------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../index.html";
    return;
  }

  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));

    if (!userDoc.exists() || userDoc.data().role !== "teacher") {
      window.location.href = "../index.html";
      return;
    }

    const data = userDoc.data();
    const name = data.fullName || "مدرس";

    // عرض الاسم وأول حرف منه في الصورة الرمزية
    teacherNameEl.textContent = name;
    teacherInitialEl.textContent = name.charAt(0);

    // تحميل الامتحانات والإحصائيات
    await loadTeacherExams(user.uid);

  } catch (error) {
    console.error("Dashboard load error:", error);
    teacherNameEl.textContent = "خطأ في التحميل";
  }
});

// ------- جلب امتحانات المدرس + حساب الإحصائيات -------
async function loadTeacherExams(teacherId) {
  try {
    const examsQuery = query(
      collection(db, "exams"),
      where("teacherId", "==", teacherId)
    );
    const snapshot = await getDocs(examsQuery);

    // عدد الامتحانات = عدد المستندات
    assessmentsCountEl.textContent = snapshot.size;

    if (snapshot.empty) {
      examsListEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📝</div>
          <h3>لسه مفيش امتحانات</h3>
          <p>ابدأ بإنشاء أول امتحان لطلابك.</p>
          <a href="create-exam.html" class="btn btn-primary">+ إنشاء أول امتحان</a>
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
        <h3>${exam.title || "بدون عنوان"}</h3>
        <div class="exam-badges">
          <span class="badge badge-type">${translateExamType(exam.type)}</span>
          <span class="badge badge-status ${exam.status}">${translateStatus(exam.status)}</span>
        </div>
      `;
      examsListEl.appendChild(card);
    });

  } catch (error) {
    console.error("Error loading exams:", error);
    examsListEl.innerHTML = `<p class="message error">تعذر تحميل الامتحانات، حاول تحديث الصفحة</p>`;
  }
}

// ------- ترجمة القيم لنصوص عربية -------
function translateExamType(type) {
  const types = {
    exam: "امتحان",
    quiz: "اختبار قصير",
    assignment: "واجب",
    worksheet: "ورقة عمل"
  };
  return types[type] || type || "امتحان";
}

function translateStatus(status) {
  const statuses = {
    draft: "مسودة",
    published: "منشور",
    closed: "مغلق"
  };
  return statuses[status] || status || "مسودة";
}

// ------- تسجيل الخروج -------
logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;

  try {
    await signOut(auth);
    window.location.href = "../index.html";
  } catch (error) {
    console.error("Logout error:", error);
    logoutBtn.disabled = false;
  }
});