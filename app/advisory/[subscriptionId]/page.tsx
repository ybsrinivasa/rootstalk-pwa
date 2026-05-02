'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface Element { element_type: string; cosh_ref: string | null; value: string | null; unit_cosh_id: string | null }
interface Practice {
  id: string; l0_type: 'INPUT' | 'NON_INPUT' | 'INSTRUCTION' | 'MEDIA'
  l1_type: string | null; l2_type: string | null; display_order: number
  is_special_input: boolean; elements: Element[]
}
interface PendingConditionalQuestion {
  question_id: string; question_text: string; display_order: number
}
interface TimelineItem {
  id: string; name: string; source: string   // CCA | CHA
  from_date: string; to_date: string; day_number: number
  practices: Practice[]
  pending_conditional_question?: PendingConditionalQuestion
  has_pending_question?: boolean
}
interface AdvisoryDay {
  subscription_id: string; client_id: string; package_id: string; package_name: string
  crop_cosh_id: string; crop_start_date: string | null; day_offset: number
  reference_number: string | null; timelines: TimelineItem[]
}
interface Subscription { id: string; package_id: string; client_id: string; status: string; crop_start_date: string | null; reference_number: string | null }

const L0_BG: Record<string, string> = {
  INPUT: '#1d4ed8', NON_INPUT: '#7c3aed', INSTRUCTION: '#b45309', MEDIA: '#be185d',
}
const L0_LABEL: Record<string, string> = {
  INPUT: 'Apply Input', NON_INPUT: 'Crop Activity', INSTRUCTION: 'Advisory', MEDIA: 'Reference',
}

export default function AdvisoryPage() {
  const router = useRouter()
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const [advisory, setAdvisory] = useState<AdvisoryDay | null>(null)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [startDate, setStartDate] = useState('')
  const [savingDate, setSavingDate] = useState(false)
  const [loading, setLoading] = useState(true)
  const [orderingPractice, setOrderingPractice] = useState<string | null>(null)
  const [orderSuccess, setOrderSuccess] = useState('')
  const [answeringQuestion, setAnsweringQuestion] = useState<string | null>(null) // question_id being answered

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [router, subscriptionId])

  async function load() {
    try {
      const [subsRes, advisoryRes] = await Promise.allSettled([
        api.get<Subscription[]>('/farmer/my-subscriptions'),
        api.get<AdvisoryDay[]>('/farmer/advisory/today'),
      ])
      if (subsRes.status === 'fulfilled') {
        const sub = subsRes.value.data.find(s => s.id === subscriptionId)
        if (sub) { setSubscription(sub); setStartDate(sub.crop_start_date?.split('T')[0] || '') }
      }
      if (advisoryRes.status === 'fulfilled') {
        const day = advisoryRes.value.data.find(a => a.subscription_id === subscriptionId)
        setAdvisory(day || null)
      }
    } finally { setLoading(false) }
  }

  async function saveStartDate() {
    if (!startDate) return
    setSavingDate(true)
    try {
      await api.put(`/farmer/subscriptions/${subscriptionId}/start-date`, {
        crop_start_date: new Date(startDate).toISOString()
      })
      await load()
    } finally { setSavingDate(false) }
  }

  async function answerConditional(questionId: string, answer: 'YES' | 'NO') {
    setAnsweringQuestion(questionId)
    try {
      await api.post('/farmer/advisory/conditional-answer', {
        subscription_id: subscriptionId,
        question_id: questionId,
        answer,
      })
      await load()  // Reload advisory with filtered practices
    } finally { setAnsweringQuestion(null) }
  }

  function orderPractice(practiceId: string, orderType = 'PESTICIDE') {
    router.push(`/order/new/${subscriptionId}?practice_ids=${practiceId}&order_type=${orderType}`)
  }

  function buyAll(l1Filter: string, orderType: string) {
    if (!advisory) return
    const ids = advisory.timelines
      .flatMap(tl => tl.practices || [])
      .filter(p => p.l0_type === 'INPUT' && (p.l1_type || '').toLowerCase().includes(l1Filter))
      .map(p => p.id)
    if (ids.length === 0) return
    router.push(`/order/new/${subscriptionId}?practice_ids=${ids.join(',')}&order_type=${orderType}`)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const hasStartDate = !!subscription?.crop_start_date

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title={advisory?.package_name || 'Advisory'} activeRole="FARMER" />
      <div className="pt-16 pb-24">

        {/* Start date gate */}
        {!hasStartDate && (
          <div className="mx-4 mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <p className="font-semibold text-amber-800 text-sm mb-1">Set your crop start date</p>
            <p className="text-amber-600 text-xs mb-4">
              Advisory begins once you tell us when you sowed or transplanted.
            </p>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="w-full border border-amber-200 rounded-xl px-4 py-3 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 mb-3" />
            <button onClick={saveStartDate} disabled={!startDate || savingDate}
              className="w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
              style={{ background: '#1A5C2A' }}>
              {savingDate ? 'Saving…' : 'Set start date and begin advisory'}
            </button>
          </div>
        )}

        {/* Active advisory */}
        {hasStartDate && advisory && (
          <div className="px-4 mt-4 space-y-4">
            {/* Day counter */}
            <div className="bg-white rounded-2xl px-4 py-3 border border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">Today</p>
                <p className="font-bold text-slate-800">
                  Day {advisory.day_offset >= 0 ? `+${advisory.day_offset}` : advisory.day_offset}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">Reference</p>
                <p className="text-xs font-mono text-slate-600">{advisory.reference_number || '—'}</p>
              </div>
            </div>

            {/* Buy all bulk buttons */}
            {advisory.timelines.length > 0 && (() => {
              const allPractices = advisory.timelines.flatMap(tl => tl.practices || [])
              const hasPest = allPractices.some(p => p.l0_type === 'INPUT' && (p.l1_type || '').toLowerCase().includes('pest'))
              const hasFert = allPractices.some(p => p.l0_type === 'INPUT' && (p.l1_type || '').toLowerCase().includes('fert'))
              if (!hasPest && !hasFert) return null
              return (
                <div className="flex gap-2">
                  {hasPest && (
                    <button onClick={() => buyAll('pest', 'PESTICIDE')}
                      className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                      Buy all Pesticides
                    </button>
                  )}
                  {hasFert && (
                    <button onClick={() => buyAll('fert', 'FERTILISER')}
                      className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-green-100 text-green-800 border border-green-200">
                      Buy all Fertilisers
                    </button>
                  )}
                </div>
              )
            })()}

            {/* No active timelines today */}
            {advisory.timelines.length === 0 && (
              <div className="bg-white rounded-2xl p-6 text-center border border-slate-100">
                <span className="text-3xl">☀️</span>
                <p className="text-slate-700 font-medium mt-3">No tasks today</p>
                <p className="text-slate-400 text-sm mt-1">
                  No practices are scheduled for Day {advisory.day_offset}. Check back tomorrow.
                </p>
              </div>
            )}

            {/* Timeline sections */}
            {advisory.timelines.map(tl => (
              <div key={tl.id}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-px flex-1 bg-slate-200" />
                  <div className="flex items-center gap-1.5 px-2">
                    {tl.source === 'CHA' && (
                      <span className="text-xs font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">🔬 CHA</span>
                    )}
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{tl.name}</p>
                  </div>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                {/* BL-02: Show conditional question BEFORE practices */}
                {tl.has_pending_question && tl.pending_conditional_question ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-3">
                    <p className="text-xs font-semibold text-amber-700 mb-2 uppercase tracking-wide">Quick check before today's advice</p>
                    <p className="font-medium text-slate-800 text-sm leading-relaxed mb-4">
                      {tl.pending_conditional_question.question_text}
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => answerConditional(tl.pending_conditional_question!.question_id, 'NO')}
                        disabled={answeringQuestion === tl.pending_conditional_question.question_id}
                        className="flex-1 py-3 rounded-xl border-2 border-red-200 bg-red-50 text-red-700 font-bold disabled:opacity-50">
                        ✗ No
                      </button>
                      <button
                        onClick={() => answerConditional(tl.pending_conditional_question!.question_id, 'YES')}
                        disabled={answeringQuestion === tl.pending_conditional_question.question_id}
                        className="flex-1 py-3 rounded-xl border-2 border-green-500 bg-green-600 text-white font-bold disabled:opacity-50">
                        ✓ Yes
                      </button>
                    </div>
                    {answeringQuestion === tl.pending_conditional_question.question_id && (
                      <p className="text-xs text-amber-600 text-center mt-2">Updating your advisory…</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {tl.practices.map(p => (
                      <PracticeCard
                        key={p.id}
                        practice={p}
                        onOrder={() => orderPractice(p.id)}
                        isOrdering={orderingPractice === p.id}
                        ordered={orderSuccess === p.id}
                      />
                    ))}
                    {tl.practices.length === 0 && (
                      <div className="bg-slate-50 rounded-xl px-4 py-3 text-center">
                        <p className="text-xs text-slate-400">We will check this with you again tomorrow.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Quick links */}
            <div className="grid grid-cols-2 gap-3 mt-2">
              <button onClick={() => router.push(`/advisory/${subscriptionId}/diagnose`)}
                className="bg-white rounded-2xl p-4 border border-slate-100 text-left shadow-sm active:scale-95 transition-transform">
                <span className="text-2xl">🔍</span>
                <p className="text-sm font-medium text-slate-800 mt-2">Diagnose Problem</p>
                <p className="text-xs text-slate-400">Identify crop issues</p>
              </button>
              <button onClick={() => router.push('/orders')}
                className="bg-white rounded-2xl p-4 border border-slate-100 text-left shadow-sm active:scale-95 transition-transform">
                <span className="text-2xl">📦</span>
                <p className="text-sm font-medium text-slate-800 mt-2">My Orders</p>
                <p className="text-xs text-slate-400">Track input orders</p>
              </button>
            </div>
          </div>
        )}
      </div>
      <BottomNav color="#1A5C2A" />
    </div>
  )
}

function PracticeCard({ practice, onOrder, isOrdering, ordered }: {
  practice: Practice
  onOrder: () => void
  isOrdering: boolean
  ordered: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const colour = L0_BG[practice.l0_type] || '#1A5C2A'
  const label = L0_LABEL[practice.l0_type] || practice.l0_type

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3.5" onClick={() => setExpanded(e => !e)}>
        <div className="w-2 h-8 rounded-full flex-shrink-0" style={{ background: colour }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
              style={{ background: colour }}>{label}</span>
            {practice.is_special_input && (
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Adjuvant</span>
            )}
          </div>
          <p className="text-sm font-medium text-slate-800 mt-1">
            {[practice.l1_type, practice.l2_type].filter(Boolean).join(' — ') || 'General Advisory'}
          </p>
        </div>
        {practice.l0_type === 'INPUT' && (
          <button
            onClick={e => { e.stopPropagation(); onOrder() }}
            disabled={isOrdering || ordered}
            className="shrink-0 text-xs font-semibold text-white px-3 py-2 rounded-xl disabled:opacity-60"
            style={{ background: ordered ? '#16a34a' : '#1A5C2A' }}>
            {ordered ? '✓ Ordered' : isOrdering ? '…' : 'Order'}
          </button>
        )}
      </div>

      {/* Expandable elements */}
      {expanded && practice.elements.length > 0 && (
        <div className="border-t border-slate-100 px-4 pb-3 pt-2 space-y-1.5">
          {practice.elements.map((el, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-slate-400 text-xs mt-0.5">•</span>
              <div>
                <span className="text-slate-600 font-medium">{el.element_type}</span>
                {el.cosh_ref && <span className="text-slate-400 text-xs ml-1">({el.cosh_ref})</span>}
                {el.value && <span className="text-slate-600 ml-1">{el.value}{el.unit_cosh_id ? ` ${el.unit_cosh_id}` : ''}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {practice.elements.length > 0 && (
        <div className="px-4 pb-2 text-xs text-slate-400 cursor-pointer" onClick={() => setExpanded(e => !e)}>
          {expanded ? '▲ Hide details' : `▼ ${practice.elements.length} detail${practice.elements.length > 1 ? 's' : ''}`}
        </div>
      )}
    </div>
  )
}
