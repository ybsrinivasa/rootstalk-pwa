'use client'

// PushNotificationSetup (2026-07-16) — client-only component that
// handles Firebase Cloud Messaging registration for the RootsTalk PWA.
//
// Responsibilities, in order:
//   1. If the user isn't logged in yet, do nothing.
//   2. If the browser doesn't support notifications at all (older
//      Safari, private windows, etc.), do nothing.
//   3. If Notification.permission === 'granted', silently fetch the
//      current FCM token and PUT it to the backend. Runs on every
//      page load so a rotated token flows through without the user
//      seeing anything.
//   4. If === 'denied', do nothing (never re-prompt automatically —
//      the browser locks the permission until the user resets it).
//   5. If === 'default' (not asked yet), show a soft banner CTA
//      inviting the farmer to enable notifications. On click, we
//      ask via Notification.requestPermission() and — on grant —
//      run the same fetch+PUT path as step 3.
//   6. Subscribe to foreground messages so an in-app toast shows
//      when a push arrives while the PWA is already open.
//
// Mounted once in app/layout.tsx so every authenticated page picks
// it up. The banner and toast render inside the app-frame column
// via `fixed bottom-*` positioning (which the app-frame's `transform`
// makes column-relative on desktop).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import api from '@/lib/api'
import { getToken as getAuthToken } from '@/lib/auth'
import { getFcmToken, onForegroundMessage } from '@/lib/firebase'

const DISMISSED_KEY = 'rt_notif_ask_dismissed_at'
// After the farmer taps "Not now", wait a week before re-asking.
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

async function registerTokenWithBackend(token: string): Promise<void> {
  // POST /platform/fcm-token is idempotent — the backend just
  // upserts users.fcm_token. Fire-and-forget; errors are logged
  // via api's interceptor but not surfaced (registration is a
  // background concern, not a blocker for the user).
  try {
    await api.post('/platform/fcm-token', { token })
  } catch {
    /* swallow — the next page load will retry */
  }
}

export default function PushNotificationSetup() {
  const t = useTranslations('push')
  const router = useRouter()
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [snoozed, setSnoozed] = useState<boolean>(false)
  const [asking, setAsking] = useState(false)
  const [toast, setToast] = useState<{ title: string; body: string; clickAction?: string } | null>(null)
  const registerAttempted = useRef(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Detect current permission + snooze state on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof Notification === 'undefined') {
      setPermission('unsupported')
      return
    }
    setPermission(Notification.permission)
    try {
      const raw = localStorage.getItem(DISMISSED_KEY)
      if (raw) {
        const when = parseInt(raw, 10)
        if (Number.isFinite(when) && Date.now() - when < SNOOZE_MS) {
          setSnoozed(true)
        }
      }
    } catch {
      /* localStorage blocked — never mind, we'll just re-ask each session */
    }
  }, [])

  // When permission is granted, silently register / refresh the token.
  useEffect(() => {
    if (permission !== 'granted') return
    if (!getAuthToken()) return
    if (registerAttempted.current) return
    registerAttempted.current = true
    ;(async () => {
      const token = await getFcmToken()
      if (token) await registerTokenWithBackend(token)
    })()
  }, [permission])

  // Foreground-message toast. Subscription is idempotent per mount.
  // Browsers suppress the system notification when the PWA has focus;
  // we render a tap-through banner instead so the user still notices.
  // Auto-dismiss is 15s (up from the earlier 5s) so a farmer has time
  // to read a longer message like "New order from Rajesh - RT-26-000265.
  // Review the items and share volumes and prices." before it slides
  // away. A tap on the banner navigates to click_action; an explicit
  // × dismisses without navigating.
  useEffect(() => {
    if (permission !== 'granted') return
    const unsub = onForegroundMessage((payload) => {
      // Backend sends data-only payloads (2026-07-16) — title/body
      // live under data.* rather than payload.notification.*. See
      // app/services/fcm_service.py and firebase-messaging-sw.js.
      const d = payload.data || {}
      const title = (d.title as string | undefined) || ''
      const body = (d.body as string | undefined) || ''
      const clickAction = (d.click_action as string | undefined) || undefined
      if (!title && !body) return
      if (toastTimer.current) clearTimeout(toastTimer.current)
      setToast({ title, body, clickAction })
      toastTimer.current = setTimeout(() => setToast(null), 15000)
    })
    return () => {
      unsub()
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [permission])

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(null)
  }, [])

  const openToastTarget = useCallback(() => {
    const target = toast?.clickAction
    dismissToast()
    if (target) router.push(target)
  }, [toast, dismissToast, router])

  const onEnableClick = useCallback(async () => {
    if (asking) return
    setAsking(true)
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result === 'granted') {
        const token = await getFcmToken()
        if (token) await registerTokenWithBackend(token)
      } else if (result === 'denied') {
        // Browser locks permission; snoozing is moot but harmless.
        try { localStorage.setItem(DISMISSED_KEY, String(Date.now())) } catch {}
        setSnoozed(true)
      }
    } finally {
      setAsking(false)
    }
  }, [asking])

  const onSnoozeClick = useCallback(() => {
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())) } catch {}
    setSnoozed(true)
  }, [])

  // Only ever render the banner when a farmer is logged in, we're
  // still in 'default' (never asked), and they haven't snoozed
  // within the last week.
  const showBanner =
    permission === 'default' &&
    !snoozed &&
    typeof window !== 'undefined' &&
    !!getAuthToken()

  return (
    <>
      {showBanner && (
        <div className="fixed left-0 right-0 bottom-16 z-40 px-4">
          <div className="max-w-lg mx-auto bg-white rounded-2xl border border-[#DDD0B8] shadow-lg px-4 py-3 flex items-start gap-3">
            <span className="text-2xl" aria-hidden>🔔</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#6B3F1F]">
                {t('banner.title')}
              </p>
              <p className="text-xs text-[#7A8C7E] mt-0.5">
                {t('banner.body')}
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={onEnableClick}
                  disabled={asking}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#3A7D44] disabled:opacity-50">
                  {asking ? t('banner.enabling') : t('banner.enable')}
                </button>
                <button
                  onClick={onSnoozeClick}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#7A8C7E]">
                  {t('banner.notNow')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed left-0 right-0 top-16 z-50 px-4 pointer-events-none">
          <div className="max-w-lg mx-auto bg-[#3A7D44] text-white rounded-2xl shadow-lg pointer-events-auto flex items-start gap-2 pl-4 pr-2 py-3">
            <button
              type="button"
              onClick={openToastTarget}
              className="flex-1 min-w-0 text-left"
              aria-label={toast.clickAction ? t('toast.tapToOpen') : undefined}>
              {toast.title && (
                <p className="text-sm font-semibold">{toast.title}</p>
              )}
              {toast.body && (
                <p className="text-xs text-white/85 mt-0.5 break-words">{toast.body}</p>
              )}
              {toast.clickAction && (
                <p className="text-[10px] text-white/70 mt-1.5 uppercase tracking-wide font-medium">
                  {t('toast.tapToOpen')}
                </p>
              )}
            </button>
            <button
              type="button"
              onClick={dismissToast}
              aria-label={t('toast.dismiss')}
              className="shrink-0 w-7 h-7 rounded-full text-white/80 hover:text-white hover:bg-white/10 flex items-center justify-center text-base">
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  )
}
