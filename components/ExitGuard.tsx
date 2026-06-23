'use client'
import { useEffect } from 'react'

/** Device-back guard for the four dashboard pages.
 *
 * Goal: a single device-Back press from a dashboard exits the app,
 * regardless of how deep the in-app history is. Without this, a user
 * who navigated several pages before returning to the dashboard would
 * walk back through every entry one press at a time.
 *
 * No prompt — per 2026-06-23 user observation, the dealer dashboard's
 * direct exit "is absolutely fine." Match that on all four.
 *
 * On mount:
 *   1. Push a sentinel history entry. The first device-Back press
 *      will pop it and fire `popstate` on this handler.
 *
 * On popstate (device-Back fired on the dashboard):
 *   1. Try `window.close()` — works in installed PWA standalone mode;
 *      silently no-ops in browser tabs.
 *   2. Browser-tab fallback: walk history back to the first entry of
 *      this tab session (`history.go(-(length-1))`). When the
 *      navigation lands, replace the destination with `about:blank`.
 *      This purges every in-app navigation entry so device-Back from
 *      `about:blank` cannot bounce back into the app.
 *
 * Previous iteration (pre-2026-06-23) only did `location.replace`
 * without the history-walk — earlier in-app entries stayed alive in
 * the back stack, so device-Back from about:blank bounced the user
 * right back to the PWA. The history-walk is what fixes that.
 */
export default function ExitGuard() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    window.history.pushState({ rtExit: true }, '')

    const handlePopState = () => {
      try { window.close() } catch { /* ignore */ }

      const popSteps = window.history.length - 1
      if (popSteps <= 0) {
        window.location.replace('about:blank')
        return
      }
      const onLanded = () => {
        window.removeEventListener('popstate', onLanded)
        window.location.replace('about:blank')
      }
      window.addEventListener('popstate', onLanded)
      window.history.go(-popSteps)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  return null
}
