'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface QuerySummary {
  id: string; title: string; status: string; severity: string
  client_id: string; expires_at: string; days_remaining: number
}
interface Company { client_id: string; role: string; is_promoter_pundit: boolean }

const COLOUR = '#3C3489'
const SEVERITY_COLOUR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MODERATE: 'bg-amber-100 text-amber-700',
  LOW: 'bg-slate-100 text-slate-500',
}

export default function PunditHomePage() {
  const router = useRouter()
  const user = getUser()
  const [queries, setQueries] = useState<QuerySummary[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [invitations, setInvitations] = useState<unknown[]>([])

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    Promise.allSettled([
      api.get<QuerySummary[]>('/pundit/queries'),
      api.get<{ companies: Company[] }>('/pundit/profile'),
      api.get<unknown[]>('/pundit/invitations'),
    ]).then(([qRes, pRes, iRes]) => {
      if (qRes.status === 'fulfilled') setQueries(qRes.value.data)
      if (pRes.status === 'fulfilled') setCompanies(pRes.value.data.companies || [])
      if (iRes.status === 'fulfilled') setInvitations(iRes.value.data)
    }).finally(() => setLoading(false))
  }, [])

  const urgent = queries.filter(q => q.days_remaining <= 2)

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="FarmPundit" activeRole="FARMER" />
      <div className="pt-16 pb-20 px-4">
        {/* Header */}
        <div className="mt-4 mb-5">
          <p className="text-xl font-bold text-slate-900">
            {user?.name ? `Welcome, ${user.name.split(' ')[0]}` : 'FarmPundit Dashboard'}
          </p>
          <p className="text-slate-500 text-sm mt-0.5">{companies.length} compan{companies.length === 1 ? 'y' : 'ies'}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Pending', value: queries.length, colour: COLOUR },
            { label: 'Urgent', value: urgent.length, colour: urgent.length > 0 ? '#dc2626' : COLOUR },
            { label: 'Invites', value: invitations.length, colour: (invitations.length > 0 ? '#d97706' : COLOUR) },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl p-4 border border-slate-100 text-center">
              <p className="text-2xl font-bold" style={{ color: s.colour }}>{loading ? '…' : s.value}</p>
              <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Pending invitations */}
        {invitations.length > 0 && (
          <div className="mb-4">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
              <span className="text-2xl">📩</span>
              <div className="flex-1">
                <p className="font-semibold text-amber-800 text-sm">{invitations.length} company invitation{invitations.length > 1 ? 's' : ''}</p>
                <p className="text-amber-600 text-xs">Review and accept or reject</p>
              </div>
              <button onClick={() => router.push('/pundit/invitations')}
                className="text-xs font-semibold text-white px-3 py-1.5 rounded-xl"
                style={{ background: COLOUR }}>
                View
              </button>
            </div>
          </div>
        )}

        {/* Queries */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800">Pending Queries</h2>
            <button onClick={() => router.push('/pundit/queries')}
              className="text-xs font-medium" style={{ color: COLOUR }}>View all →</button>
          </div>

          {loading ? (
            <div className="h-20 bg-white rounded-2xl animate-pulse" />
          ) : queries.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center border border-slate-100">
              <span className="text-3xl">✅</span>
              <p className="text-slate-500 text-sm mt-3">No pending queries. You're all caught up!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {queries.slice(0, 5).map(q => (
                <button key={q.id} onClick={() => router.push(`/pundit/queries/${q.id}`)}
                  className="w-full bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-left active:scale-98 transition-transform">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="font-medium text-slate-800 text-sm line-clamp-1">{q.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{q.status}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
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
      <BottomNav color={COLOUR} activeRole="FARMER" />
    </div>
  )
}
