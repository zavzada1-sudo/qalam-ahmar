// ============================================
// Attendance Logic - تسجيل حضور الطلاب
// ============================================
//
// فكرة التخزين:
// كل "جلسة حضور" = مستند واحد في attendanceSessions فيه مصفوفة records
// بكل طلاب المجموعة وحالة كل واحد. نفس أسلوب أسئلة الامتحان (مصفوفة جوّا
// المستند مش subcollection) — أرخص وأسرع وحفظ ذرّي بعملية كتابة واحدة.
//
// معرّف المستند ثابت: `${groupId}_${date}`
// كده لو المدرس فتح نفس المجموعة بنفس التاريخ تاني، بيعدّل على نفس الجلسة
// بدل ما يعمل نسخة مكررة.
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, documentId, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// ------- عناصر الصفحة -------
const loadingEl     = document.getElementById("loadingState");
const errorEl       = document.getElementById("errorState");
const errorTextEl   = document.getElementById("errorText");
const contentEl     = document.getElementById("contentWrapper");

const gradeSelect   = document.getElementById("gradeSelect");
const groupSelect   = document.getElementById("groupSelect");
const dateInput     = document.getElementById("dateInput");

const sheetEl       = document.getElementById("attendanceSheet");
const sheetEmptyEl  = document.getElementById("sheetEmpty");
const studentsListEl= document.getElementById("studentsList");
const searchInput   = document.getElementById("searchInput");

const statTotal     = document.getElementById("statTotal");
const statPresent   = document.getElementById("statPresent");
const statAbsent    = document.getElementById("statAbsent");
const statLate      = document.getElementById("statLate");

const markAllPresent= document.getElementById("markAllPresent");
const markAllAbsent = document.getElementById("markAllAbsent");
const saveBtn       = document.getElementById("saveBtn");
const saveMessage   = document.getElementById("saveMessage");
const savedHint     = document.getElementById("savedHint");

const historyListEl = document.getElementById("historyList");
const historyEmptyEl= document.getElementById("historyEmpty");

// ------- الحالة الحالية للصفحة -------
let currentTeacherId = null;
let teacherGrades    = [];   // كل السنوات الدراسية للمدرس
let teacherGroups    = [];   // كل المجموعات للمدرس
let groupSessions    = [];   // جلسات الحضور للمجموعة المختارة
let currentRecords   = [];   // [{ studentId, studentName, studentCode, status }]
let isExistingSession = false; // هل التاريخ ده متسجّل قبل كده؟

// الحالات المتاحة
const STATUS = { PRESENT: "present", ABSENT: "absent", LATE: "late" };

const STATUS_LABELS = {
  [STATUS.PRESENT]: "حاضر",
  [STATUS.ABSENT]: "غايب",
  [STATUS.LATE]: "متأخر"
};

// ============================================
// حماية الصفحة: لازم مدرس مسجل دخول
// ============================================
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

    currentTeacherId = user.uid;
    await loadGradesAndGroups();
  } catch (error) {
    console.error("[attendance] خطأ في التحقق من الحساب:", error.code, error.message);
    showError("حصلت مشكلة في التحقق من حسابك، حاول تحديث الصفحة");
  }
});

// ============================================
// تحميل السنوات والمجموعات
// ============================================
async function loadGradesAndGroups() {
  try {
    // بنجيب الاتنين بالتوازي عشان أسرع
    const [gradesSnap, groupsSnap] = await Promise.all([
      getDocs(query(collection(db, "grades"), where("teacherId", "==", currentTeacherId))),
      getDocs(query(collection(db, "groups"), where("teacherId", "==", currentTeacherId)))
    ]);

    teacherGrades = gradesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    teacherGroups = groupsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (!teacherGrades.length) {
      showError("لسه مضفتش سنوات دراسية. روح لصفحة الفصول وضيف سنة ومجموعة الأول.");
      return;
    }

    // ترتيب أبجدي
    teacherGrades.sort((a, b) => (a.gradeName || "").localeCompare(b.gradeName || "", "ar"));

    // تعبئة قائمة السنوات
    gradeSelect.innerHTML = `<option value="">اختار السنة الدراسية</option>` +
      teacherGrades.map((g) =>
        `<option value="${g.id}">${escapeHtml(g.gradeName || "بدون اسم")}</option>`
      ).join("");

    // التاريخ الافتراضي = النهارده
    dateInput.value = todayString();

    showContent();
  } catch (error) {
    console.error("[attendance] فشل تحميل السنوات/المجموعات:", error.code, error.message);
    showError("تعذر تحميل الفصول، حاول تحديث الصفحة");
  }
}

// ------- لما المدرس يختار سنة → نعرض مجموعاتها -------
gradeSelect.addEventListener("change", () => {
  const gradeId = gradeSelect.value;

  resetSheet();

  if (!gradeId) {
    groupSelect.innerHTML = `<option value="">اختار المجموعة</option>`;
    groupSelect.disabled = true;
    return;
  }

  const groups = teacherGroups
    .filter((g) => g.gradeId === gradeId)
    .sort((a, b) => (a.groupName || "").localeCompare(b.groupName || "", "ar"));

  if (!groups.length) {
    groupSelect.innerHTML = `<option value="">مفيش مجموعات في السنة دي</option>`;
    groupSelect.disabled = true;
    return;
  }

  groupSelect.innerHTML = `<option value="">اختار المجموعة</option>` +
    groups.map((g) =>
      `<option value="${g.id}">${escapeHtml(g.groupName || "بدون اسم")}</option>`
    ).join("");
  groupSelect.disabled = false;
});

// ------- لما يختار مجموعة أو يغيّر التاريخ → نحمّل كشف الحضور -------
groupSelect.addEventListener("change", loadAttendanceSheet);
dateInput.addEventListener("change", loadAttendanceSheet);

// ============================================
// تحميل كشف الحضور للمجموعة والتاريخ المختارين
// ============================================
async function loadAttendanceSheet() {
  const groupId = groupSelect.value;
  const date = dateInput.value;

  if (!groupId || !date) {
    resetSheet();
    return;
  }

  sheetEl.classList.add("hidden");
  sheetEmptyEl.classList.remove("hidden");
  sheetEmptyEl.innerHTML = `<p class="loading-text">بنحمّل كشف الحضور...</p>`;

  try {
    const group = teacherGroups.find((g) => g.id === groupId);
    const studentIds = group?.studentIds || [];

    if (!studentIds.length) {
      sheetEmptyEl.innerHTML = `
        <div class="empty-icon">👥</div>
        <h3>المجموعة دي فاضية</h3>
        <p>مفيش طلاب منضمين للمجموعة دي لسه.</p>
      `;
      return;
    }

    // ---- 1. جلب بيانات الطلاب ----
    const students = await getStudentsByIds(studentIds);

    // ---- 2. جلب كل جلسات المجموعة (بنستخدمها للسجل وللتاريخ الحالي) ----
    // مهم: شرط teacherId لازم يكون في الاستعلام عشان يطابق قاعدة الأمان
    const sessionsSnap = await getDocs(query(
      collection(db, "attendanceSessions"),
      where("teacherId", "==", currentTeacherId),
      where("groupId", "==", groupId)
    ));

    groupSessions = sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // ترتيب بالتاريخ تنازليًا (الأحدث الأول) — بنرتب هنا بدل orderBy
    // عشان نتجنب الحاجة لفهرس مركّب في Firestore
    groupSessions.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    // ---- 3. هل فيه جلسة متسجلة بالتاريخ ده؟ ----
    const existing = groupSessions.find((s) => s.date === date);
    isExistingSession = Boolean(existing);

    // ---- 4. بناء السجلات ----
    // لو فيه جلسة قديمة بنحمّل حالاتها، ولو جديدة الكل يبدأ "حاضر"
    // (ده الافتراضي المعتاد — المدرس بيعلّم على الغايبين بس، أسرع بكتير)
    const oldStatuses = new Map(
      (existing?.records || []).map((r) => [r.studentId, r.status])
    );

    currentRecords = students.map((student) => ({
      studentId: student.id,
      studentName: student.fullName || "بدون اسم",
      studentCode: student.studentId || "—",
      status: oldStatuses.get(student.id) || STATUS.PRESENT
    }));

    // ترتيب أبجدي بالاسم
    currentRecords.sort((a, b) => a.studentName.localeCompare(b.studentName, "ar"));

    savedHint.textContent = isExistingSession
      ? "التاريخ ده متسجّل قبل كده — أي حفظ هيعدّل عليه"
      : "";

    sheetEmptyEl.classList.add("hidden");
    sheetEl.classList.remove("hidden");

    renderStudents();
    renderStats();
    renderHistory();

  } catch (error) {
    console.error("[attendance] فشل تحميل كشف الحضور:", error.code, error.message);
    sheetEmptyEl.innerHTML = `
      <div class="empty-icon">⚠️</div>
      <h3>تعذر تحميل الكشف</h3>
      <p>حاول تحديث الصفحة.</p>
    `;
  }
}

// ------- جلب بيانات الطلاب بالـ IDs -------
async function getStudentsByIds(studentIds) {
  const students = [];

  // استعلام "in" بيقبل 10 قيم كحد أقصى، فبنقسمهم لدفعات
  for (const chunk of chunkArray(studentIds, 10)) {
    const snap = await getDocs(query(
      collection(db, "users"),
      where(documentId(), "in", chunk)
    ));
    snap.forEach((userDoc) => {
      students.push({ id: userDoc.id, ...userDoc.data() });
    });
  }

  return students;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ============================================
// عرض قائمة الطلاب مع أزرار الحالة
// ============================================
function renderStudents() {
  const term = searchInput.value.trim().toLowerCase();

  const visible = currentRecords.filter((r) =>
    r.studentName.toLowerCase().includes(term) ||
    String(r.studentCode).toLowerCase().includes(term)
  );

  if (!visible.length) {
    studentsListEl.innerHTML = `<div class="gd-empty">مفيش طلاب مطابقين لبحثك</div>`;
    return;
  }

  studentsListEl.innerHTML = visible.map((record) => `
    <div class="gd-row att-row">
      <div class="gd-row-info">
        <div class="gd-row-name">${escapeHtml(record.studentName)}</div>
        <div class="gd-row-code">كود الطالب: ${escapeHtml(String(record.studentCode))}</div>
      </div>
      <div class="att-status-group" role="group" aria-label="حالة الحضور">
        ${buildStatusButton(record, STATUS.PRESENT)}
        ${buildStatusButton(record, STATUS.LATE)}
        ${buildStatusButton(record, STATUS.ABSENT)}
      </div>
    </div>
  `).join("");
}

function buildStatusButton(record, status) {
  const isActive = record.status === status;
  return `
    <button type="button"
            class="att-status-btn ${status} ${isActive ? "active" : ""}"
            data-student-id="${escapeHtml(record.studentId)}"
            data-status="${status}"
            aria-pressed="${isActive}">
      ${STATUS_LABELS[status]}
    </button>
  `;
}

// ------- تغيير حالة طالب (event delegation) -------
studentsListEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".att-status-btn");
  if (!btn) return;

  const studentId = btn.dataset.studentId;
  const status = btn.dataset.status;

  const record = currentRecords.find((r) => r.studentId === studentId);
  if (!record) return;

  record.status = status;

  renderStudents();
  renderStats();
  clearSaveMessage();
});

// ------- أزرار التحديد السريع -------
markAllPresent.addEventListener("click", () => setAllStatuses(STATUS.PRESENT));
markAllAbsent.addEventListener("click", () => setAllStatuses(STATUS.ABSENT));

function setAllStatuses(status) {
  currentRecords.forEach((r) => { r.status = status; });
  renderStudents();
  renderStats();
  clearSaveMessage();
}

// ============================================
// الإحصائيات الحيّة
// ============================================
function renderStats() {
  const counts = countStatuses(currentRecords);
  statTotal.textContent   = currentRecords.length;
  statPresent.textContent = counts.present;
  statAbsent.textContent  = counts.absent;
  statLate.textContent    = counts.late;
}

function countStatuses(records) {
  return {
    present: records.filter((r) => r.status === STATUS.PRESENT).length,
    absent:  records.filter((r) => r.status === STATUS.ABSENT).length,
    late:    records.filter((r) => r.status === STATUS.LATE).length
  };
}

// ============================================
// حفظ الحضور
// ============================================
saveBtn.addEventListener("click", async () => {
  const groupId = groupSelect.value;
  const gradeId = gradeSelect.value;
  const date = dateInput.value;

  if (!groupId || !date || !currentRecords.length) return;

  saveBtn.disabled = true;
  saveBtn.textContent = "بنحفظ...";
  clearSaveMessage();

  try {
    const group = teacherGroups.find((g) => g.id === groupId);
    const grade = teacherGrades.find((g) => g.id === gradeId);
    const counts = countStatuses(currentRecords);

    // معرّف ثابت = المجموعة + التاريخ → يمنع تكرار نفس اليوم
    const sessionId = `${groupId}_${date}`;

    const sessionData = {
      teacherId: currentTeacherId,
      groupId,
      groupName: group?.groupName || "",
      gradeId,
      gradeName: grade?.gradeName || "",
      date,
      records: currentRecords,
      totalStudents: currentRecords.length,
      presentCount: counts.present,
      absentCount: counts.absent,
      lateCount: counts.late,
      updatedAt: serverTimestamp()
    };

    // بنضيف createdAt بس أول مرة عشان ما نمسحش تاريخ الإنشاء الأصلي
    if (!isExistingSession) {
      sessionData.createdAt = serverTimestamp();
    }

    await setDoc(doc(db, "attendanceSessions", sessionId), sessionData, { merge: true });

    isExistingSession = true;
    savedHint.textContent = "التاريخ ده متسجّل — أي حفظ هيعدّل عليه";
    showSaveMessage("تم حفظ الحضور بنجاح ✓", "success");

    // نحدّث السجل المعروض تحت من غير ما نرجع للسيرفر
    updateLocalSessions(sessionId, sessionData, counts);
    renderHistory();

  } catch (error) {
    console.error("[attendance] فشل حفظ الحضور:", error.code, error.message);
    showSaveMessage("تعذر الحفظ، حاول تاني", "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "حفظ الحضور";
  }
});

// تحديث نسخة السجل المحلية بعد الحفظ
function updateLocalSessions(sessionId, sessionData, counts) {
  const localCopy = {
    id: sessionId,
    ...sessionData,
    presentCount: counts.present,
    absentCount: counts.absent,
    lateCount: counts.late
  };

  const index = groupSessions.findIndex((s) => s.id === sessionId);
  if (index >= 0) {
    groupSessions[index] = localCopy;
  } else {
    groupSessions.push(localCopy);
  }

  groupSessions.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

// ============================================
// سجل الجلسات السابقة
// ============================================
function renderHistory() {
  if (!groupSessions.length) {
    historyListEl.innerHTML = "";
    historyEmptyEl.classList.remove("hidden");
    return;
  }

  historyEmptyEl.classList.add("hidden");

  historyListEl.innerHTML = groupSessions.map((session) => {
    const isCurrent = session.date === dateInput.value;
    return `
      <div class="gd-row att-history-row ${isCurrent ? "current" : ""}">
        <div class="gd-row-info">
          <div class="gd-row-name">${formatDateArabic(session.date)}</div>
          <div class="gd-row-code">${session.totalStudents || 0} طالب</div>
        </div>
        <div class="att-history-counts">
          <span class="att-count present">${session.presentCount || 0} حاضر</span>
          <span class="att-count late">${session.lateCount || 0} متأخر</span>
          <span class="att-count absent">${session.absentCount || 0} غايب</span>
        </div>
        <div class="att-history-actions">
          <button type="button" class="gd-btn gd-btn-primary att-open-btn"
                  data-date="${session.date}">فتح</button>
          <button type="button" class="gd-btn gd-btn-reject att-delete-btn"
                  data-session-id="${session.id}" data-date="${session.date}">مسح</button>
        </div>
      </div>
    `;
  }).join("");
}

// ------- فتح أو مسح جلسة من السجل -------
historyListEl.addEventListener("click", async (e) => {
  const openBtn = e.target.closest(".att-open-btn");
  if (openBtn) {
    dateInput.value = openBtn.dataset.date;
    await loadAttendanceSheet();
    dateInput.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const deleteBtn = e.target.closest(".att-delete-btn");
  if (deleteBtn) {
    const { sessionId, date } = deleteBtn.dataset;

    if (!confirm(`متأكد إنك عايز تمسح حضور يوم ${formatDateArabic(date)}؟\nمش هتقدر ترجّعه تاني.`)) {
      return;
    }

    deleteBtn.disabled = true;

    try {
      await deleteDoc(doc(db, "attendanceSessions", sessionId));
      groupSessions = groupSessions.filter((s) => s.id !== sessionId);
      renderHistory();

      // لو مسحنا اليوم المفتوح حاليًا، نرجّع الكشف لحالة "جديد"
      if (date === dateInput.value) {
        isExistingSession = false;
        savedHint.textContent = "";
        setAllStatuses(STATUS.PRESENT);
      }
    } catch (error) {
      console.error("[attendance] فشل مسح الجلسة:", error.code, error.message);
      alert("تعذر المسح، حاول تاني");
      deleteBtn.disabled = false;
    }
  }
});

// ------- البحث -------
searchInput.addEventListener("input", renderStudents);

// ============================================
// دوال مساعدة
// ============================================

// تاريخ النهارده بصيغة YYYY-MM-DD (بالتوقيت المحلي مش UTC)
function todayString() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().split("T")[0];
}

// عرض التاريخ بشكل مقروء بالعربي
function formatDateArabic(dateString) {
  if (!dateString) return "—";
  const date = new Date(dateString + "T00:00:00");
  return date.toLocaleDateString("ar-EG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

// إفراغ الكشف لما مفيش اختيار
function resetSheet() {
  sheetEl.classList.add("hidden");
  sheetEmptyEl.classList.remove("hidden");
  sheetEmptyEl.innerHTML = `
    <div class="empty-icon">📋</div>
    <h3>اختار مجموعة وتاريخ</h3>
    <p>هيظهرلك كشف بكل طلاب المجموعة عشان تسجّل حضورهم.</p>
  `;
  currentRecords = [];
  groupSessions = [];
  isExistingSession = false;
  savedHint.textContent = "";
  clearSaveMessage();
}

function showSaveMessage(text, type) {
  saveMessage.textContent = text;
  saveMessage.className = `message ${type}`;
}

function clearSaveMessage() {
  saveMessage.textContent = "";
  saveMessage.className = "message";
}

function showContent() {
  loadingEl.classList.add("hidden");
  errorEl.classList.add("hidden");
  contentEl.classList.remove("hidden");
}

function showError(message) {
  loadingEl.classList.add("hidden");
  contentEl.classList.add("hidden");
  errorTextEl.textContent = message;
  errorEl.classList.remove("hidden");
}

// حماية من XSS
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}