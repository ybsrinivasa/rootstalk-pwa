'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import ClientCropChip from '@/components/ClientCropChip'
import api from '@/lib/api'

interface Element { element_type: string; cosh_ref: string | null; value: string | null; unit_cosh_id: string | null }
interface Fulfilment {
  // 2026-06-29 — NOT_NEEDED added for OR-group siblings that the
  // dealer didn't pick (auto-cascaded when a peer was marked
  // AVAILABLE). They're semantically "covered by the chosen
  // alternative," not "returned by the dealer."
  status: 'PENDING' | 'AVAILABLE' | 'POSTPONED' | 'NOT_AVAILABLE' | 'NOT_NEEDED'
        | 'SENT_FOR_APPROVAL' | 'APPROVED' | 'REJECTED'
  order_id: string
  order_item_id: string
  order_status: string
  dealer_user_id: string | null
  facilitator_user_id: string | null
  brand_name: string | null
  manufacturer_name: string | null
  given_volume: number | null
  volume_unit: string | null
  price: number | null
  postponed_until: string | null
  postpone_days_remaining: number | null
  // 2026-06-06 — Packing receipt state for the "📦 Tap to confirm
  // pickup" hint on APPROVED-but-not-yet-received advisory rows.
  packing_code?: string | null
  farmer_received_at?: string | null
}
interface Practice {
  id: string; l0_type: 'INPUT' | 'NON_INPUT' | 'INSTRUCTION' | 'MEDIA'
  l1_type: string | null; l2_type: string | null
  l2_name_loc?: string | null; display_order: number
  is_special_input: boolean; elements: Element[]
  relation_id?: string | null
  relation_role?: string | null    // PART_n__OPT_m__POS_p
  relation_type?: 'AND' | 'OR' | 'IF' | null
  frequency_days?: number | null
  is_frequency_due_today?: boolean
  is_purchased?: boolean
  fulfilment?: Fulfilment | null
  // 2026-06-19 — per-occurrence acknowledgement state
  ack_status?: 'ACTIVE' | 'MARKED'
  occurrence_date?: string  // ISO date
}
interface PendingConditionalQuestion {
  question_id: string; question_text: string; display_order: number
}
interface BlankPathQuestion {
  question_id: string; question_text: string; farmer_answer: string
}
interface TimelineItem {
  id: string; name: string; source: string   // CCA | CHA | QA
  // 2026-06-19 — Stable identifier for the per-occurrence
  // practice-acknowledgement key. Survives publishes.
  lineage_id?: string
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
  // Count of practices BL-03 dedup stripped from this timeline. Lets
  // us tell the farmer WHY a CHA card is empty — covered elsewhere
  // vs no plans yet.
  suppressed_count?: number
  // 2026-07-02 — Phase 2C merge chip. When BL-03 merged one or more
  // sibling TLs into this one (shared OR identity + united window),
  // this array carries the display names of the members so the card
  // can show "covers TL2, TL3" beneath the date band.
  merged_from_tl_names?: string[]
}
interface AdvisoryDay {
  subscription_id: string; client_id: string; package_id: string; package_name: string
  package_type?: 'ANNUAL' | 'PERENNIAL' | string | null
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
// Farmer-facing helpers — never expose raw enum slugs or
// timeline names; surface the actual date window instead.
function fmtDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short' })
}
function timelineDateLabel(from: string | null, to: string | null, locale: string, todayLabel: string): string {
  if (!from && !to) return todayLabel
  if (from && to && from !== to) return `${fmtDate(from, locale)} – ${fmtDate(to, locale)}`
  return fmtDate((to || from)!, locale)
}
function humanizeType(s: string | null): string {
  if (!s) return ''
  return s.toLowerCase().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// 2026-06-12 — Elements that describe the SE's recommended PRODUCT
// (brand, manufacturer, formulation, AI concentration). The SE's pick
// is guidance for the *dealer* to source — when the dealer can't get
// the exact product, they substitute, and the farmer's actual purchase
// renders in PurchasedSummary. Showing the SE's recommendation alongside
// the actual purchase on the same card confuses the farmer ("which one
// did I buy?"). The SE forces a specific brand via Brand-Lock when it
// matters; absent that lock, the recommendation isn't farmer-facing.
//
// Filtered ALWAYS — pre and post purchase, on every view of the farmer's
// advisory. The dealer's own order view (different file) still shows
// these — the dealer needs them to source.
//
// Same rule mirrored in:
//   - app/facilitator/promoted-farmers/[subscriptionId]/advisory/page.tsx
//   - app/dealer/promoted-farmers/[subscriptionId]/page.tsx
const FARMER_HIDDEN_ELEMENT_TYPES = new Set<string>([
  'COMMON_NAME',          // SE authoring jargon, never useful to the farmer
  'BRAND_NAME',           // dealer-facing recommendation
  'MANUFACTURER',         // dealer-facing recommendation
  'FORMULATION',          // describes recommended product, not purchased
  'FORMULATION_AI_CONC',  // combined formulation + AI concentration
  'AI_CONCENTRATION',     // describes recommended product, not purchased
])

// 2026-06-12 — How to apply / how much / over what cadence is only
// useful AFTER the farmer has purchased the input. Pre-purchase the
// card is just a heads-up that an input is recommended; the precise
// instructions land once the dealer has marked the item Available and
// the farmer has approved. Hidden pre-purchase across all surfaces.
//
// Post-purchase, APPLICATION_METHOD and DOSAGE move into the
// PurchasedSummary block (alongside brand + manufacturer). VOLUME_PER_PLANT
// and INSTRUCTIONS remain in the bullet list so the farmer can see them
// without expanding to the order detail page.
const POST_PURCHASE_ONLY_ELEMENT_TYPES = new Set<string>([
  'APPLICATION_METHOD',
  'DOSAGE',
  'VOLUME_PER_PLANT',
  'INSTRUCTIONS',
])
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
// 2026-06-06 — Visible summary block on APPROVED practice cards.
// Renders Brand · by Manufacturer + Application Method + Dosage
// (or the given_volume the dealer actually committed). Replaces
// what used to live behind the "Hide details" toggle for purchased
// items — the farmer shouldn't have to expand to see what they
// bought.
function PurchasedSummary({
  brand, manufacturer, elements,
}: {
  brand: string
  manufacturer: string | null
  elements: Element[]
}) {
  // Pull application method + dosage from the SE elements; merged
  // so the dosage + unit appear on one line.
  //
  // 2026-06-12 — Dropped the `givenVolume + volumeUnit` chip that used
  // to render next to the brand. The actual purchased volume is already
  // surfaced on the Purchased Items list — duplicating it on the
  // advisory card was noise.
  const tEl = useTranslations('practice.element')
  const merged = mergeUnitElements(elements)
  const appMethod = merged.find(e => (e.element_type || '').toUpperCase() === 'APPLICATION_METHOD')
  const dosage = merged.find(e => (e.element_type || '').toUpperCase() === 'DOSAGE')
  const dosageUnit = (dosage?.unit_cosh_id && !isUuid(dosage.unit_cosh_id))
    ? dosage.unit_cosh_id
    : (dosage?.trailing_unit || '')
  return (
    <div className="border-t border-emerald-100 bg-emerald-50/40 px-4 py-3 space-y-1">
      <p className="text-base font-bold text-emerald-900 truncate">{brand}</p>
      {manufacturer && (
        <p className="text-xs text-emerald-800">by {manufacturer}</p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-emerald-900 pt-1">
        {appMethod && (appMethod.value || appMethod.cosh_ref) && (
          <p>
            <span className="text-emerald-700">{tEl.has('APPLICATION_METHOD') ? tEl('APPLICATION_METHOD') : 'Application Method'}:</span>{' '}
            <span className="font-medium">{appMethod.value || appMethod.cosh_ref}</span>
          </p>
        )}
        {dosage && (dosage.value || dosage.cosh_ref) && (
          <p>
            <span className="text-emerald-700">{tEl.has('DOSAGE') ? tEl('DOSAGE') : 'Dosage'}:</span>{' '}
            <span className="font-medium">
              {dosage.value || dosage.cosh_ref}{dosageUnit ? ` ${dosageUnit}` : ''}
            </span>
          </p>
        )}
      </div>
    </div>
  )
}

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
  const tLabel = useTranslations('practice.label')
  const tEmpty = useTranslations('practice.empty')
  const locale = useLocale()
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
      <PWAHeader title="Advisory" activeRole="FARMER" back={`/crop-detail/${subscriptionId}`} />
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
            {/* Day counter. Annual packages anchor to crop_start_date
                so "Day N" (days after sowing) is the right label. Perennial
                packages are calendar-driven (timelines fire by day-of-year,
                not by elapsed days from sowing) — "Day +N" would be
                meaningless, so we show today's date instead. */}
            <div className="bg-white rounded-2xl px-4 py-3 border border-[#DDD0B8] flex items-center justify-between">
              <div>
                <p className="text-xs text-[#7A8C7E]">{tLabel('today')}</p>
                <p className="font-bold text-[#6B3F1F]">
                  {advisory.package_type === 'PERENNIAL'
                    ? new Date().toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
                    : `${tLabel('day')} ${advisory.day_offset}`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-[#7A8C7E]">{tLabel('reference')}</p>
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
                <p className="text-[#6B3F1F] font-semibold mt-3">{tEmpty('noAdviceToday')}</p>
                {nextDate?.next_date ? (
                  <>
                    <p className="text-[#7A8C7E] text-sm mt-2">{tEmpty('nextWindow')}</p>
                    <p className="text-[#6B3F1F] font-semibold text-base mt-1">
                      {new Date(nextDate.next_date).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                    {nextDate.days_until !== undefined && (
                      <p className="text-[#7A8C7E] text-xs mt-1">
                        {tEmpty('inDays', { count: nextDate.days_until })}
                      </p>
                    )}
                  </>
                ) : nextDate?.reason === 'no_more_practices' ? (
                  <p className="text-[#7A8C7E] text-sm mt-2">{tEmpty('allDone')}</p>
                ) : (
                  <p className="text-[#7A8C7E] text-sm mt-2">{tEmpty('checkBack')}</p>
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
                        {timelineDateLabel(tl.from_date, tl.to_date, locale, tLabel('today'))}
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
                  {/* 2026-07-02 — Phase 2C merge chip. Shown when
                      BL-03 folded one or more sibling TLs' OR options
                      into this timeline's merged card. Explains the
                      wider window without cluttering the main row. */}
                  {tl.merged_from_tl_names && tl.merged_from_tl_names.length > 0 && (
                    <p className="text-center text-[11px] text-emerald-700 mt-1 italic">
                      {tLabel('coversAlso', { names: tl.merged_from_tl_names.join(', ') })}
                    </p>
                  )}
                </div>

                {/* BL-02: Show conditional question BEFORE practices */}
                {tl.has_pending_question && tl.pending_conditional_question ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-3">
                    <p className="text-xs font-semibold text-amber-700 mb-2 uppercase tracking-wide">{tEmpty('quickCheck')}</p>
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
                            subscriptionId={subscriptionId}
                            timelineLineageId={tl.lineage_id}
                            onAckChanged={load}
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
                          subscriptionId={subscriptionId}
                          timelineLineageId={tl.lineage_id}
                          onAckChanged={load}
                        />
                      )
                    })}
                    {tl.practices.length === 0 && !tl.blank_path_questions?.length && (
                      <div className="bg-[#F5F0E8] rounded-xl px-4 py-3 text-center">
                        <p className="text-xs text-[#7A8C7E]">
                          {(tl.suppressed_count ?? 0) > 0
                            ? tEmpty('coveredElsewhere')
                            : tEmpty('noPlansYet')}
                        </p>
                      </div>
                    )}
                    {/* Per spec §6.4: question-specific warm message after blank-path answer */}
                    {tl.blank_path_questions?.map(bp => (
                      <div key={bp.question_id} className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mt-2">
                        <p className="text-xs text-amber-700 font-medium">
                          {tEmpty.rich('youAnsweredQuestion', {
                            answer: bp.farmer_answer,
                            question: bp.question_text,
                            strong: chunks => <span className="font-bold">{chunks}</span>,
                          })}
                        </p>
                        <p className="text-xs text-amber-600 mt-1">
                          {tEmpty('askAgainTomorrow')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Phase 3+ (2026-06-02) — Diagnose / My Orders quick links
                removed. The crop dashboard already exposes both as
                primary tiles; surfacing them again here was visual
                noise that competed with the actual advisory content. */}
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

// 2026-06-21 — Advisory status chip now maps onto the Manage tab's
// four pills (Routed / For Approval / Returned / Ready for pickup) so
// the farmer sees the same vocabulary on both surfaces. The chip is a
// shortcut to the corresponding Manage pill — tap routes directly to
// /crop-detail/{sub}/orders?tab=manage&pill=…
type ManagePill = 'routed' | 'approval' | 'returned' | 'pickup'

const MANAGE_PILL_TONE: Record<ManagePill, { bg: string; fg: string }> = {
  routed:   { bg: '#dbeafe', fg: '#1e40af' },  // blue
  approval: { bg: '#ede9fe', fg: '#5b21b6' },  // purple
  returned: { bg: '#fee2e2', fg: '#991b1b' },  // red
  pickup:   { bg: '#d1fae5', fg: '#065f46' },  // emerald
}

// Returns the pill a fulfilment maps to, or null when the item is
// terminal-received (chip drops off — nothing left for the farmer to do).
function fulfilmentToPill(f: Fulfilment): ManagePill | null {
  if (f.farmer_received_at) return null
  switch (f.status) {
    case 'PENDING':
    case 'AVAILABLE':
    case 'POSTPONED':
      return 'routed'
    case 'SENT_FOR_APPROVAL':
      return 'approval'
    case 'NOT_AVAILABLE':
    case 'REJECTED':
      return 'returned'
    case 'APPROVED':
      return 'pickup'
    case 'NOT_NEEDED':
      // 2026-06-29 — OR alternative the dealer didn't pick. Not a
      // farmer-actionable state; no pill. The chosen leg's chip
      // tells the farmer what they're actually getting.
      return null
  }
}

function PracticeCard({
  practice, onOrder, isOrdering, ordered,
  subscriptionId, timelineLineageId, onAckChanged,
  labelOverride,
}: {
  practice: Practice
  onOrder: () => void
  isOrdering: boolean
  ordered: boolean
  subscriptionId: string
  timelineLineageId: string | undefined
  onAckChanged: () => void
  // 2026-06-26 — Replaces the L2 label when set. Used by the
  // pure-OR collapsed render to show "Microbial Pesticide or
  // Botanical Pesticide" on a single card instead of asking the
  // farmer to pick a leg (OR is a dealer-side decision; farmer's
  // authority ends at Package selection).
  labelOverride?: string
}) {
  const router = useRouter()
  const tEl = useTranslations('practice.element')
  const tPill = useTranslations('orders.cropOrders.manage.pill')
  const tAction = useTranslations('practice.action')
  const elementLabel = (et: string) => tEl.has(et) ? tEl(et) : humanizeType(et)
  const colour = L0_BG[practice.l0_type] || '#3A7D44'
  const l2Label = practice.l2_name_loc || humanizeType(practice.l2_type)
  const fulf = practice.fulfilment ?? null
  // 2026-06-21 — Status chip now reuses the Manage tab's 4 pill names
  // (Routed / For Approval / Returned / Ready for pickup). Tapping the
  // chip navigates to the matching pill on Manage instead of opening a
  // bottom sheet — keeps the farmer in one mental model.
  const pillName = fulf ? fulfilmentToPill(fulf) : null
  const pillTone = pillName ? MANAGE_PILL_TONE[pillName] : null
  // 2026-06-21 — INPUT details (brand, dose, formulation etc.) stay
  // hidden until the farmer has actually picked up the item. The risk
  // is otherwise that someone else sees the queued purchase and tries
  // to claim it at the dealer's shop before the rightful farmer gets
  // there. Once farmer_received_at is stamped, the transaction is
  // sealed and details can surface.
  const isPurchasable = practice.l0_type === 'INPUT'
  const pickedUp = !!fulf?.farmer_received_at
  const detailsVisible =
    practice.elements.length > 0 &&
    (!isPurchasable || pickedUp)

  return (
    <div className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="w-2 h-8 rounded-full flex-shrink-0" style={{ background: colour }} />
        <div className="flex-1 min-w-0">
          {(practice.is_special_input
            || (practice.frequency_days != null && practice.frequency_days > 0)) && (
            <div className="flex items-center gap-2 flex-wrap">
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
          )}
          <p className="text-sm font-medium text-[#6B3F1F] mt-1">
            {labelOverride || l2Label || 'General Advisory'}
          </p>
        </div>
        {practice.l0_type === 'INPUT' && (
          // 2026-06-21 — Status chip (Manage pill name) when the
          // practice has a live OrderItem and isn't yet picked up;
          // Order button when there's nothing in flight. The chip
          // navigates directly to the matching Manage pill — no
          // intermediate bottom-sheet. Once the item is picked up
          // (pillName === null), the chip drops entirely and the
          // practice card just renders its details (per detailsVisible).
          pillName && pillTone ? (
            <button
              onClick={e => {
                e.stopPropagation()
                router.push(`/crop-detail/${subscriptionId}/orders?tab=manage&pill=${pillName}`)
              }}
              className="shrink-0 text-xs font-semibold px-3 py-2 rounded-xl"
              style={{ background: pillTone.bg, color: pillTone.fg }}>
              {tPill(pillName)}
              {fulf?.status === 'POSTPONED' && fulf.postpone_days_remaining != null
                ? ` · ${fulf.postpone_days_remaining}d` : ''}
            </button>
          ) : !fulf && !practice.is_purchased ? (
            <button
              onClick={e => { e.stopPropagation(); onOrder() }}
              disabled={isOrdering || ordered}
              className="shrink-0 text-xs font-semibold text-white px-3 py-2 rounded-xl disabled:opacity-60"
              style={{ background: ordered ? '#16a34a' : '#3A7D44' }}>
              {ordered ? tAction('ordered') : isOrdering ? '…' : tAction('order')}
            </button>
          ) : null
          // Purchased + already-picked-up cases render no badge — the
          // PurchasedSummary block below carries the brand details.
        )}
      </div>

      {/* 2026-06-06 — Post-purchase brand summary on the card itself.
          What the farmer most needs to see — brand + manufacturer +
          how to apply — is visible without expanding. Common Name
          (the SE authoring vocabulary) is intentionally NOT shown
          here; it's filtered out of the details below too.
          2026-06-21 — Gated on pickedUp (farmer_received_at) too:
          before pickup we hide brand identity to avoid third-party
          interception of the queued purchase at the dealer's shop. */}
      {pickedUp && fulf?.brand_name && (
        <PurchasedSummary
          brand={fulf.brand_name}
          manufacturer={fulf.manufacturer_name}
          elements={practice.elements}
        />
      )}

      {detailsVisible && (() => {
        // Strip SE recommendations that are dealer-facing only and
        // collapse post-purchase APPLICATION_METHOD + DOSAGE into
        // PurchasedSummary to avoid duplication.
        const summaryShown = pickedUp && !!fulf?.brand_name
        const visibleEls = mergeUnitElements(practice.elements)
          .filter(el => {
            const t = (el.element_type || '').toUpperCase()
            if (FARMER_HIDDEN_ELEMENT_TYPES.has(t)) return false
            if (!summaryShown && POST_PURCHASE_ONLY_ELEMENT_TYPES.has(t)) return false
            if (summaryShown && (t === 'APPLICATION_METHOD' || t === 'DOSAGE')) return false
            return true
          })
        if (visibleEls.length === 0) return null
        return (
          <div className="border-t border-[#DDD0B8] px-4 pb-3 pt-2 space-y-2">
            {visibleEls.map((el, i) => {
              const type = (el.element_type || '').toUpperCase()
              const url = (el.value || '').trim()
              const isSafe = /^https?:\/\//i.test(url)
              // 2026-06-24 — Media element types ship the asset URL in
              // el.value. The previous render leaked them as plain
              // text so farmers couldn't open images / play audio /
              // tap links. Mirrors the SA-portal authoring preview
              // (components/advisory-authoring/PreviewCards.tsx).
              if (type === 'UPLOAD_IMAGE' && isSafe) {
                return (
                  <div key={i} className="text-sm">
                    <p className="text-[#6B3F1F] font-medium text-xs mb-1">{elementLabel(type)}</p>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="max-h-48 rounded-lg border border-[#DDD0B8]" />
                    </a>
                  </div>
                )
              }
              if (type === 'UPLOAD_AUDIO' && isSafe) {
                return (
                  <div key={i} className="text-sm">
                    <p className="text-[#6B3F1F] font-medium text-xs mb-1">{elementLabel(type)}</p>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio controls src={url} className="w-full max-w-sm" />
                  </div>
                )
              }
              if (type === 'HYPERLINK' && isSafe) {
                return (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-[#7A8C7E] text-xs mt-0.5">•</span>
                    <div className="min-w-0 flex-1">
                      <span className="text-[#6B3F1F] font-medium">{elementLabel(type)}: </span>
                      <a href={url} target="_blank" rel="noopener noreferrer"
                        className="text-blue-700 underline break-all">{url}</a>
                    </div>
                  </div>
                )
              }
              const showRef = el.cosh_ref && !isUuid(el.cosh_ref)
              const inlineUnit =
                (el.unit_cosh_id && !isUuid(el.unit_cosh_id) ? el.unit_cosh_id : '')
                || el.trailing_unit || ''
              return (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-[#7A8C7E] text-xs mt-0.5">•</span>
                  <div>
                    <span className="text-[#6B3F1F] font-medium">{elementLabel(type)}</span>
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
        )
      })()}
      <PracticeAckFooter
        practice={practice}
        subscriptionId={subscriptionId}
        timelineLineageId={timelineLineageId}
        onAckChanged={onAckChanged}
      />
    </div>
  )
}

// 2026-06-19 — "I've done this" tick + delete button.
// Gating rules:
//   - Non-INPUT (NON_INPUT / INSTRUCTION / MEDIA): tick always renders.
//   - INPUT practices: tick renders only once the farmer has the item
//     in hand. 2026-06-21: tightened from `is_purchased` (true on
//     APPROVED) to `farmer_received_at` on the live fulfilment.
//     Rationale: between approval and pickup the farmer can't honestly
//     say "I've done this" — they don't even have the input yet. If
//     the practice has no live fulfilment but was purchased historically
//     (legacy order, item gone from active set), is_purchased remains
//     a valid fallback.
// Visual: grey circle with check icon when ACTIVE; emerald-filled
// circle when MARKED, with a small red Delete button beside it.
// First-time hide gets a one-shot confirmation sheet (the user's
// only friction — once acknowledged, subsequent hides are instant).
function PracticeAckFooter({
  practice, subscriptionId, timelineLineageId, onAckChanged,
}: {
  practice: Practice
  subscriptionId: string
  timelineLineageId: string | undefined
  onAckChanged: () => void
}) {
  const tAck = useTranslations('practice.ack')
  const [busy, setBusy] = useState(false)
  const [confirmHide, setConfirmHide] = useState(false)
  const fulf = practice.fulfilment
  // 2026-06-22 — Tightened: INPUT cards REQUIRE a live fulfilment
  // with farmer_received_at to be ackable. Pre-fix the `is_purchased`
  // fallback (true when ANY APPROVED item has ever existed for the
  // practice) showed the tick on cards whose live fulfilment was
  // missing — e.g. when a past APPROVED item was REROUTED and the
  // replacement order hadn't yet been picked up by the farmer. The
  // farmer's mental model: "I haven't received this, why does it say
  // I've done it?" The fallback is a real edge case (purchased + then
  // timeline-archived without reroute) — those farmers won't see the
  // tick anymore, accepted trade-off.
  const ackable = practice.l0_type !== 'INPUT' || !!fulf?.farmer_received_at
  if (!ackable) return null
  if (!timelineLineageId || !practice.occurrence_date) return null

  async function call(action: 'mark' | 'unmark' | 'hide') {
    setBusy(true)
    try {
      await api.post(`/farmer/practice-ack/${action}`, {
        subscription_id: subscriptionId,
        timeline_lineage_id: timelineLineageId,
        practice_id: practice.id,
        occurrence_date: practice.occurrence_date,
      })
      onAckChanged()
    } catch { /* leave state as-is; PWA will refresh on next focus */ }
    finally { setBusy(false) }
  }

  async function onHideTap() {
    const seenKey = 'rt_practice_hide_seen'
    if (typeof window !== 'undefined' && !window.localStorage.getItem(seenKey)) {
      setConfirmHide(true)
      return
    }
    await call('hide')
  }

  const marked = practice.ack_status === 'MARKED'
  return (
    <>
      <div className="border-t border-[#DDD0B8] px-4 py-2.5 flex items-center justify-between gap-3">
        <button
          onClick={() => call(marked ? 'unmark' : 'mark')}
          disabled={busy}
          className="flex items-center gap-2 text-xs font-medium disabled:opacity-50">
          <span
            className={`inline-flex items-center justify-center w-6 h-6 rounded-full border ${
              marked
                ? 'bg-emerald-600 border-emerald-700 text-white'
                : 'bg-[#F5F0E8] border-[#DDD0B8] text-[#7A8C7E]'
            }`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
            </svg>
          </span>
          <span className={marked ? 'text-emerald-700' : 'text-[#6B3F1F]'}>
            {marked ? tAck('done') : tAck('mark')}
          </span>
        </button>
        {marked && (
          <button
            onClick={onHideTap}
            disabled={busy}
            className="text-xs font-semibold text-[#D4682E] disabled:opacity-50">
            {tAck('delete')}
          </button>
        )}
      </div>
      {confirmHide && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end"
          onClick={() => !busy && setConfirmHide(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">{tAck('confirmTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mt-2">{tAck('confirmBody')}</p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmHide(false)} disabled={busy}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                {tAck('confirmCancel')}
              </button>
              <button onClick={async () => {
                if (typeof window !== 'undefined') {
                  window.localStorage.setItem('rt_practice_hide_seen', '1')
                }
                setConfirmHide(false)
                await call('hide')
              }} disabled={busy}
                className="flex-1 bg-[#D4682E] text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {busy ? '…' : tAck('confirmYes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Practice Relations: AND/OR group renderer ───────────────────────────────
// 2026-06-26 — Visual hierarchy + i18n pass (Phase 1 of the Relations
// workstream). Three things changed for clarity:
//   - Hardcoded English strings replaced with `practice.relations.*` keys.
//   - Between Parts (top-level AND concatenation) we now render a labeled
//     "AND" pill instead of a faint hairline, so the structural
//     `(A+B) AND (C or D)` shape is visible to the farmer rather than
//     hidden behind whitespace.
//   - Dropped the abstract "Part 1 / Part 2" headers — with the explicit
//     AND pill, the numbered labels were redundant and read as jargon
//     ("what's a Part?"). Each Part now renders as its own visually
//     bordered block; the pill between names the relationship.
//   - Pure-AND group header is count-aware: "Apply both together" for 2
//     practices, "Apply all N together" for 3+, via the ICU plural in
//     `practice.relations.applyAllTogether`.
function RelationGroup({
  relationType, parts, orderingPractice, orderSuccess, onOrder,
  subscriptionId, timelineLineageId, onAckChanged,
}: {
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
  subscriptionId: string
  timelineLineageId: string | undefined
  onAckChanged: () => void
}) {
  const tAction = useTranslations('practice.action')
  const tRel = useTranslations('practice.relations')
  // 2026-06-26 — Manage-pill chip support inside AND containers so
  // the farmer sees per-leg fulfilment status (Routed / For Approval
  // / Returned / Ready for pickup) without leaving the advisory page.
  const tPill = useTranslations('orders.cropOrders.manage.pill')
  const router = useRouter()
  if (parts.length === 0) return null

  // Single Part with single Option AND-group: paired card with "Order N together"
  const isPureAndGroup =
    relationType === 'AND' &&
    parts.length === 1 &&
    parts[0].options.length === 1 &&
    parts[0].options[0].practices.length > 1

  // 2026-06-26 — Pure OR (single Part, ≥ 2 single-practice
  // Options): collapse to ONE card on the farmer page. OR is a
  // dealer-side substitution path, not a farming choice — the
  // farmer's decision authority ends at Package selection, and
  // routing between OR siblings is the dealer's call (via the
  // sibling cascade in mark_item_available). To keep the farmer
  // informed about what's coming, if the options span multiple L2
  // types we splice them into the label ("Microbial Pesticide or
  // Botanical Pesticide"); if every option shares the same L2 we
  // just show that L2. Either way: one row, one Order button, no
  // "choose ONE" framing.
  const isPureOrGroup =
    relationType === 'OR' &&
    parts.length === 1 &&
    parts[0].options.length >= 2 &&
    parts[0].options.every(o => o.practices.length === 1)

  if (isPureOrGroup) {
    const orPractices = parts[0].options.map(o => o.practices[0])
    // 2026-06-29 — Pre-decision vs post-decision OR rendering.
    // Once the dealer picks a leg of the OR (the chosen leg's
    // fulfilment lands in any of these "real" states), the card
    // should reflect THAT leg's reality — its L2 label, its
    // brand details, its Manage chip — not the abstract
    // "Microbial or Botanical or…" alternatives. Sibling legs
    // are NOT_NEEDED at this point, so picking orPractices[0]
    // as head (the default) would surface a blank no-pill card
    // for the OPT_1 sibling instead of the actual fulfilment on
    // OPT_n. Pre-decision (no leg chosen yet) keeps the joined
    // OR label so the farmer sees what's coming.
    const CHOSEN_STATUSES = new Set(['AVAILABLE', 'SENT_FOR_APPROVAL', 'APPROVED'])
    const chosenPractice = orPractices.find(p => {
      const s = p.fulfilment?.status
      return s != null && CHOSEN_STATUSES.has(s)
    })
    const head = chosenPractice ?? orPractices[0]
    const labels = chosenPractice
      ? [chosenPractice.l2_name_loc || humanizeType(chosenPractice.l2_type) || '']
      : Array.from(new Set(
          orPractices.map(p => p.l2_name_loc || humanizeType(p.l2_type) || ''),
        )).filter(Boolean)
    const joinedLabel = labels.length > 1
      ? labels.join(` ${tRel('orJoin')} `)
      : labels[0]
    const ids = orPractices.map(p => p.id)
    const isOrderingAny = ids.some(id => orderingPractice === id)
    const isAnyOrdered = ids.some(id => orderSuccess === id)
    return (
      <PracticeCard
        practice={head}
        labelOverride={joinedLabel}
        onOrder={() => onOrder(ids)}
        isOrdering={isOrderingAny}
        ordered={isAnyOrdered}
        subscriptionId={subscriptionId}
        timelineLineageId={timelineLineageId}
        onAckChanged={onAckChanged}
      />
    )
  }

  if (isPureAndGroup) {
    const opt = parts[0].options[0]
    const ids = opt.practices.map(p => p.id)
    const isOrderingAny = ids.some(id => orderingPractice === id)
    const isAnyOrdered = ids.some(id => orderSuccess === id)
    // Any leg already in flight (or post-fulfilment) suppresses the
    // "Order both together" button — same gate PracticeCard uses for
    // standalones (pillName || is_purchased).
    const anyInFlight = opt.practices.some(p => {
      const f = p.fulfilment ?? null
      return (f && fulfilmentToPill(f) != null) || p.is_purchased
    })
    return (
      <div className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#DDD0B8] bg-emerald-50">
          <div className="w-1 h-5 rounded-full bg-emerald-600" />
          <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">
            {tRel('applyAllTogether', { count: ids.length })}
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {opt.practices.map(p => {
            const f = p.fulfilment ?? null
            const pillName = f ? fulfilmentToPill(f) : null
            const pillTone = pillName ? MANAGE_PILL_TONE[pillName] : null
            return (
              <InnerPracticeRow
                key={p.id}
                practice={p}
                pillName={pillName}
                pillTone={pillTone}
                tPill={tPill}
                onPillClick={pillName
                  ? () => router.push(
                      `/crop-detail/${subscriptionId}/orders?tab=manage&pill=${pillName}`,
                    )
                  : undefined}
                subscriptionId={subscriptionId}
                timelineLineageId={timelineLineageId}
                onAckChanged={onAckChanged}
              />
            )
          })}
        </div>
        {!anyInFlight && (
          <div className="px-4 py-3 border-t border-[#DDD0B8] flex justify-end">
            <button
              onClick={() => onOrder(ids)}
              disabled={isOrderingAny || isAnyOrdered}
              className="text-xs font-semibold text-white px-4 py-2 rounded-xl disabled:opacity-60"
              style={{ background: isAnyOrdered ? '#16a34a' : '#3A7D44' }}
            >
              {isAnyOrdered
                ? tAction('ordered')
                : isOrderingAny
                  ? '…'
                  : tRel('orderAllTogether', { count: ids.length })}
            </button>
          </div>
        )}
      </div>
    )
  }

  // Otherwise: render each Part as its own block. Between Parts: a
  // labelled "AND" pill (same shape as the OR pill within a choice
  // Part) so the top-level concatenation is visible. Within a choice
  // Part: OR pills between Options.
  return (
    <div className="space-y-2">
      {parts.map((part, partIdx) => {
        // 2026-06-26 — Pure-OR-at-Part-level collapse. When a Part
        // inside a multi-Part Relation has ≥ 2 single-practice
        // Options (e.g. Part 2 of (A+B) AND (C OR D)), the OR is
        // again a dealer-side substitution path that doesn't reach
        // the farmer. Collapse to ONE PracticeCard with the merged
        // L2 label, same as the top-level pure-OR collapse — without
        // this, the farmer sees "Microbial pesticides OR Microbial
        // pesticides" inside a Complex Relation.
        const isPartPureOr =
          part.options.length >= 2 &&
          part.options.every(o => o.practices.length === 1)
        if (isPartPureOr) {
          const orPractices = part.options.map(o => o.practices[0])
          // 2026-06-29 — Same pre-/post-decision swap as the
          // top-level pure-OR collapse: once a leg has been picked
          // (AVAILABLE / SENT_FOR_APPROVAL / APPROVED), use that
          // leg's data so the chip + brand details reflect the
          // farmer's actual fulfilment, not a NOT_NEEDED sibling.
          const CHOSEN_STATUSES_P = new Set(['AVAILABLE', 'SENT_FOR_APPROVAL', 'APPROVED'])
          const chosenPracticeP = orPractices.find(p => {
            const s = p.fulfilment?.status
            return s != null && CHOSEN_STATUSES_P.has(s)
          })
          const head = chosenPracticeP ?? orPractices[0]
          const labels = chosenPracticeP
            ? [chosenPracticeP.l2_name_loc || humanizeType(chosenPracticeP.l2_type) || '']
            : Array.from(new Set(
                orPractices.map(p => p.l2_name_loc || humanizeType(p.l2_type) || ''),
              )).filter(Boolean)
          const joinedLabel = labels.length > 1
            ? labels.join(` ${tRel('orJoin')} `)
            : labels[0]
          const ids = orPractices.map(p => p.id)
          const isOrderingAny = ids.some(id => orderingPractice === id)
          const isAnyOrdered = ids.some(id => orderSuccess === id)
          return (
            <div key={part.part}>
              <PracticeCard
                practice={head}
                labelOverride={joinedLabel}
                onOrder={() => onOrder(ids)}
                isOrdering={isOrderingAny}
                ordered={isAnyOrdered}
                subscriptionId={subscriptionId}
                timelineLineageId={timelineLineageId}
                onAckChanged={onAckChanged}
              />
              {partIdx < parts.length - 1 && (
                <div className="flex items-center my-3">
                  <div className="h-px flex-1 bg-emerald-200" />
                  <span className="px-3 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded">
                    {tRel('andBetweenParts')}
                  </span>
                  <div className="h-px flex-1 bg-emerald-200" />
                </div>
              )}
            </div>
          )
        }
        return (
        <div key={part.part}>
          {part.options.map((opt, optIdx) => {
            const ids = opt.practices.map(p => p.id)
            const isOrderingAny = ids.some(id => orderingPractice === id)
            const isAnyOrdered = ids.some(id => orderSuccess === id)
            const isCompound = opt.practices.length > 1
            const isChoice = part.options.length > 1

            return (
              <div key={opt.option}>
                {isChoice && optIdx > 0 && (
                  <div className="flex items-center my-2">
                    <div className="h-px flex-1 bg-slate-300" />
                    <span className="px-3 text-xs font-bold text-[#7A8C7E] bg-[#F5F0E8] rounded">
                      {tRel('orSeparator')}
                    </span>
                    <div className="h-px flex-1 bg-slate-300" />
                  </div>
                )}
                {isCompound ? (() => {
                  // Same pill + Order-suppression logic as the pure-AND
                  // branch above. Repeats inline because the loop
                  // captures `opt`/`ids` per iteration.
                  const anyInFlight = opt.practices.some(p => {
                    const f = p.fulfilment ?? null
                    return (f && fulfilmentToPill(f) != null) || p.is_purchased
                  })
                  return (
                  <div className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-[#DDD0B8] bg-emerald-50">
                      <div className="w-1 h-5 rounded-full bg-emerald-600" />
                      <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">
                        {tRel('applyAllTogether', { count: ids.length })}
                      </p>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {opt.practices.map(p => {
                        const f = p.fulfilment ?? null
                        const pillName = f ? fulfilmentToPill(f) : null
                        const pillTone = pillName ? MANAGE_PILL_TONE[pillName] : null
                        return (
                          <InnerPracticeRow
                            key={p.id}
                            practice={p}
                            pillName={pillName}
                            pillTone={pillTone}
                            tPill={tPill}
                            onPillClick={pillName
                              ? () => router.push(
                                  `/crop-detail/${subscriptionId}/orders?tab=manage&pill=${pillName}`,
                                )
                              : undefined}
                            subscriptionId={subscriptionId}
                            timelineLineageId={timelineLineageId}
                            onAckChanged={onAckChanged}
                          />
                        )
                      })}
                    </div>
                    {!anyInFlight && (
                      <div className="px-4 py-3 border-t border-[#DDD0B8] flex justify-end">
                        <button
                          onClick={() => onOrder(ids)}
                          disabled={isOrderingAny || isAnyOrdered}
                          className="text-xs font-semibold text-white px-4 py-2 rounded-xl disabled:opacity-60"
                          style={{ background: isAnyOrdered ? '#16a34a' : '#3A7D44' }}
                        >
                          {isAnyOrdered
                            ? tAction('ordered')
                            : isOrderingAny
                              ? '…'
                              : tRel('orderAllTogether', { count: ids.length })}
                        </button>
                      </div>
                    )}
                  </div>
                  )
                })() : (
                  // Single practice in this Option — render a normal practice card with
                  // its own Order button that sends just this practice id.
                  <PracticeCard
                    practice={opt.practices[0]}
                    onOrder={() => onOrder(ids)}
                    isOrdering={isOrderingAny}
                    ordered={isAnyOrdered}
                    subscriptionId={subscriptionId}
                    timelineLineageId={timelineLineageId}
                    onAckChanged={onAckChanged}
                  />
                )}
              </div>
            )
          })}
          {partIdx < parts.length - 1 && (
            <div className="flex items-center my-3">
              <div className="h-px flex-1 bg-emerald-200" />
              <span className="px-3 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded">
                {tRel('andBetweenParts')}
              </span>
              <div className="h-px flex-1 bg-emerald-200" />
            </div>
          )}
        </div>
        )
      })}
    </div>
  )
}

// Compact in-group practice row (used inside a paired AND-group card)
function InnerPracticeRow({
  practice,
  pillName, pillTone, onPillClick, tPill,
  subscriptionId, timelineLineageId, onAckChanged,
}: {
  practice: Practice
  // 2026-06-26 — Optional Manage-pill chip on the right edge of the
  // row. Mirrors the chip PracticeCard renders for standalones, so a
  // farmer looking at an AND group can see each leg's fulfilment
  // state (Routed / For Approval / Returned / Ready for pickup)
  // without having to bounce out to the Manage tab. When any leg
  // has a pill, the parent AND container suppresses its
  // "Order both together" button — there's already an order in
  // flight.
  pillName?: ManagePill | null
  pillTone?: { bg: string; fg: string } | null
  onPillClick?: () => void
  tPill?: (k: string) => string
  // 2026-06-30 — Per-leg post-pickup affordances. When the farmer
  // has received the input for this leg (farmer_received_at set), the
  // row gains the PurchasedSummary block (brand + manufacturer +
  // dose) and the "I've done this" tick — parity with how standalone
  // PracticeCards behave after pickup. Without these, the farmer
  // looks at a picked-up AND leg and sees only the L2 label, with no
  // way to acknowledge completion and no brand context to act on.
  // Pre-fix the legs reverted to a bare label, looking identical to
  // a pending advisory.
  subscriptionId?: string
  timelineLineageId?: string | undefined
  onAckChanged?: () => void
}) {
  const l2Label = practice.l2_name_loc || humanizeType(practice.l2_type)
  const fulf = practice.fulfilment ?? null
  const pickedUp = !!fulf?.farmer_received_at
  return (
    <div>
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {(practice.is_special_input
            || (practice.frequency_days != null && practice.frequency_days > 0)) && (
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              {practice.is_special_input && (
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Adjuvant</span>
              )}
              {practice.frequency_days != null && practice.frequency_days > 0 && (
                <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                  {practice.frequency_days === 1 ? 'Every day' : `Every ${practice.frequency_days} days`}
                </span>
              )}
            </div>
          )}
          <p className="text-sm font-medium text-[#6B3F1F]">
            {l2Label || 'General Advisory'}
          </p>
        </div>
        {pillName && pillTone && tPill && (
          <button
            onClick={e => { e.stopPropagation(); onPillClick?.() }}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-xl"
            style={{ background: pillTone.bg, color: pillTone.fg }}>
            {tPill(pillName)}
            {fulf?.status === 'POSTPONED' && fulf.postpone_days_remaining != null
              ? ` · ${fulf.postpone_days_remaining}d` : ''}
          </button>
        )}
      </div>
      {pickedUp && fulf?.brand_name && (
        <PurchasedSummary
          brand={fulf.brand_name}
          manufacturer={fulf.manufacturer_name}
          elements={practice.elements}
        />
      )}
      {pickedUp && subscriptionId && (
        <PracticeAckFooter
          practice={practice}
          subscriptionId={subscriptionId}
          timelineLineageId={timelineLineageId}
          onAckChanged={onAckChanged ?? (() => {})}
        />
      )}
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
  const locale = useLocale()
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
                  {new Date(o.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
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
                    {new Date(o.date_from).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
                    {' — '}
                    {new Date(o.date_to).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
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
