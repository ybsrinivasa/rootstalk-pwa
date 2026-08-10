'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface OnboardingClient {
  client_promoter_id: string
  client_id: string
  client_name: string
  short_name: string
  logo_url: string | null
  primary_colour: string | null
  is_promoter: boolean
  is_promoter_pundit: boolean
  // 2026-08-10 — stepdown lifecycle. STEPDOWN_REQUESTED means the
  // user has tapped stepdown and is waiting for the company to
  // approve; render a "pending" pill in place of the Step Down button.
  promoter_request_status: 'NONE' | 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'STEPDOWN_REQUESTED'
  website: string | null
  phone: string | null
  onboarded_at: string
}

// 2026-06-23 — Pending Promoter invitations were moved to the
// dedicated /facilitator/promoter-invitations page (mirroring the
// pundit pattern). Onboarded Companies is now strictly the companies
// roster + Step Down.

const COLOUR = '#7D4E00'

export default function FacilitatorOnboardedCompaniesPage() {
  const router = useRouter()
  const t = useTranslations('facilitator.onboardedCompanies')
  const [companies, setCompanies] = useState<OnboardingClient[]>([])
  const [loading, setLoading] = useState(true)
  const [actingId, setActingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await api.get<OnboardingClient[]>('/facilitator/onboarding-clients')
    setCompanies(data)
  }, [])

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
    load().finally(() => setLoading(false))
  }, [load, router])

  async function stepDown(clientPromoterId: string) {
    if (!confirm(t('stepDownConfirm'))) return
    setActingId(clientPromoterId); setError('')
    try {
      await api.put(`/facilitator/promoter-status/${clientPromoterId}/step-down`)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message
      setError(msg || t('errorStepDown'))
    } finally {
      setActingId(null)
    }
  }

  function initials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FACILITATOR" back="/facilitator/home" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto space-y-4">

        {/* Companies list */}
        {loading ? (
          <div className="h-32 bg-white rounded-2xl animate-pulse" />
        ) : companies.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] p-8 text-center">
            <span className="text-3xl">🏢</span>
            <h2 className="font-semibold text-[#6B3F1F] mt-2">{t('emptyTitle')}</h2>
            <p className="text-xs text-[#7A8C7E] mt-2 leading-relaxed">{t('emptyBody')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {companies.map(c => {
              const accent = c.primary_colour || COLOUR
              return (
                <div key={c.client_id} className="bg-white rounded-2xl border border-[#DDD0B8] p-4">
                  <div className="flex items-start gap-3">
                    {c.logo_url ? (
                      <img src={c.logo_url} alt={c.client_name}
                        className="w-12 h-12 rounded-full object-contain bg-[#F5F0E8] p-1 border border-[#DDD0B8] shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: accent }}>
                        <span className="text-white text-sm font-bold">{initials(c.client_name)}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[#6B3F1F] truncate">{c.client_name}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {c.is_promoter && (
                          <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                            {t('promoterBadge')}
                          </span>
                        )}
                        {c.is_promoter_pundit && (
                          <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                            {t('promoterPunditBadge')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    {c.phone && (
                      <a href={`tel:${c.phone}`} aria-label={t('callAria', { company: c.client_name })}
                        className="inline-flex items-center justify-center w-9 h-9 rounded-lg border"
                        style={{ borderColor: '#DDD0B8', color: accent, background: 'white' }}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/>
                        </svg>
                      </a>
                    )}
                    {c.website && (
                      <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                        target="_blank" rel="noreferrer" aria-label={t('websiteAria', { company: c.client_name })}
                        className="inline-flex items-center justify-center w-9 h-9 rounded-lg border"
                        style={{ borderColor: '#DDD0B8', color: accent, background: 'white' }}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18zM3.6 9h16.8M3.6 15h16.8M12 3a14.5 14.5 0 010 18M12 3a14.5 14.5 0 000 18"/>
                        </svg>
                      </a>
                    )}
                    {c.is_promoter && c.promoter_request_status === 'STEPDOWN_REQUESTED' && (
                      <span className="ml-auto text-xs font-medium px-3 py-2 rounded-lg border bg-amber-50 border-amber-300 text-amber-800">
                        {t('stepDownPending')}
                      </span>
                    )}
                    {c.is_promoter && c.promoter_request_status !== 'STEPDOWN_REQUESTED' && (
                      <button onClick={() => stepDown(c.client_promoter_id)}
                        disabled={actingId === c.client_promoter_id}
                        className="ml-auto text-xs font-medium px-3 py-2 rounded-lg border disabled:opacity-50"
                        style={{ borderColor: '#DDD0B8', color: '#7A8C7E', background: 'white' }}>
                        {actingId === c.client_promoter_id ? '…' : t('stepDown')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}
      </div>
      <BottomNav color={COLOUR} activeRole="FACILITATOR" />
    </div>
  )
}
