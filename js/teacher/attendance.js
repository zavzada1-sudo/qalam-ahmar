// ============================================
// Attendance Logic - تسجيل حضور الطلاب
// ============================================
//
// فكرة النظام:
//
// 1) الـ QR مربوط بالمدرس مش بالمجموعة:
//    users/{teacherId}.attendanceToken  ← توكن ثابت، بيتجدد بزرار بس
//    فالمدرس بيطبع كود واحد بس مدى الحياة ويعلّقه.
//
// 2) "الحضور المفتوح دلوقتي" متخزّن على المدرس كمان:
//    users/{teacherId}.activeAttendance = { gradeId, groupId, groupName, date }
//    الطالب لما يعمل سكان، الصفحة بتقرا الحقل ده وتعرف يسجّله في أنهي مجموعة.
//
// 3) الغياب ضمني: مفيش سجل = غايب. مش بنكتب سجل لكل طالب مقدمًا.
//
// 4) الطالب مينفعش يسجّل نفسه إلا لو فعلاً في المجموعة المفتوحة
//    (متفروض في Firestore Rules مش هنا بس).
//    المدرس هو الوحيد اللي يقدر يسجّل طالب من مجموعة تانية، وساعتها
//    بيشوف تنبيه بمجموعته الحقيقية.
//
// 5) "متأخر" يدوي بس — الـ QR دايمًا بيسجّل "حاضر".
//
// معرّفات المستندات:
//   attendanceSessions/{groupId}_{date}
//   attendance/{groupId}_{date}_{studentUid}
// ============================================

import { auth, db } from "../../firebase-config.js";
import { onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, documentId, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import { showToast, showConfirm } from "../shared/ui.js";
import { renderSkeleton } from "../shared/states.js";
import { isValidCodeFormat } from "../shared/student-code.js";
import "../shared/theme.js";

// ============================================
// عناصر الصفحة
// ============================================
const loadingEl      = document.getElementById("loadingState");
const errorEl        = document.getElementById("errorState");
const errorTextEl    = document.getElementById("errorText");
const contentEl      = document.getElementById("contentWrapper");

const gradeSelect    = document.getElementById("gradeSelect");
const groupSelect    = document.getElementById("groupSelect");
const dateInput      = document.getElementById("dateInput");
const dateHintEl     = document.getElementById("dateHint");

const sessionCard    = document.getElementById("sessionCard");
const sessionBadge   = document.getElementById("sessionBadge");
const sessionTitle   = document.getElementById("sessionTitle");
const sessionSubtitle= document.getElementById("sessionSubtitle");
const toggleSessionBtn = document.getElementById("toggleSessionBtn");

const qrCodeBox      = document.getElementById("qrCodeBox");
const qrTeacherName  = document.getElementById("qrTeacherName");
const printQrBtn     = document.getElementById("printQrBtn");
const renewTokenBtn  = document.getElementById("renewTokenBtn");

const manualCard     = document.getElementById("manualCard");
const manualCodeInput= document.getElementById("manualCodeInput");
const manualStatusSelect = document.getElementById("manualStatusSelect");
const manualSubmitBtn= document.getElementById("manualSubmitBtn");

const statsWrapper   = document.getElementById("statsWrapper");
const statTotal      = document.getElementById("statTotal");
const statPresent    = document.getElementById("statPresent");
const statLate       = document.getElementById("statLate");
const statAbsent     = document.getElementById("statAbsent");

const listWrapper    = document.getElementById("listWrapper");
const searchInput    = document.getElementById("searchInput");
const filterSelect   = document.getElementById("filterSelect");
const studentsListEl = document.getElementById("studentsList");
const listEmptyEl    = document.getElementById("listEmpty");

const pickPrompt     = document.getElementById("pickPrompt");
const printReportLink= document.getElementById("printReportLink");

// ============================================
// حالة الصفحة (State)
// ============================================
let currentTeacherId = null;
let teacherData      = null;   // مستند المدرس كامل
let allGrades        = [];     // [{ id, gradeName }]
let allGroups        = [];     // [{ id, gradeId, groupName, studentIds[] }]

let selectedGroup    = null;   // كائن المجموعة المختارة
let selectedDate     = todayStr();

let groupStudents    = [];     // [{ uid, fullName, studentId }]
let recordsMap       = new Map(); // studentUid → سجل الحضور

// ============================================
// نقطة البداية
// ============================================
onAuthStateChanged(auth, async (user) => {
  // مش مسجّل دخول؟ روح لصفحة الدخول
  if (!user) {
    window.location.href = "../index.html";
    return;
  }

  try {
    currentTeacherId = user.uid;

    // ---- نقرا مستند المدرس ونتأكد إنه فعلاً مدرس ----
    const userSnap = await getDoc(doc(db, "users", currentTeacherId));

    if (!userSnap.exists()) {
      showError("الحساب غير مكتمل. كلّم الدعم.");
      return;
    }

    teacherData = userSnap.data();

    if (teacherData.role !== "teacher") {
      showError("الصفحة دي للمدرسين بس.");
      return;
    }

    // ---- نتأكد إن عنده توكن للـ QR، ولو مش عنده نولّدله واحد ----
    if (!teacherData.attendanceToken) {
      const newToken = generateToken();
      await updateDoc(doc(db, "users", currentTeacherId), {
        attendanceToken: newToken
      });
      teacherData.attendanceToken = newToken;
    }

    // ---- نحمّل السنين والمجموعات ----
    await loadGradesAndGroups();

    // ---- نجهّز الواجهة ----
    dateInput.value = selectedDate;
    renderQrCode();
    qrTeacherName.textContent = `أ/ ${teacherData.fullName || ""}`;

    loadingEl.classList.add("hidden");
    contentEl.classList.remove("hidden");

  } catch (error) {
    console.error("Attendance init error:", error);
    showError("تعذر تحميل الصفحة. تأكد من اتصالك بالإنترنت.");
  }
});

// ============================================
// تحميل السنين والمجموعات بتاعة المدرس
// ============================================
// ملاحظة مهمة: لازم where("teacherId", "==", ...) في الاتنين عشان
// يطابق شرط الـ Security Rules، وإلا Firestore بيرفض الاستعلام كله.
async function loadGradesAndGroups() {
  const [gradesSnap, groupsSnap] = await Promise.all([
    getDocs(query(collection(db, "grades"), where("teacherId", "==", currentTeacherId))),
    getDocs(query(collection(db, "groups"), where("teacherId", "==", currentTeacherId)))
  ]);

  allGrades = [];
  gradesSnap.forEach((d) => allGrades.push({ id: d.id, ...d.data() }));

  allGroups = [];
  groupsSnap.forEach((d) => allGroups.push({ id: d.id, ...d.data() }));

  // نملا قائمة السنين
  gradeSelect.innerHTML = `<option value="">اختر السنة...</option>`;
  allGrades.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.gradeName || "بدون اسم";
    gradeSelect.appendChild(opt);
  });

  if (allGrades.length === 0) {
    showToast("لسه مضفتش سنين دراسية. ضيفها من صفحة الفصول الأول.", "error");
  }
}

// ============================================
// اختيار السنة → نملا المجموعات
// ============================================
gradeSelect.addEventListener("change", () => {
  const gradeId = gradeSelect.value;

  groupSelect.innerHTML = `<option value="">اختر المجموعة...</option>`;
  groupSelect.disabled = !gradeId;

  if (!gradeId) {
    resetGroupView();
    return;
  }

  const groups = allGroups.filter((g) => g.gradeId === gradeId);

  groups.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.groupName || "بدون اسم";
    groupSelect.appendChild(opt);
  });

  if (groups.length === 0) {
    showToast("السنة دي مفيهاش مجموعات لسه.", "error");
  }

  resetGroupView();
});

// ============================================
// اختيار المجموعة → نحمّل الطلبة والحضور
// ============================================
groupSelect.addEventListener("change", async () => {
  const groupId = groupSelect.value;

  if (!groupId) {
    resetGroupView();
    return;
  }

  selectedGroup = allGroups.find((g) => g.id === groupId) || null;
  await loadAttendanceView();
});

// ============================================
// تغيير التاريخ → نعيد التحميل
// ============================================
dateInput.addEventListener("change", async () => {
  selectedDate = dateInput.value || todayStr();

  // تنبيه لو التاريخ مش النهاردة
  dateHintEl.classList.toggle("hidden", selectedDate === todayStr());

  if (selectedGroup) await loadAttendanceView();
});

// ============================================
// تحميل شاشة الحضور للمجموعة + التاريخ المختارين
// ============================================
async function loadAttendanceView() {
  if (!selectedGroup) return;

  // نظهر الأقسام المخفية
  pickPrompt.classList.add("hidden");
  sessionCard.classList.remove("hidden");
  manualCard.classList.remove("hidden");
  statsWrapper.classList.remove("hidden");
  listWrapper.classList.remove("hidden");

  // سكيلتون أثناء التحميل
  renderSkeleton(studentsListEl, { type: "row", count: 5 });

  try {
    const studentIds = selectedGroup.studentIds || [];

    // نحمّل بيانات الطلبة وسجلات الحضور مع بعض
    const [students, records] = await Promise.all([
      fetchUsersByIds(studentIds),
      fetchAttendanceRecords(selectedGroup.id, selectedDate)
    ]);

    groupStudents = students;

    recordsMap = new Map();
    records.forEach((r) => recordsMap.set(r.studentUid, r));

    renderSessionState();
    renderList();

  } catch (error) {
    console.error("Load attendance view error:", error);
    studentsListEl.innerHTML = "";
    showToast("تعذر تحميل بيانات الحضور.", "error");
  }
}

// ============================================
// جلب بيانات مستخدمين بالـ IDs
// ============================================
// Firestore بيسمح بـ 10 عناصر بس في "in"، فبنقسّمهم مجموعات
async function fetchUsersByIds(ids) {
  if (!ids || ids.length === 0) return [];

  const results = [];

  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const snap = await getDocs(
      query(collection(db, "users"), where(documentId(), "in", chunk))
    );
    snap.forEach((d) => results.push({ uid: d.id, ...d.data() }));
  }

  // ترتيب أبجدي بالاسم
  results.sort((a, b) =>
    (a.fullName || "").localeCompare(b.fullName || "", "ar")
  );

  return results;
}

// ============================================
// جلب سجلات الحضور لمجموعة في تاريخ معيّن
// ============================================
async function fetchAttendanceRecords(groupId, date) {
  const snap = await getDocs(query(
    collection(db, "attendance"),
    where("teacherId", "==", currentTeacherId),  // لازم يطابق الـ Rules
    where("groupId", "==", groupId),
    where("date", "==", date)
  ));

  const records = [];
  snap.forEach((d) => records.push({ id: d.id, ...d.data() }));
  return records;
}

// ============================================
// عرض حالة الحضور (مفتوح / مقفول)
// ============================================
function renderSessionState() {
  const active = teacherData.activeAttendance;
  const isToday = selectedDate === todayStr();

  // الحضور مفتوح للمجموعة دي النهاردة؟
  const isOpenForThisGroup =
    active &&
    active.groupId === selectedGroup.id &&
    active.date === todayStr();

  if (isOpenForThisGroup) {
    sessionBadge.textContent = "مفتوح";
    sessionBadge.className = "att-badge open";
    sessionTitle.textContent = "الحضور مفتوح دلوقتي";
    sessionSubtitle.textContent =
      "أي طالب في المجموعة دي يعمل سكان للكود هيتسجّل حاضر تلقائي.";
    toggleSessionBtn.textContent = "اقفل الحضور";
    toggleSessionBtn.className = "btn btn-outline";
    toggleSessionBtn.disabled = false;

  } else if (active && active.date === todayStr()) {
    // مفتوح بس لمجموعة تانية
    sessionBadge.textContent = "مقفول";
    sessionBadge.className = "att-badge closed";
    sessionTitle.textContent = "الحضور مفتوح لمجموعة تانية";
    sessionSubtitle.textContent =
      `دلوقتي مفتوح لـ "${active.groupName || "مجموعة تانية"}". لو فتحته هنا هيتقفل هناك.`;
    toggleSessionBtn.textContent = "افتح الحضور هنا";
    toggleSessionBtn.className = "btn btn-primary";
    toggleSessionBtn.disabled = false;

  } else {
    sessionBadge.textContent = "مقفول";
    sessionBadge.className = "att-badge closed";
    sessionTitle.textContent = "الحضور مقفول";
    sessionSubtitle.textContent = isToday
      ? "افتح الحضور عشان الطلبة يقدروا يسجّلوا بالـ QR."
      : "مش هتقدر تفتح الحضور في تاريخ قديم — سجّل يدويًا بس.";
    toggleSessionBtn.textContent = "افتح الحضور دلوقتي";
    toggleSessionBtn.className = "btn btn-primary";
    toggleSessionBtn.disabled = !isToday;  // فتح الحضور للنهاردة بس
  }
}

// ============================================
// فتح / قفل الحضور
// ============================================
toggleSessionBtn.addEventListener("click", async () => {
  if (!selectedGroup) return;

  const active = teacherData.activeAttendance;
  const today = todayStr();

  const isOpenForThisGroup =
    active && active.groupId === selectedGroup.id && active.date === today;

  setButtonLoading(toggleSessionBtn, true);

  try {
    if (isOpenForThisGroup) {
      // ---- قفل ----
      await closeActiveSession();
      showToast("تم قفل الحضور.", "success");

    } else {
      // ---- فتح ----
      // لو فيه حضور مفتوح لمجموعة تانية، نقفله الأول
      if (active && active.date === today) {
        await closeActiveSession();
      }

      const sessionId = `${selectedGroup.id}_${today}`;

      // نسجّل إن فيه حصة النهاردة (بيفرّق بين "مفيش حصة" و"الكل غاب")
      await setDoc(doc(db, "attendanceSessions", sessionId), {
        teacherId: currentTeacherId,
        gradeId:   selectedGroup.gradeId,
        groupId:   selectedGroup.id,
        groupName: selectedGroup.groupName || "",
        date:      today,
        openedAt:  serverTimestamp(),
        closedAt:  null
      }, { merge: true });

      const activeData = {
        gradeId:   selectedGroup.gradeId,
        groupId:   selectedGroup.id,
        groupName: selectedGroup.groupName || "",
        date:      today,
        openedAt:  Date.now()
      };

      await updateDoc(doc(db, "users", currentTeacherId), {
        activeAttendance: activeData
      });

      teacherData.activeAttendance = activeData;
      showToast("الحضور اتفتح — الطلبة يقدروا يسجّلوا دلوقتي.", "success");
    }

    renderSessionState();

  } catch (error) {
    console.error("Toggle session error:", error);
    showToast("تعذر تغيير حالة الحضور.", "error");
  } finally {
    setButtonLoading(toggleSessionBtn, false);
  }
});

// ============================================
// قفل الحضور المفتوح حاليًا (أيًا كانت مجموعته)
// ============================================
async function closeActiveSession() {
  const active = teacherData.activeAttendance;
  if (!active) return;

  const sessionId = `${active.groupId}_${active.date}`;

  // نحدّث وقت القفل في الجلسة (لو المستند اتمسح لأي سبب منوقعش الصفحة)
  try {
    await updateDoc(doc(db, "attendanceSessions", sessionId), {
      closedAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("Close session doc warning:", error);
  }

  await updateDoc(doc(db, "users", currentTeacherId), {
    activeAttendance: null
  });

  teacherData.activeAttendance = null;
}

// ============================================
// توليد وعرض الـ QR
// ============================================
function renderQrCode() {
  qrCodeBox.innerHTML = "";  // نفضّيه الأول عشان التجديد

  const scanUrl =
    `${window.location.origin}/pages/attendance-scan.html` +
    `?t=${currentTeacherId}&k=${teacherData.attendanceToken}`;

  new QRCode(qrCodeBox, {
    text: scanUrl,
    width: 190,
    height: 190,
    colorDark: "#2c3e50",
    colorLight: "#ffffff"
  });
}

// توليد توكن عشوائي (نستخدم crypto لو متاح)
function generateToken() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";

  for (let i = 0; i < 24; i++) {
    let rand;
    if (window.crypto?.getRandomValues) {
      const buf = new Uint32Array(1);
      window.crypto.getRandomValues(buf);
      rand = buf[0] % chars.length;
    } else {
      rand = Math.floor(Math.random() * chars.length);
    }
    token += chars[rand];
  }

  return token;
}

// ============================================
// طباعة الكود
// ============================================
printQrBtn.addEventListener("click", () => {
  window.print();
});

// ============================================
// تجديد الكود (بيلغي أي كود مطبوع قديم)
// ============================================
renewTokenBtn.addEventListener("click", async () => {
  const confirmed = await showConfirm({
    title: "تجديد كود الحضور",
    message:
      "أي كود QR مطبوع قديم هيبطل يشتغل فورًا، وهتحتاج تطبع الجديد وتعلّقه. " +
      "متأكد إنك عايز تجدّده؟",
    confirmLabel: "أيوة، جدّده",
    cancelLabel: "إلغاء",
    danger: true
  });

  if (!confirmed) return;

  setButtonLoading(renewTokenBtn, true);

  try {
    const newToken = generateToken();

    await updateDoc(doc(db, "users", currentTeacherId), {
      attendanceToken: newToken
    });

    teacherData.attendanceToken = newToken;
    renderQrCode();

    showToast("تم تجديد الكود. اطبع الكود الجديد وعلّقه.", "success");

  } catch (error) {
    console.error("Renew token error:", error);
    showToast("تعذر تجديد الكود.", "error");
  } finally {
    setButtonLoading(renewTokenBtn, false);
  }
});

// ============================================
// التسجيل اليدوي بكود الطالب
// ============================================
manualSubmitBtn.addEventListener("click", registerManually);

// الضغط على Enter في خانة الكود = تسجيل
manualCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    registerManually();
  }
});

async function registerManually() {
  if (!selectedGroup) {
    showToast("اختر المجموعة الأول.", "error");
    return;
  }

  // بحث غير حساس لحالة الأحرف: بنحوّل لكابيتال دايمًا
  const code = manualCodeInput.value.trim().toUpperCase();

  if (!code) {
    showToast("اكتب كود الطالب.", "error");
    manualCodeInput.focus();
    return;
  }

  if (!isValidCodeFormat(code)) {
    showToast("شكل الكود غلط. المفروض حرفين و3 أرقام (مثال: TK492).", "error");
    manualCodeInput.focus();
    return;
  }

  setButtonLoading(manualSubmitBtn, true);

  try {
    // ---- 1. ندوّر على الطالب بالكود ----
    const snap = await getDocs(query(
      collection(db, "users"),
      where("studentId", "==", code)
    ));

    if (snap.empty) {
      showToast(`مفيش طالب بالكود ${code}.`, "error");
      return;
    }

    const studentDoc = snap.docs[0];
    const student = { uid: studentDoc.id, ...studentDoc.data() };

    if (student.role !== "student") {
      showToast("الكود ده مش لطالب.", "error");
      return;
    }

    // ---- 2. هل هو في المجموعة دي؟ ----
    const inThisGroup = (selectedGroup.studentIds || []).includes(student.uid);
    let otherGroupNames = [];

    if (!inThisGroup) {
      // ندوّر على مجموعاته الحقيقية عند المدرس ده
      otherGroupNames = allGroups
        .filter((g) => (g.studentIds || []).includes(student.uid))
        .map((g) => g.groupName || "بدون اسم");

      const groupsText = otherGroupNames.length
        ? `مجموعته: ${otherGroupNames.join("، ")}`
        : "مش مسجّل في أي مجموعة عندك.";

      const confirmed = await showConfirm({
        title: "الطالب ده مش من المجموعة دي",
        message:
          `${student.fullName || "الطالب"} (${code}) مش في "${selectedGroup.groupName}". ` +
          `${groupsText}\n\nتسجّله حضور هنا برضه؟`,
        confirmLabel: "أيوة، سجّله",
        cancelLabel: "إلغاء"
      });

      if (!confirmed) return;
    }

    // ---- 3. هل هو مسجّل قبل كده النهاردة؟ ----
    const existing = recordsMap.get(student.uid);
    const newStatus = manualStatusSelect.value;

    if (existing) {
      if (existing.status === newStatus) {
        showToast(`${student.fullName} مسجّل بالفعل.`, "error");
        return;
      }

      const confirmed = await showConfirm({
        title: "تعديل الحالة",
        message:
          `${student.fullName} مسجّل حاليًا "${statusLabel(existing.status)}". ` +
          `تغيّرها لـ "${statusLabel(newStatus)}"؟`,
        confirmLabel: "غيّرها",
        cancelLabel: "إلغاء"
      });

      if (!confirmed) return;
    }

    // ---- 4. نكتب السجل ----
    await saveRecord({
      student,
      status: newStatus,
      method: "manual",
      fromOtherGroup: !inThisGroup,
      otherGroupNames
    });

    showToast(
      `تم تسجيل ${student.fullName} — ${statusLabel(newStatus)}.`,
      "success"
    );

    manualCodeInput.value = "";
    manualCodeInput.focus();
    renderList();

  } catch (error) {
    console.error("Manual register error:", error);
    showToast("تعذر تسجيل الحضور.", "error");
  } finally {
    setButtonLoading(manualSubmitBtn, false);
  }
}

// ============================================
// كتابة سجل حضور (بيستخدمها التسجيل اليدوي وأزرار الصفوف)
// ============================================
async function saveRecord({ student, status, method, fromOtherGroup, otherGroupNames }) {
  const recordId = `${selectedGroup.id}_${selectedDate}_${student.uid}`;

  const record = {
    teacherId:      currentTeacherId,
    gradeId:        selectedGroup.gradeId,
    groupId:        selectedGroup.id,
    groupName:      selectedGroup.groupName || "",
    date:           selectedDate,
    studentUid:     student.uid,
    studentName:    student.fullName || "",
    studentCode:    student.studentId || "",
    status,
    method,
    fromOtherGroup: !!fromOtherGroup,
    otherGroupNames: otherGroupNames || [],
    recordedAt:     serverTimestamp()
  };

  await setDoc(doc(db, "attendance", recordId), record);

  // نحدّث النسخة المحلية عشان الواجهة تتحدّث فورًا من غير إعادة تحميل
  recordsMap.set(student.uid, { id: recordId, ...record });
}

// ============================================
// عرض قائمة الطلبة
// ============================================
function renderList() {
  const searchTerm = (searchInput.value || "").trim().toLowerCase();
  const filterValue = filterSelect.value;

  // ---- نبني الصفوف: طلبة المجموعة + أي طالب غريب اتسجّل ----
  const rows = [];

  groupStudents.forEach((student) => {
    const record = recordsMap.get(student.uid);
    rows.push({
      uid:      student.uid,
      name:     student.fullName || "بدون اسم",
      code:     student.studentId || "—",
      status:   record ? record.status : "absent",
      method:   record ? record.method : null,
      foreign:  false,
      otherGroups: []
    });
  });

  // الطلبة اللي اتسجّلوا وهم مش في المجموعة
  const groupUids = new Set(groupStudents.map((s) => s.uid));
  recordsMap.forEach((record) => {
    if (groupUids.has(record.studentUid)) return;

    rows.push({
      uid:      record.studentUid,
      name:     record.studentName || "بدون اسم",
      code:     record.studentCode || "—",
      status:   record.status,
      method:   record.method,
      foreign:  true,
      otherGroups: record.otherGroupNames || []
    });
  });

  // ---- الإحصائيات (قبل الفلترة) ----
  updateStats(rows);

  // ---- الفلترة والبحث ----
  const visible = rows.filter((row) => {
    if (filterValue !== "all" && row.status !== filterValue) return false;

    if (searchTerm) {
      const haystack = `${row.name} ${row.code}`.toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }

    return true;
  });

  // ---- العرض ----
  if (rows.length === 0) {
    studentsListEl.innerHTML = "";
    listEmptyEl.classList.remove("hidden");
    listEmptyEl.querySelector("h3").textContent = "المجموعة دي فاضية";
    listEmptyEl.querySelector("p").textContent =
      "مفيش طلبة في المجموعة دي لسه.";
    return;
  }

  if (visible.length === 0) {
    studentsListEl.innerHTML = "";
    listEmptyEl.classList.remove("hidden");
    listEmptyEl.querySelector("h3").textContent = "مفيش طلبة مطابقين";
    listEmptyEl.querySelector("p").textContent =
      "جرّب تغيّر كلمة البحث أو الفلتر.";
    return;
  }

  listEmptyEl.classList.add("hidden");

  studentsListEl.innerHTML = visible.map((row) => {
    const foreignNote = row.foreign
      ? `<span class="att-foreign-note">⚠ مش من المجموعة دي${
          row.otherGroups.length ? ` — مجموعته: ${escapeHtml(row.otherGroups.join("، "))}` : ""
        }</span>`
      : "";

    const methodBadge = row.method === "qr"
      ? `<span class="att-method-badge">QR</span>`
      : "";

    return `
      <div class="gd-row ${row.foreign ? "att-row-foreign" : ""}">
        <div class="gd-row-info">
          <span class="gd-row-name">${escapeHtml(row.name)}</span>
          <span class="gd-row-code">${escapeHtml(row.code)}</span>
          ${foreignNote}
        </div>

        <div class="att-row-status">
          <span class="att-status-badge ${row.status}">
            ${statusLabel(row.status)}
          </span>${methodBadge}
        </div>

        <div class="gd-row-actions">
          <button class="gd-btn" data-action="present" data-uid="${row.uid}"
            ${row.status === "present" ? "disabled" : ""}>حاضر</button>
          <button class="gd-btn" data-action="late" data-uid="${row.uid}"
            ${row.status === "late" ? "disabled" : ""}>متأخر</button>
          <button class="gd-btn" data-action="remove" data-uid="${row.uid}"
            ${row.status === "absent" ? "disabled" : ""}>شيل</button>
        </div>
      </div>
    `;
  }).join("");
}

// ============================================
// الإحصائيات
// ============================================
function updateStats(rows) {
  // إجمالي طلبة المجموعة (من غير الغرباء)
  const total = groupStudents.length;

  let present = 0;
  let late = 0;

  rows.forEach((row) => {
    if (row.status === "present") present++;
    if (row.status === "late") late++;
  });

  // الغياب = طلبة المجموعة اللي مالهمش سجل
  const absent = groupStudents.filter((s) => !recordsMap.has(s.uid)).length;

  statTotal.textContent   = total;
  statPresent.textContent = present;
  statLate.textContent    = late;
  statAbsent.textContent  = absent;
}

// ============================================
// أزرار الصفوف (حاضر / متأخر / شيل)
// ============================================
// بنستخدم Event Delegation: مستمع واحد على القايمة كلها بدل
// مستمع لكل زرار — أسرع وبيشتغل مع الصفوف الجديدة تلقائيًا
studentsListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  const uid = btn.dataset.uid;

  btn.disabled = true;

  try {
    if (action === "remove") {
      await removeRecord(uid);
    } else {
      await changeStatus(uid, action);
    }
    renderList();
  } catch (error) {
    console.error("Row action error:", error);
    showToast("تعذر تنفيذ العملية.", "error");
    btn.disabled = false;
  }
});

// تغيير حالة طالب
async function changeStatus(uid, status) {
  const existing = recordsMap.get(uid);

  // لو عنده سجل بالفعل، نحدّث الحالة بس
  if (existing) {
    await updateDoc(doc(db, "attendance", existing.id), {
      status,
      method: "manual",     // أي تعديل من المدرس بيبقى يدوي
      recordedAt: serverTimestamp()
    });

    existing.status = status;
    existing.method = "manual";
    recordsMap.set(uid, existing);

    showToast(`اتغيّرت لـ "${statusLabel(status)}".`, "success");
    return;
  }

  // مالوش سجل → طالب غايب بنسجّله دلوقتي
  const student = groupStudents.find((s) => s.uid === uid);
  if (!student) {
    showToast("مش لاقي بيانات الطالب.", "error");
    return;
  }

  await saveRecord({
    student,
    status,
    method: "manual",
    fromOtherGroup: false,
    otherGroupNames: []
  });

  showToast(`تم تسجيل ${student.fullName} — ${statusLabel(status)}.`, "success");
}

// شيل سجل الحضور (يرجع غايب)
async function removeRecord(uid) {
  const existing = recordsMap.get(uid);
  if (!existing) return;

  const confirmed = await showConfirm({
    title: "شيل التسجيل",
    message: `تشيل تسجيل حضور ${existing.studentName}؟ هيرجع "غايب".`,
    confirmLabel: "شيله",
    cancelLabel: "إلغاء",
    danger: true
  });

  if (!confirmed) {
    renderList();  // نرجّع الزرار لحالته
    return;
  }

  await deleteDoc(doc(db, "attendance", existing.id));
  recordsMap.delete(uid);

  showToast("تم شيل التسجيل.", "success");
}

// ============================================
// البحث والفلترة
// ============================================
searchInput.addEventListener("input", renderList);
filterSelect.addEventListener("change", renderList);

// ============================================
// رابط كشف الغياب (بنمرر المجموعة والتاريخ)
// ============================================
function updateReportLink() {
  const params = new URLSearchParams();
  if (selectedGroup) {
    params.set("gradeId", selectedGroup.gradeId);
    params.set("groupId", selectedGroup.id);
  }
  params.set("date", selectedDate);

  printReportLink.href = `print-attendance.html?${params.toString()}`;
}

// ============================================
// دوال مساعدة
// ============================================

// تصفير العرض لما مفيش مجموعة مختارة
function resetGroupView() {
  selectedGroup = null;
  groupStudents = [];
  recordsMap = new Map();

  sessionCard.classList.add("hidden");
  manualCard.classList.add("hidden");
  statsWrapper.classList.add("hidden");
  listWrapper.classList.add("hidden");
  pickPrompt.classList.remove("hidden");

  studentsListEl.innerHTML = "";
  updateReportLink();
}

// تاريخ النهاردة بصيغة YYYY-MM-DD بالتوقيت المحلي
// (مش بنستخدم toISOString مباشرة لأنها بتحوّل لـ UTC وممكن ترجّع يوم غلط)
function todayStr() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

// اسم الحالة بالعربي
function statusLabel(status) {
  if (status === "present") return "حاضر";
  if (status === "late") return "متأخر";
  return "غايب";
}

// حالة التحميل على الزرار
function setButtonLoading(btn, isLoading) {
  if (isLoading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = "لحظة...";
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
    btn.disabled = false;
  }
}

// عرض حالة خطأ عامة
function showError(message) {
  loadingEl.classList.add("hidden");
  contentEl.classList.add("hidden");
  errorEl.classList.remove("hidden");
  errorTextEl.textContent = message;
}

// منع XSS: أي نص جاي من قاعدة البيانات لازم يعدي من هنا قبل innerHTML
function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

// نحدّث رابط التقرير مع أي تغيير
gradeSelect.addEventListener("change", updateReportLink);
groupSelect.addEventListener("change", updateReportLink);
dateInput.addEventListener("change", updateReportLink);