import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase web config is public by design; access is controlled by firebase/firestore.rules and firebase/storage.rules.
const app = initializeApp({
  apiKey: 'AIzaSyBto1EuVIG9oE8IUrV1yzENm7nZDZejHKE',
  authDomain: 'rupatinta-komisi.firebaseapp.com',
  projectId: 'rupatinta-komisi',
  storageBucket: 'rupatinta-komisi.firebasestorage.app',
  messagingSenderId: '614714936117',
  appId: '1:614714936117:web:fcc2b355269fceab5c9a7c',
});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
// The SDK retries failed uploads for up to 10 minutes by default, which looks like endless loading; give up sooner.
storage.maxUploadRetryTime = 30_000;
storage.maxOperationRetryTime = 30_000;
