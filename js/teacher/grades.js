// ============================================================
// grades.js
// شاشة عرض نتائج امتحان معين للمدرس:
//  - مين من طلاب المجموعة سلّم ومين لسه
//  - درجة كل طالب ونسبته والوقت اللي استغرقه
//  - إحصائيات عامة: عدد المسلّمين، المتوسط، أعلى وأقل درجة
// ============================================================

// ---------- 1. قراءة examId من رابط الصفحة ----------
// الصفحة بتتفتح بالشكل: grades.html?examId=xxxxx
const urlParams = new URLSearchParams(window.location.search);
const examId = urlParams.get('examId');

// ---------- 2. عناصر الصفحة (DOM) ----------
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const contentWrapper = document.getElementById('contentWrapper');

const examTitleEl = document.getElementById('examTitle');
const examMetaEl = document.getElementById('examMeta');

const statSubmittedEl = document.getElementById('statSubmitted');
const statAverageEl = document.getElementById('statAverage');
const statHighestEl = document.getElementById('statHighest');
const statLowestEl = document.getElementById('statLowest');

const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const studentsListEl = document.getElementById('studentsList');
const emptyStateEl = document.getElementById('emptyState');
const backBtn = document.getElementById('backBtn');

// نخزن كل الصفوف هنا عشان نقدر نبحث/نرتب من غير ما نرجع نجيب البيانات تاني
let allRows = [];

// ---------- 3. لو مفيش examId في الرابط، ارجع للوحة التحكم ----------
if (!examId) {
  window.location.href = 'teacher-dashboard.html';
}

if (backBtn) {
  backBtn.addEventListener('click', () => {
    window.location.href = 'teacher-dashboard.html';
  });
}

// ---------- 4. التحقق من تسجيل الدخول قبل عرض أي بيانات ----------
firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = '../index.html';
    return;
  }
  await loadGradesData(user.uid);
});

// ============================================================
// الدالة الرئيسية: تجيب بيانات الامتحان + الطلاب + التسليمات
// ============================================================
async function loadGradesData(teacherUid) {
  try {
    showLoading(true);
    const db = firebase.firestore();

    // --- أ. جيب بيانات الامتحان ---
    const examSnap = await db.collection('exams').doc(examId).get();
    if (!examSnap.exists) {
      showError('هذا الامتحان غير موجود أو تم حذفه.');
      return;
    }
    const exam = examSnap.data();

    // تأكيد أمني: الامتحان لازم يكون ملك نفس المدرس المسجل دخوله
    if (exam.teacherId !== teacherUid) {
      showError('لا تملك صلاحية لعرض نتائج هذا الامتحان.');
      return;
    }

    renderExamHeader(exam);

    // --- ب. جيب كل طلاب المجموعات المرتبطة بالامتحان ---
    const groupIds = exam.groupIds || [];
    const students = await getStudentsInGroups(db, groupIds);

    // --- ج. جيب كل التسليمات (submissions) الخاصة بهذا الامتحان ---
    const submissionsSnap = await db.collection('submissions')
      .where('examId', '==', examId)
      .get();

    // نحوّلها لـ Map: studentId -> بيانات التسليم، عشان نلاقي بسرعة
    const submissionsByStudent = {};
    submissionsSnap.forEach((doc) => {
      const sub = doc.data();
      submissionsByStudent[sub.studentId] = sub;
    });

    // --- د. ادمج الطلاب مع تسليماتهم (لو موجودة) ---
    allRows = students.map((student) => {
      const sub = submissionsByStudent[student.id];
      return {
        studentId: student.id,
        fullName: student.fullName || 'بدون اسم',
        studentCode: student.studentId || '-',
        submitted: !!sub,
        status: sub ? sub.status : 'not_submitted', // queued / graded / not_submitted
        score: sub ? sub.score : null,
        totalPoints: sub ? sub.totalPoints : exam.totalPoints,
        percentage: sub && typeof sub.percentage === 'number' ? sub.percentage : null,
        timeSpent: sub ? sub.totalTimeSpent : null,
      };
    });

    renderStats(allRows);
    renderStudentsList();

    showLoading(false);
  } catch (err) {
    console.error('Error loading grades:', err);
    showError('حدث خطأ أثناء تحميل النتائج. حاول تاني.');
  }
}

// ============================================================
// جلب كل الطلاب الموجودين داخل مجموعة (أو أكثر) معينة
// ============================================================
async function getStudentsInGroups(db, groupIds) {
  if (!groupIds.length) return [];

  // استعلام "in" في Firestore بيقبل 10 قيم كحد أقصى في كل مرة
  // فلو عندنا مجموعات أكتر من 10، بنقسمهم لدفعات (chunks)
  const groupChunks = chunkArray(groupIds, 10);

  // أ. اجمع studentIds الفريدة من كل المجموعات
  const studentIdSet = new Set();
  for (const chunk of groupChunks) {
    const groupsSnap = await db.collection('groups')
      .where(firebase.firestore.FieldPath.documentId(), 'in', chunk)
      .get();
    groupsSnap.forEach((doc) => {
      const group = doc.data();
      (group.studentIds || []).forEach((id) => studentIdSet.add(id));
    });
  }

  const studentIds = Array.from(studentIdSet);
  if (!studentIds.length) return [];

  // ب. جيب بيانات كل طالب (بالاسم) من users، برضه على دفعات
  const students = [];
  const idChunks = chunkArray(studentIds, 10);
  for (const chunk of idChunks) {
    const usersSnap = await db.collection('users')
      .where(firebase.firestore.FieldPath.documentId(), 'in', chunk)
      .get();
    usersSnap.forEach((doc) => {
      students.push({ id: doc.id, ...doc.data() });
    });
  }

  return students;
}

// دالة مساعدة: تقسيم مصفوفة لدفعات بحجم معين
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ============================================================
// عرض عنوان الامتحان ومعلوماته العامة
// ============================================================
function renderExamHeader(exam) {
  examTitleEl.textContent = exam.title || 'بدون عنوان';

  const typeLabels = {
    exam: 'امتحان',
    quiz: 'كويز',
    assignment: 'واجب',
    worksheet: 'ورقة عمل',
  };
  const typeLabel = typeLabels[exam.type] || exam.type || '';
  const questionsLabel = `${exam.questionsCount || 0} سؤال`;
  const pointsLabel = `${exam.totalPoints || 0} درجة`;

  examMetaEl.textContent = `${typeLabel} · ${questionsLabel} · ${pointsLabel}`;
}

// ============================================================
// حساب وعرض الإحصائيات العامة (فوق القائمة)
// ============================================================
function renderStats(rows) {
  const total = rows.length;
  const submittedRows = rows.filter((r) => r.submitted);

  statSubmittedEl.textContent = `${submittedRows.length} / ${total}`;

  // الدرجات اللي اتصححت فعلاً بس (مش اللي لسه في الطابور)
  const gradedPercentages = submittedRows
    .filter((r) => r.status === 'graded' && r.percentage !== null)
    .map((r) => r.percentage);

  if (!gradedPercentages.length) {
    statAverageEl.textContent = '—';
    statHighestEl.textContent = '—';
    statLowestEl.textContent = '—';
    return;
  }

  const average = gradedPercentages.reduce((sum, p) => sum + p, 0) / gradedPercentages.length;
  statAverageEl.textContent = `${average.toFixed(1)}%`;
  statHighestEl.textContent = `${Math.max(...gradedPercentages).toFixed(1)}%`;
  statLowestEl.textContent = `${Math.min(...gradedPercentages).toFixed(1)}%`;
}

// ============================================================
// عرض قائمة الطلاب (مع دعم البحث والترتيب)
// ============================================================
function renderStudentsList() {
  const searchTerm = (searchInput.value || '').trim().toLowerCase();
  const sortBy = sortSelect.value;

  let filtered = allRows.filter((r) =>
    r.fullName.toLowerCase().includes(searchTerm) ||
    String(r.studentCode).toLowerCase().includes(searchTerm)
  );

  filtered = sortRows(filtered, sortBy);

  if (!filtered.length) {
    studentsListEl.innerHTML = '';
    emptyStateEl.classList.remove('hidden');
    return;
  }
  emptyStateEl.classList.add('hidden');

  studentsListEl.innerHTML = filtered.map(buildStudentRowHtml).join('');
}

// دالة مساعدة للترتيب
function sortRows(rows, sortBy) {
  const sorted = [...rows];
  if (sortBy === 'name') {
    sorted.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
  } else if (sortBy === 'score_desc') {
    sorted.sort((a, b) => (b.percentage ?? -1) - (a.percentage ?? -1));
  } else if (sortBy === 'score_asc') {
    sorted.sort((a, b) => (a.percentage ?? 999) - (b.percentage ?? 999));
  }
  return sorted;
}

// بناء الـ HTML الخاص بصف طالب واحد
function buildStudentRowHtml(row) {
  const safeName = escapeHtml(row.fullName);
  const safeCode = escapeHtml(String(row.studentCode));

  let statusBadge;
  let scoreDisplay;

  if (!row.submitted) {
    statusBadge = '<span class="grade-badge grade-badge-muted">لم يسلم بعد</span>';
    scoreDisplay = '—';
  } else if (row.status === 'queued') {
    statusBadge = '<span class="grade-badge grade-badge-warning">قيد التصحيح</span>';
    scoreDisplay = '—';
  } else {
    statusBadge = '<span class="grade-badge grade-badge-success">تم التصحيح</span>';
    const pct = row.percentage !== null ? row.percentage.toFixed(1) : '0';
    scoreDisplay = `${row.score} / ${row.totalPoints} (${pct}%)`;
  }

  const timeDisplay = row.timeSpent ? formatDuration(row.timeSpent) : '—';

  return `
    <div class="entity-card grade-row">
      <div class="grade-row-main">
        <div class="grade-row-name">${safeName}</div>
        <div class="grade-row-code">كود الطالب: ${safeCode}</div>
      </div>
      <div class="grade-row-status">${statusBadge}</div>
      <div class="grade-row-score">${scoreDisplay}</div>
      <div class="grade-row-time">${timeDisplay}</div>
    </div>
  `;
}

// تحويل الثواني لصيغة "X د Y ث"
function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes} د ${seconds} ث`;
}

// منع أي كود HTML خبيث في اسم الطالب أو الكود (حماية من XSS)
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

// ============================================================
// دوال التحكم في حالة الشاشة (تحميل / خطأ / محتوى)
// ============================================================
function showLoading(isLoading) {
  loadingState.classList.toggle('hidden', !isLoading);
  contentWrapper.classList.toggle('hidden', isLoading);
  errorState.classList.add('hidden');
}

function showError(message) {
  loadingState.classList.add('hidden');
  contentWrapper.classList.add('hidden');
  errorState.textContent = message;
  errorState.classList.remove('hidden');
}

// ============================================================
// أحداث البحث والترتيب (تحديث فوري من غير إعادة تحميل الصفحة)
// ============================================================
searchInput.addEventListener('input', renderStudentsList);
sortSelect.addEventListener('change', renderStudentsList);