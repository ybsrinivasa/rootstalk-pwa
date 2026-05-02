'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import RoleSwitcherDrawer from '@/components/RoleSwitcherDrawer'
import api from '@/lib/api'

interface QuerySummary {
  id: string; title: string; status: string; severity: string
  client_id: string; expires_at: string; days_remaining: number
}
interface Company { client_id: string; role: string; is_promoter_pundit: boolean }
interface ClientInfo {
  id: string; display_name: string; primary_colour: string
  tagline: string | null; logo_url: string | null
}

const COLOUR = '#3C3489'
const SEVERITY_COLOUR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MODERATE: 'bg-amber-100 text-amber-700',
  LOW: 'bg-slate-100 text-slate-500',
}

function MailIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="text-slate-300">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="9,12 11,14 15,10"/>
    </svg>
  )
}

export default function PunditHomePage() {
  const router = useRouter()
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
        // Fetch client info for each company
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

  const newCount = queries.filter(q => q.status === 'NEW').length
  const pendingCount = queries.filter(q => q.status === 'FORWARDED').length
  const returnedCount = queries.filter(q => q.status === 'RETURNED').length

  // Show only active queries (NEW, FORWARDED, RETURNED) in dashboard preview
  const activeQueries = queries.filter(q => ['NEW', 'FORWARDED', 'RETURNED'].includes(q.status))

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader
        title="FarmPundit"
        activeRole="FARM_PUNDIT"
        onRoleSwitch={() => setShowRoleDrawer(true)}
        urgencyBadges={{ new: newCount, pending: pendingCount, returned: returnedCount }}
      />
      <div className="pt-16 pb-20 px-4">
        {/* Greeting */}
        <div className="mt-4 mb-5">
          <p className="text-xl font-bold text-slate-900">
            {user?.name ? `Welcome, ${user.name.split(' ')[0]}` : 'FarmPundit Dashboard'}
          </p>
          <p className="text-slate-500 text-sm mt-0.5">{companies.length} compan{companies.length === 1 ? 'y' : 'ies'}</p>
        </div>

        {/* Stats — New / Pending / Returned */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-white rounded-2xl p-4 border border-slate-100 text-center">
            <p className="text-2xl font-bold text-slate-800">{loading ? '…' : newCount}</p>
            <p className="text-xs text-slate-400 mt-0.5">New</p>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-slate-100 text-center">
            <p className="text-2xl font-bold text-amber-500">{loading ? '…' : pendingCount}</p>
            <p className="text-xs text-slate-400 mt-0.5">Pending</p>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-slate-100 text-center">
            <p className="text-2xl font-bold text-red-600">{loading ? '…' : returnedCount}</p>
            <p className="text-xs text-slate-400 mt-0.5">Returned</p>
          </div>
        </div>

        {/* Phone privacy toggle */}
        <div className="bg-white rounded-2xl p-4 border border-slate-100 mb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-700">Phone number hidden from company searches</p>
              <p className="text-xs text-slate-400 mt-0.5">{phoneHidden ? 'Hidden — companies cannot find you by phone' : 'Visible — companies can find you by phone'}</p>
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
                <p className="font-semibold text-amber-800 text-sm">{invitations.length} company invitation{invitations.length > 1 ? 's' : ''}</p>
                <p className="text-amber-600 text-xs">Review and accept or reject</p>
              </div>
              <button onClick={() => router.push('/pundit/invitations')}
                className="text-xs font-semibold text-white px-3 py-1.5 rounded-xl shrink-0"
                style={{ background: COLOUR }}>
                View
              </button>
            </div>
          </div>
        )}

        {/* My Companies */}
        <div className="mb-5">
          <h2 className="font-semibold text-slate-800 mb-3">My Companies</h2>
          {loading ? (
            <div className="h-16 bg-white rounded-2xl animate-pulse" />
          ) : companies.length === 0 ? (
            <div className="bg-white rounded-2xl p-5 border border-slate-100 text-center">
              <p className="text-slate-400 text-sm">No companies yet — accept invitations to join companies</p>
            </div>
          ) : (
            <div className="space-y-2">
              {companies.map(c => {
                const info = clientInfos[c.client_id]
                const colour = info?.primary_colour || COLOUR
                const initials = (info?.display_name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                return (
                  <div key={c.client_id} className="bg-white rounded-2xl p-3 border border-slate-100 flex items-center gap-3">
                    {info?.logo_url ? (
                      <img src={info.logo_url} alt={info.display_name}
                        className="w-9 h-9 rounded-full object-contain bg-slate-50 p-1 shrink-0 border border-slate-100" />
                    ) : (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: colour }}>
                        <span className="text-white text-xs font-bold">{initials}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{info?.display_name || c.client_id}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {c.is_promoter_pundit && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">Promoter</span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.role === 'PRIMARY' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                        {c.role === 'PRIMARY' ? 'Primary' : 'Panel'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Active Queries preview */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800">Active Queries</h2>
            <button onClick={() => router.push('/pundit/queries')}
              className="text-xs font-medium" style={{ color: COLOUR }}>View all →</button>
          </div>

          {loading ? (
            <div className="h-20 bg-white rounded-2xl animate-pulse" />
          ) : activeQueries.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center border border-slate-100">
              <div className="flex justify-center mb-3">
                <CheckCircleIcon />
              </div>
              <p className="text-slate-500 text-sm">No active queries. You&apos;re all caught up!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeQueries.slice(0, 5).map(q => (
                <button key={q.id} onClick={() => router.push(`/pundit/queries/${q.id}`)}
                  className={`w-full bg-white rounded-2xl p-4 border shadow-sm text-left active:scale-98 transition-transform ${q.status === 'RETURNED' || q.days_remaining <= 1 ? 'border-red-200' : 'border-slate-100'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800 text-sm line-clamp-1">{q.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{q.status}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_COLOUR[q.severity] || 'bg-slate-100 text-slate-500'}`}>
                        {q.severity}
                      </span>
                      <span className={`text-xs font-medium ${q.days_remaining <= 1 ? 'text-red-600' : q.days_remaining <= 3 ? 'text-amber-600' : 'text-slate-400'}`}>
                        {q.days_remaining}d left
                      </span>
                    </div>
                  </div>
                </button>
              ))}
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
