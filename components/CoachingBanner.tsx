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
  if (!ctx) return null

  return (
    <div className="w-full bg-gradient-to-r from-[#7D4196] to-[#5C2C79] text-white text-center py-1.5 px-3 text-xs font-medium shadow-sm z-[100] relative">
      <span className="opacity-80">🎓</span>
      <span className="ml-1.5">You&apos;re in a coaching session — this is practice.</span>
      <span className="opacity-60 ml-2 hidden sm:inline">
        · Coach: {ctx.coach_name || 'unknown'} · Context: {ctx.reference_client_name}
      </span>
    </div>
  )
}
