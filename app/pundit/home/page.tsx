'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import RoleSwitcherDrawer from '@/components/RoleSwitcherDrawer'
import api from '@/lib/api'

interface QuerySummary {
  id: string; title: string; status: string; severity: string
  client_id: string; expires_at: string; days_remaining: number
}
interface Company { client_id: string; role: 'PRIMARY' | 'PANEL' | 'PROMOTER_PUNDIT' }
interface ClientInfo {
  id: string; display_name: string; primary_colour: string
  tagline: string | null; logo_url: string | null
}

const COLOUR = '#3C3489'

function MailIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  )
}

export default function PunditHomePage() {
  const router = useRouter()
  const t = useTranslations('pundit.home')
  const user = getUser()
  const [queries, setQueries] = useState<QuerySummary[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [clientInfos, setClientInfos] = useState<Record<string, ClientInfo>>({})
  const [loading, setLoading] = useState(true)
  const [invitations, setInvitations] = useState<unknown[]>([])
  const [phoneHidden, setPhoneHidden] = useState(false)
  const [privacyLoading, setPrivacyLoading] = useState(false)
  const [showRoleDrawer, setShowRoleDrawer] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    Promise.allSettled([
      api.get<QuerySummary[]>('/pundit/queries'),
      api.get<{ companies: Company[]; phone_privacy?: boolean }>('/pundit/profile'),
      api.get<unknown[]>('/pundit/invitations'),
    ]).then(([qRes, pRes, iRes]) => {
      if (qRes.status === 'fulfilled') setQueries(qRes.value.data)
      if (pRes.status === 'fulfilled') {
        const profile = pRes.value.data
        setCompanies(profile.companies || [])
        setPhoneHidden(profile.phone_privacy ?? false)
        const ids = (profile.companies || []).map((c: Company) => c.client_id)
        if (ids.length > 0) {
          Promise.allSettled(
            ids.map((id: string) => api.get<ClientInfo>(`/client/${id}/info`).then(r => ({ id, data: r.data })))
          ).then(results => {
            const map: Record<string, ClientInfo> = {}
            results.forEach(r => { if (r.status === 'fulfilled') map[r.value.id] = r.value.data })
            setClientInfos(map)
          })
        }
      }
      if (iRes.status === 'fulfilled') setInvitations(iRes.value.data)
    }).finally(() => setLoading(false))
  }, [])

  async function togglePrivacy() {
    setPrivacyLoading(true)
    try {
      await api.put('/pundit/profile/phone-privacy', { phone_privacy: !phoneHidden })
      setPhoneHidden(v => !v)
    } finally { setPrivacyLoading(false) }
  }

  // 2026-06-23 — Per-org counts. Pundit can be onboarded with multiple
  // companies; pooled counts hide which company is waiting. Each pill
  // navigates to /pundit/queries?client=…&status=… for a filtered view.
  function countsFor(clientId: string) {
    return {
      newCount: queries.filter(q => q.client_id === clientId && q.status === 'NEW').length,
      pendingCount: queries.filter(q => q.client_id === clientId && q.status === 'FORWARDED').length,
      returnedCount: queries.filter(q => q.client_id === clientId && q.status === 'RETURNED').length,
    }
  }

  const totalNew = queries.filter(q => q.status === 'NEW').length
  const totalPending = queries.filter(q => q.status === 'FORWARDED').length
  const totalReturned = queries.filter(q => q.status === 'RETURNED').length

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader
        title={t('headerTitle')}
        activeRole="FARM_PUNDIT"
        onRoleSwitch={() => setShowRoleDrawer(true)}
        urgencyBadges={{ new: totalNew, pending: totalPending, returned: totalReturned }}
      />
      <div className="pt-16 pb-20 px-4">
        {/* Greeting */}
        <div className="mt-4 mb-5">
          <p className="text-xl font-bold text-[#6B3F1F]">
            {user?.name ? t('welcomeWithName', { name: user.name.split(' ')[0] }) : t('welcomeNoName')}
          </p>
          <p className="text-[#7A8C7E] text-sm mt-0.5">{t('companyCount', { count: companies.length })}</p>
        </div>

        {/* Phone privacy toggle */}
        <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] mb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-[#6B3F1F]">{t('privacyTitle')}</p>
              <p className="text-xs text-[#7A8C7E] mt-0.5">{phoneHidden ? t('privacyHidden') : t('privacyVisible')}</p>
            </div>
            <button
              onClick={togglePrivacy}
              disabled={privacyLoading}
              className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${phoneHidden ? 'bg-[#3C3489]' : 'bg-stone-200'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${phoneHidden ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        {/* Pending invitations */}
        {invitations.length > 0 && (
          <div className="mb-4">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
              <span className="text-amber-600">
                <MailIcon />
              </span>
              <div className="flex-1">
                <p className="font-semibold text-amber-800 text-sm">{t('invitationsCount', { count: invitations.length })}</p>
                <p className="text-amber-600 text-xs">{t('invitationsHint')}</p>
              </div>
              <button onClick={() => router.push('/pundit/invitations')}
                className="text-xs font-semibold text-white px-3 py-1.5 rounded-xl shrink-0"
                style={{ background: COLOUR }}>
                {t('invitationsViewCta')}
              </button>
            </div>
          </div>
        )}

        {/* My Companies — now the primary action surface. Each row shows
            per-org counts as clickable pills that drill into a filtered
            /pundit/queries view. Pundit responses + recommendations
            differ per onboarding company, so per-org scoping matters. */}
        <div className="mb-5">
          <h2 className="font-semibold text-[#6B3F1F] mb-3">{t('companiesTitle')}</h2>
          {loading ? (
            <div className="h-16 bg-white rounded-2xl animate-pulse" />
          ) : companies.length === 0 ? (
            <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8] text-center">
              <p className="text-[#7A8C7E] text-sm">{t('companiesEmpty')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {companies.map(c => {
                const info = clientInfos[c.client_id]
                const colour = info?.primary_colour || COLOUR
                const initials = (info?.display_name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                const { newCount, pendingCount, returnedCount } = countsFor(c.client_id)
                return (
                  <div key={c.client_id} className="bg-white rounded-2xl p-3 border border-[#DDD0B8]">
                    <div className="flex items-center gap-3">
                      {info?.logo_url ? (
                        <img src={info.logo_url} alt={info.display_name}
                          className="w-9 h-9 rounded-full object-contain bg-[#F5F0E8] p-1 shrink-0 border border-[#DDD0B8]" />
                      ) : (
                        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                          style={{ background: colour }}>
                          <span className="text-white text-xs font-bold">{initials}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#6B3F1F] truncate">{info?.display_name || c.client_id}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* PROMOTER_PUNDIT is a first-class role (since
                            2026-06-23). Regular pundits (PRIMARY / PANEL)
                            and PPs are mutually exclusive. */}
                        {c.role === 'PROMOTER_PUNDIT' ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">{t('promoterBadge')}</span>
                        ) : (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.role === 'PRIMARY' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-[#7A8C7E]'}`}>
                            {c.role === 'PRIMARY' ? t('rolePrimary') : t('rolePanel')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <CountPill label={t('statNew')} count={newCount}
                        onClick={() => newCount > 0 && router.push(`/pundit/queries?client=${c.client_id}&status=NEW`)} />
                      <CountPill label={t('statPending')} count={pendingCount} tone="amber"
                        onClick={() => pendingCount > 0 && router.push(`/pundit/queries?client=${c.client_id}&status=FORWARDED`)} />
                      <CountPill label={t('statReturned')} count={returnedCount} tone="alert"
                        onClick={() => returnedCount > 0 && router.push(`/pundit/queries?client=${c.client_id}&status=RETURNED`)} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>

      <BottomNav color={COLOUR} activeRole="FARM_PUNDIT" />

      <RoleSwitcherDrawer
        open={showRoleDrawer}
        onClose={() => setShowRoleDrawer(false)}
        onSwitch={() => setShowRoleDrawer(false)}
        activeRole="FARM_PUNDIT"
      />
    </div>
  )
}

// Compact per-org count pill. Greys out at zero (no nav target).
function CountPill({
  label, count, onClick, tone = 'primary',
}: {
  label: string
  count: number
  onClick: () => void
  tone?: 'primary' | 'amber' | 'alert'
}) {
  const disabled = count === 0
  const toneClasses =
    disabled ? 'bg-stone-100 text-[#7A8C7E]'
    : tone === 'amber' ? 'bg-amber-100 text-amber-800'
    : tone === 'alert' ? 'bg-red-100 text-[#D4682E]'
    : 'bg-[#3C3489]/10 text-[#3C3489]'
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-opacity ${toneClasses} ${disabled ? 'cursor-default' : 'active:opacity-80'}`}>
      {label} <span className="font-bold">{count}</span>
    </button>
  )
}
