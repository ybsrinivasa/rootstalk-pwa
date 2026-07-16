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

// When the browser is in the background (tab closed / minimised /
// device locked) and the backend send includes a `notification` key,
// the browser auto-shows the system notification and this handler is
// NOT called. This handler is for data-only payloads (or if we ever
// want to override the auto-rendering with a custom body). The
// backend today sends via messaging.send() with both `notification`
// and `data`, so the system notification renders even if this handler
// is silent.
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'rootsTALK'
  const body = (payload.notification && payload.notification.body) || ''
  self.registration.showNotification(title, {
    body,
    icon: '/icon.png',
    badge: '/icon.png',
    data: payload.data || {},
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
