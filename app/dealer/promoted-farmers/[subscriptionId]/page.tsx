'use client'
import { Suspense, useState, useEffect } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

const COLOUR = '#7D4196'

interface ElementRow {
  element_type: string
  cosh_ref: string | null
  value: string | null
  unit_cosh_id: string | null
}

interface Practice {
  id: string
  l0_type: 'INPUT' | 'NON_INPUT' | 'INSTRUCTION' | 'MEDIA'
  l1_type: string | null
  l2_type: string | null
  l2_name_loc?: string | null
  display_order: number
  elements: ElementRow[]
  is_purchased?: boolean
  frequency_days?: number | null
  is_frequency_due_today?: boolean
  // 2026-06-12 — Surfaces the dealer-delivered brand + manufacturer so
  // the promoter can speak to the farmer about what they actually have.
  // Populated by the today-advisory kernel when the latest order item
  // for this practice is APPROVED (brand visible to farmer ↔ visible
  // to promoter).
  fulfilment?: {
    status?: string | null
    brand_name?: string | null
    manufacturer_name?: string | null
  } | null
  // 2026-11-28 — Farmer's "I've purchased this" ack surfaces for the
  // promoter chip. purchased_at is the ISO timestamp set by the
  // v1.8 (2026-09-17) Advisory-Only Mode ack flow (also populated
  // on regular-mode subs via order receipt). Brand fields come from
  // v2 Checkbox 3 (2026-09-22) — populated when the farmer picked
  // a catalog brand on the ack, OR free text via purchased_brand_text.
  purchased_at?: string | null
  purchased_brand_name?: string | null
  purchased_brand_text?: string | null
  purchased_brand_manufacturer_name?: string | null
}

interface TimelineItem {
  id: string
  name: string
  source: string
  from_date: string
  to_date: string
  day_number: number
  practices: Practice[]
  problem_name?: string
  triggered_at?: string
}

interface AdvisoryDay {
  subscription_id: string
  client_id: string
  package_id: string
  package_name: string
  crop_cosh_id: string
  crop_start_date: string | null
  day_offset: number
  reference_number: string | null
  // Advisory-Only Mode (2026-09-16, v1.3 mirror). Snapshotted on
  // Subscription at create; controls the renderElements filter so
  // the promoter sees the relaxed view the farmer sees on
  // advisory-only subs.
  advisory_only_mode?: boolean
  in_app_orders_enabled?: boolean
  dealer_list_enabled?: boolean
  timelines: TimelineItem[]
}

const L0_BG: Record<string, string> = {
  INPUT: '#5B7BA8',
  NON_INPUT: '#8B6FA8',
  INSTRUCTION: '#B58A4A',
  MEDIA: '#A85F76',
}
function fmtDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short' })
}
function timelineDateLabel(from: string | null, to: string | null, locale: string, todayLabel: string): string {
  if (!from && !to) return todayLabel
  if (from && to && from !== to) return `${fmtDate(from, locale)} – ${fmtDate(to, locale)}`
  return fmtDate((to || from)!, locale)
}
function humanize(s: string | null): string {
  if (!s) return ''
  return s.toLowerCase().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

// 2026-06-12 — Same surfacing rules as the farmer's advisory view:
//   - FARMER_HIDDEN_ELEMENT_TYPES: hidden always
//   - POST_PURCHASE_ONLY_ELEMENT_TYPES: hidden until is_purchased is true
//
// This page is "dealer-as-promoter viewing the farmer they sponsor" —
// the dealer here is the promoter, not the selling dealer. The
// promoter sees what the farmer sees: nothing extra pre-purchase,
// application detail once purchased.
//
// Mirror of FARMER_HIDDEN_ELEMENT_TYPES / POST_PURCHASE_ONLY_ELEMENT_TYPES
// in app/advisory/[subscriptionId]/page.tsx.
const FARMER_HIDDEN_ELEMENT_TYPES = new Set<string>([
  'COMMON_NAME',
  'BRAND_NAME',
  'MANUFACTURER',
  'FORMULATION',
  'FORMULATION_AI_CONC',
  'AI_CONCENTRATION',
  // 2026-07-13 — NPK Handling spec §5.3 mirror. Dealer's promoted-
  // farmer view renders the farmer surface (what the farmer sees),
  // not the dealer's ordering surface, so the same hide rules
  // apply. Canonical rationale on each key lives in
  // app/advisory/[subscriptionId]/page.tsx.
  'N_DOSAGE',
  'P_DOSAGE',
  'K_DOSAGE',
  'UNIT',
  'FERTIGATION_INTERVAL',
  'IRRIGATION_INTERVAL',
  'REPEAT_INTERVAL',
  'NUMBER_OF_APPLICATIONS',
])

const POST_PURCHASE_ONLY_ELEMENT_TYPES = new Set<string>([
  'APPLICATION_METHOD',
  'DOSAGE',
  'VOLUME_PER_PLANT',
  'INSTRUCTIONS',
])

// 2026-09-16 — Advisory-Only Mode (v1.3 mirror). See canonical
// rationale in app/advisory/[subscriptionId]/page.tsx: farmer is the
// buyer on advisory-only subs, so SE-authored COMMON_NAME + BRAND_NAME
// + MANUFACTURER + DOSAGE + APPLICATION_METHOD + VOLUME_PER_PLANT +
// INSTRUCTIONS all become visible.
const ADVISORY_ONLY_HIDDEN_ELEMENT_TYPES = new Set<string>([
  // v1.9: COMMON_NAME now surfaced via composeChemistryIdentifier
  // subheader — hide from bullet list to avoid duplication.
  'COMMON_NAME',
  'FORMULATION',
  'FORMULATION_AI_CONC',
  'AI_CONCENTRATION',
  'N_DOSAGE',
  'P_DOSAGE',
  'K_DOSAGE',
  'UNIT',
  'FERTIGATION_INTERVAL',
  'IRRIGATION_INTERVAL',
  'REPEAT_INTERVAL',
  'NUMBER_OF_APPLICATIONS',
])

// v1.9 helper — cascade-sourced elements (COMMON_NAME etc.) carry
// the friendly name in cosh_ref, not value. See canonical
// elementDisplay comment in app/advisory/[subscriptionId]/page.tsx.
function elementDisplay(el: ElementRow | undefined): string {
  if (!el) return ''
  const v = (el.value ?? '').toString().trim()
  if (v) return v
  const ref = (el.cosh_ref ?? '').toString().trim()
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
function composeChemistryIdentifier(elements: ElementRow[]): string | null {
  const byType = (t: string) =>
    elements.find(e => (e.element_type || '').toUpperCase() === t)
  const cnStr = elementDisplay(byType('COMMON_NAME'))
  const aiStr = elementDisplay(byType('AI_CONCENTRATION'))
  const fmtRaw = elementDisplay(byType('FORMULATION'))
  const fmtStr = fmtRaw ? formulationAcronym(fmtRaw) : ''
  const combinedStr = elementDisplay(byType('FORMULATION_AI_CONC'))
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

function renderElements(
  elements: ElementRow[],
  isPurchased: boolean,
  elementLabel: (et: string) => string,
  advisoryOnly = false,
): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  for (const e of elements) {
    const type = (e.element_type || '').toUpperCase()
    if (advisoryOnly) {
      if (ADVISORY_ONLY_HIDDEN_ELEMENT_TYPES.has(type)) continue
    } else {
      if (FARMER_HIDDEN_ELEMENT_TYPES.has(type)) continue
      if (!isPurchased && POST_PURCHASE_ONLY_ELEMENT_TYPES.has(type)) continue
    }
    const valueStr = (e.value ?? '').toString()
    if (!valueStr) continue
    if (type.endsWith('_UNIT')) {
      const prev = out[out.length - 1]
      if (prev) prev.value = `${prev.value} ${valueStr}`
      continue
    }
    const label = elementLabel(type)
    const value = isUuid(valueStr) ? '' : valueStr
    if (!value) continue
    out.push({ label, value })
  }
  return out
}

// 2026-11-28 — Next.js 16 requires useSearchParams() inside a
// Suspense boundary during prerender. Wrap the content component
// so the params-dependent back-nav works at build-time.
export default function DealerFarmerAdvisoryPage() {
  return (
    <Suspense fallback={null}>
      <DealerFarmerAdvisoryContent />
    </Suspense>
  )
}

function DealerFarmerAdvisoryContent() {
  const router = useRouter()
  const t = useTranslations('dealer.promotedFarmers.detail')
  const tEl = useTranslations('practice.element')
  const locale = useLocale()
  const elementLabel = (et: string) => tEl.has(et) ? tEl(et) : humanize(et)
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  // Contextual back. When the user lands here via the Alerts page's
  // "View advisory →" tap-through, we pass ?from=alerts so the back
  // arrow returns to /alerts-incoming instead of the default
  // /promoted-farmers list. Any other entry (My Farmers tile,
  // direct URL, etc.) keeps the default back.
  const searchParams = useSearchParams()
  const backHref = searchParams.get('from') === 'alerts'
    ? '/dealer/alerts-incoming'
    : '/dealer/promoted-farmers'
  const [day, setDay] = useState<AdvisoryDay | null>(null)
  const [loading, setLoading] = useState(true)
  const [errCode, setErrCode] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  // 2026-11-28 — Previous / Today / Next day navigation. `dayOffset=0`
  // is today; negative = past days, positive = future. Translated to
  // a for_date ISO string before being sent to the backend. The
  // backend added for_date on the same day; defaults to today when
  // omitted so back-compat holds.
  const [dayOffset, setDayOffset] = useState<number>(0)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // 2026-11-28 — Only trigger full-page spinner on the INITIAL
    // load (day === null). On subsequent fetches (day-nav clicks)
    // keep the stale day visible so the nav stays on screen and
    // the user can tell the click registered (the data swaps in
    // when the new fetch returns).
    if (day === null) setLoading(true)
    const params = new URLSearchParams()
    if (dayOffset !== 0) {
      const d = new Date()
      d.setDate(d.getDate() + dayOffset)
      params.set('for_date', d.toISOString().slice(0, 10))
    }
    const qs = params.toString()
    const url = `/promoter/assignments/${subscriptionId}/today${qs ? `?${qs}` : ''}`
    api.get<AdvisoryDay>(url)
      .then(r => { setDay(r.data); setErrCode(null); setErrMsg(null) })
      .catch((e: unknown) => {
        const err = e as { response?: { status?: number; data?: { detail?: { code?: string; message?: string } | string } } }
        const status = err?.response?.status
        const detail = err?.response?.data?.detail
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
    // Intentionally omit `day` from the dep array — it would re-fire
    // the effect on every setDay(), causing an infinite loop. The
    // day === null check inside reads the latest value correctly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, subscriptionId, t, dayOffset])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={t('headerTitle')} activeRole="DEALER" back={backHref} />
        <div className="pt-16 px-4 max-w-lg mx-auto">
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-[#DDD0B8] border-t-[#7D4196] rounded-full animate-spin" />
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
        <PWAHeader title={t('headerTitle')} activeRole="DEALER" back={backHref} />
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
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back={backHref} />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        <div className="mt-3 mb-3 rounded-xl border border-[#DDD0B8] bg-white px-3 py-2 text-[11px] text-[#7A8C7E] text-center">
          {t('readOnlyHint')}
        </div>

        <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 mb-4">
          <p className="text-lg font-bold text-[#6B3F1F]">
            {cropDisplayName(day.crop_cosh_id)}
          </p>
          {day.reference_number && (
            <p className="text-xs font-mono text-[#7A8C7E] mt-1">{day.reference_number}</p>
          )}
          <p className="text-xs text-[#7A8C7E] mt-2">
            {t('dayHeader', { day: day.day_offset, count: day.timelines.length })}
          </p>
          {/* 2026-11-28 — Previous / Today / Next day navigation. Mirrors
              the farmer's own advisory nav affordance so the promoter can
              walk the farmer forward ("Day 15 — next, you'll need…") or
              back ("Yesterday's advisory said…"). Today button disabled
              when already on today. */}
          <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-[#DDD0B8]">
            <button
              type="button"
              onClick={() => setDayOffset(o => o - 1)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full border border-[#DDD0B8] text-[#6B3F1F] hover:bg-[#F5F0E8]">
              ← {t('dayPrev')}
            </button>
            <button
              type="button"
              onClick={() => setDayOffset(0)}
              disabled={dayOffset === 0}
              className="text-xs font-semibold px-3 py-1.5 rounded-full border text-[#6B3F1F] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ borderColor: COLOUR + '66', background: dayOffset === 0 ? COLOUR + '10' : '#fff' }}>
              {t('dayToday')}
            </button>
            <button
              type="button"
              onClick={() => setDayOffset(o => o + 1)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full border border-[#DDD0B8] text-[#6B3F1F] hover:bg-[#F5F0E8]">
              {t('dayNext')} →
            </button>
          </div>
        </div>

        {day.timelines.length === 0 ? (
          <div className="rounded-2xl border border-[#DDD0B8] bg-white p-5 text-center">
            <p className="text-sm text-[#7A8C7E]">
              {t('noneToday')}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {day.timelines.map(tl => (
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
                  {tl.practices.length === 0 ? (
                    <p className="text-xs text-[#7A8C7E] py-3 text-center">
                      {t('noPracticeToday')}
                    </p>
                  ) : tl.practices.map(p => {
                    const rows = renderElements(
                      p.elements, !!p.is_purchased, elementLabel,
                      !!day?.advisory_only_mode,
                    )
                    const l2Label = p.l2_name_loc || (p.l2_type ? humanize(p.l2_type) : null)
                    // v1.9 — Common Name AI% Formulation identifier
                    // for chemical L2s, sits above the elements list.
                    const chemistryLine = composeChemistryIdentifier(p.elements)
                    return (
                      <div key={p.id}
                        className="rounded-xl border border-[#DDD0B8] overflow-hidden">
                        <div className="px-3 py-2 text-white text-[11px] font-semibold uppercase tracking-wide"
                          style={{ background: L0_BG[p.l0_type] || '#7A8C7E' }}>
                          {l2Label}
                        </div>
                        <div className="p-3 text-sm">
                          {/* 2026-11-28 — Chips row at the TOP of the
                              card (moved from bottom per user feedback
                              to match the facilitator layout). Promoter
                              scanning the day's practices answers
                              "which of these has the farmer already
                              handled?" at a glance. */}
                          {(p.l0_type === 'INPUT' || p.frequency_days != null) && (
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {p.l0_type === 'INPUT' && (
                                (p.is_purchased || p.purchased_at) ? (
                                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-medium">
                                    {t('farmerPurchased')}
                                    {p.purchased_at && (
                                      <span className="opacity-80"> · {fmtDate(p.purchased_at, locale)}</span>
                                    )}
                                    {(p.purchased_brand_name || p.purchased_brand_text || p.fulfilment?.brand_name) && (
                                      <span className="opacity-80">
                                        {' · '}
                                        {p.purchased_brand_name || p.purchased_brand_text || p.fulfilment?.brand_name}
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-stone-100 border border-stone-200 text-stone-600 font-medium">
                                    {t('purchasePending')}
                                  </span>
                                )
                              )}
                              {p.frequency_days != null && (
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-[#7A8C7E]">
                                  {t('frequencyEvery', { count: p.frequency_days })}
                                  {p.is_frequency_due_today === false && t('frequencyNotDueToday')}
                                </span>
                              )}
                            </div>
                          )}
                          {chemistryLine && (
                            <p className="text-sm font-bold text-[#6B3F1F] mb-2">
                              {chemistryLine}
                            </p>
                          )}
                          {/* 2026-06-12 — Approved fulfilment brand
                              strip (dealer-delivered brand). Still
                              rendered below chemistry — this is the
                              "what you actually have in hand" surface
                              for the ordering flow. */}
                          {p.fulfilment?.status === 'APPROVED' && p.fulfilment?.brand_name && (
                            <div className="-mx-3 -mt-2 mb-3 px-3 py-2 border-b border-purple-100 bg-purple-50/40">
                              <p className="text-sm font-bold text-purple-900 truncate">{p.fulfilment.brand_name}</p>
                              {p.fulfilment.manufacturer_name && (
                                <p className="text-[11px] text-purple-800">by {p.fulfilment.manufacturer_name}</p>
                              )}
                            </div>
                          )}
                          {rows.length === 0 ? (
                            <p className="text-[#7A8C7E] text-xs">{t('noSpecificInstructions')}</p>
                          ) : (
                            <dl className="space-y-1.5">
                              {rows.map((r, i) => (
                                <div key={i} className="flex justify-between gap-3 text-[13px]">
                                  <dt className="text-[#7A8C7E] shrink-0">{r.label}</dt>
                                  <dd className="text-[#6B3F1F] font-medium text-right">{r.value}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
