// ============================================
// Teacher Dashboard Logic - لوحة تحكم المدرس
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc,deleteDoc, collection, query, where, getDocs,onSnapshot}
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { showToast, showConfirm } from "../shared/ui.js";
import { renderSkeleton, renderErrorState } from "../shared/states.js";
import "../shared/theme.js";

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

     checkTeacherId(user.uid, data);


    // تحميل الامتحانات والإحصائيات
    // تحميل الامتحانات والإحصائيات
   loadTeacherExams(user.uid);
    await loadClassesAndStudentsCount(user.uid);

  } catch (error) {
    console.error("Dashboard load error:", error);
    teacherNameEl.textContent = "خطأ في التحميل";
  }
});

// ------- جلب امتحانات المدرس + حساب الإحصائيات -------
// مرجع للاستماع الحالي عشان نقدر نوقفه ونمنع تكراره
let unsubscribeExams = null;

function loadTeacherExams(teacherId) {
  renderSkeleton(examsListEl, { type: "card", count: 3 });

  if (unsubscribeExams) unsubscribeExams();

  // onSnapshot بدل getDocs: البيانات بتظهر فورًا من الكاش المحلي،
  // والتحديث من السيرفر بييجي بعدها. وكمان أي امتحان جديد أو محذوف
  // بيتحدّث في الشاشة لوحده من غير reload.
  unsubscribeExams = onSnapshot(
    query(collection(db, "exams"), where("teacherId", "==", teacherId)),
    (snapshot) => {
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
        card.style.cursor = "pointer";
        card.innerHTML = `
  <div class="exam-card-actions">
    ${exam.status === "published"
      ? `<button class="exam-grades-btn" title="عرض النتائج">📊</button>
         <button class="exam-print-btn" title="طباعة الامتحان">🖶</button>`
      : ""
    }
    <button class="exam-delete-btn" title="حذف الامتحان">🗑️</button>
  </div>
  <h3>${exam.title || "بدون عنوان"}</h3>
  <div class="exam-badges">
    <span class="badge badge-type">${translateExamType(exam.type)}</span>
    <span class="badge badge-status ${exam.status}">${translateStatus(exam.status)}</span>
  </div>
`;

        // فتح الامتحان للتعديل
        card.addEventListener("click", () => {
          window.location.href = `create-exam.html?examId=${examDoc.id}`;
        });

        // حذف الامتحان (مع منع فتح صفحة التعديل)
        card.querySelector(".exam-delete-btn").addEventListener("click", async (e) => {
          e.stopPropagation();
          await deleteExam(examDoc.id, exam.title || "بدون عنوان", teacherId);
        });

        // زرار الطباعة (بيظهر بس لو الامتحان منشور)
        const printBtn = card.querySelector(".exam-print-btn");
        if (printBtn) {
          printBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            window.open(`print-exam.html?examId=${examDoc.id}`, "_blank");
          });
        }

        // زرار النتائج (بيظهر بس لو الامتحان منشور)
        const gradesBtn = card.querySelector(".exam-grades-btn");
        if (gradesBtn) {
          gradesBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            window.location.href = `grades.html?examId=${examDoc.id}`;
          });
        }

        examsListEl.appendChild(card);
      });
    },
    (error) => {
      console.error("Error loading exams:", error);
      renderErrorState(examsListEl, {
        message: "تعذر تحميل الامتحانات، حاول تحديث الصفحة",
        onRetry: () => loadTeacherExams(teacherId),
      });
    }
  );
}

// ------- حساب عدد الفصول (المجموعات) وعدد الطلاب الفريدين -------
async function loadClassesAndStudentsCount(teacherId) {
  try {
    const groupsQuery = query(
      collection(db, "groups"),
      where("teacherId", "==", teacherId)
    );
    const snapshot = await getDocs(groupsQuery);

    // عدد الفصول = عدد المجموعات
    classesCountEl.textContent = snapshot.size;

    // عدد الطلاب = عدد الأكواد الفريدة (الطالب ممكن يكون في أكتر من مجموعة،
    // فمش بنعدّه مرتين)
    const uniqueStudentIds = new Set();
    snapshot.forEach((groupDoc) => {
      const studentIds = groupDoc.data().studentIds || [];
      studentIds.forEach((id) => uniqueStudentIds.add(id));
    });

    studentsCountEl.textContent = uniqueStudentIds.size;

  } catch (error) {
    console.error("Error loading classes/students count:", error);
    classesCountEl.textContent = "—";
    studentsCountEl.textContent = "—";
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
// ------- حذف امتحان -------
async function deleteExam(examId, examTitle, teacherId) {
  // نشوف الأول لو فيه طلاب سلّموا الامتحان ده
  let submissionsCount = 0;
  try {
    const subsSnap = await getDocs(query(
      collection(db, "submissions"),
      where("examId", "==", examId),
      where("teacherId", "==", teacherId)
    ));
    submissionsCount = subsSnap.size;
  } catch (error) {
    console.error("Check submissions error:", error);
  }

  // رسالة تحذير حسب الحالة
  let confirmMessage = `متأكد إنك عايز تمسح "${examTitle}"؟ مش هتقدر ترجّعه تاني.`;
  if (submissionsCount > 0) {
    confirmMessage =
      `فيه ${submissionsCount} طالب سلّموا الامتحان ده بالفعل. لو مسحته، نتايجهم هتفضل موجودة بس من غير أسئلة الامتحان (مش هيقدروا يراجعوا إجاباتهم). متأكد إنك عايز تمسح "${examTitle}"؟`;
  }

  const confirmed = await showConfirm({
    title: submissionsCount > 0 ? "⚠️ تحذير: فيه تسليمات مرتبطة" : "حذف الامتحان",
    message: confirmMessage,
    confirmLabel: "حذف",
    danger: true,
  });
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "exams", examId));
    showToast("تم حذف الامتحان بنجاح", "success");
    await loadTeacherExams(teacherId); // نعيد تحميل القايمة
  } catch (error) {
    console.error("Delete exam error:", error);
    showToast("حصلت مشكلة في الحذف، حاول تاني", "error");
  }
}


// ============================================
// اختيار ID المدرس (أول مرة)
// ============================================

const teacherIdModal = document.getElementById("teacherIdModal");
const teacherIdForm = document.getElementById("teacherIdForm");
const teacherIdInput = document.getElementById("teacherIdInput");
const saveIdBtn = document.getElementById("saveIdBtn");
const teacherIdError = document.getElementById("teacherIdError");

// متغير نحفظ فيه بيانات المدرس الحالي عشان نستخدمها
let currentTeacherUid = null;

// دالة نستدعيها بعد التأكد إن المستخدم مدرس
// بتشوف: هل عنده teacherCode ولا لأ؟
function checkTeacherId(uid, userData) {
  currentTeacherUid = uid;

  // لو المدرس لسه مختارش ID → نظهر الشاشة
  if (!userData.teacherCode) {
    teacherIdModal.classList.remove("hidden");
  }
}

// عند حفظ الـ ID
teacherIdForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  teacherIdError.textContent = "";

  const chosenId = teacherIdInput.value.trim();

  // تحقق بسيط: مش فاضي وطوله معقول
  if (chosenId.length < 3) {
    teacherIdError.textContent = "الـ ID لازم يكون 3 حروف/أرقام على الأقل";
    return;
  }

  saveIdBtn.disabled = true;
  saveIdBtn.textContent = "جاري الحفظ...";

  try {
    // نتأكد إن الـ ID ده مش مستخدم من مدرس تاني
    const existingQuery = query(
      collection(db, "users"),
      where("teacherCode", "==", chosenId)
    );
    const existing = await getDocs(existingQuery);

    if (!existing.empty) {
      teacherIdError.textContent = "الـ ID ده مستخدم بالفعل، اختار واحد تاني";
      saveIdBtn.disabled = false;
      saveIdBtn.textContent = "حفظ الـ ID";
      return;
    }

    // نحفظ الـ ID في حساب المدرس
    await updateDoc(doc(db, "users", currentTeacherUid), {
      teacherCode: chosenId
    });

    // نخفي الشاشة
    teacherIdModal.classList.add("hidden");

  } catch (error) {
    console.error("Save teacher ID error:", error);
    teacherIdError.textContent = "حدث خطأ، حاول مرة أخرى";
    saveIdBtn.disabled = false;
    saveIdBtn.textContent = "حفظ الـ ID";
  }
});