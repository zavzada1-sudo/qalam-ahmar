// ============================================
// Firebase Configuration - قلم أحمر (Red Pen)
// ============================================

// استدعاء الدوال المطلوبة من Firebase SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// بيانات مشروعك على Firebase
const firebaseConfig = {
  apiKey: "AIzaSyC2uvuF4J5wLpgO-EBJh3ccumHo6d2NPbQ",
  authDomain: "red-pen-a261b.firebaseapp.com",
  projectId: "red-pen-a261b",
  storageBucket: "red-pen-a261b.firebasestorage.app",
  messagingSenderId: "1034116940075",
  appId: "1:1034116940075:web:86bc89a680b5de4845456e"
};

// تهيئة (تشغيل) Firebase App
const app = initializeApp(firebaseConfig);

// تفعيل خدمة تسجيل الدخول (Authentication)
const auth = getAuth(app);

// ============================================
// تفعيل قاعدة البيانات مع الكاش المحلي (Offline Persistence)
// ============================================
//
// بنستخدم initializeFirestore بدل getFirestore عشان نقدر نفعّل الكاش.
//
// إيه اللي بيعمله الكاش ده:
// - بيخزّن نسخة من البيانات على جهاز المستخدم (IndexedDB)
// - مع onSnapshot، البيانات بتظهر فورًا من الكاش، والتحديث من
//   السيرفر بييجي بعدها في الخلفية
// - الموقع بيشتغل بدون نت (مطلوب في مواصفات المشروع - بند PWA)
//
// persistentMultipleTabManager: بيخلي الكاش يشتغل صح لو المستخدم
// فاتح الموقع في أكتر من تاب في نفس الوقت (من غيره التابات بتتخانق
// على الكاش وواحد بس اللي بيشتغل).
//
// ⚠️ مهم: initializeFirestore لازم تتنادى مرة واحدة بس في عمر التطبيق،
// وقبل أي استخدام لـ db — وده مضمون هنا لأن الملف ده بيتحمّل مرة
// واحدة والمتصفح بيكاشه كـ module.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// تصدير المتغيرات دي عشان نستخدمها في أي ملف تاني في المشروع
export { app, auth, db };