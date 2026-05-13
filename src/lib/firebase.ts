import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

console.log('Firebase Config:', firebaseConfig);
const app = initializeApp(firebaseConfig);
console.log('Firebase App initialized');
export const db = getFirestore(app);
console.log('Firestore initialized with default DB');
export const auth = getAuth(app);
console.log('Auth initialized');
