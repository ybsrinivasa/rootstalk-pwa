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
  relation_id?: string | null
  relation_role?: string | null    // PART_n__OPT_m__POS_p
  relation_type?: 'AND' | 'OR' | 'IF' | null
  frequency_days?: number | null
  is_frequency_due_today?: boolean
}
interface PendingConditionalQuestion {
  question_id: string; question_text: string; display_order: number
}
interface BlankPathQuestion {
  question_id: string; question_text: string; farmer_answer: string
}
interface TimelineItem {
  id: string; name: string; source: string   // CCA | CHA
  from_date: string; to_date: string; day_number: number
  practices: Practice[]
  pending_conditional_question?: PendingConditionalQuestion
  has_pending_question?: boolean
  blank_path_questions?: BlankPathQuestion[]
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

// ── Relation grouping helpers ───────────────────────────────────────────────
function decodeRole(role: string): { part: number; option: number; position: number } | null {
  const m = /^PART_(\d+)__OPT_(\d+)__POS_(\d+)$/.exec(role)
  if (!m) return null
  return { part: +m[1], option: +m[2], position: +m[3] }
}

interface OptionGroup { option: number; practices: Practice[] }
interface PartGroup { part: number; options: OptionGroup[] }

function buildPartsTree(practices: Practice[]): PartGroup[] {
  const partsMap: Record<number, Record<number, { pos: number; p: Practice }[]>> = {}
  for (const p of practices) {
    const c = decodeRole(p.relation_role || '')
    if (!c) continue
    partsMap[c.part] = partsMap[c.part] || {}
    partsMap[c.part][c.option] = partsMap[c.part][c.option] || []
    partsMap[c.part][c.option].push({ pos: c.position, p })
  }
  return Object.keys(partsMap)
    .map(Number)
    .sort((a, b) => a - b)
    .map(partNum => ({
      part: partNum,
      options: Object.keys(partsMap[partNum])
        .map(Number)
        .sort((a, b) => a - b)
        .map(optNum => ({
          option: optNum,
          practices: partsMap[partNum][optNum]
            .sort((a, b) => a.pos - b.pos)
            .map(x => x.p),
        })),
    }))
}

interface PracticeRow {
  kind: 'standalone' | 'relation'
  // For 'standalone': single practice
  practice?: Practice
  // For 'relation': the grouping
  relation_id?: string
  relation_type?: 'AND' | 'OR' | 'IF'
  parts?: PartGroup[]
  // Stable display order: smallest display_order across all practices in group
  sortKey: number
}

function groupTimelinePractices(practices: Practice[]): PracticeRow[] {
  const standalones: Practice[] = []
  const byRelation: Record<string, Practice[]> = {}
  for (const p of practices) {
    if (p.relation_id) {
      byRelation[p.relation_id] = byRelation[p.relation_id] || []
      byRelation[p.relation_id].push(p)
    } else {
      standalones.push(p)
    }
  }
  const rows: PracticeRow[] = []
  for (const p of standalones) {
    rows.push({ kind: 'standalone', practice: p, sortKey: p.display_order })
  }
  for (const [relId, rPracs] of Object.entries(byRelation)) {
    const parts = buildPartsTree(rPracs)
    const minOrder = Math.min(...rPracs.map(x => x.display_order))
    const relType = (rPracs.find(x => x.relation_type)?.relation_type || 'OR') as 'AND' | 'OR' | 'IF'
    rows.push({ kind: 'relation', relation_id: relId, relation_type: relType, parts, sortKey: minOrder })
  }
  rows.sort((a, b) => a.sortKey - b.sortKey)
  return rows
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
  const [nextDate, setNextDate] = useState<{ next_date: string | null; timeline_name?: string; days_until?: number; reason?: string } | null>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [router, subscriptionId])

  useEffect(() => {
    const hasStart = !!subscription?.crop_start_date
    if (advisory && advisory.timelines.length === 0 && hasStart) {
      api.get<{ next_date: string | null; timeline_name?: string; days_until?: number; reason?: string }>(
        `/farmer/subscriptions/${subscriptionId}/advisory/next-date`,
      )
        .then(r => setNextDate(r.data))
        .catch(() => {})
    }
  }, [advisory, subscription, subscriptionId])

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
    if (!startDate || !startDate.trim()) {
      alert('Please choose a date. The start date cannot be removed once set.')
      return
    }
    setSavingDate(true)
    try {
      await api.put(`/farmer/subscriptions/${subscriptionId}/start-date`, {
        crop_start_date: new Date(startDate).toISOString()
      })
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      alert(err.response?.data?.detail || 'Could not save start date')
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
              <div className="bg-white rounded-2xl p-6 text-center border border-slate-100 shadow-sm">
                <svg className="w-12 h-12 mx-auto text-slate-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"/>
                </svg>
                <p className="text-slate-800 font-semibold mt-3">No advice for today</p>
                {nextDate?.next_date ? (
                  <>
                    <p className="text-slate-500 text-sm mt-2">Your next advisory window opens on</p>
                    <p className="text-slate-800 font-semibold text-base mt-1">
                      {new Date(nextDate.next_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                    {nextDate.days_until !== undefined && (
                      <p className="text-slate-400 text-xs mt-1">
                        in {nextDate.days_until} day{nextDate.days_until !== 1 ? 's' : ''}
                      </p>
                    )}
                  </>
                ) : nextDate?.reason === 'no_more_practices' ? (
                  <p className="text-slate-500 text-sm mt-2">You have completed all advisory practices for this season.</p>
                ) : (
                  <p className="text-slate-400 text-sm mt-2">Check back tomorrow.</p>
                )}
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
                    {tl.source === 'QA' && (
                      // Pundit-origin marker. Same advisory shape as
                      // CHA — Timeline → Practice → Element with
                      // purchase + tracking — but originated from a
                      // FarmPundit picking a curated standard answer.
                      <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">🌾 Pundit</span>
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
                    {groupTimelinePractices(tl.practices).map(row => {
                      if (row.kind === 'standalone' && row.practice) {
                        const p = row.practice
                        return (
                          <PracticeCard
                            key={p.id}
                            practice={p}
                            onOrder={() => orderPractice(p.id)}
                            isOrdering={orderingPractice === p.id}
                            ordered={orderSuccess === p.id}
                          />
                        )
                      }
                      // Relation row
                      return (
                        <RelationGroup
                          key={row.relation_id}
                          relationType={row.relation_type || 'OR'}
                          parts={row.parts || []}
                          orderingPractice={orderingPractice}
                          orderSuccess={orderSuccess}
                          onOrder={(ids) => {
                            const url = `/order/new/${subscriptionId}?practice_ids=${ids.join(',')}&order_type=PESTICIDE`
                            router.push(url)
                          }}
                        />
                      )
                    })}
                    {tl.practices.length === 0 && !tl.blank_path_questions?.length && (
                      <div className="bg-slate-50 rounded-xl px-4 py-3 text-center">
                        <p className="text-xs text-slate-400">We will check this with you again tomorrow.</p>
                      </div>
                    )}
                    {/* Per spec §6.4: question-specific warm message after blank-path answer */}
                    {tl.blank_path_questions?.map(bp => (
                      <div key={bp.question_id} className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mt-2">
                        <p className="text-xs text-amber-700 font-medium">
                          You answered <span className="font-bold">{bp.farmer_answer}</span> to: &ldquo;{bp.question_text}&rdquo;
                        </p>
                        <p className="text-xs text-amber-600 mt-1">
                          We will ask you this question again tomorrow.
                        </p>
                      </div>
                    ))}
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
            {practice.frequency_days != null && practice.frequency_days > 0 && (
              <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
                </svg>
                {practice.frequency_days === 1 ? 'Every day' : `Every ${practice.frequency_days} days`}
              </span>
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

// ── Practice Relations: AND/OR group renderer ───────────────────────────────
function RelationGroup({ relationType, parts, orderingPractice, orderSuccess, onOrder }: {
  relationType: 'AND' | 'OR' | 'IF'
  parts: PartGroup[]
  orderingPractice: string | null
  orderSuccess: string
  onOrder: (practiceIds: string[]) => void
}) {
  if (parts.length === 0) return null

  // Single Part with single Option AND-group: paired card with "Order both together"
  const isPureAndGroup =
    relationType === 'AND' &&
    parts.length === 1 &&
    parts[0].options.length === 1 &&
    parts[0].options[0].practices.length > 1

  if (isPureAndGroup) {
    const opt = parts[0].options[0]
    const ids = opt.practices.map(p => p.id)
    const isOrderingAny = ids.some(id => orderingPractice === id)
    const isAnyOrdered = ids.some(id => orderSuccess === id)
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-emerald-50">
          <div className="w-1 h-5 rounded-full bg-emerald-600" />
          <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">
            Apply both together — AND group
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {opt.practices.map(p => (
            <InnerPracticeRow key={p.id} practice={p} />
          ))}
        </div>
        <div className="px-4 py-3 border-t border-slate-100 flex justify-end">
          <button
            onClick={() => onOrder(ids)}
            disabled={isOrderingAny || isAnyOrdered}
            className="text-xs font-semibold text-white px-4 py-2 rounded-xl disabled:opacity-60"
            style={{ background: isAnyOrdered ? '#16a34a' : '#1A5C2A' }}
          >
            {isAnyOrdered ? '✓ Ordered' : isOrderingAny ? '…' : 'Order both together'}
          </button>
        </div>
      </div>
    )
  }

  // Otherwise: render each Part; show OR separators between Options of choice Parts
  return (
    <div className="space-y-2">
      {parts.map((part, partIdx) => (
        <div key={part.part}>
          {parts.length > 1 && (
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                Part {part.part}
              </span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
          )}
          {part.options.map((opt, optIdx) => {
            const ids = opt.practices.map(p => p.id)
            const isOrderingAny = ids.some(id => orderingPractice === id)
            const isAnyOrdered = ids.some(id => orderSuccess === id)
            const isCompound = opt.practices.length > 1
            const isChoice = part.options.length > 1
            const buttonLabel = isCompound
              ? (isAnyOrdered ? '✓ Ordered' : isOrderingAny ? '…' : 'Order this option')
              : (isAnyOrdered ? '✓ Ordered' : isOrderingAny ? '…' : 'Order')

            return (
              <div key={opt.option}>
                {isChoice && optIdx > 0 && (
                  <div className="flex items-center my-2">
                    <div className="h-px flex-1 bg-slate-300" />
                    <span className="px-3 text-xs font-bold text-slate-500 bg-slate-50 rounded">OR</span>
                    <div className="h-px flex-1 bg-slate-300" />
                  </div>
                )}
                {isCompound ? (
                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-emerald-50">
                      <div className="w-1 h-5 rounded-full bg-emerald-600" />
                      <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">
                        Apply together
                      </p>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {opt.practices.map(p => (
                        <InnerPracticeRow key={p.id} practice={p} />
                      ))}
                    </div>
                    <div className="px-4 py-3 border-t border-slate-100 flex justify-end">
                      <button
                        onClick={() => onOrder(ids)}
                        disabled={isOrderingAny || isAnyOrdered}
                        className="text-xs font-semibold text-white px-4 py-2 rounded-xl disabled:opacity-60"
                        style={{ background: isAnyOrdered ? '#16a34a' : '#1A5C2A' }}
                      >
                        {buttonLabel}
                      </button>
                    </div>
                  </div>
                ) : (
                  // Single practice in this Option — render a normal practice card with
                  // its own Order button that sends just this practice id.
                  <PracticeCard
                    practice={opt.practices[0]}
                    onOrder={() => onOrder(ids)}
                    isOrdering={isOrderingAny}
                    ordered={isAnyOrdered}
                  />
                )}
              </div>
            )
          })}
          {partIdx < parts.length - 1 && parts.length > 1 && (
            <div className="my-3 h-px bg-slate-300" />
          )}
        </div>
      ))}
    </div>
  )
}

// Compact in-group practice row (used inside a paired AND-group card)
function InnerPracticeRow({ practice }: { practice: Practice }) {
  const colour = L0_BG[practice.l0_type] || '#1A5C2A'
  const label = L0_LABEL[practice.l0_type] || practice.l0_type
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap mb-0.5">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
          style={{ background: colour }}>{label}</span>
        {practice.is_special_input && (
          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Adjuvant</span>
        )}
        {practice.frequency_days != null && practice.frequency_days > 0 && (
          <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
            {practice.frequency_days === 1 ? 'Every day' : `Every ${practice.frequency_days} days`}
          </span>
        )}
      </div>
      <p className="text-sm font-medium text-slate-800">
        {[practice.l1_type, practice.l2_type].filter(Boolean).join(' — ') || 'General Advisory'}
      </p>
    </div>
  )
}
