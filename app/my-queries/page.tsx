'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
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
interface SubmissionMedia { media_type: string; url: string }

interface QueryDetail {
  id: string; title: string; status: string
  description: string | null
  severity: string
  crop_age: string | null
  created_at: string
  media: SubmissionMedia[]
  response: {
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
  const t = useTranslations('farmerQueries')
  const locale = useLocale()
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

  // Single QueryCard used by all three buckets — mirror of the
  // per-sub Queries page (2026-06-18). Farmer needs to see what
  // they asked + what came back together; separating the two on
  // different surfaces was confusing.
  function QueryCard({ q, variant }: { q: QueryItem; variant: 'pending' | 'responded' | 'closed' }) {
    const isOpen = expandedQuery === q.id
    const detail = queryDetail[q.id]
    const borderClass = variant === 'responded' ? 'border-green-100' : 'border-[#DDD0B8]'
    const dimClass = variant === 'closed' ? 'opacity-70' : ''
    return (
      <div className={`bg-white rounded-2xl border ${borderClass} shadow-sm overflow-hidden ${dimClass}`}>
        <button className="w-full px-4 py-3.5 text-left flex items-start gap-3"
          onClick={() => toggleQuery(q.id)}>
          <div className="flex-1">
            <p className="font-medium text-[#6B3F1F] text-sm">{q.title}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${variant === 'responded' ? 'bg-green-100 text-green-700' : STATUS_COLOUR[q.status]}`}>
                {variant === 'responded' ? t('respondedBadge') : q.status}
              </span>
              <span className="text-xs text-[#7A8C7E]">{new Date(q.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            </div>
          </div>
          <svg className={`w-4 h-4 text-[#7A8C7E] transition-transform mt-1 ${isOpen ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isOpen && detail && (() => {
          const submitted = detail.media || []
          const myPhotos = submitted.filter(m => m.media_type === 'IMAGE')
          const myAudio = submitted.filter(m => m.media_type === 'AUDIO')
          const resp = detail.response
          const respMedia = resp?.media || []
          const respPhotos = respMedia.filter(m => m.media_type === 'IMAGE')
          const respAudio = respMedia.filter(m => m.media_type === 'AUDIO')
          const respLinks = respMedia.filter(m => m.media_type === 'HYPERLINK')
          return (
            <div className="border-t border-[#DDD0B8] px-4 py-3 space-y-3">
              {detail.description && (
                <p className="text-sm text-[#6B3F1F] leading-relaxed">{detail.description}</p>
              )}
              {myPhotos.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-[#7A8C7E] mb-1">{t('yourPhotos')}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {myPhotos.map((p, i) => (
                      <a key={i} href={p.url} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" className="w-full h-20 object-cover rounded-lg border border-[#DDD0B8]" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {myAudio.map((a, i) => (
                <div key={i} className="bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl px-3 py-2">
                  <p className="text-xs text-[#7A8C7E] mb-1">{t('yourVoiceNote')}</p>
                  <audio src={a.url} controls className="w-full" />
                </div>
              ))}
              <p className="text-xs text-[#DDD0B8]">{t('askedOn', { date: new Date(detail.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }) })}</p>

              {resp ? (
                <div className="border-t border-green-100 pt-3 mt-3 space-y-3">
                  {resp.has_cha_recommendation && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                      <p className="text-xs text-blue-700 font-medium">{t('chaAddedTitle')}</p>
                      <p className="text-xs text-blue-600 mt-0.5">
                        {t('chaAddedBodyPrefix')} <strong>{resp.problem_name || resp.problem_cosh_id}</strong> {t('chaAddedBodySuffix')}
                      </p>
                    </div>
                  )}
                  {resp.text && (
                    <div>
                      <p className="text-xs font-medium text-[#7A8C7E] mb-1">{t('expertAdvice')}</p>
                      <p className="text-sm text-[#6B3F1F] leading-relaxed">{resp.text}</p>
                    </div>
                  )}
                  {respPhotos.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {respPhotos.map((p, i) => (
                        <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.url} alt={t('expertPhotoAlt', { index: i + 1 })}
                            className="w-full h-28 object-cover rounded-xl border border-[#DDD0B8]" />
                        </a>
                      ))}
                    </div>
                  )}
                  {respAudio.map((a, i) => (
                    <div key={i} className="bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl px-3 py-2">
                      <p className="text-xs text-[#7A8C7E] mb-1">{t('expertVoiceNote')}</p>
                      <audio src={a.url} controls className="w-full" />
                    </div>
                  ))}
                  {respLinks.map((l, i) => (
                    <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                      className="block bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm text-blue-700 hover:underline truncate">
                      🔗 {l.url}
                    </a>
                  ))}
                  <p className="text-xs text-[#DDD0B8]">
                    {new Date(resp.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[#7A8C7E] italic border-t border-[#DDD0B8] pt-3 mt-3">
                  {variant === 'closed' ? t('closedNoResponse') : t('awaitingReply')}
                </p>
              )}
            </div>
          )
        })()}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FARMER" back="/home" />
      <div className="pt-16 pb-20 px-4">
        <button
          onClick={() => router.replace('/home')}
          className="mt-4 mb-2 flex items-center gap-1 text-sm"
          style={{ color: '#7A8C7E' }}>
          {t('backToHome')}
        </button>
        {loading ? (
          <div className="mt-4 h-20 bg-white rounded-2xl animate-pulse" />
        ) : queries.length === 0 ? (
          <div className="mt-4 text-center py-16">
            <span className="text-4xl">💬</span>
            <p className="text-[#6B3F1F] font-medium mt-3">{t('empty')}</p>
            <p className="text-[#7A8C7E] text-sm mt-1">{t('emptyHint')}</p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {pending.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide mb-2">{t('awaitingResponse', { count: pending.length })}</p>
                <div className="space-y-2">
                  {pending.map(q => <QueryCard key={q.id} q={q} variant="pending" />)}
                </div>
              </div>
            )}
            {responded.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide mb-2">{t('responded', { count: responded.length })}</p>
                <div className="space-y-2">
                  {responded.map(q => <QueryCard key={q.id} q={q} variant="responded" />)}
                </div>
              </div>
            )}
            {closed.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide mb-2">{t('closed')}</p>
                <div className="space-y-2">
                  {closed.map(q => <QueryCard key={q.id} q={q} variant="closed" />)}
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
