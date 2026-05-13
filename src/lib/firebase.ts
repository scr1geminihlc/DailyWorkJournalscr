import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

console.log('Firebase Config:', firebaseConfig);
const app = initializeApp(firebaseConfig);
console.log('Firebase App initialized');

const dbInstance = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

console.log('Firestore initialized with DB ID:', (dbInstance as any)._databaseId?.database || '(default)');
export const db = dbInstance;
export const auth = getAuth(app);
console.log('Auth initialized');
