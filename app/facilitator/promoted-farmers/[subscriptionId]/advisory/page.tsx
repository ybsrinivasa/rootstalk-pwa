'use client'
import { Suspense, useState, useEffect } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

// 2026-06-23 — Rebuilt as a faithful read-only mirror of
// /advisory/[subscriptionId] for the facilitator (and dealer; this
// page is the canonical promoter view). User direction:
//   "this screen is supposed to be a mirror of the farmer advisory
//    with an exception that the Promoter cannot take any action.
//    If the promoter cannot see the advisory of his farmer, then
//    there would be a miscommunication between the two."
// Gaps closed vs. the prior version:
//   - package_type-aware day counter (annual vs perennial)
//   - relation grouping (AND / OR / IF) instead of flat practice list
//   - per-practice ack_status as a read-only ✓ (no toggle)
//   - order status pill (Routed / For Approval / Returned / Ready
//     for pickup) derived from fulfilment
//   - PurchasedSummary on picked-up INPUTs (brand + method + dose)
//   - suppressed_count messaging on CHA/QA cards
//   - pending conditional question surfaced read-only ("Farmer needs
//     to answer X") so the F-P can nudge the farmer

const COLOUR = '#7D4E00'

// ── Types — mirror the farmer page ─────────────────────────────────

interface Element {
  element_type: string
  cosh_ref: string | null
  value: string | null
  unit_cosh_id: string | null
}
interface Fulfilment {
  // 2026-06-29 — NOT_NEEDED for OR cascade siblings (mirror of farmer page).
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
  packing_code?: string | null
  farmer_received_at?: string | null
}
interface Practice {
  id: string
  l0_type: 'INPUT' | 'NON_INPUT' | 'INSTRUCTION' | 'MEDIA'
  l1_type: string | null
  l2_type: string | null
  l2_name_loc?: string | null
  display_order: number
  is_special_input?: boolean
  elements: Element[]
  relation_id?: string | null
  relation_role?: string | null
  relation_type?: 'AND' | 'OR' | 'IF' | null
  frequency_days?: number | null
  is_frequency_due_today?: boolean
  is_purchased?: boolean
  fulfilment?: Fulfilment | null
  ack_status?: 'ACTIVE' | 'MARKED'
  occurrence_date?: string
  // 2026-11-28 — Farmer's "I've purchased this" ack surfaces for the
  // promoter chip. See dealer page for canonical comment.
  purchased_at?: string | null
  purchased_brand_name?: string | null
  purchased_brand_text?: string | null
  purchased_brand_manufacturer_name?: string | null
  // 2026-11-28 — Brand-lock parity with farmer view. Drives (a) the
  // "🔒 Brand Locked" chip in the chips row, (b) amber accent on
  // BRAND_NAME + MANUFACTURER element rows, (c) product image block
  // below the practice. See dealer page for same fields.
  is_brand_locked?: boolean
  brand_image_url?: string | null
  locked_brand_name?: string | null
  locked_manufacturer_name?: string | null
}
interface PendingConditionalQuestion {
  question_id: string
  question_text: string
  display_order: number
}
interface TimelineItem {
  id: string
  name: string
  source: string
  lineage_id?: string
  from_date: string
  to_date: string
  day_number: number
  practices: Practice[]
  pending_conditional_question?: PendingConditionalQuestion
  has_pending_question?: boolean
  problem_name?: string
  triggered_at?: string
  suppressed_count?: number
}
// 2026-11-28 — Cluster-nav shape for advisory-only subs. Mirrors the
// farmer response. See dealer page for canonical comment.
interface ClusterMeta {
  offset: number
  position: 'past' | 'current' | 'future' | 'before_start' | 'after_end'
  day_from: number | null
  day_to: number | null
  date_from: string | null
  date_to: string | null
  has_prev: boolean
  has_next: boolean
  index: number
  total: number
  current_index: number
}

interface AdvisoryDay {
  subscription_id: string
  client_id: string
  package_id: string
  package_name: string
  package_type?: 'ANNUAL' | 'PERENNIAL' | string | null
  crop_cosh_id: string
  crop_start_date: string | null
  day_offset: number
  reference_number: string | null
  // Advisory-Only Mode (2026-09-16, v1.3 mirror). Snapshotted on
  // Subscription at create; controls the PracticeCard element filter
  // and detailsVisible gate so the facilitator sees the same relaxed
  // view the farmer sees on an advisory-only sub.
  advisory_only_mode?: boolean
  dealer_list_enabled?: boolean
  timelines: TimelineItem[]
  // 2026-11-28 — Present only when sub is advisory_only_mode AND the
  // response came from /promoter/assignments/{sid}/cluster.
  cluster?: ClusterMeta | null
  ongoing_timelines?: TimelineItem[]
}

// ── Style constants mirror the farmer page ─────────────────────────

const L0_BG: Record<string, string> = {
  INPUT: '#5B7BA8',
  NON_INPUT: '#8B6FA8',
  INSTRUCTION: '#B58A4A',
  MEDIA: '#A85F76',
}

// Manage-pill tone map — same as farmer page so the chips read
// the same on both surfaces. Tap is disabled (read-only).
// Pill names match the farmer page's ManagePill type so the same
// i18n key (orders.cropOrders.manage.pill.*) and the same tone map
// apply on both surfaces — promoter and farmer read the chip
// identically.
type ManagePill = 'routed' | 'approval' | 'returned' | 'pickup'
const MANAGE_PILL_TONE: Record<ManagePill, { bg: string; fg: string }> = {
  routed:   { bg: '#dbeafe', fg: '#1e40af' },
  approval: { bg: '#ede9fe', fg: '#5b21b6' },
  returned: { bg: '#fee2e2', fg: '#991b1b' },
  pickup:   { bg: '#d1fae5', fg: '#065f46' },
}

function fulfilmentToPill(f: Fulfilment): ManagePill | null {
  if (f.farmer_received_at) return null
  switch (f.status) {
    case 'PENDING':
    case 'AVAILABLE':
    case 'POSTPONED':         return 'routed'
    case 'SENT_FOR_APPROVAL': return 'approval'
    case 'NOT_AVAILABLE':
    case 'REJECTED':          return 'returned'
    case 'APPROVED':          return 'pickup'
    default:                  return null
  }
}

// ── Element filtering rules — identical to farmer page ─────────────

const FARMER_HIDDEN_ELEMENT_TYPES = new Set<string>([
  'COMMON_NAME', 'BRAND_NAME', 'MANUFACTURER',
  'FORMULATION', 'FORMULATION_AI_CONC', 'AI_CONCENTRATION',
  // 2026-07-13 — NPK Handling spec §5.3 mirror. See
  // app/advisory/[subscriptionId]/page.tsx for the canonical
  // rationale on each key. Facilitator advisory renders the
  // farmer surface, so the same hiding applies.
  'N_DOSAGE', 'P_DOSAGE', 'K_DOSAGE', 'UNIT',
  'FERTIGATION_INTERVAL', 'IRRIGATION_INTERVAL', 'REPEAT_INTERVAL',
  'NUMBER_OF_APPLICATIONS',
])
const POST_PURCHASE_ONLY_ELEMENT_TYPES = new Set<string>([
  'APPLICATION_METHOD', 'DOSAGE', 'VOLUME_PER_PLANT', 'INSTRUCTIONS',
])

// 2026-09-16 — Advisory-Only Mode (v1.3): mirror of the farmer's
// advisory page rule set. When advisoryOnly=true, farmer is the
// buyer; SE-authored COMMON_NAME + BRAND_NAME + MANUFACTURER +
// DOSAGE + APPLICATION_METHOD + VOLUME_PER_PLANT + INSTRUCTIONS all
// become visible; only dealer/engine-side math stays hidden. See
// app/advisory/[subscriptionId]/page.tsx for the canonical rationale.
const ADVISORY_ONLY_HIDDEN_ELEMENT_TYPES = new Set<string>([
  // v1.9: COMMON_NAME now surfaced via composeChemistryIdentifier
  // subheader — hide from bullet list to avoid duplication.
  'COMMON_NAME',
  'FORMULATION', 'FORMULATION_AI_CONC', 'AI_CONCENTRATION',
  'N_DOSAGE', 'P_DOSAGE', 'K_DOSAGE', 'UNIT',
  'FERTIGATION_INTERVAL', 'IRRIGATION_INTERVAL', 'REPEAT_INTERVAL',
  'NUMBER_OF_APPLICATIONS',
])

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}
function humanizeType(s: string | null): string {
  if (!s) return ''
  return s.toLowerCase().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
function fmtDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short' })
}
function timelineDateLabel(from: string | null, to: string | null, locale: string, todayLabel: string): string {
  if (!from && !to) return todayLabel
  if (from && to && from !== to) return `${fmtDate(from, locale)} – ${fmtDate(to, locale)}`
  return fmtDate((to || from)!, locale)
}

type ElementWithUnit = Element & { trailing_unit?: string }
function mergeUnitElements(elements: Element[]): ElementWithUnit[] {
  const out: ElementWithUnit[] = []
  for (const el of elements) {
    const isUnitRow = (el.element_type || '').toUpperCase().endsWith('_UNIT')
    if (isUnitRow && out.length > 0) {
      const unitLabel = el.value || (el.cosh_ref && !isUuid(el.cosh_ref) ? el.cosh_ref : '') || ''
      if (unitLabel) out[out.length - 1].trailing_unit = unitLabel
      continue
    }
    out.push({ ...el })
  }
  return out
}

// v1.9 helper — see canonical elementDisplay comment in
// app/advisory/[subscriptionId]/page.tsx.
function elementDisplay(el: Element | undefined): string {
  if (!el) return ''
  const v = el.value?.trim()
  if (v) return v
  const ref = el.cosh_ref?.trim()
  if (ref && !isUuid(ref)) return ref
  return ''
}
// v1.9.2 helper — extract acronym from "Emulsifiable Concentrate (EC)".
function formulationAcronym(name: string): string {
  if (!name) return ''
  const m = name.match(/\(([^)]+)\)\s*$/)
  return (m ? m[1] : name).trim()
}

// 2026-09-17 (v1.9 mirror) — chemistry identifier line. See canonical
// rationale in app/advisory/[subscriptionId]/page.tsx.
function composeChemistryIdentifier(elements: Element[]): string | null {
  const merged = mergeUnitElements(elements)
  const cn = merged.find(e => (e.element_type || '').toUpperCase() === 'COMMON_NAME')
  const ai = merged.find(e => (e.element_type || '').toUpperCase() === 'AI_CONCENTRATION')
  const fmt = merged.find(e => (e.element_type || '').toUpperCase() === 'FORMULATION')
  const combined = merged.find(e => (e.element_type || '').toUpperCase() === 'FORMULATION_AI_CONC')
  const cnStr = elementDisplay(cn)
  const aiStr = elementDisplay(ai)
  const fmtRaw = elementDisplay(fmt)
  const fmtStr = fmtRaw ? formulationAcronym(fmtRaw) : ''
  const combinedStr = elementDisplay(combined)
  if (aiStr || fmtStr) {
    const parts: string[] = []
    if (cnStr) parts.push(cnStr)
    if (aiStr) parts.push(`${aiStr}%`)
    if (fmtStr) parts.push(fmtStr)
    return parts.length > 0 ? parts.join(' ') : null
  }
  if (combinedStr) {
    return cnStr ? `${cnStr} ${combinedStr}` : combinedStr
  }
  return cnStr || null
}

// 2026-09-16 — Advisory-Only Mode (v1.4 mirror). Short synopsis for
// the collapsed PracticeCard header. See canonical rationale in
// app/advisory/[subscriptionId]/page.tsx.
function computeSynopsis(
  elements: Element[],
  tSuggestedLabel: string,
): string | null {
  const merged = mergeUnitElements(elements)
  const brandEl = merged.find(e => (e.element_type || '').toUpperCase() === 'BRAND_NAME')
  const dosageEl = merged.find(e => (e.element_type || '').toUpperCase() === 'DOSAGE')
  const brand = elementDisplay(brandEl)
  const dose = dosageEl
    ? `${dosageEl.value || ''}${dosageEl.trailing_unit ? ' ' + dosageEl.trailing_unit : ''}`.trim()
    : ''
  if (brand && dose) return `${tSuggestedLabel}: ${brand} · ${dose}`
  if (brand) return `${tSuggestedLabel}: ${brand}`
  if (dose) return dose
  return null
}

// ── Relation grouping helpers — identical to farmer page ───────────

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
    .map(Number).sort((a, b) => a - b)
    .map(partNum => ({
      part: partNum,
      options: Object.keys(partsMap[partNum])
        .map(Number).sort((a, b) => a - b)
        .map(optNum => ({
          option: optNum,
          practices: partsMap[partNum][optNum].sort((a, b) => a.pos - b.pos).map(x => x.p),
        })),
    }))
}
interface PracticeRow {
  kind: 'standalone' | 'relation'
  practice?: Practice
  relation_id?: string
  relation_type?: 'AND' | 'OR' | 'IF'
  parts?: PartGroup[]
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
  for (const p of standalones) rows.push({ kind: 'standalone', practice: p, sortKey: p.display_order })
  for (const [relId, rPracs] of Object.entries(byRelation)) {
    const parts = buildPartsTree(rPracs)
    const minOrder = Math.min(...rPracs.map(x => x.display_order))
    const relType = (rPracs.find(x => x.relation_type)?.relation_type || 'OR') as 'AND' | 'OR' | 'IF'
    rows.push({ kind: 'relation', relation_id: relId, relation_type: relType, parts, sortKey: minOrder })
  }
  rows.sort((a, b) => a.sortKey - b.sortKey)
  return rows
}

// ── Sub-components ─────────────────────────────────────────────────

function PurchasedSummary({
  brand, manufacturer, elements,
  elementLabel,
}: {
  brand: string
  manufacturer: string | null
  elements: Element[]
  elementLabel: (et: string) => string
}) {
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
            <span className="text-emerald-700">{elementLabel('APPLICATION_METHOD')}:</span>{' '}
            <span className="font-medium">{appMethod.value || appMethod.cosh_ref}</span>
          </p>
        )}
        {dosage && (dosage.value || dosage.cosh_ref) && (
          <p>
            <span className="text-emerald-700">{elementLabel('DOSAGE')}:</span>{' '}
            <span className="font-medium">
              {dosage.value || dosage.cosh_ref}{dosageUnit ? ` ${dosageUnit}` : ''}
            </span>
          </p>
        )}
      </div>
    </div>
  )
}

function ReadOnlyAckMarker({ marked, label }: { marked: boolean; label: string }) {
  return (
    <div className="border-t border-[#DDD0B8] px-4 py-2.5 flex items-center gap-2">
      <span
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full border ${
          marked
            ? 'bg-emerald-600 border-emerald-700 text-white'
            : 'bg-[#F5F0E8] border-[#DDD0B8] text-[#7A8C7E]'
        }`}>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
        </svg>
      </span>
      <span className={`text-xs font-medium ${marked ? 'text-emerald-700' : 'text-[#7A8C7E]'}`}>
        {label}
      </span>
    </div>
  )
}

// Advisory-Only v1.7 mirror (2026-09-17) — math-notation separators
// inside Relation groups. See canonical rationale in
// app/advisory/[subscriptionId]/page.tsx.
function BigPlusSeparator() {
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-emerald-50/30">
      <div className="h-0.5 flex-1 bg-emerald-200" />
      <span className="text-3xl font-bold text-emerald-600 leading-none">+</span>
      <div className="h-0.5 flex-1 bg-emerald-200" />
    </div>
  )
}
function BigOrSeparator() {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className="h-0.5 flex-1 bg-blue-200" />
      <span className="text-base font-bold text-blue-700 tracking-widest">OR</span>
      <div className="h-0.5 flex-1 bg-blue-200" />
    </div>
  )
}

function PracticeCard({
  practice, elementLabel, t, tPill, labelOverride, advisoryOnly = false,
  collapsed = false, onToggleCollapsed, insideContainer = false, tSuggestedLabel,
}: {
  practice: Practice
  elementLabel: (et: string) => string
  t: (k: string, vars?: Record<string, string | number>) => string
  tPill: (k: string) => string
  // 2026-06-26 — Pure-OR collapse (mirror of farmer page).
  labelOverride?: string
  // 2026-09-16 — Advisory-Only Mode (v1.3 mirror). When true, use the
  // relaxed filter set and skip the post-purchase gate — mirrors the
  // farmer's own advisory view.
  advisoryOnly?: boolean
  // 2026-09-16 — v1.4 mirror: accordion behaviour + insideContainer
  // + synopsis label. See canonical rationale in
  // app/advisory/[subscriptionId]/page.tsx.
  collapsed?: boolean
  onToggleCollapsed?: () => void
  insideContainer?: boolean
  tSuggestedLabel?: string
}) {
  const colour = L0_BG[practice.l0_type] || '#3A7D44'
  const l2Label = practice.l2_name_loc || humanizeType(practice.l2_type)
  const fulf = practice.fulfilment ?? null
  const pillName = fulf ? fulfilmentToPill(fulf) : null
  const pillTone = pillName ? MANAGE_PILL_TONE[pillName] : null
  const isPurchasable = practice.l0_type === 'INPUT'
  const pickedUp = !!fulf?.farmer_received_at
  const summaryShown = pickedUp && !!fulf?.brand_name
  const detailsVisible =
    practice.elements.length > 0 && (advisoryOnly || !isPurchasable || pickedUp)
  const visibleEls = detailsVisible
    ? mergeUnitElements(practice.elements).filter(el => {
        const tp = (el.element_type || '').toUpperCase()
        if (advisoryOnly) {
          if (ADVISORY_ONLY_HIDDEN_ELEMENT_TYPES.has(tp)) return false
          return true
        }
        if (FARMER_HIDDEN_ELEMENT_TYPES.has(tp)) return false
        if (!summaryShown && POST_PURCHASE_ONLY_ELEMENT_TYPES.has(tp)) return false
        if (summaryShown && (tp === 'APPLICATION_METHOD' || tp === 'DOSAGE')) return false
        return true
      })
    : []

  const ackable = practice.l0_type !== 'INPUT' || !!fulf?.farmer_received_at
  const ackMarked = practice.ack_status === 'MARKED'

  // v1.9 mirror — chemistry identifier line, both modes, always visible.
  const chemistryLine = composeChemistryIdentifier(practice.elements)
  const synopsisLine = (advisoryOnly && collapsed && tSuggestedLabel)
    ? computeSynopsis(practice.elements, tSuggestedLabel)
    : null
  const outerCls = insideContainer
    ? 'bg-white'
    : 'bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden'

  return (
    <div className={outerCls}>
      <div
        className={`flex items-center gap-3 px-4 py-3.5 ${onToggleCollapsed ? 'cursor-pointer active:bg-slate-50' : ''}`}
        onClick={onToggleCollapsed}
        role={onToggleCollapsed ? 'button' : undefined}
        tabIndex={onToggleCollapsed ? 0 : undefined}
        onKeyDown={onToggleCollapsed
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onToggleCollapsed()
              }
            }
          : undefined}
      >
        <div className="w-2 h-8 rounded-full flex-shrink-0" style={{ background: colour }} />
        <div className="flex-1 min-w-0">
          {(practice.is_special_input
            || (practice.frequency_days != null && practice.frequency_days > 0)) && (
            <div className="flex items-center gap-2 flex-wrap">
              {practice.is_special_input && (
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                  {t('adjuvantBadge')}
                </span>
              )}
              {practice.frequency_days != null && practice.frequency_days > 0 && (
                <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                  {practice.frequency_days === 1
                    ? t('frequencyEveryDay')
                    : t('frequencyEvery', { count: practice.frequency_days })}
                </span>
              )}
            </div>
          )}
          {/* 2026-11-28 — Chips row: brand-lock + purchase status.
              Shows for INPUT practices. Matches the farmer view —
              brand-lock reads as a locked product recommendation,
              purchase chip reads as the farmer's own ack state. */}
          {practice.l0_type === 'INPUT' && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {practice.is_brand_locked && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 font-medium">
                  🔒 Brand Locked
                </span>
              )}
              {(practice.is_purchased || practice.purchased_at) ? (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-medium">
                  {t('farmerPurchased')}
                  {practice.purchased_at && (
                    <span className="opacity-80"> · {new Date(practice.purchased_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}</span>
                  )}
                  {(practice.purchased_brand_name || practice.purchased_brand_text || fulf?.brand_name) && (
                    <span className="opacity-80">
                      {' · '}
                      {practice.purchased_brand_name || practice.purchased_brand_text || fulf?.brand_name}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-stone-100 border border-stone-200 text-stone-600 font-medium">
                  {t('purchasePending')}
                </span>
              )}
            </div>
          )}
          <p className="text-sm font-medium text-[#6B3F1F] mt-1">
            {labelOverride || l2Label || t('generalAdvisory')}
          </p>
          {chemistryLine && (
            <p className="text-sm font-bold text-[#6B3F1F] mt-0.5 truncate">
              {chemistryLine}
            </p>
          )}
          {synopsisLine && (
            <p className="text-xs text-[#7A8C7E] mt-0.5 truncate">{synopsisLine}</p>
          )}
        </div>
        {/* Read-only status chip (no tap action — promoter is not
            allowed to act). When the practice is INPUT with a live
            fulfilment, we surface the pill name so the F-P knows
            where the input stands in the order chain. */}
        {practice.l0_type === 'INPUT' && pillName && pillTone && (
          <span
            className="shrink-0 text-xs font-semibold px-3 py-2 rounded-xl"
            style={{ background: pillTone.bg, color: pillTone.fg }}>
            {tPill(pillName)}
            {fulf?.status === 'POSTPONED' && fulf.postpone_days_remaining != null
              ? ` · ${fulf.postpone_days_remaining}d` : ''}
          </span>
        )}
        {onToggleCollapsed && (
          <svg
            className={`w-5 h-5 text-[#7A8C7E] shrink-0 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
            aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
          </svg>
        )}
      </div>

      {!collapsed && pickedUp && fulf?.brand_name && (
        <PurchasedSummary
          brand={fulf.brand_name}
          manufacturer={fulf.manufacturer_name}
          elements={practice.elements}
          elementLabel={elementLabel}
        />
      )}

      {!collapsed && visibleEls.length > 0 && (
        <div className="border-t border-[#DDD0B8] px-4 pb-3 pt-2 space-y-2">
          {visibleEls.map((el, i) => {
            const type = (el.element_type || '').toUpperCase()
            const url = (el.value || '').trim()
            const isSafe = /^https?:\/\//i.test(url)
            // 2026-06-24 — Render media elements (image / audio /
            // hyperlink) inline so the promoter sees what the farmer
            // sees. Mirrors the farmer page's render added the same
            // day.
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
            // 2026-11-28 — Mirror farmer's amber-accent + 🔒 prefix
            // on BRAND_NAME / MANUFACTURER rows when the practice is
            // brand-locked. Makes the "locked product" stand out of
            // the regular element list, exactly as the farmer sees it.
            const isLockedIdentityRow = !!practice.is_brand_locked
              && (type === 'BRAND_NAME' || type === 'MANUFACTURER')
            if (isLockedIdentityRow) {
              return (
                <div key={i} className="flex items-start gap-2 text-sm border-l-2 border-amber-400 bg-amber-50/50 pl-2 py-0.5 rounded-r">
                  <span className="text-amber-700 text-xs mt-0.5">{type === 'BRAND_NAME' ? '🔒' : '•'}</span>
                  <div>
                    <span className="text-amber-900 font-bold">{elementLabel(type)}</span>
                    {el.value
                      ? <span className="text-amber-900 font-bold ml-1">: {el.value}{inlineUnit ? ` ${inlineUnit}` : ''}</span>
                      : showRef
                        ? <span className="text-amber-900 font-bold ml-1">: {el.cosh_ref}</span>
                        : inlineUnit
                          ? <span className="text-amber-900 font-bold ml-1">: {inlineUnit}</span>
                          : null}
                  </div>
                </div>
              )
            }
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
          {/* 2026-11-28 — Product image block for brand-locked
              practices (mirror of farmer render). Dashed top-border +
              "Product image" caption tie it visually to the
              recommendation. Tap to expand full-screen via lightbox. */}
          {practice.is_brand_locked && practice.brand_image_url && (
            <div className="mt-3 pt-3 border-t border-dashed" style={{ borderColor: '#DDD0B8' }}>
              <p className="text-[10px] uppercase tracking-wider text-[#7A8C7E] font-semibold mb-2">
                Product image
              </p>
              <BrandImageWithLightbox src={practice.brand_image_url} />
            </div>
          )}
        </div>
      )}

      {!collapsed && ackable && (
        <ReadOnlyAckMarker
          marked={ackMarked}
          label={ackMarked ? t('ackMarked') : t('ackPending')}
        />
      )}
    </div>
  )
}

function RelationGroup({
  relationType, parts, elementLabel, t, tPill, tRel, advisoryOnly = false,
  tAdvisoryOnly,
}: {
  relationType: 'AND' | 'OR' | 'IF'
  parts: PartGroup[]
  elementLabel: (et: string) => string
  t: (k: string, vars?: Record<string, string | number>) => string
  tPill: (k: string) => string
  // 2026-06-26 — shared keys with the farmer page so promoter sees
  // exactly what the farmer sees on a relation block.
  tRel: (k: string, vars?: Record<string, string | number>) => string
  // 2026-09-16 — Advisory-Only Mode (v1.3 mirror). Forwarded to every
  // nested PracticeCard so the relaxed element filter kicks in on
  // advisory-only subs (buyer = farmer, not dealer).
  advisoryOnly?: boolean
  // 2026-09-16 — v1.4 mirror: translator for the expand-all / suggested
  // labels. Passed in from the caller so tests + storybook can inject
  // a stub if ever needed. When absent, defaults collapse to labels.
  tAdvisoryOnly?: (k: string) => string
}) {
  if (parts.length === 0) return null

  const isPureAndGroup =
    relationType === 'AND' &&
    parts.length === 1 &&
    parts[0].options.length === 1 &&
    parts[0].options[0].practices.length > 1

  // 2026-06-26 — Pure OR collapse: ONE card with a joined L2 label
  // (e.g. "Microbial Pesticide or Botanical Pesticide") so the
  // promoter sees what the farmer sees. OR is a dealer-side
  // substitution path, not a farming choice — promoter's view
  // mirrors the farmer page.
  const isPureOrGroup =
    relationType === 'OR' &&
    parts.length === 1 &&
    parts[0].options.length >= 2 &&
    parts[0].options.every(o => o.practices.length === 1)

  // 2026-09-16 — v1.5 mirror: exclusive-expand accordion.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const suggestedLabel = tAdvisoryOnly ? tAdvisoryOnly('suggested') : 'Suggested'
  const cardCollapseProps = (p: Practice) =>
    advisoryOnly
      ? {
          collapsed: expandedId !== p.id,
          onToggleCollapsed: () =>
            setExpandedId(prev => (prev === p.id ? null : p.id)),
          tSuggestedLabel: suggestedLabel,
        }
      : {}

  if (isPureOrGroup && !advisoryOnly) {
    const orPractices = parts[0].options.map(o => o.practices[0])
    // 2026-06-29 — Mirror of farmer page: once a leg has been
    // picked, the card reflects THAT leg's reality (label, brand,
    // chip) rather than the alternatives.
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
    return (
      <PracticeCard
        practice={head}
        labelOverride={joinedLabel}
        elementLabel={elementLabel}
        t={t}
        tPill={tPill}
        advisoryOnly={advisoryOnly}
      />
    )
  }

  if (isPureAndGroup) {
    const opt = parts[0].options[0]
    // v1.7 mirror: drop header + green border + BigPlusSeparator when
    // advisoryOnly. See canonical rationale on farmer page.
    const andCls = advisoryOnly
      ? 'bg-white rounded-2xl border border-emerald-200 shadow-sm overflow-hidden'
      : 'bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden'
    return (
      <div className={andCls}>
        {!advisoryOnly && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[#DDD0B8] bg-emerald-50">
            <div className="w-1 h-5 rounded-full bg-emerald-600" />
            <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">
              {tRel('applyAllTogether', { count: opt.practices.length })}
            </p>
          </div>
        )}
        <div className={advisoryOnly ? '' : 'divide-y divide-slate-100'}>
          {opt.practices.flatMap((p, i) => {
            const card = (
              <div key={p.id} className={advisoryOnly ? '' : 'px-3 py-2'}>
                <PracticeCard
                  practice={p}
                  elementLabel={elementLabel} t={t} tPill={tPill}
                  advisoryOnly={advisoryOnly}
                  insideContainer={advisoryOnly}
                  {...cardCollapseProps(p)}
                />
              </div>
            )
            return i === 0 || !advisoryOnly
              ? [card]
              : [<BigPlusSeparator key={`plus-${p.id}`} />, card]
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {parts.map((part, partIdx) => {
        // 2026-06-26 — Pure-OR-at-Part-level collapse, mirror of
        // farmer page: an OR Part inside a multi-Part Relation
        // (e.g. Part 2 of (A+B) AND (C OR D)) collapses to ONE
        // card with the merged L2 label.
        const isPartPureOr =
          part.options.length >= 2 &&
          part.options.every(o => o.practices.length === 1)
        // 2026-09-16 — v1.4 mirror: skip Part-level pure-OR collapse
        // in advisory-only mode too.
        if (isPartPureOr && !advisoryOnly) {
          const orPractices = part.options.map(o => o.practices[0])
          // 2026-06-29 — Mirror of farmer page per-Part collapse:
          // chosen leg's data takes over once a leg is picked.
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
          return (
            <div key={part.part}>
              <PracticeCard
                practice={head}
                labelOverride={joinedLabel}
                elementLabel={elementLabel}
                t={t}
                tPill={tPill}
                advisoryOnly={advisoryOnly}
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
        // 2026-09-16 — v1.5: mirror the farmer page — hoist isChoice
        // and wrap the whole Part's options in a blue "Choose one"
        // container in advisory-only mode.
        const isChoicePart = part.options.length > 1
        const optionsBody = part.options.map((opt, optIdx) => {
            const isChoice = isChoicePart
            const isCompound = opt.practices.length > 1
            return (
              <div key={opt.option}>
                {isChoice && optIdx > 0 && !advisoryOnly && (
                  <div className="flex items-center my-2">
                    <div className="h-px flex-1 bg-slate-300" />
                    <span className="px-3 text-xs font-bold text-[#7A8C7E] bg-[#F5F0E8] rounded">
                      {tRel('orSeparator')}
                    </span>
                    <div className="h-px flex-1 bg-slate-300" />
                  </div>
                )}
                {isCompound ? (
                  <div className={advisoryOnly
                    ? 'bg-white rounded-2xl border border-emerald-200 shadow-sm overflow-hidden'
                    : 'bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden'}>
                    {!advisoryOnly && (
                      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#DDD0B8] bg-emerald-50">
                        <div className="w-1 h-5 rounded-full bg-emerald-600" />
                        <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">
                          {tRel('applyAllTogether', { count: opt.practices.length })}
                        </p>
                      </div>
                    )}
                    <div className={advisoryOnly ? '' : 'divide-y divide-slate-100'}>
                      {opt.practices.flatMap((p, i) => {
                        const card = (
                          <div key={p.id} className={advisoryOnly ? '' : 'px-3 py-2'}>
                            <PracticeCard
                              practice={p}
                              elementLabel={elementLabel} t={t} tPill={tPill}
                              advisoryOnly={advisoryOnly}
                              insideContainer={advisoryOnly}
                              {...cardCollapseProps(p)}
                            />
                          </div>
                        )
                        return i === 0 || !advisoryOnly
                          ? [card]
                          : [<BigPlusSeparator key={`plus-${p.id}`} />, card]
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {opt.practices.map(p => (
                      <PracticeCard
                        key={p.id}
                        practice={p}
                        elementLabel={elementLabel} t={t} tPill={tPill}
                        advisoryOnly={advisoryOnly}
                        insideContainer={advisoryOnly && isChoice}
                        {...cardCollapseProps(p)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
        })
        return (
        <div key={part.part}>
          {advisoryOnly && isChoicePart && tAdvisoryOnly ? (
            <div className="bg-white rounded-2xl border border-blue-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-blue-200 bg-blue-50">
                <div className="w-1 h-5 rounded-full bg-blue-500" />
                <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">
                  {tAdvisoryOnly('chooseOne')}
                </p>
              </div>
              {/* 2026-09-17 — v1.7 mirror: BigOrSeparator between options.
                  v1.7.1: tightened padding to match farmer page. */}
              <div className="p-2 space-y-1">
                {optionsBody.flatMap((el, i) =>
                  i === 0
                    ? [el]
                    : [<BigOrSeparator key={`or-${i}`} />, el],
                )}
              </div>
            </div>
          ) : optionsBody}
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

// ── Page ───────────────────────────────────────────────────────────

// 2026-11-28 — Suspense wrapper for useSearchParams() (Next.js 16).
export default function FacilitatorAdvisoryViewPage() {
  return (
    <Suspense fallback={null}>
      <FacilitatorAdvisoryViewContent />
    </Suspense>
  )
}

function FacilitatorAdvisoryViewContent() {
  const router = useRouter()
  const t = useTranslations('facilitator.promotedFarmers.detail')
  const tEl = useTranslations('practice.element')
  const tPill = useTranslations('orders.cropOrders.manage.pill')
  const tAdvisoryOnly = useTranslations('advisoryOnly')
  // 2026-06-26 — shared with farmer page so the relation hierarchy
  // reads identically on both surfaces.
  const tRel = useTranslations('practice.relations')
  const locale = useLocale()
  const elementLabel = (et: string) => tEl.has(et) ? tEl(et) : humanizeType(et)
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  // 2026-11-28 — Contextual back when arrived via Alerts tap-through.
  const searchParams = useSearchParams()
  const backHref = searchParams.get('from') === 'alerts'
    ? '/facilitator/alerts-incoming'
    : '/facilitator/promoted-farmers'
  const [day, setDay] = useState<AdvisoryDay | null>(null)
  const [loading, setLoading] = useState(true)
  const [errCode, setErrCode] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  // 2026-11-28 — Cluster navigation state. See dealer page for
  // canonical comment. Only meaningful on advisory_only_mode subs.
  const [clusterOffset, setClusterOffset] = useState<number>(0)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    if (day === null) setLoading(true)
    const useCluster = day?.advisory_only_mode === true
    const url = useCluster
      ? `/promoter/assignments/${subscriptionId}/cluster?offset=${clusterOffset}`
      : `/promoter/assignments/${subscriptionId}/today`
    api.get<AdvisoryDay>(url)
      .then(r => { setDay(r.data); setErrCode(null); setErrMsg(null) })
      .catch((e: unknown) => {
        const err = e as { response?: { status?: number; data?: { detail?: { code?: string; message?: string } | string } } }
        const status = err?.response?.status
        const detail = err?.response?.data?.detail
        if (status === 404 && typeof detail === 'object' && detail
            && detail.code === 'cluster_out_of_range'
            && clusterOffset !== 0) {
          setClusterOffset(0)
          return
        }
        if (typeof detail === 'object' && detail && detail.code) {
          setErrCode(detail.code)
          setErrMsg(detail.message || null)
        } else if (status === 404) {
          setErrCode('not_found')
          setErrMsg(typeof detail === 'string' ? detail : t('errorNotFound'))
        } else {
          setErrCode('unknown')
          setErrMsg(t('errorLoad'))
        }
      })
      .finally(() => setLoading(false))
    // Omit `day` from deps — see canonical comment in dealer page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, subscriptionId, t, clusterOffset])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={t('headerTitle')} activeRole="FACILITATOR" back={backHref} />
        <div className="pt-16 px-4 max-w-lg mx-auto">
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-[#DDD0B8] border-t-[#7D4E00] rounded-full animate-spin" />
          </div>
        </div>
      </div>
    )
  }

  if (errCode) {
    const isNoAdvisory = errCode === 'no_advisory_yet'
    const isPending = errCode === 'assignment_not_active'
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={t('headerTitle')} activeRole="FACILITATOR" back={backHref} />
        <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
          <div className="mt-8 rounded-2xl border border-[#DDD0B8] bg-white p-5">
            <p className="text-base font-bold text-[#6B3F1F] mb-2">
              {isNoAdvisory ? t('errorTitleWaiting') : isPending ? t('errorTitlePending') : t('errorTitleNotAvailable')}
            </p>
            <p className="text-sm text-[#7A8C7E] leading-relaxed">
              {errMsg ||
                (isNoAdvisory
                  ? t('errorBodyNoAdvisory')
                  : isPending
                    ? t('errorBodyPending')
                    : t('errorBodyUnknown'))}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!day) return null

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FACILITATOR" back={backHref} />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        {/* Read-only banner */}
        <div className="mt-3 mb-3 rounded-xl border border-[#DDD0B8] bg-white px-3 py-2 text-[11px] text-[#7A8C7E] text-center">
          {t('readOnlyHint')}
        </div>

        {/* Crop + reference header (mirrors the farmer's ClientCropChip) */}
        <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 mb-4">
          <p className="text-lg font-bold text-[#6B3F1F]">
            {cropDisplayName(day.crop_cosh_id)}
          </p>
          {day.reference_number && (
            <p className="text-xs font-mono text-[#7A8C7E] mt-1">{day.reference_number}</p>
          )}
        </div>

        {/* Day counter — annual shows "Day N", perennial shows today's date */}
        <div className="bg-white rounded-2xl px-4 py-3 border border-[#DDD0B8] mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[#7A8C7E]">{t('todayLabel')}</p>
              <p className="font-bold text-[#6B3F1F]">
                {day.package_type === 'PERENNIAL'
                  ? new Date().toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
                  : t('dayN', { day: day.day_offset })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[#7A8C7E]">{t('activeTimelines')}</p>
              <p className="font-bold text-[#6B3F1F]">{day.timelines.length}</p>
            </div>
          </div>
          {/* 2026-11-28 — Cluster navigation for Advisory-Only Mode
              subs ONLY. Matches the farmer's /advisory nav exactly
              (per user direction 2026-11-28: exact parity). Regular
              Mode subs have no nav — same as the farmer's own view. */}
          {day.advisory_only_mode && day.cluster && (() => {
            const c = day.cluster
            const isEmpty = c.position === 'before_start' || c.position === 'after_end'
            const posKey = isEmpty ? 'clusterPositionNone'
              : c.position === 'past' ? 'clusterPositionPast'
              : c.position === 'future' ? 'clusterPositionFuture'
              : 'clusterPositionCurrent'
            return (
              <div className="mt-3 pt-3 border-t border-[#DDD0B8] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => setClusterOffset(o => o - 1)}
                    disabled={!c.has_prev}
                    className="text-xs font-semibold text-[#6B3F1F] px-3 py-2 rounded-xl bg-[#F5F0E8] disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
                    ← {tAdvisoryOnly('clusterPrevious')}
                  </button>
                  <button
                    onClick={() => setClusterOffset(0)}
                    disabled={c.offset === 0}
                    className="text-xs font-semibold text-[#7D4E00] px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
                    {tAdvisoryOnly('clusterToday')}
                  </button>
                  <button
                    onClick={() => setClusterOffset(o => o + 1)}
                    disabled={!c.has_next}
                    className="text-xs font-semibold text-[#6B3F1F] px-3 py-2 rounded-xl bg-[#F5F0E8] disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
                    {tAdvisoryOnly('clusterNext')} →
                  </button>
                </div>
                <div className="text-center">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-[#7A8C7E]">
                    {tAdvisoryOnly(posKey)}
                  </p>
                  {!isEmpty && c.date_from && c.date_to && c.day_from != null && c.day_to != null && (() => {
                    const lastInclusiveDay = c.day_to - 1
                    const dateToInclusive = new Date(c.date_to + 'T00:00:00')
                    dateToInclusive.setDate(dateToInclusive.getDate() - 1)
                    const singleDay = c.day_from === lastInclusiveDay
                    return (
                      <p className="text-sm font-medium text-[#6B3F1F] mt-0.5">
                        {singleDay
                          ? `Day ${c.day_from} · ${new Date(c.date_from).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}`
                          : `Day ${c.day_from} – ${lastInclusiveDay} · ${new Date(c.date_from).toLocaleDateString(locale, { day: '2-digit', month: 'short' })} – ${dateToInclusive.toLocaleDateString(locale, { day: '2-digit', month: 'short' })}`}
                      </p>
                    )
                  })()}
                </div>
              </div>
            )
          })()}
        </div>

        {/* Timelines */}
        {day.timelines.length === 0 ? (
          <div className="rounded-2xl border border-[#DDD0B8] bg-white p-5 text-center">
            <p className="text-sm text-[#7A8C7E]">{t('noneToday')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {day.timelines.map(tl => {
              const rows = groupTimelinePractices(tl.practices)
              return (
                <div key={tl.id}
                  className="bg-white rounded-2xl border border-[#DDD0B8] overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#DDD0B8] bg-[#F5F0E8]/40">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        {tl.problem_name && (
                          <p className="text-[10px] uppercase tracking-wide font-semibold text-[#D4682E] mb-0.5">
                            {tl.source} · {tl.problem_name}
                          </p>
                        )}
                        <p className="font-semibold text-[#6B3F1F] truncate">{tl.name}</p>
                      </div>
                      <span className="text-xs text-[#7A8C7E] shrink-0">
                        {timelineDateLabel(tl.from_date, tl.to_date, locale, t('todayLabel'))}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 space-y-3">
                    {/* Pending conditional question (read-only). The
                        farmer is being asked this; the F-P can see it
                        so they know to nudge the farmer. No Yes/No
                        buttons — the F-P can't answer. */}
                    {tl.has_pending_question && tl.pending_conditional_question && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-[10px] uppercase tracking-wide font-semibold text-amber-800 mb-1">
                          {t('pendingQuestionLabel')}
                        </p>
                        <p className="text-sm text-amber-900">
                          {tl.pending_conditional_question.question_text}
                        </p>
                        <p className="text-[11px] text-amber-700 mt-2">
                          {t('pendingQuestionHint')}
                        </p>
                      </div>
                    )}

                    {rows.length === 0 ? (
                      (tl.suppressed_count ?? 0) > 0 ? (
                        <p className="text-xs text-[#7A8C7E] py-3 text-center">
                          {t('suppressedNote', { count: tl.suppressed_count! })}
                        </p>
                      ) : (
                        <p className="text-xs text-[#7A8C7E] py-3 text-center">
                          {t('noPracticeToday')}
                        </p>
                      )
                    ) : rows.map(row =>
                      row.kind === 'standalone' && row.practice ? (
                        <PracticeCard key={row.practice.id}
                          practice={row.practice}
                          elementLabel={elementLabel} t={t} tPill={tPill}
                          advisoryOnly={!!day?.advisory_only_mode} />
                      ) : row.kind === 'relation' ? (
                        <RelationGroup key={row.relation_id}
                          relationType={row.relation_type || 'OR'}
                          parts={row.parts || []}
                          elementLabel={elementLabel} t={t} tPill={tPill} tRel={tRel}
                          advisoryOnly={!!day?.advisory_only_mode}
                          tAdvisoryOnly={tAdvisoryOnly} />
                      ) : null
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// 2026-11-28 — Inline + lightbox-on-tap image for brand-locked
// practice. Mirror of BrandImageWithLightbox on /advisory and
// /dealer/promoted-farmers. Shared as a plain helper; not worth
// extracting to a shared module for three callsites.
function BrandImageWithLightbox({ src }: { src: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Product"
        className="w-full max-h-64 object-contain rounded-lg bg-white cursor-zoom-in"
        onClick={() => setOpen(true)}
      />
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setOpen(false)}
          role="dialog" aria-modal="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="Product"
            className="max-h-full max-w-full object-contain rounded"
          />
        </div>
      )}
    </>
  )
}
