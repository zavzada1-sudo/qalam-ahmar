import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const elements = {
  welcomeTitle: document.getElementById("welcomeTitle"),
  teacherName: document.getElementById("teacherName"),
  teacherInitial: document.getElementById("teacherInitial"),
  classesCount: document.getElementById("classesCount"),
  studentsCount: document.getElementById("studentsCount"),
  assessmentsCount: document.getElementById("assessmentsCount"),
  pendingCount: document.getElementById("pendingCount"),
  subscriptionValue: document.getElementById("subscriptionValue"),
  subscriptionDescription: document.getElementById("subscriptionDescription"),
  upcomingList: document.getElementById("upcomingList"),
  upcomingEmpty: document.getElementById("upcomingEmpty"),
  dashboardMessage: document.getElementById("dashboardMessage"),
  logoutButton: document.getElementById("logoutButton"),
  menuButton: document.getElementById("menuButton"),
  sidebar: document.getElementById("sidebar"),
  sidebarBackdrop: document.getElementById("sidebarBackdrop")
};

function showMessage(message, isError = false) {
  elements.dashboardMessage.textContent = message;
  elements.dashboardMessage.classList.toggle("error", isError);
  elements.dashboardMessage.hidden = false;
}

function setMetric(element, value) {
  element.textContent = new Intl.NumberFormat("ar-EG").format(value);
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return "غير محدد";
  return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function getAssessmentDate(assessment) {
  return toDate(assessment.availableFrom) || toDate(assessment.availableTo) || null;
}

function renderUpcomingAssessments(assessments) {
  elements.upcomingList.replaceChildren();
  const now = new Date();
  const upcoming = assessments
    .filter((assessment) => assessment.status !== "draft")
    .sort((first, second) => {
      const firstDate = getAssessmentDate(first) || now;
      const secondDate = getAssessmentDate(second) || now;
      return firstDate - secondDate;
    })
    .slice(0, 5);

  elements.upcomingEmpty.hidden = upcoming.length > 0;

  upcoming.forEach((assessment) => {
    const item = document.createElement("li");
    item.className = "assessment-item";
    const type = assessment.type === "assignment" || assessment.type === "worksheet" ? "واجب" : "امتحان";
    const icon = type === "واجب" ? "📝" : "✦";

    const information = document.createElement("div");
    information.className = "assessment-information";
    const iconElement = document.createElement("span");
    iconElement.className = "assessment-type";
    iconElement.textContent = icon;
    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = assessment.title || "بدون عنوان";
    const details = document.createElement("span");
    details.textContent = `${type}${assessment.timeLimit ? ` • ${assessment.timeLimit} دقيقة` : ""}`;
    text.append(title, details);
    information.append(iconElement, text);

    const date = document.createElement("div");
    date.className = "assessment-date";
    const dateLabel = document.createElement("strong");
    dateLabel.textContent = formatDate(assessment.availableFrom || assessment.availableTo);
    date.append(dateLabel);

    item.append(information, date);
    elements.upcomingList.append(item);
  });
}

function renderSubscription(subscriptionEndDate) {
  const endDate = toDate(subscriptionEndDate);
  if (!endDate) {
    elements.subscriptionValue.textContent = "غير محدد";
    elements.subscriptionDescription.textContent = "لا توجد بيانات اشتراك مضافة إلى حسابك حتى الآن.";
    return;
  }

  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const daysRemaining = Math.ceil((endDate.getTime() - Date.now()) / millisecondsPerDay);
  if (daysRemaining < 0) {
    elements.subscriptionValue.textContent = "انتهى الاشتراك";
    elements.subscriptionDescription.textContent = `انتهى اشتراكك في ${formatDate(endDate)}. تواصل مع الإدارة للتجديد.`;
    return;
  }

  elements.subscriptionValue.textContent = `${new Intl.NumberFormat("ar-EG").format(daysRemaining)} يوم متبقٍ`;
  elements.subscriptionDescription.textContent = `ينتهي اشتراكك في ${formatDate(endDate)}.`;
}

async function loadDashboard(user) {
  try {
    const teacherReference = doc(db, "users", user.uid);
    const [teacherSnapshot, classesSnapshot, assessmentsSnapshot, submissionsSnapshot] = await Promise.all([
      getDoc(teacherReference),
      getDocs(query(collection(db, "classes"), where("teacherId", "==", user.uid))),
      getDocs(query(collection(db, "exams"), where("teacherId", "==", user.uid))),
      getDocs(query(collection(db, "submissions"), where("teacherId", "==", user.uid)))
    ]);

    const teacher = teacherSnapshot.exists() ? teacherSnapshot.data() : {};
    if (teacher.role && teacher.role !== "teacher") {
      window.location.replace("../index.html");
      return;
    }

    const teacherName = teacher.fullName || user.email?.split("@")[0] || "مدرس";
    elements.teacherName.textContent = teacherName;
    elements.welcomeTitle.textContent = `مرحبًا، ${teacherName}`;
    elements.teacherInitial.textContent = teacherName.trim().charAt(0) || "م";
    renderSubscription(teacher.subscriptionEndDate);

    const classes = classesSnapshot.docs.map((snapshot) => snapshot.data());
    const assessments = assessmentsSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
    const submissions = submissionsSnapshot.docs.map((snapshot) => snapshot.data());
    const studentIds = new Set(classes.flatMap((classItem) => Array.isArray(classItem.studentIds) ? classItem.studentIds : []));

    setMetric(elements.classesCount, classes.length);
    setMetric(elements.studentsCount, studentIds.size);
    setMetric(elements.assessmentsCount, assessments.filter((assessment) => assessment.status !== "draft").length);
    setMetric(elements.pendingCount, submissions.filter((submission) => ["queued", "grading"].includes(submission.status)).length);
    renderUpcomingAssessments(assessments);
  } catch (error) {
    console.error("Dashboard loading error:", error);
    setMetric(elements.classesCount, 0);
    setMetric(elements.studentsCount, 0);
    setMetric(elements.assessmentsCount, 0);
    setMetric(elements.pendingCount, 0);
    elements.subscriptionValue.textContent = "تعذر التحميل";
    elements.subscriptionDescription.textContent = "حاول إعادة تحميل الصفحة.";
    elements.upcomingEmpty.hidden = false;
    showMessage("تعذر تحميل بيانات لوحة التحكم. تأكد من اتصال الإنترنت وقواعد Firestore.", true);
  }
}

function setSidebar(open) {
  elements.sidebar.classList.toggle("is-open", open);
  elements.sidebarBackdrop.hidden = !open;
  elements.menuButton.setAttribute("aria-expanded", String(open));
}

elements.menuButton.addEventListener("click", () => setSidebar(!elements.sidebar.classList.contains("is-open")));
elements.sidebarBackdrop.addEventListener("click", () => setSidebar(false));

document.querySelectorAll("[data-coming-soon]").forEach((button) => {
  button.addEventListener("click", () => {
    showMessage(`${button.dataset.comingSoon} ستكون متاحة في الخطوة التالية من المشروع.`);
    setSidebar(false);
  });
});

elements.logoutButton.addEventListener("click", async () => {
  elements.logoutButton.disabled = true;
  try {
    await signOut(auth);
    window.location.replace("../index.html");
  } catch (error) {
    console.error("Logout error:", error);
    showMessage("تعذر تسجيل الخروج. حاول مرة أخرى.", true);
    elements.logoutButton.disabled = false;
  }
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.replace("../index.html");
    return;
  }
  loadDashboard(user);
});
