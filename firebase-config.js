// ============================================
// Firebase Configuration - قلم أحمر (Red Pen)
// ============================================

// استدعاء الدوال المطلوبة من Firebase SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

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

// تفعيل قاعدة البيانات (Firestore)
const db = getFirestore(app);

// تصدير المتغيرات دي عشان نستخدمها في أي ملف تاني في المشروع
export { app, auth, db };