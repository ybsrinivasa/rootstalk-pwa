'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken, getUser, getActiveRoles, refreshUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

// V1.1 Items 1+2 (2026-05-09): self-registration into the Facilitator
// ecosystem. Per the user's framing 2026-05-08, "facilitators are
// plain rural youths, they don't need a special profile" — this
// page is a 1-button confirm that flips the FACILITATOR role on
// via POST /auth/me/claim-role and lands the user on
// /facilitator/profile. Companies recognise the Facilitator
// separately on their Field Manager page.

export default function BecomeFacilitatorPage() {
  const router = useRouter()
  const t = useTranslations('becomeFacilitator')
  const user = getUser()
  const roles = getActiveRoles(user)
  // STRICT "already a facilitator" — only the role row satisfies it.
  // A widened check here would early-return for users with leftover
  // facilitator_declared_at, masking the conflicting dealer role.
  const isFacilitator = roles.includes('FACILITATOR')
  // 2026-06-23 — LENIENT block. Mirror of /become-dealer's gate.
  // `dealer_profile_complete` covers the legacy case where pwa_roles
  // is missing DEALER despite the user having gone through dealer setup.
  //
  // 2026-09-03 — Coaching Sandbox bypass. Students need both roles
  // for cross-role practice; backend claim-role mirrors this.
  const isCoachingStudent = !!user?.coaching_context
  const blockedByDealer = !isCoachingStudent && (
    roles.includes('DEALER') || user?.dealer_profile_complete === true
  )

  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
    if (isFacilitator) {
      router.replace('/facilitator/profile')
    }
  }, [])

  if (isFacilitator) return null

  if (blockedByDealer) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#7D4E00' }}>
        <PWAHeader title="Become a Facilitator" activeRole="FACILITATOR" customColour="#7D4E00" back="/home" />
        <div className="flex-1 flex flex-col rounded-t-[2rem] px-5 pt-7 pb-10 mt-14 bg-[#FAFAF8]">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5 bg-amber-100">
            <span className="text-2xl">🔒</span>
          </div>
          <h2 className="text-[#6B3F1F] text-2xl font-semibold">{t('blocked.heading')}</h2>
          <p className="text-[#7A8C7E] text-sm mt-3 leading-relaxed">
            {t('blocked.explanation1')}
          </p>
          <p className="text-[#7A8C7E] text-sm mt-3 leading-relaxed">
            {t('blocked.explanation2')}
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mt-6">
            <p className="text-amber-800 text-sm leading-relaxed">
              <strong>{t('blocked.comingSoonLabel')}</strong>{t('blocked.comingSoonBody')}
            </p>
          </div>
          <button onClick={() => router.push('/home')}
            className="mt-6 w-full py-3 rounded-2xl text-[#7A8C7E] border border-[#DDD0B8] font-medium text-sm">
            {t('blocked.backHome')}
          </button>
        </div>
      </div>
    )
  }

  async function become() {
    setClaiming(true); setError('')
    try {
      await api.post('/auth/me/claim-role', { role: 'FACILITATOR' })
      await refreshUser()
      router.replace('/facilitator/profile')
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message || t('errorFallback')
      setError(msg)
    } finally { setClaiming(false) }
  }

  const perkKeys = ['acceptRoute', 'lastMile', 'paymentRequests', 'promoterRole'] as const

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#7D4E00' }}>
      <PWAHeader title="Become a Facilitator" activeRole="FACILITATOR" customColour="#7D4E00" back="/home" />
      <div className="flex-1 flex flex-col rounded-t-[2rem] px-5 pt-7 pb-10 mt-14 bg-[#FAFAF8]">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5"
          style={{ background: '#7D4E00' }}>
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/>
          </svg>
        </div>

        <h2 className="text-[#6B3F1F] text-2xl font-semibold">{t('heading')}</h2>
        <p className="text-[#7A8C7E] text-sm mt-2 leading-relaxed">
          {t('intro')}
        </p>

        <div className="mt-6 space-y-3">
          <p className="text-[#7A8C7E] text-xs font-semibold uppercase tracking-widest">{t('whatYouCanDo')}</p>
          {perkKeys.map(k => (
            <div key={k} className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: '#7D4E00' }}>
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
                </svg>
              </div>
              <p className="text-[#6B3F1F] text-sm">{t(`perks.${k}`)}</p>
            </div>
          ))}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mt-6">
          <p className="text-amber-800 font-semibold text-sm mb-1">{t('afterYouRegisterLabel')}</p>
          <p className="text-amber-700 text-sm leading-relaxed">
            {t('afterYouRegisterBody', { phoneSuffix: user?.phone ? ` (${user.phone})` : '' })}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mt-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <button onClick={become} disabled={claiming}
          className="mt-6 w-full py-4 rounded-2xl text-white font-semibold text-base disabled:opacity-50"
          style={{ background: '#7D4E00' }}>
          {claiming ? t('registering') : t('cta')}
        </button>
        <button onClick={() => router.push('/home')}
          className="mt-3 w-full py-3 rounded-2xl text-[#7A8C7E] border border-[#DDD0B8] font-medium text-sm">
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}
