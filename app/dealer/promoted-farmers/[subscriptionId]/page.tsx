'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

const COLOUR = '#085041'

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
  timelines: TimelineItem[]
}

const L0_BG: Record<string, string> = {
  INPUT: '#5B7BA8',
  NON_INPUT: '#8B6FA8',
  INSTRUCTION: '#B58A4A',
  MEDIA: '#A85F76',
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}
function timelineDateLabel(from: string | null, to: string | null, todayLabel: string): string {
  if (!from && !to) return todayLabel
  if (from && to && from !== to) return `${fmtDate(from)} – ${fmtDate(to)}`
  return fmtDate((to || from)!)
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
])

const POST_PURCHASE_ONLY_ELEMENT_TYPES = new Set<string>([
  'APPLICATION_METHOD',
  'DOSAGE',
  'VOLUME_PER_PLANT',
  'INSTRUCTIONS',
])

function renderElements(
  elements: ElementRow[],
  isPurchased: boolean,
): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  for (const e of elements) {
    const type = (e.element_type || '').toUpperCase()
    if (FARMER_HIDDEN_ELEMENT_TYPES.has(type)) continue
    if (!isPurchased && POST_PURCHASE_ONLY_ELEMENT_TYPES.has(type)) continue
    const valueStr = (e.value ?? '').toString()
    if (!valueStr) continue
    if (type.endsWith('_UNIT')) {
      const prev = out[out.length - 1]
      if (prev) prev.value = `${prev.value} ${valueStr}`
      continue
    }
    const label = humanize(type)
    const value = isUuid(valueStr) ? '' : valueStr
    if (!value) continue
    out.push({ label, value })
  }
  return out
}

export default function DealerFarmerAdvisoryPage() {
  const router = useRouter()
  const t = useTranslations('dealer.promotedFarmers.detail')
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const [day, setDay] = useState<AdvisoryDay | null>(null)
  const [loading, setLoading] = useState(true)
  const [errCode, setErrCode] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<AdvisoryDay>(`/promoter/assignments/${subscriptionId}/today`)
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
  }, [router, subscriptionId, t])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/promoted-farmers" />
        <div className="pt-16 px-4 max-w-lg mx-auto">
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-[#DDD0B8] border-t-[#085041] rounded-full animate-spin" />
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
        <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/promoted-farmers" />
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
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/promoted-farmers" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        <div className="mt-3 mb-3 rounded-xl border border-[#DDD0B8] bg-white px-3 py-2 text-[11px] text-[#7A8C7E] text-center">
          {t('readOnlyHint')}
        </div>

        <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 mb-4">
          <p className="text-lg font-bold text-[#6B3F1F]">
            {cropDisplayName(day.crop_cosh_id)}
          </p>
          <p className="text-sm text-[#7A8C7E] mt-0.5">{day.package_name}</p>
          {day.reference_number && (
            <p className="text-xs font-mono text-[#7A8C7E] mt-1">{day.reference_number}</p>
          )}
          <p className="text-xs text-[#7A8C7E] mt-2">
            {t('dayHeader', { day: day.day_offset, count: day.timelines.length })}
          </p>
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
                      {timelineDateLabel(tl.from_date, tl.to_date, t('todayLabel'))}
                    </span>
                  </div>
                </div>

                <div className="p-3 space-y-3">
                  {tl.practices.length === 0 ? (
                    <p className="text-xs text-[#7A8C7E] py-3 text-center">
                      {t('noPracticeToday')}
                    </p>
                  ) : tl.practices.map(p => {
                    const rows = renderElements(p.elements, !!p.is_purchased)
                    const l2Label = p.l2_name_loc || (p.l2_type ? humanize(p.l2_type) : null)
                    return (
                      <div key={p.id}
                        className="rounded-xl border border-[#DDD0B8] overflow-hidden">
                        <div className="px-3 py-2 text-white text-[11px] font-semibold uppercase tracking-wide"
                          style={{ background: L0_BG[p.l0_type] || '#7A8C7E' }}>
                          {l2Label}
                        </div>
                        <div className="p-3 text-sm">
                          {/* 2026-06-12 — When the farmer has purchased
                              this input, surface the brand + manufacturer
                              the dealer actually delivered. Promoter
                              needs this to speak to the farmer about
                              their actual product ("use this, use
                              that"). Matches the farmer's
                              PurchasedSummary block on /advisory. */}
                          {p.fulfilment?.status === 'APPROVED' && p.fulfilment?.brand_name && (
                            <div className="-mx-3 -mt-3 mb-3 px-3 py-2 border-b border-emerald-100 bg-emerald-50/40">
                              <p className="text-sm font-bold text-emerald-900 truncate">{p.fulfilment.brand_name}</p>
                              {p.fulfilment.manufacturer_name && (
                                <p className="text-[11px] text-emerald-800">by {p.fulfilment.manufacturer_name}</p>
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

                          <div className="flex flex-wrap gap-1.5 mt-2.5">
                            {p.l0_type === 'INPUT' && (
                              p.is_purchased ? (
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-green-800 font-medium">
                                  {t('farmerPurchased')}
                                </span>
                              ) : (
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-900 font-medium">
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
