'use client'
import { useState, useEffect, Suspense, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface QueryItem {
  id: string; title: string; status: string; severity: string
  client_id: string; expires_at: string; days_remaining: number
  recipient_name?: string
}
interface Company { client_id: string; role: 'PRIMARY' | 'PANEL' | 'PROMOTER_PUNDIT' }
interface ClientInfo {
  id: string; display_name: string; primary_colour: string
  tagline: string | null; logo_url: string | null
}

const COLOUR = '#3C3489'
const SEVERITY_COLOUR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MODERATE: 'bg-amber-100 text-amber-700',
  LOW: 'bg-slate-100 text-[#7A8C7E]',
}

type Tab = 'new' | 'pending' | 'returned' | 'history'

// Map the `?status=` query param values (NEW / FORWARDED / RETURNED)
// onto the page's tab keys.
const STATUS_TO_TAB: Record<string, Tab> = {
  NEW: 'new',
  FORWARDED: 'pending',
  RETURNED: 'returned',
}

export default function PunditQueriesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F5F0E8]" />}>
      <PunditQueriesInner />
    </Suspense>
  )
}

function PunditQueriesInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations('pundit.queries')

  // Per-org filter via `?client=<id>` set by the dashboard's count
  // pills. Empty string means cross-org.
  const clientFilter = searchParams.get('client') || ''
  // Initial tab via `?status=<NEW|FORWARDED|RETURNED>` — also set by
  // the dashboard pills so a tap lands on the right bucket.
  const statusParam = searchParams.get('status') || ''
  const initialTab: Tab = STATUS_TO_TAB[statusParam] || 'new'

  const [tab, setTab] = useState<Tab>(initialTab)
  const [queries, setQueries] = useState<QueryItem[]>([])
  const [history, setHistory] = useState<QueryItem[]>([])
  const [clientInfos, setClientInfos] = useState<Record<string, ClientInfo>>({})
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyFetched, setHistoryFetched] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    Promise.allSettled([
      api.get<QueryItem[]>('/pundit/queries'),
      api.get<{ companies: Company[] }>('/pundit/profile'),
    ]).then(([qRes, pRes]) => {
      if (qRes.status === 'fulfilled') setQueries(qRes.value.data)
      if (pRes.status === 'fulfilled') {
        const ids = (pRes.value.data.companies || []).map((c: Company) => c.client_id)
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
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (tab === 'history' && !historyFetched) {
      setHistoryLoading(true)
      api.get<QueryItem[]>('/pundit/queries/history')
        .then(r => { setHistory(r.data); setHistoryFetched(true) })
        .finally(() => setHistoryLoading(false))
    }
  }, [tab, historyFetched])

  // Apply per-org filter to the raw query list before tab bucketing.
  const filtered = useMemo(
    () => (clientFilter ? queries.filter(q => q.client_id === clientFilter) : queries),
    [queries, clientFilter],
  )
  const filteredHistory = useMemo(
    () => (clientFilter ? history.filter(q => q.client_id === clientFilter) : history),
    [history, clientFilter],
  )

  const newQueries = filtered
    .filter(q => q.status === 'NEW')
    .sort((a, b) => a.days_remaining - b.days_remaining)
  const pendingQueries = filtered.filter(q => q.status === 'FORWARDED')
  const returnedQueries = filtered.filter(q => q.status === 'RETURNED')

  const TABS: { key: Tab; label: string; count: number | null }[] = [
    { key: 'new',      label: t('tabNew'),      count: newQueries.length },
    { key: 'pending',  label: t('tabPending'),  count: pendingQueries.length },
    { key: 'returned', label: t('tabReturned'), count: returnedQueries.length },
    { key: 'history',  label: t('tabHistory'),  count: null },
  ]

  function getActiveList(): QueryItem[] {
    if (tab === 'new')      return newQueries
    if (tab === 'pending')  return pendingQueries
    if (tab === 'returned') return returnedQueries
    if (tab === 'history')  return filteredHistory
    return []
  }

  function isListLoading() {
    if (tab === 'history') return historyLoading
    return loading
  }

  function cardBorderClass(q: QueryItem): string {
    if (tab === 'returned' || q.status === 'RETURNED' || q.days_remaining <= 1) {
      return 'border-red-200'
    }
    if (q.days_remaining <= 3) return 'border-amber-200'
    return 'border-[#DDD0B8]'
  }

  function clearClientFilter() {
    // Drop the ?client= and ?status= params; keep the user on the
    // current tab.
    router.replace('/pundit/queries')
  }

  const list = getActiveList()
  const filterInfo = clientFilter ? clientInfos[clientFilter] : null

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FARM_PUNDIT" back="/pundit/home" />
      <div className="pt-16 pb-20">
        {/* Per-org filter chip — visible when arrived via a dashboard
            count pill. Tap × to clear. */}
        {clientFilter && (
          <div className="px-4 pt-3">
            <div className="bg-white border border-[#DDD0B8] rounded-full inline-flex items-center gap-2 pl-3 pr-1 py-1">
              {filterInfo?.display_name ? (
                <span className="text-xs font-semibold" style={{ color: filterInfo.primary_colour || COLOUR }}>
                  {t('filterChip', { company: filterInfo.display_name })}
                </span>
              ) : (
                <span className="text-xs font-semibold text-[#6B3F1F]">
                  {t('filterChipFallback')}
                </span>
              )}
              <button onClick={clearClientFilter}
                aria-label={t('clearFilter')}
                className="w-6 h-6 rounded-full flex items-center justify-center bg-stone-100 text-[#7A8C7E] text-sm">
                ×
              </button>
            </div>
          </div>
        )}

        {/* Four-tab bar */}
        <div className="flex bg-white border-b border-[#DDD0B8] mt-3">
          {TABS.map(tabRow => (
            <button key={tabRow.key} onClick={() => setTab(tabRow.key)}
              className={`flex-1 py-3 text-xs font-medium border-b-2 transition-colors ${tab === tabRow.key ? 'border-[#3C3489] text-[#3C3489]' : 'border-transparent text-[#7A8C7E]'}`}>
              {tabRow.label}
              {tabRow.count !== null && (
                <span className={`ml-1 ${tab === tabRow.key ? 'text-[#3C3489]' : 'text-[#DDD0B8]'}`}>
                  {t('tabCount', { count: tabRow.count })}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="px-4 mt-4 space-y-3">
          {isListLoading() ? (
            <div className="h-20 bg-white rounded-2xl animate-pulse" />
          ) : list.length === 0 ? (
            <div className="text-center py-16">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
                strokeLinecap="round" strokeLinejoin="round" className="text-[#DDD0B8] mx-auto mb-3">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
              </svg>
              <p className="text-[#7A8C7E] text-sm">
                {tab === 'new' ? t('emptyNew')
                  : tab === 'pending' ? t('emptyPending')
                  : tab === 'returned' ? t('emptyReturned')
                  : t('emptyHistory')}
              </p>
            </div>
          ) : (
            list.map(q => {
              const info = clientInfos[q.client_id]
              return (
                <button key={q.id}
                  onClick={() => tab !== 'history' ? router.push(`/pundit/queries/${q.id}`) : undefined}
                  className={`w-full bg-white rounded-2xl p-4 border shadow-sm text-left active:scale-98 transition-transform ${cardBorderClass(q)}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[#6B3F1F] text-sm line-clamp-1">{q.title}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {/* Company badge — shown when cross-org (i.e. no
                            per-client filter active). Within a filtered
                            view it'd be redundant — the chip already
                            tells the user. */}
                        {!clientFilter && info?.display_name && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                            style={{ background: (info.primary_colour || COLOUR) + '1A', color: info.primary_colour || COLOUR }}>
                            {info.display_name}
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_COLOUR[q.severity] || 'bg-slate-100 text-[#7A8C7E]'}`}>
                          {q.severity}
                        </span>
                        {tab === 'new' && q.days_remaining !== undefined && (
                          <span className={`text-xs font-medium ${q.days_remaining <= 1 ? 'text-[#D4682E]' : q.days_remaining <= 3 ? 'text-amber-600' : 'text-[#7A8C7E]'}`}>
                            {t('daysRemaining', { count: q.days_remaining })}
                          </span>
                        )}
                        {tab === 'pending' && q.recipient_name && (
                          <span className="text-xs text-[#7A8C7E]">{t('forwardedTo', { name: q.recipient_name })}</span>
                        )}
                        {tab === 'history' && (
                          <span className="text-xs text-[#7A8C7E]">{q.status}</span>
                        )}
                      </div>
                    </div>
                    {tab !== 'history' && <span className="text-[#DDD0B8] text-xl shrink-0">›</span>}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="FARM_PUNDIT" />
    </div>
  )
}
