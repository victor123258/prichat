// ==================== APP / FIREBASE CONFIG LOADER ====================
// Reads from Vite-injected environment variables (import.meta.env) first.
// Falls back to the committed src/js/firebase-config.js so GitHub Pages
// builds work without any secrets or CI configuration.

import { firebaseConfig } from './firebase-config.js'

export function getFirebaseConfig() {
  const env = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  }

  const envComplete = Object.values(env).every(v => v && v !== 'YOUR_API_KEY')
  return envComplete ? env : firebaseConfig
}

export const isFirebaseConfigured = () => {
  const config = getFirebaseConfig()
  return Object.values(config).every(v => v && v !== 'YOUR_API_KEY')
}

export const FIREBASE_CONFIG = getFirebaseConfig()

// WebRTC STUN Configuration
export const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
}

// Max upload size in bytes (files & voice notes) — 10 MB
export const MAX_FILE_BYTES = 10 * 1024 * 1024