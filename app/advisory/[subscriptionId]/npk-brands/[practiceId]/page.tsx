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
  // 2026-10-30 — backend flag; false when the candidate has no active
  // trade name in Cosh. PWA filters these out so the farmer only
  // sees shelf-available options.
  has_brands?: boolean
}
interface NPKStraight {
  cosh_id: string
  name: string
  n: number; p: number; k: number
  class: 'STRAIGHT_N' | 'STRAIGHT_P' | 'STRAIGHT_K' | 'MIXED'
  water_soluble: boolean
  kg_product_needed: number | null
  has_brands?: boolean
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
// 2026-10-30 — purchase record returned by the backend list endpoint.
// Keyed by trade_name_cosh_id in the client state so Brands rows can
// render ✓ Bought instantly.
interface NPKPurchase {
  id: string
  trade_name_cosh_id: string | null
  trade_name_display: string
  common_name_cosh_id: string | null
  product_role: 'MIXED' | 'STRAIGHT_N' | 'STRAIGHT_P' | 'STRAIGHT_K'
  match_target: 'N' | 'P' | 'K' | null
  source: 'COSH' | 'FARMER_ENTERED'
  photo_url: string | null
  apply_kg: number | null
  // 2026-10-30 — human scope label ("2 acres" / "1000 plants") so
  // the UI renders "~X kg for your N <scope>" without having to know
  // which subscription type (acre vs plant-wise) is in play. Replaces
  // the earlier hardcoded "for your N acres" text that broke on
  // plant-wise crops.
  scope_text: string | null
  area_acres: number | null  // retained for backwards compat
}
// Context needed to POST a purchase from a trade-name row — the row
// itself only knows its own cosh_id + name; the parent context
// supplies the common_name, product_role, and match_target
// recovered from the ranked_mixed / enabled_straights entry.
interface PurchaseContext {
  common_name_cosh_id: string
  product_role: 'MIXED' | 'STRAIGHT_N' | 'STRAIGHT_P' | 'STRAIGHT_K'
  match_target: 'N' | 'P' | 'K' | null
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

  // 2026-10-30 — purchase records keyed by trade_name_cosh_id for
  // O(1) "already bought" ticks. Loaded on mount; re-loaded after
  // every POST/DELETE.
  const [purchases, setPurchases] = useState<Record<string, NPKPurchase>>({})
  const [buyingBrand, setBuyingBrand] = useState<string | null>(null)
  const purchaseList = useMemo(() => Object.values(purchases), [purchases])

  const loadPurchases = useCallback(async () => {
    try {
      const r = await api.get<{ purchases: NPKPurchase[] }>(
        `/farmer/subscriptions/${subscriptionId}/practices/${practiceId}/npk-purchases`,
      )
      // Key by trade_name_cosh_id for O(1) "already bought" checks
      // on the Cosh brands list. FARMER_ENTERED rows have a NULL
      // trade_name_cosh_id so we key them by the record id instead
      // (they still appear in purchaseList via Object.values).
      const next: Record<string, NPKPurchase> = {}
      for (const p of r.data.purchases) {
        next[p.trade_name_cosh_id || p.id] = p
      }
      setPurchases(next)
    } catch {
      // non-fatal — screen still works, buy buttons will just not show ticks
    }
  }, [subscriptionId, practiceId])

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
    loadPurchases()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptionId, practiceId])

  // 2026-10-30 — Filter out candidates with no brands in Cosh so the
  // picker only shows products the farmer can actually walk into a
  // shop and buy. Legacy clients that pre-date the has_brands flag
  // read undefined → treat as "available" so nothing hides when
  // the backend is temporarily behind.
  const rankedMixedWithBrands = useMemo(
    () => (data?.ranked_mixed || []).filter(m => m.has_brands !== false),
    [data],
  )
  const straightsWithBrands = useMemo(
    () => (data?.enabled_straights || []).filter(s => s.has_brands !== false),
    [data],
  )

  // Route availability — derived from the filtered lists.
  const dose = data?.required_dose || null
  const singleNutrientDose = countNonZero(dose) <= 1
  const mixedRouteAvailable = useMemo(
    () => !!data && !singleNutrientDose && rankedMixedWithBrands.length > 0,
    [data, singleNutrientDose, rankedMixedWithBrands],
  )
  const straightsRouteAvailable = useMemo(
    () => !!data && straightsWithBrands.length > 0,
    [data, straightsWithBrands],
  )

  // Nutrient-group completion from purchases. A group collapses to a
  // one-line summary when the farmer has recorded a purchase for its
  // straight class (STRAIGHT_N / P / K). Mixed collapse analogous
  // via productRole === 'MIXED'.
  const purchaseByRole = useMemo(() => {
    const m = { MIXED: null as NPKPurchase | null,
      STRAIGHT_N: null as NPKPurchase | null,
      STRAIGHT_P: null as NPKPurchase | null,
      STRAIGHT_K: null as NPKPurchase | null,
    }
    for (const p of purchaseList) {
      if (m[p.product_role] == null) m[p.product_role] = p
    }
    return m
  }, [purchaseList])

  // Auto-select the only available route (so landing isn't a one-card
  // picker that reads like a dead-end).
  useEffect(() => {
    if (!data || route !== 'initial') return
    if (mixedRouteAvailable && !straightsRouteAvailable) setRoute('mixed')
    else if (!mixedRouteAvailable && straightsRouteAvailable) setRoute('straights')
  }, [data, mixedRouteAvailable, straightsRouteAvailable, route])

  // If the farmer has an existing Mixed purchase on this practice,
  // auto-pick that Mixed on landing so the picker shows "Your pick"
  // + straights-for-gap directly (no re-tap required). Only runs on
  // first data arrival, and only when nothing is picked yet, so
  // mid-session Change-pick isn't fought.
  useEffect(() => {
    if (!data || pickedMixedCoshId) return
    const mixedPurchase = purchaseByRole.MIXED
    if (mixedPurchase && mixedRouteAvailable) {
      const matching = rankedMixedWithBrands.find(
        m => m.cosh_id === mixedPurchase.common_name_cosh_id,
      )
      if (matching) {
        setRoute('mixed')
        setPickedMixedCoshId(mixedPurchase.common_name_cosh_id)
        load(mixedPurchase.common_name_cosh_id)
      }
    }
    // intentionally not depending on load; one-shot on data arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, purchaseByRole.MIXED])

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

  async function handleBuyBrand(
    trade: NPKTradeName, ctx: PurchaseContext,
  ) {
    if (purchases[trade.cosh_id]) return  // already bought
    setBuyingBrand(trade.cosh_id)
    try {
      await api.post(
        `/farmer/subscriptions/${subscriptionId}/practices/${practiceId}/npk-purchases`,
        {
          common_name_cosh_id: ctx.common_name_cosh_id,
          trade_name_cosh_id: trade.cosh_id,
          trade_name_display: trade.name,
          product_role: ctx.product_role,
          match_target: ctx.match_target,
        },
      )
      await loadPurchases()
      // Signal to the practice card on the advisory page to refetch
      // its apply-quantity block.
      try {
        window.dispatchEvent(new Event('rt-npk-purchases-changed'))
      } catch { /* non-browser env */ }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      alert(err?.response?.data?.detail || 'Could not record purchase.')
    } finally {
      setBuyingBrand(null)
    }
  }

  const [startingOver, setStartingOver] = useState(false)
  async function handleStartOver() {
    if (purchaseList.length === 0) return
    if (!confirm('Remove all your picks for this fertilizer? Start over.')) return
    setStartingOver(true)
    try {
      for (const p of purchaseList) {
        try {
          await api.delete(
            `/farmer/subscriptions/${subscriptionId}/practices/${practiceId}/npk-purchases/${p.id}`,
          )
        } catch { /* keep going; worst case Done surfaces the error */ }
      }
      await loadPurchases()
      // Reset in-memory picker state too so the view returns to clean.
      setPickedMixedCoshId(null)
      setTradeNamesFor(null)
      setTradeNames([])
      setRoute('initial')
      await load(null)
      try {
        window.dispatchEvent(new Event('rt-npk-purchases-changed'))
      } catch { /* non-browser env */ }
    } finally {
      setStartingOver(false)
    }
  }

  async function handleBuyFreeText(
    ctx: PurchaseContext,
    args: { brand: string; photoFile: File | null },
  ) {
    const brand = (args.brand || '').trim()
    if (!brand) return
    try {
      let photoUrl: string | null = null
      if (args.photoFile) {
        const fd = new FormData()
        fd.append('file', args.photoFile)
        fd.append('folder', 'npk-brand-photos')
        const { data: up } = await api.post<{ url: string }>(
          '/media/upload', fd,
          { headers: { 'Content-Type': 'multipart/form-data' } },
        )
        photoUrl = up?.url || null
      }
      await api.post(
        `/farmer/subscriptions/${subscriptionId}/practices/${practiceId}/npk-purchases`,
        {
          source: 'FARMER_ENTERED',
          trade_name_display: brand,
          photo_url: photoUrl,
          product_role: ctx.product_role,
          match_target: ctx.match_target,
        },
      )
      await loadPurchases()
      try {
        window.dispatchEvent(new Event('rt-npk-purchases-changed'))
      } catch { /* non-browser env */ }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      alert(err?.response?.data?.detail || 'Could not record the brand.')
    }
  }

  async function handleRemoveBrand(purchaseId: string) {
    try {
      await api.delete(
        `/farmer/subscriptions/${subscriptionId}/practices/${practiceId}/npk-purchases/${purchaseId}`,
      )
      await loadPurchases()
      try {
        window.dispatchEvent(new Event('rt-npk-purchases-changed'))
      } catch { /* non-browser env */ }
    } catch {
      alert('Could not remove purchase.')
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

  const gap = data.gap
  const gapAllZero = !!gap && gap.n === 0 && gap.p === 0 && gap.k === 0
  const bothRoutesAvailable = mixedRouteAvailable && straightsRouteAvailable
  const pickedMixedCand = pickedMixedCoshId
    ? rankedMixedWithBrands.find(m => m.cosh_id === pickedMixedCoshId) || null
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

        {/* Your purchases summary strip */}
        {purchaseList.length > 0 && (
          <div className="bg-emerald-50 border border-emerald-300 rounded-2xl px-4 py-3 mb-4">
            <p className="text-[11px] uppercase tracking-wider text-emerald-800 font-semibold mb-2">
              What to apply (based on what you&apos;ve bought)
            </p>
            <ul className="space-y-1.5">
              {purchaseList.map(p => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-[#4A3528] flex-1 min-w-0">
                    <span className="font-semibold text-[#6B3F1F]">
                      {p.trade_name_display}
                    </span>
                    {p.source === 'FARMER_ENTERED' && (
                      <span className="text-[11px] text-slate-500 ml-1">(you added)</span>
                    )}
                    {p.apply_kg != null && p.scope_text ? (
                      <> — apply ~{fmt(p.apply_kg)} kg for your {p.scope_text}</>
                    ) : p.source === 'FARMER_ENTERED' ? (
                      <span className="text-[#7A8C7E]"> — ask dealer for the amount to apply</span>
                    ) : (
                      <span className="text-[#7A8C7E]"> — quantity needs your field size + Cosh concentration</span>
                    )}
                    {p.photo_url && (
                      <> {' '}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <a href={p.photo_url} target="_blank" rel="noopener noreferrer"
                          className="inline-block align-middle">
                          <img src={p.photo_url} alt="bag"
                            className="inline-block h-6 w-6 object-cover rounded border border-slate-300" />
                        </a>
                      </>
                    )}
                  </span>
                  <button onClick={() => handleRemoveBrand(p.id)}
                    className="text-xs font-medium text-red-700 shrink-0">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
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
                  {rankedMixedWithBrands.map((m, idx) => (
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
                        <BrandList
                          rows={tradeNames} loading={tradeNamesLoading}
                          purchases={purchases}
                          purchaseCtx={{
                            common_name_cosh_id: m.cosh_id,
                            product_role: 'MIXED',
                            match_target: m.match_target,
                          }}
                          buyingBrand={buyingBrand}
                          onBuy={handleBuyBrand}
                          onBuyFreeText={handleBuyFreeText}
                        />
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
                    <BrandList
                      rows={tradeNames} loading={tradeNamesLoading}
                      purchases={purchases}
                      purchaseCtx={{
                        common_name_cosh_id: pickedMixedCand.cosh_id,
                        product_role: 'MIXED',
                        match_target: pickedMixedCand.match_target,
                      }}
                      buyingBrand={buyingBrand}
                      onBuy={handleBuyBrand}
                      onBuyFreeText={handleBuyFreeText}
                    />
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
                    straights={straightsWithBrands}
                    gap={gap}
                    headerLabel="Top up with straight fertilizers"
                    tradeNamesFor={tradeNamesFor}
                    tradeNames={tradeNames}
                    tradeNamesLoading={tradeNamesLoading}
                    onShowBrands={handleShowBrands}
                    purchases={purchases}
                    buyingBrand={buyingBrand}
                    onBuy={handleBuyBrand}
                    onBuyFreeText={handleBuyFreeText}
                  />
                )}
              </>
            )}
          </>
        )}

        {/* Straights route (no Mixed in the picture) */}
        {route === 'straights' && (
          <StraightsByNutrient
            straights={straightsWithBrands}
            gap={gap}
            headerLabel="Straight fertilizers for your full dose"
            tradeNamesFor={tradeNamesFor}
            tradeNames={tradeNames}
            tradeNamesLoading={tradeNamesLoading}
            onShowBrands={handleShowBrands}
            purchases={purchases}
            buyingBrand={buyingBrand}
            onBuy={handleBuyBrand}
            onBuyFreeText={handleBuyFreeText}
          />
        )}

        <p className="text-[11px] text-[#7A8C7E] mt-5 leading-relaxed">
          Advisories are suggestions. Local availability and your soil may
          influence the final choice. Any fertilizer that delivers the required
          NPK dose will work.
        </p>

        {/* 2026-10-30 — Action bar: Done returns to the practice card;
            Start over wipes all records for this practice so the farmer
            can restart. All picks are already persisted per-tap so
            no explicit Save is needed. */}
        <div className="mt-6 flex items-center gap-3">
          <button onClick={() => router.back()}
            className="flex-1 text-sm font-semibold py-3 rounded-xl bg-emerald-600 text-white">
            Done
          </button>
          {purchaseList.length > 0 && (
            <button onClick={handleStartOver}
              disabled={startingOver}
              className="text-sm font-medium py-3 px-4 rounded-xl bg-white border border-slate-300 text-slate-700 disabled:opacity-50">
              {startingOver ? 'Clearing…' : 'Start over'}
            </button>
          )}
        </div>
      </div>
      <BottomNav />
    </div>
  )
}

function StraightsByNutrient({
  straights, gap, headerLabel, tradeNamesFor, tradeNames, tradeNamesLoading,
  onShowBrands, purchases, buyingBrand, onBuy, onBuyFreeText,
}: {
  straights: NPKStraight[]
  gap: { n: number; p: number; k: number } | null
  headerLabel: string
  tradeNamesFor: string | null
  tradeNames: NPKTradeName[]
  tradeNamesLoading: boolean
  onShowBrands: (coshId: string) => void
  purchases: Record<string, NPKPurchase>
  buyingBrand: string | null
  onBuy: (trade: NPKTradeName, ctx: PurchaseContext) => void | Promise<void>
  onBuyFreeText: (ctx: PurchaseContext, args: {
    brand: string; photoFile: File | null
  }) => void | Promise<void>
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
        {groups.map(g => {
          // Collapsed state: a purchase already exists for this
          // nutrient group → show a one-line summary with Change (reset
          // via Remove from the top strip) instead of the full list.
          const bought = Object.values(purchases).find(
            p => p.product_role === g.straightClass,
          )
          if (bought) {
            return (
              <div key={g.letter}
                className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                <p className="text-xs text-emerald-800">
                  ✓ For {g.label} — <span className="font-semibold">{bought.trade_name_display}</span>
                  {bought.source === 'FARMER_ENTERED' && (
                    <span className="text-[11px] text-slate-500 ml-1">(you added)</span>
                  )}
                  {bought.apply_kg != null && (
                    <> · ~{fmt(bought.apply_kg)} kg</>
                  )}
                </p>
              </div>
            )
          }
          return (
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
                        <BrandList
                          rows={tradeNames} loading={tradeNamesLoading}
                          purchases={purchases}
                          purchaseCtx={{
                            common_name_cosh_id: s.cosh_id,
                            product_role: g.straightClass,
                            match_target: null,
                          }}
                          buyingBrand={buyingBrand}
                          onBuy={onBuy}
                          onBuyFreeText={onBuyFreeText}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          )
        })}
      </div>
    </>
  )
}

function BrandList({
  rows, loading, purchases, purchaseCtx, buyingBrand, onBuy, onBuyFreeText,
}: {
  rows: NPKTradeName[]
  loading: boolean
  purchases: Record<string, NPKPurchase>
  purchaseCtx: PurchaseContext | null
  buyingBrand: string | null
  onBuy: (trade: NPKTradeName, ctx: PurchaseContext) => void | Promise<void>
  onBuyFreeText: (ctx: PurchaseContext, args: {
    brand: string; photoFile: File | null
  }) => void | Promise<void>
}) {
  const [showFreeText, setShowFreeText] = useState(false)
  const [freeBrand, setFreeBrand] = useState('')
  const [freePhoto, setFreePhoto] = useState<File | null>(null)
  const [freeSaving, setFreeSaving] = useState(false)

  async function handleFreeSubmit() {
    if (!purchaseCtx || !freeBrand.trim()) return
    setFreeSaving(true)
    try {
      await onBuyFreeText(purchaseCtx, {
        brand: freeBrand.trim(),
        photoFile: freePhoto,
      })
      setShowFreeText(false)
      setFreeBrand('')
      setFreePhoto(null)
    } finally {
      setFreeSaving(false)
    }
  }

  return (
    <div className="mt-3 pl-3 border-l-2 border-purple-200">
      {loading ? (
        <p className="text-xs text-[#7A8C7E] py-1">Loading brands…</p>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="text-xs text-[#7A8C7E] py-1">
              No brands listed. If the shop sells one, enter it below.
            </p>
          ) : (
            <ul className="space-y-1 py-1">
              {rows.map(tn => {
                const bought = !!purchases[tn.cosh_id]
                const busy = buyingBrand === tn.cosh_id
                const canBuy = !!purchaseCtx && !bought && !busy
                return (
                  <li key={tn.cosh_id} className="flex items-center justify-between gap-3 py-1">
                    <span className="text-sm text-[#4A3528] flex-1 min-w-0">
                      {bought && <span className="text-emerald-700 mr-1">✓</span>}
                      {tn.name}
                    </span>
                    {bought ? (
                      <span className="text-xs font-medium text-emerald-700 shrink-0">
                        Bought
                      </span>
                    ) : (
                      <button
                        disabled={!canBuy}
                        onClick={() => purchaseCtx && onBuy(tn, purchaseCtx)}
                        className="text-xs font-semibold px-2.5 py-1 rounded-md bg-emerald-600 border border-emerald-700 text-white disabled:opacity-50 shrink-0">
                        {busy ? 'Saving…' : 'I bought this'}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {/* Free-text brand entry — fallback when the shop sells
              something not in Cosh. 2026-10-30 per YB. */}
          {!showFreeText ? (
            <button onClick={() => setShowFreeText(true)}
              disabled={!purchaseCtx}
              className="text-xs text-purple-700 underline mt-1 disabled:opacity-50">
              Not on this list? Enter it →
            </button>
          ) : (
            <div className="mt-2 bg-white border border-slate-300 rounded-lg p-3 space-y-2">
              <label className="block text-[11px] uppercase tracking-wider text-slate-600 font-medium">
                Brand name on the bag
              </label>
              <input type="text" value={freeBrand}
                onChange={e => setFreeBrand(e.target.value)}
                placeholder="e.g. Spic Super Urea Plus"
                className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5" />
              <label className="block text-[11px] uppercase tracking-wider text-slate-600 font-medium mt-2">
                Photo of the bag (optional)
              </label>
              <input type="file" accept="image/*" capture="environment"
                onChange={e => setFreePhoto(e.target.files?.[0] || null)}
                className="w-full text-xs" />
              {freePhoto && (
                <p className="text-[11px] text-emerald-700">
                  ✓ Photo attached: {freePhoto.name}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={handleFreeSubmit}
                  disabled={freeSaving || !freeBrand.trim()}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-600 border border-emerald-700 text-white disabled:opacity-50">
                  {freeSaving ? 'Saving…' : 'Save brand'}
                </button>
                <button onClick={() => {
                  setShowFreeText(false); setFreeBrand(''); setFreePhoto(null)
                }}
                  className="text-xs font-medium px-3 py-1.5 rounded-md bg-white border border-slate-300 text-slate-700">
                  Cancel
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                We&apos;ll show the brand name and photo, but can&apos;t compute
                an application quantity without concentration data.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
