import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase web config comes from env vars (.env locally, Vercel project settings in production); see .env.example.
// These values end up in the browser bundle by design: access is controlled by firebase/firestore.rules and
// firebase/storage.rules, not by keeping the key hidden.
const env = import.meta.env;
const config = {
  apiKey: env.PUBLIC_FIREBASE_API_KEY,
  authDomain: env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.PUBLIC_FIREBASE_APP_ID,
};
const unset = Object.entries(config).filter(([, v]) => !v).map(([k]) => k);
if (unset.length) throw new Error(`Firebase config missing (${unset.join(', ')}). Set the PUBLIC_FIREBASE_* env vars; see .env.example.`);
const app = initializeApp(config);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
// The SDK retries failed uploads for up to 10 minutes by default, which looks like endless loading; give up sooner.
storage.maxUploadRetryTime = 30_000;
storage.maxOperationRetryTime = 30_000;
