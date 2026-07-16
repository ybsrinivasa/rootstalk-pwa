// Firebase client init for RootsTalk PWA (2026-07-16).
//
// The values below are Firebase "Web App config" — they are PUBLIC by
// design (Firebase's own docs recommend hardcoding them into the client
// bundle). Access control lives on the backend side via our per-user
// auth check on POST /platform/fcm-token, plus Firebase's own project
// security rules. Do NOT put the service-account JSON here — that
// stays on the servers at /app/secrets/firebase-admin.json.
//
// Same Firebase project (rootstalk-2caa0) is used for staging and prod;
// per-env split can be added later via NEXT_PUBLIC_FIREBASE_* env vars
// if the two ever need distinct FCM audiences.

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import {
  getMessaging, getToken, onMessage,
  type Messaging, type MessagePayload,
} from 'firebase/messaging'

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDZgXFhxfOodV5lmBNGzYkSps58QyuxILU',
  projectId: 'rootstalk-2caa0',
  messagingSenderId: '936973134462',
  appId: '1:936973134462:web:d4eb95060c1398cf8fc62f',
}

// Web Push public VAPID key for token generation. Public — client only.
export const VAPID_PUBLIC_KEY =
  'BD7fHuy-PAvWSGB__m_6Vs73LdBJT-OM4xk7XblQI0tpkcOEU3Ia3KljYLdjmEdaLQtCpgJiPPSqUUHyFcoKj6A'

let _app: FirebaseApp | null = null
let _messaging: Messaging | null = null

function getFirebaseApp(): FirebaseApp {
  if (_app) return _app
  _app = getApps()[0] ?? initializeApp(FIREBASE_CONFIG)
  return _app
}

// getMessaging() must only run in the browser and only when the
// browser actually supports service workers + Notification API.
// Returns null on unsupported browsers (Safari on old iOS, private
// windows on Firefox, etc.) so callers can no-op gracefully.
export function getMessagingSafe(): Messaging | null {
  if (typeof window === 'undefined') return null
  if (!('serviceWorker' in navigator)) return null
  if (typeof Notification === 'undefined') return null
  if (_messaging) return _messaging
  try {
    _messaging = getMessaging(getFirebaseApp())
    return _messaging
  } catch {
    return null
  }
}

// Register the dedicated FCM service worker (public/firebase-messaging-sw.js)
// and hand it to getToken so Firebase reuses it rather than trying to
// register its own default sw.js path — which would collide with the
// next-pwa Workbox service worker already at /sw.js.
async function getFcmServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined') return null
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register(
      '/firebase-messaging-sw.js',
      { scope: '/firebase-cloud-messaging-push-scope' },
    )
  } catch {
    return null
  }
}

// Ask Firebase for the current FCM token. Requires that
// Notification.permission is already 'granted'. Returns null on any
// failure so the caller can decide whether to retry.
export async function getFcmToken(): Promise<string | null> {
  const messaging = getMessagingSafe()
  if (!messaging) return null
  const swReg = await getFcmServiceWorkerRegistration()
  if (!swReg) return null
  try {
    const token = await getToken(messaging, {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: swReg,
    })
    return token || null
  } catch {
    return null
  }
}

// Foreground message hook — when the page is open, the browser does
// NOT auto-show system notifications; we surface an in-app toast via
// this callback instead. Background messages are handled by the
// service worker (public/firebase-messaging-sw.js).
export function onForegroundMessage(
  handler: (payload: MessagePayload) => void,
): () => void {
  const messaging = getMessagingSafe()
  if (!messaging) return () => {}
  return onMessage(messaging, handler)
}
