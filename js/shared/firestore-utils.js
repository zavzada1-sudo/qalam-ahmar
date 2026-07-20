// ============================================
// Firestore Utils - دوال مساعدة لاستعلامات Firestore
// الهدف: منع نسيان where("teacherId", "==", ...) اللي كان بيسبب
// permission-denied صامت في أكتر من مكان (grades, join, deleteExam)
// ============================================

import { db } from "../../firebase-config.js";
import {
  collection, query, where, getDocs, doc, getDoc,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// ------- استعلام مقيّد بمدرس معيّن -------
// بيستخدم في: submissions, exams, groups, grades, materials, attendanceSessions...
// أي مجموعة فيها حقل teacherId
export async function queryTeacherDocs(collectionName, teacherId, extraFilters = []) {
  if (!teacherId) {
    throw new Error(`queryTeacherDocs: teacherId is required (collection: ${collectionName})`);
  }
  const constraints = [where("teacherId", "==", teacherId), ...extraFilters];
  const q = query(collection(db, collectionName), ...constraints);
  const snap = await getDocs(q);

  const results = [];
  snap.forEach((docSnap) => results.push({ id: docSnap.id, ...docSnap.data() }));
  return results;
}

// ------- استعلام مقيّد بطالب معيّن -------
// بيستخدم في: submissions بتاعة طالب معيّن
export async function queryStudentDocs(collectionName, studentId, extraFilters = []) {
  if (!studentId) {
    throw new Error(`queryStudentDocs: studentId is required (collection: ${collectionName})`);
  }
  const constraints = [where("studentId", "==", studentId), ...extraFilters];
  const q = query(collection(db, collectionName), ...constraints);
  const snap = await getDocs(q);

  const results = [];
  snap.forEach((docSnap) => results.push({ id: docSnap.id, ...docSnap.data() }));
  return results;
}

// ------- استعلام مقيّد بـ role معيّن (زي مشكلة join.js) -------
// لازم يتطابق مع شرط الـ Rules: resource.data.role == 'teacher'
export async function queryByRole(collectionName, role, extraFilters = []) {
  const constraints = [where("role", "==", role), ...extraFilters];
  const q = query(collection(db, collectionName), ...constraints);
  const snap = await getDocs(q);

  const results = [];
  snap.forEach((docSnap) => results.push({ id: docSnap.id, ...docSnap.data() }));
  return results;
}

// ------- جلب مستند واحد بالـ ID، بيرجّع null لو مش موجود -------
// (بديل مختصر لتكرار getDoc(doc(db, ...)) + exists() في كل ملف)
export async function getDocById(collectionName, docId) {
  if (!docId) return null;
  const snap = await getDoc(doc(db, collectionName, docId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}