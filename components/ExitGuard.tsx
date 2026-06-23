'use client'
import { useEffect, useState } from 'react'
import { C } from '@/lib/tokens'

/** Device-back guard for the root-ish PWA screens (Home, Dealer
 * Home, Facilitator Home, Pundit Dashboard).
 *
 * Pattern: on mount push a sentinel history entry so the user's
 * NEXT back press fires `popstate` on this URL instead of leaving
 * the app. The listener shows a "Do you wish to close
 * rootsTALK.in?" confirm. Pressing Stay re-arms the sentinel so a
 * subsequent back press behaves the same way. Pressing Close
 * tries `window.close()` (works in PWA / installed app contexts)
 * and falls back to navigating to about:blank, which boots the
 * user out of the app context.
 *
 * Mount this only on the canonical "root" pages — never on
 * detail screens where back should mean "go back one screen".
 */
export default function ExitGuard() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // Sentinel — when popstate fires on this entry, we know the
    // user pressed back from a root page.
    window.history.pushState({ rtExitGuard: true }, '')
    const onPopState = () => {
      setOpen(true)
      // Re-arm so the next back press also lands here.
      window.history.pushState({ rtExitGuard: true }, '')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function closeApp() {
    setOpen(false)
    // Installed PWA contexts (Android Chrome, iOS standalone) honour
    // window.close() and exit cleanly. Browser tabs can't be closed
    // by script — there's no clean exit there, and we used to redirect
    // to eywa.farm as a "soft landing," but a marketing-site redirect
    // surprises the user (2026-06-23 feedback: "we are leading the
    // user to our website, which is not right"). Drop the redirect —
    // if window.close() is a no-op, leave the user on the dashboard
    // with the sheet dismissed; they'll exit via the OS back gesture.
    try { window.close() } catch { /* ignore */ }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end"
      onClick={() => setOpen(false)}>
      <div
        onClick={e => e.stopPropagation()}
        className="w-full rounded-t-2xl"
        style={{
          background: C.cardBg,
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        }}>
        <div className="w-10 h-1 rounded-full mx-auto mt-3 mb-4"
          style={{ background: C.divider }} />
        <div className="px-5">
          <p className="font-bold text-[18px]" style={{ color: C.textPrimary }}>
            Do you wish to close rootsTALK.in?
          </p>
          <p className="text-sm mt-1" style={{ color: C.textSecond }}>
            You can come back any time — your data stays safe.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <button
              onClick={() => setOpen(false)}
              className="py-3 rounded-xl text-[15px] font-bold"
              style={{ border: `1px solid ${C.divider}`, color: C.textPrimary, minHeight: 48 }}>
              Stay
            </button>
            <button
              onClick={closeApp}
              className="py-3 rounded-xl text-white text-[15px] font-bold"
              style={{ background: C.alert, minHeight: 48 }}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
