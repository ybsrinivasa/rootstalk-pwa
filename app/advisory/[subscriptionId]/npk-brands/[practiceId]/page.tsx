/*
 * Advisory-Only Mode — NPK Brands screen for CHEMICAL_FERTILIZERS_NPK_DOSAGES
 * and FERTIGATION_NPK_DOSAGES practices.
 *
 * UX architecture (2026-10-30 refinement):
 *   The screen uses a route picker — farmer chooses between "Mixed
 *   fertilizer" (pick one complex, top up any gap with straights) or
 *   "Straight fertilizers only" (buy pure N/P/K separately). Each
 *   route hides the irrelevant section; a "Change choice" button at
 *   the top returns to the landing picker.
 *
 *   The Mixed route is hidden when:
 *     - Only one nutrient has dose > 0 (a Mixed is never valid when
 *       there's a single-nutrient target; `rank_mixed` returns [] in
 *       that case anyway — the hide is defensive clarity).
 *     - `ranked_mixed` comes back empty for any other reason.
 *   The Straights route is hidden when enabled_straights is empty.
 *   If only one route is available, it is auto-selected (no picker).
 *
 * Each straight row shows the kg needed to close the gap for its one
 * nutrient (backend's `kg_product_needed`, computed from the live gap)
 * so the farmer sees a concrete shopping list, not just a candidate
 * list.
 */
'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
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
  kg_product_needed: number | null
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

type Route = 'initial' | 'mixed' | 'straights'


function fmt(v: number): string {
  if (!Number.isFinite(v)) return '0'
  if (v === 0) return '0'
  if (v === Math.trunc(v)) return String(v)
  return v.toFixed(2).replace(/\.?0+$/, '')
}

function nutrientsLine(n: number, p: number, k: number): string {
  const parts: string[] = []
  if (n > 0) parts.push(`N ${fmt(n)}`)
  if (p > 0) parts.push(`P ${fmt(p)}`)
  if (k > 0) parts.push(`K ${fmt(k)}`)
  return parts.join(', ')
}

function countNonZero(d: { n: number; p: number; k: number } | null): number {
  if (!d) return 0
  return (d.n > 0 ? 1 : 0) + (d.p > 0 ? 1 : 0) + (d.k > 0 ? 1 : 0)
}


export default function NpkBrandsPage() {
  const router = useRouter()
  const params = useParams<{ subscriptionId: string; practiceId: string }>()
  const subscriptionId = params?.subscriptionId as string
  const practiceId = params?.practiceId as string

  const [data, setData] = useState<NPKOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [route, setRoute] = useState<Route>('initial')
  const [pickedMixedCoshId, setPickedMixedCoshId] = useState<string | null>(null)

  // Brands drilldown — common_name cosh_id currently expanded (null = none).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptionId, practiceId])

  // Route availability — derived from backend response.
  const dose = data?.required_dose || null
  const singleNutrientDose = countNonZero(dose) <= 1
  const mixedRouteAvailable = useMemo(
    () => !!data && !singleNutrientDose && data.ranked_mixed.length > 0,
    [data, singleNutrientDose],
  )
  const straightsRouteAvailable = useMemo(
    () => !!data && data.enabled_straights.length > 0,
    [data],
  )

  // Auto-select the only available route (so landing isn't a one-card
  // picker that reads like a dead-end).
  useEffect(() => {
    if (!data || route !== 'initial') return
    if (mixedRouteAvailable && !straightsRouteAvailable) setRoute('mixed')
    else if (!mixedRouteAvailable && straightsRouteAvailable) setRoute('straights')
  }, [data, mixedRouteAvailable, straightsRouteAvailable, route])

  async function handlePickMixed(cand: NPKMixed) {
    const nextPick = pickedMixedCoshId === cand.cosh_id ? null : cand.cosh_id
    setPickedMixedCoshId(nextPick)
    setTradeNamesFor(null)
    setTradeNames([])
    await load(nextPick)
  }

  async function handleShowBrands(commonNameCoshId: string) {
    if (tradeNamesFor === commonNameCoshId) {
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

  async function handleChangeChoice() {
    setRoute('initial')
    setPickedMixedCoshId(null)
    setTradeNamesFor(null)
    setTradeNames([])
    await load(null)
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

  const gap = data.gap
  const gapAllZero = !!gap && gap.n === 0 && gap.p === 0 && gap.k === 0
  const bothRoutesAvailable = mixedRouteAvailable && straightsRouteAvailable
  const pickedMixedCand = pickedMixedCoshId
    ? data.ranked_mixed.find(m => m.cosh_id === pickedMixedCoshId) || null
    : null

  return (
    <div className="min-h-screen bg-[#FDF6E3] pb-24">
      <PWAHeader />
      <div className="px-5 pt-5">
        <button onClick={() => router.back()}
          className="text-xs text-slate-600 mb-4">← Back</button>

        {/* Dose header */}
        {dose && (
          <div className="bg-white border border-[#DDD0B8] rounded-2xl px-4 py-3 mb-4">
            <p className="text-[11px] uppercase tracking-wider text-[#7A8C7E] font-medium">
              {data.fertigation ? 'Fertigation NPK dosage' : 'Chemical NPK dosage'}
            </p>
            <p className="text-base font-semibold text-[#6B3F1F] mt-1">
              {nutrientsLine(dose.n, dose.p, dose.k) || '—'}
            </p>
          </div>
        )}

        {/* Change choice (only if both routes are an option) */}
        {route !== 'initial' && bothRoutesAvailable && (
          <button onClick={handleChangeChoice}
            className="text-xs font-medium text-slate-600 mb-4 underline">
            ← Change choice
          </button>
        )}

        {/* Route picker — both routes available */}
        {route === 'initial' && bothRoutesAvailable && (
          <>
            <p className="text-sm font-semibold text-[#4A3528] mb-3">
              How would you like to buy?
            </p>
            <button onClick={() => setRoute('mixed')}
              className="w-full text-left bg-white border border-[#DDD0B8] rounded-2xl px-4 py-4 mb-3 hover:border-emerald-500">
              <p className="text-base font-semibold text-[#6B3F1F]">
                Mixed fertilizer
              </p>
              <p className="text-xs text-[#7A8C7E] mt-1 leading-relaxed">
                Pick one complex (like NPK 10:14:34) and top up any gap with
                straight fertilizers.
              </p>
            </button>
            <button onClick={() => setRoute('straights')}
              className="w-full text-left bg-white border border-[#DDD0B8] rounded-2xl px-4 py-4 hover:border-emerald-500">
              <p className="text-base font-semibold text-[#6B3F1F]">
                Straight fertilizers only
              </p>
              <p className="text-xs text-[#7A8C7E] mt-1 leading-relaxed">
                Buy pure N, P, K fertilizers separately.
              </p>
            </button>
          </>
        )}

        {/* Neither route — show a friendly dead-end */}
        {route === 'initial' && !bothRoutesAvailable
          && !mixedRouteAvailable && !straightsRouteAvailable && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-sm text-amber-800">
              No fertilizer options available for this dosage right now. Ask
              your dealer which product combinations will deliver this NPK.
            </p>
          </div>
        )}

        {/* Mixed route */}
        {route === 'mixed' && (
          <>
            {!pickedMixedCand && (
              <>
                <p className="text-[11px] uppercase tracking-wider text-[#7A8C7E] font-semibold mb-2">
                  Mixed fertilizers {data.fertigation ? '(water-soluble)' : ''}
                </p>
                <div className="bg-white rounded-2xl border border-[#DDD0B8] overflow-hidden">
                  {data.ranked_mixed.map((m, idx) => (
                    <div key={m.cosh_id}
                      className={`px-4 py-3 ${idx > 0 ? 'border-t border-[#EEE4D2]' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[#6B3F1F]">{m.name}</p>
                          <p className="text-xs text-[#7A8C7E] mt-0.5">
                            {nutrientsLine(m.n, m.p, m.k)}
                          </p>
                          <p className="text-xs text-[#4A3528] mt-1">
                            Delivers {nutrientsLine(m.delivered.n, m.delivered.p, m.delivered.k)}
                            {' · '}~{fmt(m.kg_product)} kg of product
                          </p>
                        </div>
                        <div className="flex flex-col gap-1.5 shrink-0">
                          <button onClick={() => handlePickMixed(m)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 border border-emerald-700 text-white">
                            Pick
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
                  ))}
                </div>
              </>
            )}

            {pickedMixedCand && (
              <>
                <p className="text-[11px] uppercase tracking-wider text-[#7A8C7E] font-semibold mb-2">
                  Your pick
                </p>
                <div className="bg-emerald-50 border border-emerald-300 rounded-2xl px-4 py-3 mb-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[#6B3F1F]">
                        ✓ {pickedMixedCand.name}
                      </p>
                      <p className="text-xs text-[#4A3528] mt-1">
                        Delivers {nutrientsLine(
                          pickedMixedCand.delivered.n,
                          pickedMixedCand.delivered.p,
                          pickedMixedCand.delivered.k,
                        )}
                        {' · '}~{fmt(pickedMixedCand.kg_product)} kg of product
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button onClick={() => handlePickMixed(pickedMixedCand)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700">
                        Change pick
                      </button>
                      <button onClick={() => handleShowBrands(pickedMixedCand.cosh_id)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-100 text-purple-800 border border-purple-200">
                        {tradeNamesFor === pickedMixedCand.cosh_id ? 'Hide brands' : 'Brands'}
                      </button>
                    </div>
                  </div>
                  {tradeNamesFor === pickedMixedCand.cosh_id && (
                    <BrandList rows={tradeNames} loading={tradeNamesLoading} />
                  )}
                </div>

                {gapAllZero ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                    <p className="text-sm text-emerald-800">
                      ✓ This mixed covers your full dose. No straights needed.
                    </p>
                  </div>
                ) : (
                  <StraightsByNutrient
                    straights={data.enabled_straights}
                    gap={gap}
                    headerLabel="Top up with straight fertilizers"
                    tradeNamesFor={tradeNamesFor}
                    tradeNames={tradeNames}
                    tradeNamesLoading={tradeNamesLoading}
                    onShowBrands={handleShowBrands}
                  />
                )}
              </>
            )}
          </>
        )}

        {/* Straights route (no Mixed in the picture) */}
        {route === 'straights' && (
          <StraightsByNutrient
            straights={data.enabled_straights}
            gap={gap}
            headerLabel="Straight fertilizers for your full dose"
            tradeNamesFor={tradeNamesFor}
            tradeNames={tradeNames}
            tradeNamesLoading={tradeNamesLoading}
            onShowBrands={handleShowBrands}
          />
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

function StraightsByNutrient({
  straights, gap, headerLabel, tradeNamesFor, tradeNames, tradeNamesLoading,
  onShowBrands,
}: {
  straights: NPKStraight[]
  gap: { n: number; p: number; k: number } | null
  headerLabel: string
  tradeNamesFor: string | null
  tradeNames: NPKTradeName[]
  tradeNamesLoading: boolean
  onShowBrands: (coshId: string) => void
}) {
  if (!gap) return null
  // Group by nutrient target. Skip nutrients with gap = 0.
  const groups: {
    letter: 'N' | 'P' | 'K'
    label: string
    gapValue: number
    straightClass: 'STRAIGHT_N' | 'STRAIGHT_P' | 'STRAIGHT_K'
    rows: NPKStraight[]
  }[] = []
  if (gap.n > 0) {
    groups.push({
      letter: 'N', label: 'Nitrogen (N)', gapValue: gap.n,
      straightClass: 'STRAIGHT_N',
      rows: straights.filter(s => s.class === 'STRAIGHT_N'),
    })
  }
  if (gap.p > 0) {
    groups.push({
      letter: 'P', label: 'Phosphorus (P)', gapValue: gap.p,
      straightClass: 'STRAIGHT_P',
      rows: straights.filter(s => s.class === 'STRAIGHT_P'),
    })
  }
  if (gap.k > 0) {
    groups.push({
      letter: 'K', label: 'Potassium (K)', gapValue: gap.k,
      straightClass: 'STRAIGHT_K',
      rows: straights.filter(s => s.class === 'STRAIGHT_K'),
    })
  }
  if (groups.length === 0) return null
  return (
    <>
      <p className="text-[11px] uppercase tracking-wider text-[#7A8C7E] font-semibold mb-2">
        {headerLabel}
      </p>
      <div className="space-y-4">
        {groups.map(g => (
          <div key={g.letter}>
            <p className="text-xs text-[#4A3528] mb-1 font-medium">
              For {g.label} — need {fmt(g.gapValue)} kg
            </p>
            {g.rows.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                <p className="text-xs text-amber-800">
                  No {g.label} straight fertilizer available in the catalog.
                  Ask your dealer.
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-[#DDD0B8] overflow-hidden">
                {g.rows.map((s, idx) => {
                  const conc = s.class === 'STRAIGHT_N' ? s.n
                    : s.class === 'STRAIGHT_P' ? s.p
                    : s.class === 'STRAIGHT_K' ? s.k
                    : 0
                  return (
                    <div key={s.cosh_id}
                      className={`px-4 py-3 ${idx > 0 ? 'border-t border-[#EEE4D2]' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[#6B3F1F]">{s.name}</p>
                          <p className="text-xs text-[#4A3528] mt-0.5">
                            {s.kg_product_needed != null
                              ? `~${fmt(s.kg_product_needed)} kg · ${fmt(conc)}% ${g.letter}`
                              : `${fmt(conc)}% ${g.letter}`}
                            {s.water_soluble ? ' · water-soluble' : ''}
                          </p>
                        </div>
                        <button onClick={() => onShowBrands(s.cosh_id)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-100 text-purple-800 border border-purple-200 shrink-0">
                          {tradeNamesFor === s.cosh_id ? 'Hide brands' : 'Brands'}
                        </button>
                      </div>
                      {tradeNamesFor === s.cosh_id && (
                        <BrandList rows={tradeNames} loading={tradeNamesLoading} />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
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
