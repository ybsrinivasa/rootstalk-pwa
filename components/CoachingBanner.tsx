'use client'

// Persistent purple banner that appears on every PWA screen when the
// logged-in user is a coaching student in an OPEN session. Read from
// `user.coaching_context` on /auth/me; NULL for non-students so the
// banner renders nothing.
//
// Design decisions locked with user 2026-09-01:
//   - Persistent (no dismiss) — students should never lose sight of
//     the fact that they're in practice mode
//   - Purple palette — distinct from Training Sandbox's amber
//   - Sits above every page's own header; not inside the client-name
//     area of the farmer home (that space is reserved for the actual
//     client identity)
//   - Mounted in the root layout so it appears across every route

import { useEffect, useState } from 'react'
import { getUser, PWAUser } from '@/lib/auth'


// Ribbon height in px. Kept as a single constant so the CSS var
// published to documentElement and the visible band stay in sync.
const BANNER_HEIGHT_PX = 32

export default function CoachingBanner() {
  const [user, setUser] = useState<PWAUser | null>(null)

  useEffect(() => {
    // Read the cached user on mount. Subsequent /auth/me refreshes
    // (login, refreshUser) update localStorage; we re-read on route
    // changes via a lightweight interval since PWA pages don't share
    // a single React tree state.
    setUser(getUser())
    const t = setInterval(() => setUser(getUser()), 3000)
    return () => clearInterval(t)
  }, [])

  const ctx = user?.coaching_context
  const active = !!ctx

  // Publish banner height as a CSS variable on <html> so layout
  // primitives that must not overlap the ribbon can read it:
  //   - PWAHeader offsets its `top` by the var (moves the fixed
  //     header down when the banner is up).
  //   - .app-scroll padding-top is bumped by the var so page
  //     content clears the shifted header without touching every
  //     page's `pt-16`.
  // Reset to 0px on unmount / when the student's session closes so
  // the whole tree snaps back to the non-coaching layout.
  useEffect(() => {
    const root = document.documentElement
    if (active) {
      root.style.setProperty('--coaching-banner-h', `${BANNER_HEIGHT_PX}px`)
    } else {
      root.style.setProperty('--coaching-banner-h', '0px')
    }
    return () => {
      root.style.setProperty('--coaching-banner-h', '0px')
    }
  }, [active])

  if (!ctx) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 bg-gradient-to-r from-[#7D4196] to-[#5C2C79] text-white text-center px-3 text-xs font-medium shadow-sm z-[100] flex items-center justify-center"
      style={{ height: `${BANNER_HEIGHT_PX}px` }}
    >
      <span className="opacity-80">🎓</span>
      <span className="ml-1.5">You&apos;re in a coaching session — this is practice.</span>
      <span className="opacity-60 ml-2 hidden sm:inline">
        · Coach: {ctx.coach_name || 'unknown'} · Context: {ctx.reference_client_name}
      </span>
    </div>
  )
}
