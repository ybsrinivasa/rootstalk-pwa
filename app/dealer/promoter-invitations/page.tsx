'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface PromoterInvitation {
  client_promoter_id: string
  client_id: string
  client_name: string
  short_name: string
  logo_url: string | null
  primary_colour: string | null
  sent_at: string
}

type PendingAction = { id: string; action: 'accept' | 'decline'; companyName: string } | null

const COLOUR = '#7D4196'

export default function DealerPromoterInvitationsPage() {
  const router = useRouter()
  const t = useTranslations('dealer.promoterInvitations')
  const [invitations, setInvitations] = useState<PromoterInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<PendingAction>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<PromoterInvitation[]>('/dealer/promoter-invitations')
      setInvitations(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
    load()
  }, [load, router])

  async function confirm() {
    if (!pending) return
    setBusy(true); setError('')
    try {
      const endpoint = pending.action === 'accept'
        ? `/dealer/promoter-invitations/${pending.id}/accept`
        : `/dealer/promoter-invitations/${pending.id}/decline`
      await api.put(endpoint)
      setPending(null)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message
      setError(msg || t('errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  function initials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/home" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
          ) : invitations.length === 0 ? (
            <div className="text-center py-16">
              <span className="text-4xl">📩</span>
              <p className="text-[#7A8C7E] text-sm mt-3">{t('emptyTitle')}</p>
            </div>
          ) : (
            invitations.map(inv => {
              const accent = inv.primary_colour || COLOUR
              return (
                <div key={inv.client_promoter_id} className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm">
                  <div className="flex items-center gap-3 mb-3">
                    {inv.logo_url ? (
                      <img src={inv.logo_url} alt={inv.client_name}
                        className="w-11 h-11 rounded-full object-contain bg-[#F5F0E8] p-1 border border-[#DDD0B8] shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: accent }}>
                        <span className="text-white text-xs font-bold">{initials(inv.client_name)}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[#6B3F1F] truncate">{inv.client_name}</p>
                      <p className="text-[11px] text-[#7A8C7E]">
                        {t('invitationSent', { date: new Date(inv.sent_at).toLocaleDateString() })}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-[#7A8C7E] mb-3 leading-relaxed">{t('description')}</p>
                  <div className="flex gap-2">
                    <button onClick={() => setPending({ id: inv.client_promoter_id, action: 'accept', companyName: inv.client_name })}
                      className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm"
                      style={{ background: COLOUR }}>
                      {t('acceptCta')}
                    </button>
                    <button onClick={() => setPending({ id: inv.client_promoter_id, action: 'decline', companyName: inv.client_name })}
                      className="flex-1 border border-red-100 text-[#D4682E] font-medium py-2.5 rounded-xl text-sm">
                      {t('declineCta')}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />

      {pending && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => !busy && setPending(null)}>
          <div className="bg-white rounded-t-3xl w-full p-5 pb-8" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-[#6B3F1F]">
              {pending.action === 'accept'
                ? t('confirmAcceptTitle', { company: pending.companyName })
                : t('confirmRejectTitle', { company: pending.companyName })}
            </h2>
            <p className="text-[#7A8C7E] text-sm mt-2">
              {pending.action === 'accept' ? t('confirmAcceptBody') : t('confirmRejectBody')}
            </p>
            {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={() => setPending(null)} disabled={busy}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] font-medium py-3 rounded-2xl text-sm disabled:opacity-50">
                {t('confirmCancel')}
              </button>
              <button onClick={confirm} disabled={busy}
                className="flex-1 text-white font-semibold py-3 rounded-2xl text-sm disabled:opacity-50"
                style={{ background: pending.action === 'accept' ? COLOUR : '#dc2626' }}>
                {busy ? t('confirmBusy')
                  : pending.action === 'accept' ? t('confirmAcceptCta') : t('confirmRejectCta')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
