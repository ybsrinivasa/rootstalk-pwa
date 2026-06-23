'use client'
import { useEffect } from 'react'

/** Device-back guard for the four dashboard pages.
 *
 * Tries `window.close()` on the FIRST device-back press from a
 * dashboard. In an installed PWA (Android Chrome standalone, iOS
 * standalone), `window.close()` is honoured and the app exits in one
 * press. In a browser tab where the API silently no-ops, the natural
 * back-history behaviour continues from where the popstate left the
 * user — no fake about:blank intermediate, no visible history walk.
 *
 * Why no smarter fallback: browser-tab JS fundamentally cannot
 * dismiss a tab it didn't open, and any attempt to walk history with
 * `history.go(-N)` in a Next.js app re-renders each intermediate
 * route on the way back. Earlier iterations tried both
 * (location.replace('about:blank') and chained history.go) — both
 * either bounced back into the app or made the history walk visible.
 * The honest answer is: installed PWAs exit cleanly; browser tabs
 * keep their natural behaviour.
 */
export default function ExitGuard() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Don't stack sentinels if one is already present (re-mount after
    // sub-page navigation would otherwise push another).
    if (!(window.history.state && (window.history.state as { rtExit?: boolean }).rtExit)) {
      window.history.pushState({ rtExit: true }, '')
    }

    const onPopState = () => {
      try { window.close() } catch { /* ignore */ }
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  return null
}
