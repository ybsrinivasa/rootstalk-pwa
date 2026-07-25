'use client'
import { useState, useEffect, Suspense, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import AvatarLightbox from '@/components/AvatarLightbox'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

interface QueryItem {
  id: string; title: string; status: string; severity: string
  client_id: string; expires_at: string; days_remaining: number
  recipient_name?: string
  // 2026-06-23 — Card enrichment fields. All optional so the History
  // endpoint (which doesn't ship these yet) still renders gracefully.
  farmer_name?: string | null
  farmer_photo_url?: string | null
  crop_cosh_id?: string | null
  crop_name?: string | null
  crop_start_date?: string | null
  client_name?: string | null
  // 2026-07-24 — Training Sandbox marker. Drives the "TRAINING"
  // chip on the query card + membership of the Training tab.
  client_is_training?: boolean
}
interface Company { client_id: string; role: 'PRIMARY' | 'PANEL' | 'PROMOTER_PUNDIT' }
interface ClientInfo {
  id: string; display_name: string; primary_colour: string
  tagline: string | null; logo_url: string | null
  // 2026-07-25 — Drives the top-of-page Training banner when the
  // pundit lands here filtered to a training client's queries.
  is_training?: boolean
}

const COLOUR = '#3C3489'
const SEVERITY_COLOUR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MODERATE: 'bg-amber-100 text-amber-700',
  LOW: 'bg-slate-100 text-[#7A8C7E]',
}
// 2026-06-23 — Text-only severity tone for the inline-with-title
// rendering. Matches the urgency cue of SEVERITY_COLOUR without
// the pill background.
const SEVERITY_TEXT: Record<string, string> = {
  CRITICAL: 'text-red-700',
  HIGH: 'text-orange-700',
  MODERATE: 'text-amber-700',
  LOW: 'text-[#7A8C7E]',
}

// 2026-07-25 — Training tab removed. Rationale: training queries
// now surface via a dedicated Training organisation card on the
// pundit dashboard (backend `/pundit/profile`). Tapping any of that
// card's count pills lands here with `?client=<training_child_id>`,
// filtering the list to just that session's queries — and a
// persistent banner at the top of this page tells the pundit the
// current context is training. Real (cross-org) tabs continue to
// exclude training so a busy pundit's day isn't polluted.
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

function fmtStart(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short' })
  } catch { return null }
}

function PunditQueriesInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations('pundit.queries')
  const locale = useLocale()

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

  // 2026-07-25 — Cross-org view (no client filter) continues to
  // hide training queries from the real tabs. Client-filtered view
  // (arrived via a dashboard count pill — real OR training) shows
  // exactly what the filter says, and the top-of-page banner tells
  // the pundit whether they're in a training context.
  const tabFiltered = useMemo(
    () => clientFilter ? filtered : filtered.filter(q => !q.client_is_training),
    [filtered, clientFilter],
  )

  const newQueries = tabFiltered
    .filter(q => q.status === 'NEW')
    .sort((a, b) => a.days_remaining - b.days_remaining)
  const pendingQueries = tabFiltered.filter(q => q.status === 'FORWARDED')
  const returnedQueries = tabFiltered.filter(q => q.status === 'RETURNED')

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
  // 2026-07-25 — Training banner is on when the filtered client is
  // a training child. Under this banner every card + composer +
  // response IS training, so we don't also render per-card chips.
  const trainingContext = !!(filterInfo?.is_training)

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

        {/* 2026-07-25 — Training banner. When the pundit is viewing
            a training organisation's queries, every card + response
            + composer on this screen is practice work. A persistent
            banner up top avoids the mid-flow confusion the team saw
            when the training marker sat only on the query card. */}
        {trainingContext && (
          <div className="mx-4 mt-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-amber-900 font-semibold text-sm">
              Training session
            </p>
            <p className="text-amber-800 text-xs mt-0.5 leading-relaxed">
              These queries are from a practice session. Your responses
              here won&apos;t affect any real farmer subscription.
            </p>
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
              // 2026-06-23 — Card redesign per user direction:
              //   [photo]  Poor fruit set · Moderate intensity      2d
              //            Tomato · Started 12 Jun · Company name    ›
              // Severity moves inline with the title (no longer a
              // separate pill). Company name + crop + start date land
              // on a quieter metadata line. Time-remaining stays
              // right-aligned so the urgency anchor is preserved.
              const crop = cropDisplayName(q.crop_cosh_id || null, q.crop_name || null)
              const startedLabel = fmtStart(q.crop_start_date, locale)
              const companyName = q.client_name || info?.display_name || null
              const metaSegments: string[] = []
              if (crop) metaSegments.push(crop)
              if (startedLabel) metaSegments.push(t('startedShort', { date: startedLabel }))
              // Company only on the cross-org view (the filter chip
              // up-top already tells the pundit who they're filtered to).
              if (!clientFilter && companyName) metaSegments.push(companyName)
              const farmerName = q.farmer_name || ''
              const severityText = q.severity
                ? t.has(`severityInline.${q.severity}`)
                    ? t(`severityInline.${q.severity}`)
                    : q.severity
                : ''
              const sevClass = SEVERITY_TEXT[q.severity] || 'text-[#7A8C7E]'
              return (
                <button key={q.id}
                  onClick={() => tab !== 'history' ? router.push(`/pundit/queries/${q.id}`) : undefined}
                  className={`w-full bg-white rounded-2xl p-4 border shadow-sm text-left active:scale-98 transition-transform ${cardBorderClass(q)}`}>
                  <div className="flex items-start gap-3">
                    <div onClick={e => e.stopPropagation()} className="shrink-0">
                      <AvatarLightbox
                        photoUrl={q.farmer_photo_url || null}
                        name={farmerName}
                        size={48}
                        bgColor={COLOUR + '1A'}
                        textColor={COLOUR}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">
                        <span className="font-semibold text-[#6B3F1F]">{q.title}</span>
                        {severityText && (
                          <>
                            <span className="text-[#7A8C7E]"> · </span>
                            <span className={`font-medium ${sevClass}`}>{severityText}</span>
                          </>
                        )}
                        {/* 2026-07-25 — Per-card training chip is
                            only useful in the cross-org view, where
                            training queries could mix with real. In
                            a client-filtered training context the
                            top-of-page banner already signals it. */}
                        {q.client_is_training && !trainingContext && (
                          <>
                            <span className="text-[#7A8C7E]"> · </span>
                            <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-300 text-amber-900 px-1.5 py-0.5 rounded align-middle">
                              Training
                            </span>
                          </>
                        )}
                      </p>
                      {metaSegments.length > 0 && (
                        <p className="text-[11px] text-[#7A8C7E] mt-1 leading-snug">
                          {metaSegments.join(' · ')}
                        </p>
                      )}
                      {tab === 'pending' && q.recipient_name && (
                        <p className="text-[11px] text-[#7A8C7E] mt-1">
                          {t('forwardedTo', { name: q.recipient_name })}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      {tab === 'new' && q.days_remaining !== undefined && (
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          q.days_remaining <= 1
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : q.days_remaining <= 3
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : 'bg-stone-100 text-[#7A8C7E]'
                        }`}>
                          {t('daysRemainingShort', { count: q.days_remaining })}
                        </span>
                      )}
                      {tab === 'history' && (
                        <span className="text-[11px] text-[#7A8C7E] uppercase tracking-wide">
                          {q.status}
                        </span>
                      )}
                      {tab !== 'history' && <span className="text-[#DDD0B8] text-xl">›</span>}
                    </div>
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
