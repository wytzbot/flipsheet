import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { getMessaging, getToken, isSupported as messagingSupported } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging.js';
import { getAnalytics, isSupported as analyticsSupported } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-analytics.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAf2jNjbGk_kZWzxcI4UMWmiWTzN2kOwAU',
  authDomain: 'flipsheet.firebaseapp.com',
  projectId: 'flipsheet',
  storageBucket: 'flipsheet.firebasestorage.app',
  messagingSenderId: '70593024614',
  appId: '1:70593024614:web:27eed0e3450dbd33f1d3a7',
  measurementId: 'G-47BLW4RY11'
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export { signInWithPopup, getToken };
export const messagingPromise = messagingSupported().then(ok => ok ? getMessaging(app) : null);
export const analyticsPromise = analyticsSupported().then(ok => ok ? getAnalytics(app) : null);
