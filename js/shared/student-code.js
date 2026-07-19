// ============================================
// Student Code - توليد وحجز كود الطالب
// ============================================
//
// شكل الكود: حرفين + 3 أرقام  →  TK492
//
// ليه كوليكشن منفصل (studentCodes)؟
// عشان نتأكد إن الكود مش مستخدم، محتاجين نستعلم. بس قاعدة users
// معتمدة على محتوى المستند، والطالب مش هيقدر يعمل استعلام عليها.
// فبنعمل كوليكشن بسيط معرّف كل مستند فيه = الكود نفسه:
//   studentCodes/TK492 → { uid: "...", createdAt: ... }
// كده الفحص بيبقى قراءة مستند واحد (مسموحة ورخيصة) بدل استعلام.
//
// ومنع التضارب: القاعدة بتسمح بـ create بس، من غير update.
// يعني لو اتنين حاولوا يحجزوا نفس الكود في نفس اللحظة، التاني
// محاولته هتبقى "تعديل" على مستند موجود → Firestore يرفضها تلقائيًا،
// فنجرب كود تاني. مفيش حاجة اسمها كودين متكررين.
// ============================================

import { db } from "../../firebase-config.js";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// ------- إعدادات شكل الكود -------
// لو حبيت تغيّر الشكل بعدين، غيّر الرقمين دول وبس.
const LETTERS_COUNT = 2;
const DIGITS_COUNT  = 3;

// الحروف المسموحة: 22 حرف (شيلنا I و O و Q و S عشان ما يتلخبطوش
// مع الأرقام 1 و 0 و 5 وقت القراءة أو الكتابة)
const ALLOWED_LETTERS = "ABCDEFGHJKLMNPRTUVWXYZ";

// أقصى عدد محاولات لتوليد كود فاضي قبل ما نستسلم
const MAX_ATTEMPTS = 12;

// ============================================
// توليد كود عشوائي (من غير أي فحص)
// ============================================
function generateRandomCode() {
  let code = "";

  // الحروف الأول
  for (let i = 0; i < LETTERS_COUNT; i++) {
    code += ALLOWED_LETTERS[randomInt(ALLOWED_LETTERS.length)];
  }

  // بعدين الأرقام (بنكمّل أصفار من الشمال لو الرقم قصير: 7 → 007)
  for (let i = 0; i < DIGITS_COUNT; i++) {
    code += randomInt(10);
  }

  return code;
}

// رقم عشوائي من 0 لحد (max - 1)
// بنستخدم crypto لو متاح لأنه توزيعه أعدل من Math.random
function randomInt(max) {
  if (window.crypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    window.crypto.getRandomValues(buffer);
    return buffer[0] % max;
  }
  return Math.floor(Math.random() * max);
}

// ============================================
// حجز كود جديد وربطه بالمستخدم
// بترجع الكود اللي اتحجز
// ============================================
export async function reserveStudentCode(uid) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateRandomCode();

    try {
      // ---- 1. نشوف الكود محجوز قبل كده ولا لأ ----
      const codeRef = doc(db, "studentCodes", code);
      const existing = await getDoc(codeRef);

      if (existing.exists()) {
        // لو الكود بتاعنا أصلاً (حصل ونجح الحجز بس فشل تحديث users)
        // نستخدمه عادي بدل ما نحرقه
        if (existing.data().uid === uid) return code;
        continue; // محجوز لحد تاني → نجرب كود جديد
      }

      // ---- 2. نحجزه ----
      // لو حد تاني سبقنا بجزء من الثانية، ده هيبقى "تعديل" مش "إنشاء"
      // والقاعدة هترفضه → هننزل للـ catch ونجرب تاني
      await setDoc(codeRef, {
        uid,
        createdAt: serverTimestamp()
      });

      return code;

    } catch (error) {
      // permission-denied هنا معناها الأغلب إن حد سبقنا للكود ده
      if (error.code === "permission-denied") continue;
      throw error; // أي خطأ تاني (شبكة مثلاً) نرفعه لبرّه
    }
  }

  throw new Error("تعذر توليد كود فريد للطالب بعد عدة محاولات");
}

// ============================================
// التأكد إن الطالب عنده كود، ولو مش عنده نولّدله واحد
//
// بنستخدمها في مكانين:
//  1. عند التسجيل (طالب جديد)
//  2. عند تسجيل دخول طالب قديم اتسجّل قبل نظام الأكواد
//
// ملاحظة مهمة: الطالب هو اللي بينفّذ دي، مش المدرس — لأن قاعدة users
// بتسمح للمستخدم يكتب في مستنده هو بس.
// ============================================
export async function ensureStudentCode(uid) {
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) return null;

  const existingCode = userSnap.data().studentId;

  // عنده كود بالشكل الجديد؟ خلاص مفيش حاجة نعملها
  if (existingCode && isValidCodeFormat(existingCode)) {
    return existingCode;
  }

  // مش عنده كود، أو عنده كود قديم بشكل مختلف (زي STD1234) → نولّد جديد
  const newCode = await reserveStudentCode(uid);
  await updateDoc(userRef, { studentId: newCode });

  return newCode;
}

// ============================================
// التحقق من شكل الكود (حرفين + 3 أرقام)
// ============================================
export function isValidCodeFormat(code) {
  if (typeof code !== "string") return false;

  const pattern = new RegExp(
    `^[${ALLOWED_LETTERS}]{${LETTERS_COUNT}}[0-9]{${DIGITS_COUNT}}$`
  );

  return pattern.test(code);
}