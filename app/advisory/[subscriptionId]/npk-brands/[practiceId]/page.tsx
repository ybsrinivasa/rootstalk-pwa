/*
 * Advisory-Only Mode — NPK Brands screen for CHEMICAL_FERTILIZERS_NPK_DOSAGES
 * and FERTIGATION_NPK_DOSAGES practices (2026-10-30).
 *
 * The regular /brands/[practiceId] screen looks up a COMMON_NAME on
 * the practice to pull brands. NPK dosage practices have no COMMON_NAME
 * — the SE authored elemental N / P / K kg rather than a specific
 * product — so that path returns an empty list. This screen replaces
 * it: it calls `/farmer/subscriptions/{sid}/practices/{pid}/npk-brands`
 * to get the ranked Mixed candidates + enabled Straights for the
 * required dose, then per-common-name fetches `/npk-trade-names` to
 * show branded options.
 *
 * No purchase ack flow here — the "I've purchased this" tap on the
 * practice card stays as the single purchase moment (same behaviour
 * as other Advisory-Only screens). This is browse + reference only.
 */
'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'


interface NPKMixed {
  cosh_id: string
  name: string
  n: number; p: number; k: number
  kg_product: number
  delivered: { n: number; p: number; k: number }
  match_target: 'N' | 'P' | 'K'
  total_delivered: number
}
interface NPKStraight {
  cosh_id: string
  name: string
  n: number; p: number; k: number
  class: 'STRAIGHT_N' | 'STRAIGHT_P' | 'STRAIGHT_K' | 'MIXED'
  water_soluble: boolean
}
interface NPKOptions {
  is_npk_practice: boolean
  fertigation: boolean
  required_dose: { n: number; p: number; k: number } | null
  ranked_mixed: NPKMixed[]
  enabled_straights: NPKStraight[]
  gap: { n: number; p: number; k: number } | null
}
interface NPKTradeName {
  cosh_id: string
  name: string
  manufacturer_cosh_id: string | null
}
interface NPKTradeNamesResponse {
  common_name_cosh_id: string
  fertigation: boolean
  trade_names: NPKTradeName[]
}


function fmt(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '0'
  if (v === Math.trunc(v)) return String(v)
  return v.toFixed(2).replace(/\.?0+$/, '')
}

function nutrientsOnlyLine(n: number, p: number, k: number): string {
  const parts: string[] = []
  if (n > 0) parts.push(`N ${fmt(n)}`)
  if (p > 0) parts.push(`P ${fmt(p)}`)
  if (k > 0) parts.push(`K ${fmt(k)}`)
  return parts.join(', ')
}


export default function NpkBrandsPage() {
  const router = useRouter()
  const params = useParams<{ subscriptionId: string; practiceId: string }>()
  const subscriptionId = params?.subscriptionId as string
  const practiceId = params?.practiceId as string

  const [data, setData] = useState<NPKOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Selected Mixed (optional — farmer may skip Mixed and go straight to Straights).
  const [pickedMixedCoshId, setPickedMixedCoshId] = useState<string | null>(null)

  // Common name currently showing trade-name options (null = none expanded).
  // Keyed by common_name cosh_id so Mixed + Straight rows don't collide.
  const [tradeNamesFor, setTradeNamesFor] = useState<string | null>(null)
  const [tradeNamesLoading, setTradeNamesLoading] = useState(false)
  const [tradeNames, setTradeNames] = useState<NPKTradeName[]>([])

  const load = useCallback(
    async (nextPickedMixedCoshId: string | null) => {
      try {
        setLoading(true)
        const qs = nextPickedMixedCoshId
          ? `?picked_mixed_cosh_id=${encodeURIComponent(nextPickedMixedCoshId)}`
          : ''
        const r = await api.get<NPKOptions>(
          `/farmer/subscriptions/${subscriptionId}/practices/${practiceId}/npk-brands${qs}`,
        )
        setData(r.data)
      } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: { message?: string } | string } } }
        const detail = err?.response?.data?.detail
        const msg = typeof detail === 'object' ? detail?.message : (detail as string)
        setError(msg || 'Could not load options. Please go back and try again.')
      } finally {
        setLoading(false)
      }
    },
    [subscriptionId, practiceId],
  )

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load(null)
    // Only on mount. Mixed pick triggers reload via its own handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptionId, practiceId])

  async function handlePickMixed(cand: NPKMixed) {
    // Toggle: if already picked, unpick (back to full-dose Straights).
    const nextPick = pickedMixedCoshId === cand.cosh_id ? null : cand.cosh_id
    setPickedMixedCoshId(nextPick)
    setTradeNamesFor(null)
    setTradeNames([])
    await load(nextPick)
  }

  async function handleShowBrands(commonNameCoshId: string) {
    if (tradeNamesFor === commonNameCoshId) {
      // Collapse.
      setTradeNamesFor(null)
      setTradeNames([])
      return
    }
    setTradeNamesFor(commonNameCoshId)
    setTradeNames([])
    setTradeNamesLoading(true)
    try {
      const r = await api.get<NPKTradeNamesResponse>(
        `/farmer/subscriptions/${subscriptionId}/practices/${practiceId}/npk-trade-names`
        + `?common_name_cosh_id=${encodeURIComponent(commonNameCoshId)}`,
      )
      setTradeNames(r.data.trade_names || [])
    } catch {
      setTradeNames([])
    } finally {
      setTradeNamesLoading(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-[#FDF6E3] pb-24">
        <PWAHeader />
        <div className="px-5 pt-5 text-sm text-[#7A8C7E]">Loading…</div>
        <BottomNav />
      </div>
    )
  }
  if (error && !data) {
    return (
      <div className="min-h-screen bg-[#FDF6E3] pb-24">
        <PWAHeader />
        <div className="px-5 pt-5">
          <button onClick={() => router.back()}
            className="text-xs text-slate-600 mb-4">← Back</button>
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {error}
          </p>
        </div>
        <BottomNav />
      </div>
    )
  }
  if (!data) return null

  const dose = data.required_dose
  const gap = data.gap

  return (
    <div className="min-h-screen bg-[#FDF6E3] pb-24">
      <PWAHeader />
      <div className="px-5 pt-5">
        <button onClick={() => router.back()}
          className="text-xs text-slate-600 mb-4">← Back</button>

        {/* Required dose header card */}
        {dose && (
          <div className="bg-white border border-[#DDD0B8] rounded-2xl px-4 py-3 mb-4">
            <p className="text-[11px] uppercase tracking-wider text-[#7A8C7E] font-medium">
              {data.fertigation ? 'Fertigation NPK dosage' : 'Chemical NPK dosage'}
            </p>
            <p className="text-base font-semibold text-[#6B3F1F] mt-1">
              {nutrientsOnlyLine(dose.n, dose.p, dose.k) || '—'}
            </p>
            <p className="text-[11px] text-[#7A8C7E] mt-1">
              Pick a mixed fertilizer below (optional). The straights panel then
              shows what you still need for the remaining gap.
            </p>
          </div>
        )}

        {/* Mixed candidates */}
        {data.ranked_mixed.length > 0 && (
          <div className="mb-5">
            <p className="text-[11px] uppercase tracking-wider text-[#7A8C7E] font-semibold mb-2">
              Mixed fertilizers {data.fertigation ? '(water-soluble)' : ''}
            </p>
            <div className="bg-white rounded-2xl border border-[#DDD0B8] overflow-hidden">
              {data.ranked_mixed.map((m, idx) => {
                const picked = pickedMixedCoshId === m.cosh_id
                return (
                  <div key={m.cosh_id}
                    className={`px-4 py-3 ${idx > 0 ? 'border-t border-[#EEE4D2]' : ''} ${picked ? 'bg-emerald-50' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[#6B3F1F]">{m.name}</p>
                        <p className="text-xs text-[#7A8C7E] mt-0.5">
                          {nutrientsOnlyLine(m.n, m.p, m.k)}
                        </p>
                        <p className="text-xs text-[#4A3528] mt-1">
                          Delivers: {nutrientsOnlyLine(m.delivered.n, m.delivered.p, m.delivered.k)}
                          {' · '}~{fmt(m.kg_product)} kg of product
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button onClick={() => handlePickMixed(m)}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${
                            picked
                              ? 'bg-emerald-600 border-emerald-700 text-white'
                              : 'bg-white border-slate-300 text-slate-700'
                          }`}>
                          {picked ? 'Picked' : 'Pick'}
                        </button>
                        <button onClick={() => handleShowBrands(m.cosh_id)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-100 text-purple-800 border border-purple-200">
                          {tradeNamesFor === m.cosh_id ? 'Hide brands' : 'Brands'}
                        </button>
                      </div>
                    </div>
                    {tradeNamesFor === m.cosh_id && (
                      <BrandList rows={tradeNames} loading={tradeNamesLoading} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Straights for the remaining gap */}
        {data.enabled_straights.length > 0 && (
          <div className="mb-5">
            <p className="text-[11px] uppercase tracking-wider text-[#7A8C7E] font-semibold mb-2">
              Straight fertilizers {gap && (gap.n > 0 || gap.p > 0 || gap.k > 0)
                ? ` (for gap: ${nutrientsOnlyLine(gap.n, gap.p, gap.k) || '—'})`
                : ''}
            </p>
            <div className="bg-white rounded-2xl border border-[#DDD0B8] overflow-hidden">
              {data.enabled_straights.map((s, idx) => (
                <div key={s.cosh_id}
                  className={`px-4 py-3 ${idx > 0 ? 'border-t border-[#EEE4D2]' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[#6B3F1F]">{s.name}</p>
                      <p className="text-xs text-[#7A8C7E] mt-0.5">
                        {nutrientsOnlyLine(s.n, s.p, s.k)}
                        {s.water_soluble ? ' · water-soluble' : ''}
                      </p>
                    </div>
                    <button onClick={() => handleShowBrands(s.cosh_id)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-100 text-purple-800 border border-purple-200 shrink-0">
                      {tradeNamesFor === s.cosh_id ? 'Hide brands' : 'Brands'}
                    </button>
                  </div>
                  {tradeNamesFor === s.cosh_id && (
                    <BrandList rows={tradeNames} loading={tradeNamesLoading} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {data.ranked_mixed.length === 0 && data.enabled_straights.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-sm text-amber-800">
              No fertilizer options available for this dosage right now. Ask
              your dealer which product combinations will deliver this NPK.
            </p>
          </div>
        )}

        <p className="text-[11px] text-[#7A8C7E] mt-5 leading-relaxed">
          Advisories are suggestions. Local availability and your soil may
          influence the final choice. Any fertilizer that delivers the required
          NPK dose will work.
        </p>
      </div>
      <BottomNav />
    </div>
  )
}

function BrandList({ rows, loading }: {
  rows: NPKTradeName[]
  loading: boolean
}) {
  return (
    <div className="mt-3 pl-3 border-l-2 border-purple-200">
      {loading ? (
        <p className="text-xs text-[#7A8C7E] py-1">Loading brands…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[#7A8C7E] py-1">
          No brands found for this common name. Ask your dealer.
        </p>
      ) : (
        <ul className="space-y-1 py-1">
          {rows.map(tn => (
            <li key={tn.cosh_id} className="text-sm text-[#4A3528]">
              {tn.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
