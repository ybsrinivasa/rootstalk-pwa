'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser, getActiveRoles, refreshUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

// V1.1 Items 1+2 (2026-05-09): self-registration into the Dealer
// ecosystem. Per the five-ecosystem architecture, anyone can declare
// themselves a Dealer. The role flips on via POST /auth/me/claim-role,
// then the user is sent to /dealer/profile to fill in shop details.
// Companies recognise the Dealer separately on their Field Manager
// page; that's the second step (FM enters phone, fetches profile,
// onboards).

export default function BecomeDealerPage() {
  const router = useRouter()
  const user = getUser()
  const roles = getActiveRoles(user)
  // STRICT "already a dealer" — only true if the role row is present.
  // A widened check here would early-return into /dealer/profile for
  // users with leftover dealer_profile_complete state, masking the
  // conflicting facilitator role.
  const isDealer = roles.includes('DEALER')
  // 2026-06-23 — Dealer + Facilitator exclusivity. LENIENT block —
  // any signal of facilitator state triggers the block:
  // `facilitator_declared_at` covers the legacy case where pwa_roles
  // is missing FACILITATOR despite the user having gone through
  // facilitator setup.
  //
  // 2026-09-03 — Coaching Sandbox bypass. Students need both roles
  // for cross-role practice; backend `/auth/me/claim-role` mirrors
  // this. Real users still see the block.
  const isCoachingStudent = !!user?.coaching_context
  const blockedByFacilitator = !isCoachingStudent && (
    roles.includes('FACILITATOR') || !!user?.facilitator_declared_at
  )

  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
    if (isDealer) {
      router.replace('/dealer/profile')
    }
  }, [])

  if (isDealer) return null

  if (blockedByFacilitator) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#7D4196' }}>
        <PWAHeader title="Become a Dealer" activeRole="DEALER" back="/home" />
        <div className="flex-1 flex flex-col rounded-t-[2rem] px-5 pt-7 pb-10 mt-14 bg-[#FAFAF8]">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5 bg-amber-100">
            <span className="text-2xl">🔒</span>
          </div>
          <h2 className="text-[#6B3F1F] text-2xl font-semibold">You're already a Facilitator</h2>
          <p className="text-[#7A8C7E] text-sm mt-3 leading-relaxed">
            A single user cannot be both a Dealer and a Facilitator on RootsTalk. They sit on opposite ends of the order-routing chain — a Facilitator routes farmer orders to Dealers, so the same person can't be on both sides.
          </p>
          <p className="text-[#7A8C7E] text-sm mt-3 leading-relaxed">
            You're free to combine any other role (Farmer + Dealer + Pundit, or Farmer + Facilitator + Pundit, etc.) — just not Dealer and Facilitator together.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mt-6">
            <p className="text-amber-800 text-sm leading-relaxed">
              <strong>Coming soon:</strong> a way to voluntarily end your Facilitator role (once all your pending tasks are clear), after which you'll be able to register as a Dealer.
            </p>
          </div>
          <button onClick={() => router.push('/home')}
            className="mt-6 w-full py-3 rounded-2xl text-[#7A8C7E] border border-[#DDD0B8] font-medium text-sm">
            Back to Farmer Home
          </button>
        </div>
      </div>
    )
  }

  async function become() {
    setClaiming(true); setError('')
    try {
      await api.post('/auth/me/claim-role', { role: 'DEALER' })
      // Refresh the cached User so getActiveRoles() returns DEALER
      // immediately and the layout's role-driven nav refreshes.
      await refreshUser()
      router.replace('/dealer/profile')
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message || 'Could not register you as a Dealer. Please try again.'
      setError(msg)
    } finally { setClaiming(false) }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#7D4196' }}>
      <PWAHeader title="Become a Dealer" activeRole="DEALER" back="/home" />
      <div className="flex-1 flex flex-col rounded-t-[2rem] px-5 pt-7 pb-10 mt-14 bg-[#FAFAF8]">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5"
          style={{ background: '#7D4196' }}>
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z"/>
          </svg>
        </div>

        <h2 className="text-[#6B3F1F] text-2xl font-semibold">Become a Dealer</h2>
        <p className="text-[#7A8C7E] text-sm mt-2 leading-relaxed">
          As a dealer, you receive purchase orders from farmers and supply recommended agricultural inputs.
        </p>

        <div className="mt-6 space-y-3">
          <p className="text-[#7A8C7E] text-xs font-semibold uppercase tracking-widest">What dealers can do</p>
          {[
            'Receive and process farmer orders',
            'Select brands and enter volumes',
            'Share packing lists with farmers',
            'Manage subscription payment requests',
            'Become a Promoter and assign advisories',
          ].map(item => (
            <div key={item} className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: '#7D4196' }}>
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
                </svg>
              </div>
              <p className="text-[#6B3F1F] text-sm">{item}</p>
            </div>
          ))}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mt-6">
          <p className="text-amber-800 font-semibold text-sm mb-1">After you register</p>
          <p className="text-amber-700 text-sm leading-relaxed">
            You&apos;ll set up your shop details (location, licences, what you sell). To start receiving orders, a
            company will need to recognise you on their Field Manager page using your registered phone number
            {user?.phone ? <> ({user.phone})</> : null}.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mt-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <button onClick={become} disabled={claiming}
          className="mt-6 w-full py-4 rounded-2xl text-white font-semibold text-base disabled:opacity-50"
          style={{ background: '#7D4196' }}>
          {claiming ? 'Registering…' : 'Register as a Dealer'}
        </button>
        <button onClick={() => router.push('/home')}
          className="mt-3 w-full py-3 rounded-2xl text-[#7A8C7E] border border-[#DDD0B8] font-medium text-sm">
          Cancel
        </button>
      </div>
    </div>
  )
}
