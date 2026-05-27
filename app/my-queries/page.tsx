'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface QueryItem {
  id: string; title: string; status: string; severity: string; expires_at: string; created_at: string
}
interface ResponseMedia {
  media_type: string; url: string; caption: string | null
}

interface QueryDetail {
  id: string; title: string; status: string; response: {
    text: string | null
    problem_cosh_id: string | null
    problem_name: string | null
    has_cha_recommendation: boolean
    media: ResponseMedia[]
    created_at: string
  } | null
}

const STATUS_COLOUR: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-700',
  FORWARDED: 'bg-purple-100 text-purple-700',
  RETURNED: 'bg-amber-100 text-amber-700',
  RESPONDED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-[#D4682E]',
  EXPIRED: 'bg-slate-100 text-[#7A8C7E]',
}

export default function FarmerQueriesPage() {
  const router = useRouter()
  const [queries, setQueries] = useState<QueryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedQuery, setExpandedQuery] = useState<string | null>(null)
  const [queryDetail, setQueryDetail] = useState<Record<string, QueryDetail>>({})

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<QueryItem[]>('/farmer/queries')
      .then(r => setQueries(r.data))
      .finally(() => setLoading(false))
  }, [])

  async function toggleQuery(id: string) {
    if (expandedQuery === id) { setExpandedQuery(null); return }
    setExpandedQuery(id)
    if (!queryDetail[id]) {
      const { data } = await api.get<QueryDetail>(`/farmer/queries/${id}`)
      setQueryDetail(m => ({ ...m, [id]: data }))
    }
  }

  const pending = queries.filter(q => !['RESPONDED', 'REJECTED', 'EXPIRED'].includes(q.status))
  const responded = queries.filter(q => q.status === 'RESPONDED')
  const closed = queries.filter(q => ['REJECTED', 'EXPIRED'].includes(q.status))

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="My Expert Queries" activeRole="FARMER" back="/home" />
      <div className="pt-16 pb-20 px-4">
        <button
          onClick={() => router.replace('/home')}
          className="mt-4 mb-2 flex items-center gap-1 text-sm"
          style={{ color: '#7A8C7E' }}>
          ← Back to home
        </button>
        {loading ? (
          <div className="mt-4 h-20 bg-white rounded-2xl animate-pulse" />
        ) : queries.length === 0 ? (
          <div className="mt-4 text-center py-16">
            <span className="text-4xl">💬</span>
            <p className="text-[#6B3F1F] font-medium mt-3">No expert queries yet</p>
            <p className="text-[#7A8C7E] text-sm mt-1">Ask an expert from any active advisory</p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* Pending */}
            {pending.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide mb-2">Awaiting Response ({pending.length})</p>
                <div className="space-y-2">
                  {pending.map(q => (
                    <div key={q.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
                      <button className="w-full px-4 py-3.5 text-left flex items-start gap-3"
                        onClick={() => toggleQuery(q.id)}>
                        <div className="flex-1">
                          <p className="font-medium text-[#6B3F1F] text-sm">{q.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[q.status]}`}>
                              {q.status}
                            </span>
                            <span className="text-xs text-[#7A8C7E]">{new Date(q.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <svg className={`w-4 h-4 text-[#7A8C7E] transition-transform mt-1 ${expandedQuery === q.id ? 'rotate-180' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Responded */}
            {responded.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide mb-2">Responded ({responded.length})</p>
                <div className="space-y-2">
                  {responded.map(q => (
                    <div key={q.id} className="bg-white rounded-2xl border border-green-100 shadow-sm overflow-hidden">
                      <button className="w-full px-4 py-3.5 text-left flex items-start gap-3"
                        onClick={() => toggleQuery(q.id)}>
                        <div className="flex-1">
                          <p className="font-medium text-[#6B3F1F] text-sm">{q.title}</p>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">RESPONDED</span>
                        </div>
                        <svg className={`w-4 h-4 text-[#7A8C7E] transition-transform mt-1 ${expandedQuery === q.id ? 'rotate-180' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {expandedQuery === q.id && queryDetail[q.id]?.response && (() => {
                        const resp = queryDetail[q.id].response!
                        const media = resp.media || []
                        const photos = media.filter(m => m.media_type === 'IMAGE')
                        const audios = media.filter(m => m.media_type === 'AUDIO')
                        const links  = media.filter(m => m.media_type === 'HYPERLINK')
                        return (
                          <div className="border-t border-green-100 px-4 pb-4 pt-3 space-y-3">
                            {resp.has_cha_recommendation && (
                              <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                                <p className="text-xs text-blue-700 font-medium">🔬 Crop Health Advisory Added</p>
                                <p className="text-xs text-blue-600 mt-0.5">
                                  Treatment recommendations for <strong>{resp.problem_name || resp.problem_cosh_id}</strong> have been added to your advisory timeline.
                                </p>
                              </div>
                            )}
                            {resp.text && (
                              <div>
                                <p className="text-xs font-medium text-[#7A8C7E] mb-1">Expert&apos;s Advice:</p>
                                <p className="text-sm text-[#6B3F1F] leading-relaxed">{resp.text}</p>
                              </div>
                            )}
                            {photos.length > 0 && (
                              <div className="grid grid-cols-2 gap-2">
                                {photos.map((p, i) => (
                                  <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="block">
                                    <img src={p.url} alt={`Expert photo ${i + 1}`}
                                      className="w-full h-28 object-cover rounded-xl border border-[#DDD0B8]" />
                                  </a>
                                ))}
                              </div>
                            )}
                            {audios.map((a, i) => (
                              <div key={i} className="bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl px-3 py-2">
                                <p className="text-xs text-[#7A8C7E] mb-1">🎙 Expert&apos;s voice note</p>
                                <audio src={a.url} controls className="w-full" />
                              </div>
                            ))}
                            {links.map((l, i) => (
                              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                                className="block bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm text-blue-700 hover:underline truncate">
                                🔗 {l.url}
                              </a>
                            ))}
                            <p className="text-xs text-[#DDD0B8]">
                              {new Date(resp.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        )
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Closed */}
            {closed.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide mb-2">Closed</p>
                <div className="space-y-2">
                  {closed.map(q => (
                    <div key={q.id} className="bg-white rounded-2xl border border-[#DDD0B8] opacity-70">
                      <div className="px-4 py-3.5">
                        <p className="font-medium text-[#6B3F1F] text-sm">{q.title}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[q.status]}`}>
                          {q.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <BottomNav color="#3A7D44" activeRole="FARMER" />
    </div>
  )
}
