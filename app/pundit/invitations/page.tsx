'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface Invitation { id: string; client_id: string; role: string; status: string; created_at: string }
interface ClientInfo {
  id: string; display_name: string; primary_colour: string
  tagline: string | null; logo_url: string | null
}

type PendingAction = { id: string; action: 'accept' | 'reject'; companyName: string } | null

const COLOUR = '#3C3489'

export default function PunditInvitationsPage() {
  const router = useRouter()
  const t = useTranslations('pundit.invitations')
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [clientInfos, setClientInfos] = useState<Record<string, ClientInfo>>({})
  const [loading, setLoading] = useState(true)
  // Single confirmation sheet shared by Accept + Decline. No reason
  // collected — the user dropped the mandatory-reason requirement
  // 2026-06-23. Both actions just need a simple yes/no.
  const [pending, setPending] = useState<PendingAction>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<Invitation[]>('/pundit/invitations')
      setInvitations(data)
      // Resolve client info per invitation so each card can render the
      // company's logo + display name + branding colour. Without this
      // the pundit only sees a generic "Company invitation" label and
      // can't tell who's actually inviting them.
      const ids = [...new Set(data.map(i => i.client_id))]
      if (ids.length > 0) {
        const results = await Promise.allSettled(
          ids.map(id => api.get<ClientInfo>(`/client/${id}/info`).then(r => ({ id, data: r.data }))),
        )
        const map: Record<string, ClientInfo> = {}
        results.forEach(r => { if (r.status === 'fulfilled') map[r.value.id] = r.value.data })
        setClientInfos(map)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [load, router])

  async function confirm() {
    if (!pending) return
    setBusy(true)
    try {
      if (pending.action === 'accept') {
        await api.put(`/pundit/invitations/${pending.id}/accept`)
      } else {
        await api.put(`/pundit/invitations/${pending.id}/reject`, {})
      }
      setPending(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  function initials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FARM_PUNDIT" back="/pundit/home" />
      <div className="pt-16 pb-20 px-4">
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
              const info = clientInfos[inv.client_id]
              const companyName = info?.display_name || t('companyFallback')
              const accent = info?.primary_colour || COLOUR
              return (
                <div key={inv.id} className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm">
                  {/* Company header — logo + display name lets the
                      pundit see *who* is inviting them, not just a
                      generic "Company invitation" label. */}
                  <div className="flex items-center gap-3 mb-3">
                    {info?.logo_url ? (
                      <img src={info.logo_url} alt={companyName}
                        className="w-11 h-11 rounded-full object-contain bg-[#F5F0E8] p-1 border border-[#DDD0B8] shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: accent }}>
                        <span className="text-white text-xs font-bold">{initials(companyName)}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[#6B3F1F] truncate">{companyName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${inv.role === 'PRIMARY' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-[#6B3F1F]'}`}>
                          {inv.role === 'PRIMARY' ? t('rolePrimary') : t('rolePanel')}
                        </span>
                        <span className="text-[11px] text-[#7A8C7E]">{new Date(inv.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-[#7A8C7E] mb-3 leading-relaxed">
                    {inv.role === 'PRIMARY' ? t('descriptionPrimary') : t('descriptionPanel')}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setPending({ id: inv.id, action: 'accept', companyName })}
                      className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm"
                      style={{ background: COLOUR }}>
                      {t('acceptCta')}
                    </button>
                    <button onClick={() => setPending({ id: inv.id, action: 'reject', companyName })}
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
      <BottomNav color={COLOUR} activeRole="FARM_PUNDIT" />

      {/* Shared confirmation sheet — same UX whether the pundit
          accepts or declines. No reason collected per user direction
          2026-06-23 ("let there be a simple confirmation, there is no
          need to give a reason"). */}
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
