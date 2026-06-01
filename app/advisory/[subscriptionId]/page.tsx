'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import ClientCropChip from '@/components/ClientCropChip'
import api from '@/lib/api'

interface Element { element_type: string; cosh_ref: string | null; value: string | null; unit_cosh_id: string | null }
interface Fulfilment {
  status: 'PENDING' | 'AVAILABLE' | 'POSTPONED' | 'NOT_AVAILABLE'
        | 'SENT_FOR_APPROVAL' | 'APPROVED' | 'REJECTED'
  order_id: string
  order_item_id: string
  order_status: string
  dealer_user_id: string | null
  facilitator_user_id: string | null
  brand_name: string | null
  given_volume: number | null
  volume_unit: string | null
  price: number | null
  postponed_until: string | null
  postpone_days_remaining: number | null
}
interface Practice {
  id: string; l0_type: 'INPUT' | 'NON_INPUT' | 'INSTRUCTION' | 'MEDIA'
  l1_type: string | null; l2_type: string | null; display_order: number
  is_special_input: boolean; elements: Element[]
  relation_id?: string | null
  relation_role?: string | null    // PART_n__OPT_m__POS_p
  relation_type?: 'AND' | 'OR' | 'IF' | null
  frequency_days?: number | null
  is_frequency_due_today?: boolean
  is_purchased?: boolean
  fulfilment?: Fulfilment | null
}
interface PendingConditionalQuestion {
  question_id: string; question_text: string; display_order: number
}
interface BlankPathQuestion {
  question_id: string; question_text: string; farmer_answer: string
}
interface TimelineItem {
  id: string; name: string; source: string   // CCA | CHA | QA
  from_date: string; to_date: string; day_number: number
  practices: Practice[]
  pending_conditional_question?: PendingConditionalQuestion
  has_pending_question?: boolean
  blank_path_questions?: BlankPathQuestion[]
  // CHA/QA only: name of the problem the recommendation addresses
  // (e.g. "Fruit Fly"), and the wall-clock timestamp of the diagnosis
  // commit. Used to surface the problem on the card AND to float
  // freshly-triggered timelines to the top of the list.
  problem_name?: string
  triggered_at?: string
}
interface AdvisoryDay {
  subscription_id: string; client_id: string; package_id: string; package_name: string
  crop_cosh_id: string; crop_start_date: string | null; day_offset: number
  reference_number: string | null; timelines: TimelineItem[]
}
interface Subscription { id: string; package_id: string; client_id: string; status: string; crop_start_date: string | null; reference_number: string | null }

// Muted, equal-brightness tones tuned to the warm earth palette
// (Crop Green / Soil Brown / Field Cream). The four hue families
// are kept so each L0 type stays instantly distinguishable, but
// the saturation is dialled back so they no longer fight the
// surrounding cards or the green Order button.
const L0_BG: Record<string, string> = {
  INPUT: '#5B7BA8',       // muted slate blue
  NON_INPUT: '#8B6FA8',   // muted lavender
  INSTRUCTION: '#B58A4A', // warm muted gold
  MEDIA: '#A85F76',       // dusty rose
}
const L0_LABEL: Record<string, string> = {
  INPUT: 'Apply Input', NON_INPUT: 'Crop Activity', INSTRUCTION: 'Advisory', MEDIA: 'Reference',
}

// Farmer-facing helpers — never expose raw enum slugs or
// timeline names; surface the actual date window instead.
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}
function timelineDateLabel(from: string | null, to: string | null): string {
  if (!from && !to) return 'Today'
  if (from && to && from !== to) return `${fmtDate(from)} – ${fmtDate(to)}`
  return fmtDate((to || from)!)
}
function humanizeType(s: string | null): string {
  if (!s) return ''
  return s.toLowerCase().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
// Cosh refs and unit IDs sometimes arrive as bare UUIDs (backend
// hasn't joined them to a friendly name yet). Strip them in the
// UI — showing "(d79cfced-8de1-…)" to a farmer is worse than
// showing nothing.
function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

// Author tools store a unit as its own Element row with
// element_type ending in `_UNIT` (e.g. DOSAGE / DOSAGE_UNIT pair).
// "Dosage Unit" should never appear as its own label to the
// farmer — fold it back onto the preceding non-unit sibling so
// the dosage card reads "Dosage: 5 ml" instead of "Dosage: 5"
// + "Dosage Unit: ml".
type ElementWithUnit = Element & { trailing_unit?: string }
function mergeUnitElements(elements: Element[]): ElementWithUnit[] {
  const out: ElementWithUnit[] = []
  for (const el of elements) {
    const isUnitRow = (el.element_type || '').toUpperCase().endsWith('_UNIT')
    if (isUnitRow && out.length > 0) {
      const unitLabel = el.value || (el.cosh_ref && !isUuid(el.cosh_ref) ? el.cosh_ref : '') || ''
      if (unitLabel) out[out.length - 1].trailing_unit = unitLabel
      // either way, suppress the standalone *_UNIT row
      continue
    }
    out.push({ ...el })
  }
  return out
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
  const [bundleSheet, setBundleSheet] = useState<{ category: 'PESTICIDE' | 'FERTILIZER' } | null>(null)

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

  // 2026-05-21 — replaced per-practice + "Buy all" buttons with a
  // date-range bundle picker. Tapping Order on any pesticide card
  // (or adjuvant — L1=SPECIAL_INPUT) opens the picker for the
  // PESTICIDE basket; fertiliser cards open the FERTILIZER basket.
  // Picker computes the bundle server-side via /order-preview, then
  // routes to /order/new with the resolved practice_ids.
  function basketCategoryFor(l1: string | null | undefined): 'PESTICIDE' | 'FERTILIZER' | null {
    const u = (l1 || '').toUpperCase()
    if (u === 'PESTICIDE' || u === 'SPECIAL_INPUT') return 'PESTICIDE'
    if (u === 'FERTILIZER') return 'FERTILIZER'
    return null
  }
  function orderPractice(practice: Practice, timeline?: TimelineItem) {
    // Phase 3 of the Orders restructure (2026-06-02) — Advisory taps
    // now route to the package's Orders page with the right
    // accordion pre-opened and the practice's date range prefilled.
    // BundleOrderSheet stays defined below for the legacy direct
    // flow but no longer mounts from here.
    const cat = basketCategoryFor(practice.l1_type)
    if (!cat) return
    const todayIso = new Date().toISOString().split('T')[0]
    // Default to_date = the timeline's to_date the practice belongs
    // to. CategorySection on the next page re-previews against the
    // bundle for this window — identical to what BundleOrderSheet
    // computed inline before.
    const toIso = (timeline?.to_date || '').slice(0, 10)
    const params = new URLSearchParams({
      tab: 'order',
      open: cat.toLowerCase(),
      date_from: todayIso,
    })
    if (toIso) params.set('date_to', toIso)
    router.push(`/crop-detail/${subscriptionId}/orders?${params.toString()}`)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const hasStartDate = !!subscription?.crop_start_date

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={advisory?.package_name || 'Advisory'} activeRole="FARMER" back="/home" />
      <div className="pt-16 pb-24">
        <ClientCropChip subscriptionId={subscriptionId} />

        {/* Phase 3 of the Orders restructure (2026-06-02) — Orders
            moved off the Advisory surface entirely. The crop dashboard
            now has its own Orders button that opens a dedicated three-
            tab page; placing them inline on Advisory crossed two
            mental contexts (what-to-do vs what-to-procure). Pre-sowing
            now lives as a sub-mode inside the Pesticide/Fertilizer
            accordions on that page. */}

        {/* Start date gate */}
        {!hasStartDate && (
          <div className="mx-4 mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <p className="font-semibold text-amber-800 text-sm mb-1">Set your crop start date</p>
            <p className="text-amber-600 text-xs mb-4">
              Advisory begins once you tell us when you sowed or transplanted.
            </p>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="w-full border border-amber-200 rounded-xl px-4 py-3 text-sm text-[#6B3F1F] bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 mb-3" />
            <button onClick={saveStartDate} disabled={!startDate || savingDate}
              className="w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
              style={{ background: '#3A7D44' }}>
              {savingDate ? 'Saving…' : 'Set start date and begin advisory'}
            </button>
          </div>
        )}

        {/* Active advisory */}
        {hasStartDate && advisory && (
          <div className="px-4 mt-4 space-y-8">
            {/* Day counter */}
            <div className="bg-white rounded-2xl px-4 py-3 border border-[#DDD0B8] flex items-center justify-between">
              <div>
                <p className="text-xs text-[#7A8C7E]">Today</p>
                <p className="font-bold text-[#6B3F1F]">
                  Day {advisory.day_offset >= 0 ? `+${advisory.day_offset}` : advisory.day_offset}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-[#7A8C7E]">Reference</p>
                <p className="text-xs font-mono text-[#6B3F1F]">{advisory.reference_number || '—'}</p>
              </div>
            </div>

            {/* "Buy all Pesticides / Fertilisers" buttons removed
                2026-05-21 — replaced by the per-card Order tap that
                opens a date-range bundling sheet. The farmer picks
                a TO date once; the bundle picks every unordered
                pesticide (or fertiliser) overlapping that window. */}

            {/* No active timelines today */}
            {advisory.timelines.length === 0 && (
              <div className="bg-white rounded-2xl p-6 text-center border border-[#DDD0B8] shadow-sm">
                <svg className="w-12 h-12 mx-auto text-[#DDD0B8]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"/>
                </svg>
                <p className="text-[#6B3F1F] font-semibold mt-3">No advice for today</p>
                {nextDate?.next_date ? (
                  <>
                    <p className="text-[#7A8C7E] text-sm mt-2">Your next advisory window opens on</p>
                    <p className="text-[#6B3F1F] font-semibold text-base mt-1">
                      {new Date(nextDate.next_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                    {nextDate.days_until !== undefined && (
                      <p className="text-[#7A8C7E] text-xs mt-1">
                        in {nextDate.days_until} day{nextDate.days_until !== 1 ? 's' : ''}
                      </p>
                    )}
                  </>
                ) : nextDate?.reason === 'no_more_practices' ? (
                  <p className="text-[#7A8C7E] text-sm mt-2">You have completed all advisory practices for this season.</p>
                ) : (
                  <p className="text-[#7A8C7E] text-sm mt-2">Check back tomorrow.</p>
                )}
              </div>
            )}

            {/* Date-grouped sections. Order:
                  1. CHA / QA timelines first, newest triggered_at on top
                     (a fresh diagnosis or pundit response is what the
                     farmer just acted on — surface it immediately).
                  2. Then CCA timelines, latest to_date first.
                Timeline name / "(COPY)" suffix is internal jargon —
                farmer sees the actual date window + problem name
                instead. */}
            {[...advisory.timelines]
              .sort((a, b) => {
                const aIsCha = a.source === 'CHA' || a.source === 'QA'
                const bIsCha = b.source === 'CHA' || b.source === 'QA'
                if (aIsCha !== bIsCha) return aIsCha ? -1 : 1
                if (aIsCha && bIsCha) {
                  // newest CHA on top, fall back to date if triggered_at missing
                  const aT = new Date(a.triggered_at || a.from_date || 0).getTime()
                  const bT = new Date(b.triggered_at || b.from_date || 0).getTime()
                  return bT - aT
                }
                return new Date(b.to_date || b.from_date || 0).getTime()
                     - new Date(a.to_date || a.from_date || 0).getTime()
              })
              .map(tl => (
              <div key={tl.id}>
                <div className="mb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-slate-200" />
                    <div className="flex items-center gap-1.5 px-2">
                      {tl.source === 'CHA' && (
                        <span className="text-xs font-bold text-[#D4682E] bg-red-50 px-1.5 py-0.5 rounded">🔬 CHA</span>
                      )}
                      {tl.source === 'QA' && (
                        <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">🌾 Pundit</span>
                      )}
                      <p className="text-xs font-semibold text-[#6B3F1F] tracking-wide">
                        {timelineDateLabel(tl.from_date, tl.to_date)}
                      </p>
                    </div>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>
                  {/* Problem name sits under the badge / date so the
                      farmer immediately knows which problem this set of
                      practices addresses. CCA timelines don't carry a
                      problem_name; the line is suppressed for them. */}
                  {tl.problem_name && (
                    <p className="text-center text-sm font-semibold text-[#6B3F1F] mt-1.5">
                      {tl.problem_name}
                    </p>
                  )}
                </div>

                {/* BL-02: Show conditional question BEFORE practices */}
                {tl.has_pending_question && tl.pending_conditional_question ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-3">
                    <p className="text-xs font-semibold text-amber-700 mb-2 uppercase tracking-wide">Quick check before today's advice</p>
                    <p className="font-medium text-[#6B3F1F] text-sm leading-relaxed mb-4">
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
                            onOrder={() => orderPractice(p, tl)}
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
                          onOrder={() => {
                            // Relation-group "Order both together" — same
                            // date-range bundling. We derive the category
                            // from the first practice's L1; AND/OR groups
                            // are always homogeneous by L1. ids ignored.
                            const first = row.parts?.[0]?.options?.[0]?.practices?.[0]
                            if (first) orderPractice(first, tl)
                          }}
                        />
                      )
                    })}
                    {tl.practices.length === 0 && !tl.blank_path_questions?.length && (
                      <div className="bg-[#F5F0E8] rounded-xl px-4 py-3 text-center">
                        <p className="text-xs text-[#7A8C7E]">We will check this with you again tomorrow.</p>
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
                className="bg-white rounded-2xl p-4 border border-[#DDD0B8] text-left shadow-sm active:scale-95 transition-transform">
                <span className="text-2xl">🔍</span>
                <p className="text-sm font-medium text-[#6B3F1F] mt-2">Diagnose Problem</p>
                <p className="text-xs text-[#7A8C7E]">Identify crop issues</p>
              </button>
              <button onClick={() => router.push('/orders')}
                className="bg-white rounded-2xl p-4 border border-[#DDD0B8] text-left shadow-sm active:scale-95 transition-transform">
                <span className="text-2xl">📦</span>
                <p className="text-sm font-medium text-[#6B3F1F] mt-2">My Orders</p>
                <p className="text-xs text-[#7A8C7E]">Track input orders</p>
              </button>
            </div>
          </div>
        )}
      </div>
      <BottomNav color="#3A7D44" />

      {bundleSheet && (
        <BundleOrderSheet
          subscriptionId={subscriptionId}
          category={bundleSheet.category}
          // Default TO date = end of the latest visible timeline window.
          // The picker clamps to package_end (from /order-preview).
          defaultToDate={(() => {
            if (!advisory) return null
            const tos = advisory.timelines.map(t => t.to_date).filter(Boolean) as string[]
            if (tos.length === 0) return null
            return tos.reduce((max, d) => d > max ? d : max).split('T')[0]
          })()}
          onClose={() => setBundleSheet(null)}
          onConfirm={(practiceIds, toDate) => {
            setBundleSheet(null)
            const todayIso = new Date().toISOString().split('T')[0]
            router.push(
              `/order/new/${subscriptionId}`
              + `?practice_ids=${practiceIds.join(',')}`
              + `&order_type=${bundleSheet.category}`
              + `&date_from=${todayIso}`
              + `&date_to=${toDate}`,
            )
          }}
        />
      )}
    </div>
  )
}

// ── Bundle order sheet ────────────────────────────────────────────────────
//
// Opens when the farmer taps Order on any pesticide / fertiliser /
// adjuvant card. The farmer picks a TO date; this sheet calls
// /order-preview to compute the bundle (every unordered practice in
// the category whose timeline overlaps [today, to_date]) and shows
// a live count. Confirm hands off to /order/new with the bundled
// practice_ids — the dealer-picker continues from there.
function BundleOrderSheet({
  subscriptionId, category, defaultToDate, onClose, onConfirm,
}: {
  subscriptionId: string
  category: 'PESTICIDE' | 'FERTILIZER'
  defaultToDate: string | null
  onClose: () => void
  onConfirm: (practiceIds: string[], toDate: string) => void
}) {
  const todayIso = new Date().toISOString().split('T')[0]
  const [toDate, setToDate] = useState<string>(defaultToDate || todayIso)
  const [preview, setPreview] = useState<{
    count: number
    practices: { id: string }[]
    package_end_date: string | null
    excluded_already_ordered: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!toDate) return
    setLoading(true); setError(null)
    const ctrl = new AbortController()
    api.get(
      `/farmer/subscriptions/${subscriptionId}/order-preview`
      + `?category=${category}&to_date=${toDate}`,
      { signal: ctrl.signal },
    )
      .then(r => setPreview(r.data as typeof preview))
      .catch((err: unknown) => {
        if ((err as { code?: string })?.code === 'ERR_CANCELED') return
        const e = err as {
          response?: { status?: number; data?: { detail?: unknown } }
          message?: string
        }
        const detail = e?.response?.data?.detail
        const status = e?.response?.status
        if (typeof detail === 'string') setError(detail)
        else if (detail && typeof detail === 'object') {
          const m = (detail as { message?: string }).message
          setError(m || JSON.stringify(detail))
        }
        else setError(`Preview failed${status ? ` (HTTP ${status})` : ''}: ${e?.message || 'unknown error'}`)
      })
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [toDate, category, subscriptionId])

  const label = category === 'PESTICIDE' ? 'Pesticides + Adjuvants' : 'Fertilisers'
  const canConfirm = !loading && !error && preview != null && preview.count > 0

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end"
      onClick={onClose}>
      <div className="bg-white w-full rounded-t-3xl p-5 max-w-lg mx-auto"
        onClick={e => e.stopPropagation()}>
        <p className="font-bold text-[#6B3F1F] text-base">Choose date range</p>
        <p className="text-xs text-[#7A8C7E] mt-1">
          One {category === 'PESTICIDE' ? 'pesticide' : 'fertiliser'} order for everything you&apos;ll need between these dates. <span className="font-medium">{label}</span> are included.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-[#7A8C7E] mb-1">From</p>
            <div className="border border-[#DDD0B8] rounded-xl px-3 py-2.5 text-sm text-[#6B3F1F] bg-[#F5F0E8]">
              Today
            </div>
          </div>
          <div>
            <p className="text-xs text-[#7A8C7E] mb-1">To</p>
            <input
              type="date"
              value={toDate}
              min={todayIso}
              max={preview?.package_end_date || undefined}
              onChange={e => setToDate(e.target.value)}
              className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2.5 text-sm text-[#6B3F1F] focus:outline-none focus:border-[#3A7D44]" />
          </div>
        </div>

        <div className="mt-3 bg-[#F5F0E8] rounded-xl px-4 py-3">
          {loading ? (
            <p className="text-sm text-[#7A8C7E]">Calculating…</p>
          ) : error ? (
            <p className="text-sm text-[#D4682E]">{error}</p>
          ) : preview ? (
            <>
              <p className="text-sm font-semibold text-[#6B3F1F]">
                {preview.count} {preview.count === 1 ? 'option' : 'options'} will be in this order
              </p>
              {preview.count > 0 && (
                <p className="text-[11px] text-[#7A8C7E] mt-0.5 leading-snug">
                  The dealer may pick between alternatives — your final list could be shorter.
                </p>
              )}
              {preview.count === 0 && (
                <p className="text-xs text-[#7A8C7E] mt-1">
                  {preview.excluded_already_ordered > 0
                    ? "Everything in this window is already in another order. Pick a later TO date if you want to add more."
                    : "No options match this date range yet. Extend the TO date."}
                </p>
              )}
              {preview.excluded_already_ordered > 0 && preview.count > 0 && (
                <p className="text-xs text-[#7A8C7E] mt-1">
                  {preview.excluded_already_ordered} {preview.excluded_already_ordered === 1 ? 'option' : 'options'} already in an existing order — not shown.
                </p>
              )}
            </>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-5">
          <button onClick={onClose}
            className="py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-semibold">
            Cancel
          </button>
          <button
            onClick={() => preview && onConfirm(preview.practices.map(p => p.id), toDate)}
            disabled={!canConfirm}
            className="py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
            style={{ background: '#3A7D44' }}>
            Continue →
          </button>
        </div>
      </div>
    </div>
  )
}

// Orders V2 Batch 11 — palette + copy for the tappable status chip.
const FULFILMENT_TONE: Record<string, { bg: string; fg: string; copy: string }> = {
  PENDING:             { bg: '#fef3c7', fg: '#92400e', copy: 'Dealer processing' },
  AVAILABLE:           { bg: '#dbeafe', fg: '#1e40af', copy: 'Dealer processing' },
  SENT_FOR_APPROVAL:   { bg: '#ede9fe', fg: '#5b21b6', copy: 'Ready for approval' },
  APPROVED:            { bg: '#d1fae5', fg: '#065f46', copy: 'Purchased' },
  POSTPONED:           { bg: '#fed7aa', fg: '#9a3412', copy: 'Postponed' },
  NOT_AVAILABLE:       { bg: '#fee2e2', fg: '#991b1b', copy: 'Returned — needs action' },
  REJECTED:            { bg: '#fce7f3', fg: '#9d174d', copy: 'Rejected' },
}

function PracticeCard({ practice, onOrder, isOrdering, ordered }: {
  practice: Practice
  onOrder: () => void
  isOrdering: boolean
  ordered: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const colour = L0_BG[practice.l0_type] || '#3A7D44'
  const label = L0_LABEL[practice.l0_type] || practice.l0_type
  const fulf = practice.fulfilment ?? null
  const tone = fulf ? FULFILMENT_TONE[fulf.status] : null
  // INPUT details (brand, dose, formulation) are hidden until the
  // farmer purchases — the dealer picks the actual product, and
  // resolved details surface on the order page after fulfilment.
  // Backend marks practice.is_purchased=true once any OrderItem
  // for it is APPROVED (same threshold BL-03 uses). NON_INPUT /
  // INSTRUCTION / MEDIA are not purchased — their details are the
  // advisory, always shown. UUID-safe via isUuid() in render.
  const isPurchasable = practice.l0_type === 'INPUT'
  const detailsVisible =
    practice.elements.length > 0 &&
    (!isPurchasable || practice.is_purchased === true)

  return (
    <div className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
      <div
        className={`flex items-center gap-3 px-4 py-3.5${detailsVisible ? ' cursor-pointer' : ''}`}
        onClick={detailsVisible ? () => setExpanded(e => !e) : undefined}
      >
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
          <p className="text-sm font-medium text-[#6B3F1F] mt-1">
            {[humanizeType(practice.l1_type), humanizeType(practice.l2_type)].filter(Boolean).join(' — ') || 'General Advisory'}
          </p>
        </div>
        {practice.l0_type === 'INPUT' && (
          // Status chip when the practice has a live OrderItem;
          // Order button otherwise. The chip is tappable — opens a
          // small detail sheet with the right info per status.
          fulf && tone ? (
            <button
              onClick={e => { e.stopPropagation(); setSheetOpen(true) }}
              className="shrink-0 text-xs font-semibold px-3 py-2 rounded-xl"
              style={{ background: tone.bg, color: tone.fg }}>
              {tone.copy}{fulf.status === 'POSTPONED' && fulf.postpone_days_remaining != null
                ? ` · ${fulf.postpone_days_remaining}d` : ''}
            </button>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); if (!practice.is_purchased) onOrder() }}
              disabled={isOrdering || ordered || practice.is_purchased === true}
              className="shrink-0 text-xs font-semibold text-white px-3 py-2 rounded-xl disabled:opacity-60"
              style={{ background: (ordered || practice.is_purchased) ? '#16a34a' : '#3A7D44' }}>
              {practice.is_purchased ? '✓ Purchased' : ordered ? '✓ Ordered' : isOrdering ? '…' : 'Order'}
            </button>
          )
        )}
      </div>

      {/* Batch 11 — fulfilment detail sheet. What's shown depends on
          the item's status; the action button always navigates the
          farmer to /orders/{id} where the full per-item actions
          (re-route, postpone, accept brand & price) already live. */}
      {sheetOpen && fulf && tone && (
        <FulfilmentSheet
          fulfilment={fulf}
          chipCopy={tone.copy}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {detailsVisible && expanded && (
        <div className="border-t border-[#DDD0B8] px-4 pb-3 pt-2 space-y-1.5">
          {mergeUnitElements(practice.elements).map((el, i) => {
            const showRef = el.cosh_ref && !isUuid(el.cosh_ref)
            const inlineUnit =
              (el.unit_cosh_id && !isUuid(el.unit_cosh_id) ? el.unit_cosh_id : '')
              || el.trailing_unit || ''
            return (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="text-[#7A8C7E] text-xs mt-0.5">•</span>
                <div>
                  <span className="text-[#6B3F1F] font-medium">{humanizeType(el.element_type)}</span>
                  {el.value
                    ? <span className="text-[#6B3F1F] ml-1">: {el.value}{inlineUnit ? ` ${inlineUnit}` : ''}</span>
                    : showRef
                      ? <span className="text-[#6B3F1F] ml-1">: {el.cosh_ref}</span>
                      : inlineUnit
                        ? <span className="text-[#6B3F1F] ml-1">: {inlineUnit}</span>
                        : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {detailsVisible && (
        <div className="px-4 pb-2 text-xs text-[#7A8C7E] cursor-pointer" onClick={() => setExpanded(e => !e)}>
          {expanded ? '▲ Hide details' : `▼ ${mergeUnitElements(practice.elements).length} detail${mergeUnitElements(practice.elements).length > 1 ? 's' : ''}`}
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
  // 2026-05-21 — onOrder is now category-driven; the parent opens
  // the date-range sheet using the first practice's L1 (groups are
  // always homogeneous by L1). The unused practiceIds arg is kept
  // in the signature for backward shape so the internal callers
  // don't need rework — the parent just ignores it.
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
      <div className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#DDD0B8] bg-emerald-50">
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
        <div className="px-4 py-3 border-t border-[#DDD0B8] flex justify-end">
          <button
            onClick={() => onOrder(ids)}
            disabled={isOrderingAny || isAnyOrdered}
            className="text-xs font-semibold text-white px-4 py-2 rounded-xl disabled:opacity-60"
            style={{ background: isAnyOrdered ? '#16a34a' : '#3A7D44' }}
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
              <span className="text-xs font-bold text-[#7A8C7E] bg-slate-100 px-2 py-0.5 rounded">
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
                    <span className="px-3 text-xs font-bold text-[#7A8C7E] bg-[#F5F0E8] rounded">OR</span>
                    <div className="h-px flex-1 bg-slate-300" />
                  </div>
                )}
                {isCompound ? (
                  <div className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-[#DDD0B8] bg-emerald-50">
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
                    <div className="px-4 py-3 border-t border-[#DDD0B8] flex justify-end">
                      <button
                        onClick={() => onOrder(ids)}
                        disabled={isOrderingAny || isAnyOrdered}
                        className="text-xs font-semibold text-white px-4 py-2 rounded-xl disabled:opacity-60"
                        style={{ background: isAnyOrdered ? '#16a34a' : '#3A7D44' }}
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
  const colour = L0_BG[practice.l0_type] || '#3A7D44'
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
      <p className="text-sm font-medium text-[#6B3F1F]">
        {[humanizeType(practice.l1_type), humanizeType(practice.l2_type)].filter(Boolean).join(' — ') || 'General Advisory'}
      </p>
    </div>
  )
}

// Orders V2 Batch 11 — drill-down sheet that opens from the status
// chip on each INPUT card. The copy/CTA per status mirrors the
// 2026-05-31 narrative: brand/price hidden until APPROVED;
// Returned points to the bundled-reroute CTA on the order page;
// Postponed shows remaining days.
function FulfilmentSheet({
  fulfilment, chipCopy, onClose,
}: {
  fulfilment: Fulfilment
  chipCopy: string
  onClose: () => void
}) {
  const router = useRouter()
  const goToOrder = () => {
    onClose()
    router.push(`/orders/${fulfilment.order_id}`)
  }

  const tone = FULFILMENT_TONE[fulfilment.status]
  const isReturned = fulfilment.status === 'NOT_AVAILABLE' || fulfilment.status === 'REJECTED'

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end" onClick={onClose}>
      <div className="bg-white w-full rounded-t-3xl p-5 max-w-lg mx-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: tone.bg, color: tone.fg }}>
            {chipCopy}
          </span>
          <button onClick={onClose} className="text-[#7A8C7E] text-xl leading-none">×</button>
        </div>

        {fulfilment.status === 'APPROVED' && (
          <div className="space-y-2">
            {fulfilment.brand_name && (
              <div>
                <p className="text-xs text-[#7A8C7E]">Brand</p>
                <p className="font-semibold text-[#6B3F1F]">{fulfilment.brand_name}</p>
              </div>
            )}
            {fulfilment.given_volume != null && (
              <div>
                <p className="text-xs text-[#7A8C7E]">Quantity</p>
                <p className="text-[#6B3F1F]">{fulfilment.given_volume} {fulfilment.volume_unit}</p>
              </div>
            )}
            {fulfilment.price != null && (
              <div>
                <p className="text-xs text-[#7A8C7E]">Price</p>
                <p className="text-[#6B3F1F]">₹{fulfilment.price}</p>
              </div>
            )}
          </div>
        )}

        {fulfilment.status === 'POSTPONED' && (
          <div className="space-y-1.5">
            <p className="text-sm text-[#6B3F1F]">
              The dealer has delayed this item. It will be back in their list automatically.
            </p>
            {fulfilment.postpone_days_remaining != null && (
              <p className="text-xs text-[#7A8C7E]">
                {fulfilment.postpone_days_remaining} day{fulfilment.postpone_days_remaining === 1 ? '' : 's'} remaining before it auto-returns to you.
              </p>
            )}
          </div>
        )}

        {isReturned && (
          <div className="space-y-1.5">
            <p className="text-sm text-[#6B3F1F]">
              {fulfilment.status === 'NOT_AVAILABLE'
                ? "The dealer couldn't fulfil this item. Send it to a different dealer or facilitator."
                : "You rejected the dealer's brand and price. Send it to a different dealer or facilitator."}
            </p>
            <p className="text-xs text-[#7A8C7E]">
              Use the &quot;Send returned items&quot; button on the order page — it bundles every returned item from this order in one go.
            </p>
          </div>
        )}

        {(fulfilment.status === 'PENDING' || fulfilment.status === 'AVAILABLE') && (
          <p className="text-sm text-[#6B3F1F]">
            The dealer is working on this item. The brand and price will be visible once you approve them.
          </p>
        )}

        {fulfilment.status === 'SENT_FOR_APPROVAL' && (
          <p className="text-sm text-[#6B3F1F]">
            The dealer has sent you the brand and price for approval — open the order to review them.
          </p>
        )}

        <button onClick={goToOrder}
          className="w-full mt-5 py-3 rounded-2xl text-white font-semibold text-sm"
          style={{ background: '#3A7D44' }}>
          Open order →
        </button>
      </div>
    </div>
  )
}

// ── Batch 18 — DBS Pre-sowing inputs strip ─────────────────────────────────
//
// Per the 2026-05-31 carve-out (project_rootstalk_dbs_v1.md):
// - DBS purchase available pre-start-date, advisory listing deferred.
// - Annual packages only.
// - Window closes when crop_start_date <= today.
// - Server tells us count + has_locked_brand + practice_ids per category.
// Strip is invisible when both categories return `available: false`.
type DBSPreview = {
  category: 'PESTICIDE' | 'FERTILIZER'
  count: number
  available: boolean
  reason: string | null
  has_locked_brand: boolean
  practice_ids: string[]
  client_id: string
}

type Recipient = {
  user_id: string
  name: string
  phone: string
  shop_name?: string | null
  distance_km?: number
  is_promoter?: boolean
}

// Phase 2 of the Orders restructure (2026-06-02): show all orders
// (regular + seed) for ONE subscription, inline on its advisory page.
// Reuses the same status palette + card shape /orders uses so the
// farmer reads them consistently. Empty state explicitly says "for
// this crop" so the farmer doesn't worry about other crops' orders.

const ORDERS_STATUS_COLOUR: Record<string, string> = {
  SENT:               'bg-purple-100 text-purple-700',
  PROCESSING:         'bg-blue-100 text-blue-700',
  SENT_FOR_APPROVAL:  'bg-amber-100 text-amber-700',
  PARTIALLY_APPROVED: 'bg-orange-100 text-orange-700',
  COMPLETED:          'bg-emerald-100 text-emerald-700',
  CANCELLED:          'bg-stone-100 text-[#7A8C7E]',
  // Seed-only statuses
  DRAFT:              'bg-stone-100 text-[#7A8C7E]',
  APPROVED:           'bg-blue-100 text-blue-700',
  PURCHASED:          'bg-emerald-100 text-emerald-700',
}

type SubOrder =
  | {
      kind: 'REGULAR'
      id: string; status: string; date_from: string; date_to: string
      created_at: string
      item_count?: number; is_max_count?: boolean
      category?: 'PESTICIDE' | 'FERTILIZER' | null
    }
  | {
      kind: 'SEED'
      id: string; status: string; variety_name: string | null
      unit: string | null; quantity: number | null; total_price: number | null
      created_at: string
    }

function SubscriptionOrders({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter()
  const [orders, setOrders] = useState<SubOrder[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api.get<{ orders: SubOrder[] }>(
      `/farmer/subscriptions/${subscriptionId}/orders`,
    )
      .then(({ data }) => { if (!cancelled) setOrders(data.orders || []) })
      .catch(() => { if (!cancelled) setOrders([]) })
    return () => { cancelled = true }
  }, [subscriptionId])

  if (orders === null) {
    return (
      <div className="mx-4 mt-4 h-20 bg-white/60 border border-[#DDD0B8] rounded-2xl animate-pulse" />
    )
  }

  return (
    <div className="mx-4 mt-4">
      <p className="text-xs font-semibold text-[#6B3F1F] uppercase tracking-wider mb-2 px-1">
        Orders for this crop
      </p>
      {orders.length === 0 ? (
        <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4 text-center">
          <p className="text-xs text-[#7A8C7E]">No orders yet for this crop.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map(o => (
            <button key={`${o.kind}:${o.id}`} onClick={() => router.push(
              o.kind === 'SEED' ? `/seed-orders/${o.id}` : `/orders/${o.id}`,
            )}
              className="w-full bg-white rounded-2xl p-3 border border-[#DDD0B8] shadow-sm text-left active:scale-[0.98] transition-transform">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-[#7A8C7E] uppercase tracking-wider">
                    {o.kind === 'SEED' ? 'Seed' : (o.category?.toLowerCase() || 'order')}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${ORDERS_STATUS_COLOUR[o.status] || 'bg-stone-100 text-[#7A8C7E]'}`}>
                    {o.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <span className="text-[10px] text-[#7A8C7E]">
                  {new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                </span>
              </div>
              {o.kind === 'SEED' ? (
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-[#6B3F1F] truncate">{o.variety_name || 'Unknown variety'}</p>
                  {o.quantity != null && o.unit && (
                    <p className="text-xs text-[#7A8C7E] shrink-0">
                      {o.quantity} {o.unit}{o.total_price != null ? ` · ₹${o.total_price}` : ''}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-[#6B3F1F]">
                    {new Date(o.date_from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    {' — '}
                    {new Date(o.date_to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </p>
                  {o.item_count !== undefined && o.item_count > 0 && (
                    <span className="text-xs text-[#7A8C7E] shrink-0">
                      {o.is_max_count ? 'Max ' : ''}{o.item_count} item{o.item_count !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DBSStrip({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter()
  const [pesticide, setPesticide] = useState<DBSPreview | null>(null)
  const [fertilizer, setFertilizer] = useState<DBSPreview | null>(null)
  const [pickerCategory, setPickerCategory] = useState<'PESTICIDE' | 'FERTILIZER' | null>(null)
  const [pickerTab, setPickerTab] = useState<'dealers' | 'facilitators'>('dealers')
  const [dealers, setDealers] = useState<Recipient[]>([])
  const [facilitators, setFacilitators] = useState<Recipient[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const [lockedExplainer, setLockedExplainer] = useState<string | null>(null)

  useEffect(() => {
    const fetchPreview = async (category: 'PESTICIDE' | 'FERTILIZER') => {
      try {
        const { data } = await api.get<DBSPreview>(
          `/farmer/subscriptions/${subscriptionId}/dbs-bulk-preview?category=${category}`,
        )
        if (category === 'PESTICIDE') setPesticide(data)
        else setFertilizer(data)
      } catch { /* preview failures hide the strip */ }
    }
    void fetchPreview('PESTICIDE')
    void fetchPreview('FERTILIZER')
  }, [subscriptionId])

  const visible = (pesticide?.available || fertilizer?.available) ?? false
  if (!visible) return null

  async function openPicker(category: 'PESTICIDE' | 'FERTILIZER') {
    const preview = category === 'PESTICIDE' ? pesticide : fertilizer
    if (!preview || !preview.available) return
    setPickerCategory(category)
    setPickerLoading(true)
    try {
      const params = new URLSearchParams({
        category,
        practice_ids: preview.practice_ids.join(','),
      })
      const { data } = await api.get<{
        dealers: Recipient[]
        facilitators: Recipient[]
        has_locked_brand: boolean
        locked_brand_explainer: string | null
      }>(`/farmer/subscriptions/${subscriptionId}/eligible-recipients-for-new-order?${params}`)
      setDealers(data.dealers || [])
      setFacilitators(data.facilitators || [])
      setLockedExplainer(data.locked_brand_explainer)
    } finally { setPickerLoading(false) }
  }

  async function sendToRecipient(r: Recipient, isDealer: boolean) {
    if (!pickerCategory) return
    const preview = pickerCategory === 'PESTICIDE' ? pesticide : fertilizer
    if (!preview) return
    setSending(r.user_id)
    try {
      const payload = isDealer
        ? { dealer_user_id: r.user_id }
        : { facilitator_user_id: r.user_id }
      const { data } = await api.post<{ id: string }>(`/farmer/orders/dbs-bulk`, {
        subscription_id: subscriptionId,
        client_id: preview.client_id,
        category: pickerCategory,
        ...payload,
      })
      router.push(`/orders/${data.id}`)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: { message?: string } } } }
      alert(e?.response?.data?.detail?.message || 'Could not send the order.')
    } finally { setSending(null) }
  }

  const pesticideCount = pesticide?.count ?? 0
  const fertilizerCount = fertilizer?.count ?? 0
  const pesticideAvailable = pesticide?.available ?? false
  const fertilizerAvailable = fertilizer?.available ?? false

  return (
    <>
      <div className="mx-4 mt-4 bg-white border border-[#DDD0B8] rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xl">🌾</span>
          <p className="font-semibold text-[#6B3F1F] text-sm">Pre-sowing inputs</p>
        </div>
        <p className="text-xs text-[#7A8C7E] mb-3 leading-relaxed">
          Order what you need before sowing. One bulk order per category.
          The dealer may pick between alternatives — your final list could be shorter.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => openPicker('PESTICIDE')}
            disabled={!pesticideAvailable}
            className="py-2.5 rounded-xl text-xs font-semibold transition-colors disabled:opacity-40"
            style={{
              background: pesticideAvailable ? '#3A7D44' : '#e5e5e5',
              color: pesticideAvailable ? 'white' : '#7A8C7E',
            }}>
            {pesticideAvailable ? `Pesticides · ${pesticideCount} ${pesticideCount === 1 ? 'option' : 'options'}` : 'Pesticides — none'}
          </button>
          <button onClick={() => openPicker('FERTILIZER')}
            disabled={!fertilizerAvailable}
            className="py-2.5 rounded-xl text-xs font-semibold transition-colors disabled:opacity-40"
            style={{
              background: fertilizerAvailable ? '#3A7D44' : '#e5e5e5',
              color: fertilizerAvailable ? 'white' : '#7A8C7E',
            }}>
            {fertilizerAvailable ? `Fertilizers · ${fertilizerCount} ${fertilizerCount === 1 ? 'option' : 'options'}` : 'Fertilizers — none'}
          </button>
        </div>
      </div>

      {/* Picker — same shape as /orders/[id]'s picker. Locked-brand
          orders show the purple banner + hide the facilitators tab. */}
      {pickerCategory && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => !sending && setPickerCategory(null)}>
          <div className="bg-white rounded-t-2xl w-full max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
            <div className="px-4 py-3 border-b border-[#DDD0B8] flex items-center justify-between">
              <p className="font-semibold text-[#6B3F1F]">
                Send pre-sowing {pickerCategory === 'PESTICIDE' ? 'pesticides' : 'fertilizers'} to
              </p>
              <button onClick={() => !sending && setPickerCategory(null)} className="text-[#7A8C7E] text-xl">×</button>
            </div>
            {lockedExplainer && (
              <div className="mx-4 mt-3 bg-purple-50 border border-purple-200 rounded-xl px-3 py-2.5 text-xs text-purple-800 leading-relaxed">
                <p className="font-semibold mb-0.5">Brand-locked order</p>
                <p>{lockedExplainer}</p>
              </div>
            )}
            <div className="flex border-b border-[#DDD0B8]">
              {(['dealers', 'facilitators'] as const).map(t => {
                if (t === 'facilitators' && lockedExplainer) return null
                return (
                  <button key={t} onClick={() => setPickerTab(t)}
                    className={`flex-1 py-3 text-sm font-medium ${pickerTab === t ? 'text-[#6B3F1F] border-b-2 border-[#3A7D44]' : 'text-[#7A8C7E]'}`}>
                    {t === 'dealers' ? `Dealers (${dealers.length})` : `Facilitators (${facilitators.length})`}
                  </button>
                )
              })}
            </div>
            <div className="p-4 space-y-3">
              {pickerLoading ? (
                [1, 2, 3].map(i => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)
              ) : (pickerTab === 'dealers' ? dealers : facilitators).length === 0 ? (
                <div className="text-center py-10 text-sm text-[#7A8C7E]">
                  No {pickerTab} found nearby.
                </div>
              ) : (
                (pickerTab === 'dealers' ? dealers : facilitators).map(r => {
                  const isDealer = pickerTab === 'dealers'
                  const busy = sending === r.user_id
                  return (
                    <div key={r.user_id} className="bg-white border border-[#DDD0B8] rounded-xl p-3 flex items-center justify-between">
                      <div className="min-w-0 mr-3">
                        <p className="font-semibold text-[#6B3F1F] text-sm truncate">{r.name}</p>
                        {isDealer && r.shop_name && <p className="text-xs text-[#7A8C7E] truncate">{r.shop_name}</p>}
                        {typeof r.distance_km === 'number' && <p className="text-xs text-[#7A8C7E]">{r.distance_km} km away</p>}
                        {r.is_promoter && <span className="text-[10px] text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded-full font-medium">Promoter</span>}
                      </div>
                      <button onClick={() => sendToRecipient(r, isDealer)}
                        disabled={!!sending}
                        className="shrink-0 px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                        style={{ background: '#3A7D44' }}>
                        {busy ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
