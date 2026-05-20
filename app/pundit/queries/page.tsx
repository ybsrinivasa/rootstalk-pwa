'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface QueryItem {
  id: string; title: string; status: string; severity: string
  client_id: string; expires_at: string; days_remaining: number
  recipient_name?: string
}

const COLOUR = '#3C3489'
const SEVERITY_COLOUR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MODERATE: 'bg-amber-100 text-amber-700',
  LOW: 'bg-slate-100 text-[#7A8C7E]',
}

type Tab = 'new' | 'pending' | 'returned' | 'history'

export default function PunditQueriesPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('new')
  const [queries, setQueries] = useState<QueryItem[]>([])
  const [history, setHistory] = useState<QueryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyFetched, setHistoryFetched] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<QueryItem[]>('/pundit/queries')
      .then(r => setQueries(r.data))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (tab === 'history' && !historyFetched) {
      setHistoryLoading(true)
      api.get<QueryItem[]>('/pundit/queries/history')
        .then(r => { setHistory(r.data); setHistoryFetched(true) })
        .finally(() => setHistoryLoading(false))
    }
  }, [tab, historyFetched])

  const newQueries = queries
    .filter(q => q.status === 'NEW')
    .sort((a, b) => a.days_remaining - b.days_remaining)
  const pendingQueries = queries.filter(q => q.status === 'FORWARDED')
  const returnedQueries = queries.filter(q => q.status === 'RETURNED')

  const TABS: { key: Tab; label: string; count: number | null }[] = [
    { key: 'new',      label: 'New',      count: newQueries.length },
    { key: 'pending',  label: 'Pending',  count: pendingQueries.length },
    { key: 'returned', label: 'Returned', count: returnedQueries.length },
    { key: 'history',  label: 'History',  count: null },
  ]

  function getActiveList(): QueryItem[] {
    if (tab === 'new')      return newQueries
    if (tab === 'pending')  return pendingQueries
    if (tab === 'returned') return returnedQueries
    if (tab === 'history')  return history
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

  const list = getActiveList()

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="My Queries" activeRole="FARM_PUNDIT" />
      <div className="pt-16 pb-20">
        {/* Four-tab bar */}
        <div className="flex bg-white border-b border-[#DDD0B8]">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-3 text-xs font-medium border-b-2 transition-colors ${tab === t.key ? 'border-[#3C3489] text-[#3C3489]' : 'border-transparent text-[#7A8C7E]'}`}>
              {t.label}
              {t.count !== null && (
                <span className={`ml-1 ${tab === t.key ? 'text-[#3C3489]' : 'text-[#DDD0B8]'}`}>
                  ({t.count})
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
              <p className="text-[#7A8C7E] text-sm">No {tab} queries</p>
            </div>
          ) : (
            list.map(q => (
              <button key={q.id}
                onClick={() => tab !== 'history' ? router.push(`/pundit/queries/${q.id}`) : undefined}
                className={`w-full bg-white rounded-2xl p-4 border shadow-sm text-left active:scale-98 transition-transform ${cardBorderClass(q)}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[#6B3F1F] text-sm line-clamp-1">{q.title}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_COLOUR[q.severity] || 'bg-slate-100 text-[#7A8C7E]'}`}>
                        {q.severity}
                      </span>
                      {tab === 'new' && q.days_remaining !== undefined && (
                        <span className={`text-xs font-medium ${q.days_remaining <= 1 ? 'text-[#D4682E]' : q.days_remaining <= 3 ? 'text-amber-600' : 'text-[#7A8C7E]'}`}>
                          {q.days_remaining}d remaining
                        </span>
                      )}
                      {tab === 'pending' && q.recipient_name && (
                        <span className="text-xs text-[#7A8C7E]">Forwarded to {q.recipient_name}</span>
                      )}
                      {tab === 'history' && (
                        <span className="text-xs text-[#7A8C7E]">{q.status}</span>
                      )}
                    </div>
                  </div>
                  {tab !== 'history' && <span className="text-[#DDD0B8] text-xl shrink-0">›</span>}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="FARM_PUNDIT" />
    </div>
  )
}
