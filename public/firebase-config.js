// Firebase web settings for the live app.
//
// These values are designed to be public: they identify the project but grant
// no access by themselves. Access is controlled by firestore.rules and the
// household allowlist. Never put a private key or password in this file.
//
// Paste the config from: Firebase console > Project settings > Your apps > Web app,
// then set authDomain to "<project-id>.web.app" (more reliable sign-in on iPhones).
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD0I_q7scoBBJjHkRHuONsG7eFDwNdvK2c',
  authDomain: 'week-at-a-glance-95425.web.app',
  projectId: 'week-at-a-glance-95425',
  storageBucket: 'week-at-a-glance-95425.firebasestorage.app',
  messagingSenderId: '1021562476719',
  appId: '1:1021562476719:web:eee17e2c62e7fa5054dc5a',
};

// Used only when running locally against the Firebase emulators.
export const EMULATOR_CONFIG = {
  apiKey: 'demo-key',
  authDomain: 'localhost',
  projectId: 'demo-week-at-a-glance',
  appId: 'demo-app',
};
