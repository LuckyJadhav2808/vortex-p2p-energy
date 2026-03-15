// ============================================
// VORTEX — Firebase Configuration
// Shared across all pages
// ============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit, onSnapshot, getDocs, writeBatch, serverTimestamp, Timestamp, increment } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getDatabase, ref, set, onValue, off, push, update as rtUpdate, get as rtGet, remove as rtRemove } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCZsmWVQHwSlK85XufrYTE8ZZQc1CLjEi8",
  authDomain: "vortex-68de9.firebaseapp.com",
  projectId: "vortex-68de9",
  storageBucket: "vortex-68de9.firebasestorage.app",
  messagingSenderId: "830503447936",
  appId: "1:830503447936:web:b33e3d64cd13b3025ee565",
  measurementId: "G-FDMEQ10MMB",
  databaseURL: "https://vortex-68de9-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

// Backend API URL — auto-detect environment
const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? "http://localhost:5000"
  : "https://vortex-backend-v92y.onrender.com";  // In production, use relative paths or set your deployed backend URL here

// Auth state helper
function requireAuth(callback) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      callback(user);
    } else {
      window.location.href = "auth.html";
    }
  });
}

// Get current user profile from Firestore
async function getUserProfile(uid) {
  const docSnap = await getDoc(doc(db, "users", uid));
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() };
  }
  return null;
}

// Logout
function logout() {
  signOut(auth).then(() => {
    window.location.href = "index.html";
  });
}

export {
  app, auth, db, rtdb, API_BASE_URL,
  // Auth
  onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail,
  // Firestore
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit,
  onSnapshot, getDocs, writeBatch, serverTimestamp, Timestamp, increment,
  // Realtime DB
  ref, set, onValue, off, push, rtUpdate, rtGet, rtRemove,
  // Helpers
  requireAuth, getUserProfile, logout
};
