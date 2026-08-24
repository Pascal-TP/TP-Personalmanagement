import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBPeDOgKJXgMG-zaq2sPokbx0UHc0VQelA",
  authDomain: "tp-personalmanagement.firebaseapp.com",
  projectId: "tp-personalmanagement",
  storageBucket: "tp-personalmanagement.firebasestorage.app",
  messagingSenderId: "376587718209",
  appId: "1:376587718209:web:0fc02350013715a0fac0c0",
  measurementId: "G-2PQ85F671Q"
};

// Bestehendes Blaze-Projekt aus dem Schulungsportal: Storage/Cloud Functions.
export const blazeConfig = {
  apiKey: "AIzaSyCcHI5sGR7sFwrWRpo2uQ3Plm0HpTvqr30",
  authDomain: "kalkpro-4cc29.firebaseapp.com",
  projectId: "kalkpro-4cc29",
  storageBucket: "kalkpro-4cc29.firebasestorage.app",
  messagingSenderId: "185447466021",
  appId: "1:185447466021:web:ed1e448d9b92e151b52bcc",
  measurementId: "G-K594BLG0G4"
};

export const portalApp = getApps().some(a => a.name === "tp-personalmanagement") ? getApp("tp-personalmanagement") : initializeApp(firebaseConfig, "tp-personalmanagement");
export const blazeApp = getApps().some(a => a.name === "tp-personalmanagement-blaze") ? getApp("tp-personalmanagement-blaze") : initializeApp(blazeConfig, "tp-personalmanagement-blaze");
export const auth = getAuth(portalApp);
export const db = getFirestore(portalApp);
export const functions = getFunctions(blazeApp, "europe-west1");
