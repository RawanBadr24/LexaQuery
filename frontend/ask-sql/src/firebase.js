import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyBIwGqFUvJDO_WeZjODhwBt9AM_wIU72P0",
    authDomain: "lexaquery.firebaseapp.com",
    projectId: "lexaquery",
    storageBucket: "lexaquery.firebasestorage.app",
    messagingSenderId: "1062692278238",
    appId: "1:1062692278238:web:1aa8907746cb2c7f34974f",
    measurementId: "G-J62HJND97X"
  };
  
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app); 