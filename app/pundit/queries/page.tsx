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
}

const COLOUR = '#3C3489'
const STATUS_COLOUR: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-700',
  FORWARDED: 'bg-purple-100 text-purple-700',
  RETURNED: 'bg-amber-100 text-amber-700',
  RESPONDED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-600',
  EXPIRED: 'bg-slate-100 text-slate-500',
}

export default function PunditQueriesPage() {
  const router = useRouter()
  const [tab, setTab] = useState<'active' | 'history'>('active')
  const [queries, setQueries] = useState<QueryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<QueryItem[]>('/pundit/queries')
      .then(r => setQueries(r.data))
      .finally(() => setLoading(false))
  }, [])

  const active = queries.filter(q => ['NEW', 'FORWARDED', 'RETURNED'].includes(q.status))
  const history = queries.filter(q => ['RESPONDED', 'REJECTED', 'EXPIRED'].includes(q.status))

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="My Queries" activeRole="FARMER" />
      <div className="pt-16 pb-20">
        <div className="flex bg-white border-b border-slate-100">
          {(['active', 'history'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-[#3C3489] text-[#3C3489]' : 'border-transparent text-slate-400'}`}>
              {t === 'active' ? `Active (${active.length})` : `History (${history.length})`}
            </button>
          ))}
        </div>

        <div className="px-4 mt-4 space-y-3">
          {loading ? (
            <div className="h-20 bg-white rounded-2xl animate-pulse" />
          ) : (tab === 'active' ? active : history).length === 0 ? (
            <div className="text-center py-16">
              <span className="text-4xl">💬</span>
              <p className="text-slate-400 text-sm mt-3">No {tab === 'active' ? 'active' : 'past'} queries</p>
            </div>
          ) : (
            (tab === 'active' ? active : history).map(q => (
              <button key={q.id} onClick={() => router.push(`/pundit/queries/${q.id}`)}
                className="w-full bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-left active:scale-98 transition-transform">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="font-medium text-slate-800 text-sm">{q.title}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[q.status] || 'bg-slate-100 text-slate-500'}`}>
                        {q.status}
                      </span>
                      {q.days_remaining !== undefined && (
                        <span className={`text-xs font-medium ${q.days_remaining <= 1 ? 'text-red-600' : q.days_remaining <= 3 ? 'text-amber-600' : 'text-slate-400'}`}>
                          {q.days_remaining}d remaining
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-slate-300 text-xl">›</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="FARMER" />
    </div>
  )
}
