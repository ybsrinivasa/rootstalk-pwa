'use client'
import { useEffect, useState, useRef } from 'react'
import { useTranslations } from 'next-intl'

/**
 * Renders on root-tab surfaces (Home, per-role primary tabs). Installs
 * a device-back interceptor that requires TWO taps to exit the PWA
 * rather than immediately popping the previous history entry.
 *
 * Mechanic:
 *  - On mount, pushes a "sentinel" history entry so the first device
 *    back tap fires a popstate on THIS page instead of navigating.
 *  - First tap: show a toast + re-push the sentinel. Farmer sees
 *    "Tap back once more to close the app."
 *  - Second tap within 2s: detach the listener + call history.back()
 *    one more entry. In a standalone PWA at position 0, that closes
 *    the app; in a browser tab it navigates to the previous entry.
 *  - Third+ tap after 2s window expires: treated as a fresh first tap.
 *  - On unmount (farmer navigates away via Link), if we're still on
 *    the sentinel entry we unwind it — but we can't always guarantee
 *    a clean history because router.push adds entries on top of the
 *    sentinel. See feedback_pwa_device_back_modal_intercept.md for
 *    the companion pattern used for modals.
 */
export default function ExitOnDoubleBack() {
  const t = useTranslations('nav.exit')
  const [visible, setVisible] = useState(false)
  const lastBackRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.history.pushState({ rtExitGuard: true }, '')

    const onPop = () => {
      const now = Date.now()
      if (now - lastBackRef.current < 2000) {
        window.removeEventListener('popstate', onPop)
        setVisible(false)
        window.history.back()
        return
      }
      lastBackRef.current = now
      setVisible(true)
      window.history.pushState({ rtExitGuard: true }, '')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setVisible(false)
        lastBackRef.current = 0
      }, 2000)
    }

    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (timerRef.current) clearTimeout(timerRef.current)
      if ((window.history.state as { rtExitGuard?: boolean } | null)?.rtExitGuard) {
        window.history.back()
      }
    }
  }, [])

  if (!visible) return null
  return (
    <div
      className="fixed left-1/2 z-[100] -translate-x-1/2 bg-black/85 text-white px-5 py-2.5 rounded-full text-sm font-medium shadow-lg"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}
      role="status"
      aria-live="polite">
      {t('tapAgainToExit')}
    </div>
  )
}
