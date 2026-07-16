// Firebase Cloud Messaging background service worker.
//
// Registered explicitly from lib/firebase.ts at
// scope /firebase-cloud-messaging-push-scope so it coexists with the
// next-pwa Workbox service worker at /sw.js (which owns the app-wide
// scope). Do NOT edit the file path or scope without also updating
// getFcmServiceWorkerRegistration() in lib/firebase.ts.
//
// The config below is the Firebase Web App config — public by design.
// Keep it in sync with FIREBASE_CONFIG in lib/firebase.ts.
/* eslint-disable */

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyDZgXFhxfOodV5lmBNGzYkSps58QyuxILU',
  projectId: 'rootstalk-2caa0',
  messagingSenderId: '936973134462',
  appId: '1:936973134462:web:d4eb95060c1398cf8fc62f',
})

const messaging = firebase.messaging()

// The backend sends DATA-ONLY payloads (see app/services/fcm_service.py
// 2026-07-16). With no `notification` field on the payload, the browser
// has no auto-render path — this handler is the single source of truth
// for rendering, avoiding the double-notification issue Android Samsung
// Internet exhibited when both auto-render and this handler fired.
//
// title / body / click_action are read from data.* (server-side keys
// set in send_fcm), NOT from payload.notification.
//
// `tag` is set from data.type + data.order_id so a second push for the
// same entity replaces the first rather than stacking — belt-and-braces
// against any future double-send.
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {}
  const title = d.title || 'rootsTALK'
  const body = d.body || ''
  const tag = (d.type || 'default') + (d.order_id ? ':' + d.order_id : (d.query_id ? ':' + d.query_id : ''))
  self.registration.showNotification(title, {
    body,
    icon: '/icon.png',
    badge: '/icon.png',
    data: d,
    tag,
    renotify: true,
  })
})

// Tap-through: bring the app to focus (or open it) at whatever route
// the backend included in `data.click_action`, falling back to /.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.click_action) || '/'
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      if ('focus' in client) {
        client.navigate(target).catch(() => {})
        return client.focus()
      }
    }
    if (self.clients.openWindow) {
      return self.clients.openWindow(target)
    }
  })())
})
