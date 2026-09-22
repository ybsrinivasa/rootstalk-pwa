/*
 * Hybrid-mode Order Builder — Option 5 (v2 Checkbox 3).
 *
 * Reached from the Advisory screen's Order button when the subscription
 * is hybrid (advisory_only_mode=true AND in_app_orders_enabled=true).
 *
 * The traditional Regular-Mode flow bundles every in-window input of
 * the tapped category and sends one order. That auto-bundling has a
 * dual-channel failure mode in hybrid mode: the farmer might have
 * bought some items offline already, and the app can't tell (either
 * because the farmer ack'd them and we don't filter, or because they
 * forgot to ack). Result: over-order.
 *
 * This page inverts the default. The tapped practice(s) are LOCKED in
 * the order (that's the farmer's explicit intent). Other in-window
 * candidates render as opt-in tickable rows. Items already handled
 * (in-flight order OR manually ack'd "I've purchased this") appear
 * as read-only context so the farmer sees WHY they're excluded. A
 * one-tap "Include all suggested" shortcut preserves the fast bundle
 * path for the trust-the-app farmer.
 *
 * On Continue, hands off to the standard /order/new page with the
 * assembled practice_ids — recipient picking + POST are unchanged.
 */
'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface Fulfilment {
  status: string
  farmer_received_at: string | null
}
interface Element {
  element_type: string
  cosh_ref?: string | null
  value?: string | null
}
interface Practice {
  id: string
  l0_type: string
  l1_type: string | null
  l2_type: string | null
  l2_name_loc?: string | null
  elements: Element[]
  is_purchased?: boolean
  purchased_at?: string | null
  fulfilment?: Fulfilment | null
  occurrence_date?: string
}
interface TimelineItem {
  id: string
  from_date: string
  to_date: string
  practices: Practice[]
}
interface AdvisoryDay {
  subscription_id: string
  timelines: TimelineItem[]
  advisory_only_mode?: boolean
  in_app_orders_enabled?: boolean
  ongoing_timelines?: TimelineItem[]
  cluster?: unknown
}
interface Subscription {
  id: string
  advisory_only_mode?: boolean
  in_app_orders_enabled?: boolean
}

function basketCategoryFor(l1: string | null | undefined): 'PESTICIDE' | 'FERTILIZER' | null {
  const u = (l1 || '').toUpperCase()
  if (u === 'PESTICIDE' || u === 'SPECIAL_INPUT') return 'PESTICIDE'
  if (u === 'FERTILIZER') return 'FERTILIZER'
  return null
}

// L1s that share a basket with the given category. Mirrors the
// backend `compute_bundle` category → L1 mapping so what we show on
// the builder screen matches what the order-preview endpoint would
// have returned.
function l1sForCategory(cat: 'PESTICIDE' | 'FERTILIZER'): Set<string> {
  return cat === 'PESTICIDE'
    ? new Set(['PESTICIDE', 'SPECIAL_INPUT'])
    : new Set(['FERTILIZER'])
}

function brandLabel(p: Practice): string | null {
  const brand = p.elements.find(e => (e.element_type || '').toUpperCase() === 'BRAND_NAME')
  if (!brand) return null
  const v = (brand.value || '').trim() || (brand.cosh_ref || '').trim()
  return v || null
}

// Chemistry line helpers mirrored from the advisory page (v1.9 +
// v1.9.2). Farmer-facing "Common Name AI% Formulation-acronym"
// identifier — the true product identity when brand is not
// authored. Kept inline here rather than extracted to a shared
// module because this is the second consumer only; extract if a
// third surface needs the same later.
function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}
function elementDisplay(el: Element | undefined): string {
  if (!el) return ''
  const v = el.value?.trim()
  if (v) return v
  const ref = el.cosh_ref?.trim()
  if (ref && !isUuid(ref)) return ref
  return ''
}
function formulationAcronym(name: string): string {
  if (!name) return ''
  const m = name.match(/\(([^)]+)\)\s*$/)
  return (m ? m[1] : name).trim()
}
function chemistryLine(elements: Element[]): string | null {
  const cn = elements.find(e => (e.element_type || '').toUpperCase() === 'COMMON_NAME')
  const ai = elements.find(e => (e.element_type || '').toUpperCase() === 'AI_CONCENTRATION')
  const fmt = elements.find(e => (e.element_type || '').toUpperCase() === 'FORMULATION')
  const combined = elements.find(e => (e.element_type || '').toUpperCase() === 'FORMULATION_AI_CONC')
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
  if (combinedStr) return cnStr ? `${cnStr} ${combinedStr}` : combinedStr
  return cnStr || null
}

function formatWindow(from: string, to: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' }
  const f = new Date(from).toLocaleDateString('en-GB', opts)
  const t = new Date(to).toLocaleDateString('en-GB', opts)
  return f === t ? f : `${f} – ${t}`
}

export default function HybridOrderBuilder() {
  const router = useRouter()
  const params = useParams<{ subscriptionId: string }>()
  const searchParams = useSearchParams()
  const tAdv = useTranslations('advisoryOnly')
  const subscriptionId = params.subscriptionId

  const lockedIds = useMemo(() => {
    const raw = searchParams.get('practice_ids') || ''
    return raw.split(',').map(s => s.trim()).filter(Boolean)
  }, [searchParams])

  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [advisory, setAdvisory] = useState<AdvisoryDay | null>(null)
  const [loading, setLoading] = useState(true)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const subsRes = await api.get<Subscription[]>('/farmer/my-subscriptions')
        const sub = subsRes.data.find(s => s.id === subscriptionId) || null
        if (!sub) throw new Error('Subscription not found')
        if (!sub.advisory_only_mode || !sub.in_app_orders_enabled) {
          throw new Error('Not a hybrid-mode subscription')
        }
        if (cancelled) return
        setSubscription(sub)
        // Fetch cluster (advisory-only default view). Any candidate we
        // can order for THIS sub lives in the current cluster —
        // ongoing (frequency-driven) practices also come in the same
        // payload under ongoing_timelines. If the cluster call fails
        // fall back to /farmer/advisory/today.
        let day: AdvisoryDay | null = null
        try {
          const r = await api.get<AdvisoryDay>(
            `/farmer/advisory/cluster?subscription_id=${subscriptionId}&offset=0`,
          )
          day = r.data
        } catch {
          const r = await api.get<AdvisoryDay[]>('/farmer/advisory/today')
          day = r.data.find(d => d.subscription_id === subscriptionId) || null
        }
        if (cancelled) return
        setAdvisory(day)
      } catch (e: unknown) {
        if (!cancelled) setError((e as { message?: string })?.message || 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [subscriptionId])

  // Flatten all practices (fixed-window timelines + ongoing) into one
  // list keyed by practice id. Dedup — a practice in multiple
  // timelines within the same cluster only surfaces once.
  const allPractices = useMemo(() => {
    if (!advisory) return new Map<string, { p: Practice; tl: TimelineItem }>()
    const map = new Map<string, { p: Practice; tl: TimelineItem }>()
    const walk = (tls: TimelineItem[] | undefined) => {
      for (const tl of tls || []) {
        for (const p of tl.practices || []) {
          if (!map.has(p.id)) map.set(p.id, { p, tl })
        }
      }
    }
    walk(advisory.timelines)
    walk(advisory.ongoing_timelines)
    return map
  }, [advisory])

  // Derive the category from the first tapped practice — all group
  // callers pass same-category practice ids together (AND/OR groups
  // are homogeneous by L1).
  const category = useMemo<'PESTICIDE' | 'FERTILIZER' | null>(() => {
    for (const id of lockedIds) {
      const hit = allPractices.get(id)
      if (hit) {
        const c = basketCategoryFor(hit.p.l1_type)
        if (c) return c
      }
    }
    return null
  }, [lockedIds, allPractices])

  // Partition candidates. Everything actionable (both the tapped
  // practice(s) and other in-window candidates) lives in a single
  // `orderableCandidates` list. The tapped items are simply
  // PRE-TICKED — they still render with the same affordance as the
  // rest and the farmer can un-tick them freely. Prevents the
  // "these are special" perception of a separate locked section
  // (user feedback 2026-09-22). `handled` stays separate because
  // its rows are genuinely non-interactive (already in-flight or
  // already ack'd).
  const { orderableCandidates, handledCandidates } = useMemo(() => {
    const orderable: { p: Practice; tl: TimelineItem }[] = []
    const handled: { p: Practice; tl: TimelineItem; reason: 'ordered' | 'purchased_ack' }[] = []
    if (!category) return { orderableCandidates: orderable, handledCandidates: handled }
    const l1s = l1sForCategory(category)
    for (const [, entry] of allPractices) {
      if (entry.p.l0_type !== 'INPUT') continue
      const l1u = (entry.p.l1_type || '').toUpperCase()
      if (!l1s.has(l1u)) continue
      // Handled buckets — read-only context to the farmer.
      const fulfNotDone = !!entry.p.fulfilment
      const ackDone = !!entry.p.purchased_at
      if (fulfNotDone) {
        handled.push({ ...entry, reason: 'ordered' })
        continue
      }
      if (ackDone) {
        handled.push({ ...entry, reason: 'purchased_ack' })
        continue
      }
      orderable.push(entry)
    }
    // Order the list so the tapped practice(s) render first — they're
    // the farmer's explicit intent, natural to see up top.
    const lockedSet = new Set(lockedIds)
    orderable.sort((a, b) => {
      const aLocked = lockedSet.has(a.p.id) ? 0 : 1
      const bLocked = lockedSet.has(b.p.id) ? 0 : 1
      return aLocked - bLocked
    })
    return { orderableCandidates: orderable, handledCandidates: handled }
  }, [allPractices, category, lockedIds])

  // Initialise `ticked` with the tapped practices when they become
  // available in the resolved orderable list. Empty until the load
  // completes; refreshed when lockedIds change.
  useEffect(() => {
    if (orderableCandidates.length === 0) return
    const orderableSet = new Set(orderableCandidates.map(x => x.p.id))
    const initial = new Set(lockedIds.filter(id => orderableSet.has(id)))
    setTicked(initial)
  }, [orderableCandidates, lockedIds])

  const canContinue = ticked.size > 0 && !!category

  function toggleTick(id: string) {
    setTicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function includeAllAvailable() {
    setTicked(new Set(orderableCandidates.map(x => x.p.id)))
  }

  const allTicked = ticked.size === orderableCandidates.length

  function onContinue() {
    if (!canContinue || !category) return
    const allIds = orderableCandidates
      .filter(x => ticked.has(x.p.id))
      .map(x => x.p.id)
    // Compute date span across the selected practices' timelines so
    // downstream (order-create + advisory refresh) has correct date
    // context. date_from is always today (matches Regular Mode); date_to
    // is the max of the selected practices' timeline to_dates.
    const todayIso = new Date().toISOString().split('T')[0]
    let maxTo = todayIso
    for (const id of allIds) {
      const hit = allPractices.get(id)
      if (hit && hit.tl.to_date > maxTo) maxTo = hit.tl.to_date
    }
    const q = new URLSearchParams({
      practice_ids: allIds.join(','),
      order_type: category,
      date_from: todayIso,
      date_to: maxTo.slice(0, 10),
    })
    router.push(`/order/new/${subscriptionId}?${q.toString()}`)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={tAdv('orderBuilder.title')} activeRole="FARMER" back={`/advisory/${subscriptionId}`} />
        <div className="pt-20 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  // Fail-safe: bail out with the error card when the tapped
  // practice(s) can't be found in the current cluster (stale link,
  // sub deleted, wrong id in URL). "Can't find any orderable
  // candidates" is a reasonable trigger too — but we only bail if
  // the tapped ids specifically didn't resolve.
  const tappedFound = lockedIds.some(id => orderableCandidates.some(x => x.p.id === id))
  if (error || !subscription || !category || !tappedFound) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={tAdv('orderBuilder.title')} activeRole="FARMER" back={`/advisory/${subscriptionId}`} />
        <div className="pt-20 px-4">
          <div className="bg-white border border-amber-200 rounded-xl p-4">
            <p className="text-sm text-amber-800">{tAdv('orderBuilder.loadError')}</p>
            {error && <p className="text-xs text-amber-600 mt-1">{error}</p>}
          </div>
        </div>
        <BottomNav activeRole="FARMER" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={tAdv('orderBuilder.title')} activeRole="FARMER" back={`/advisory/${subscriptionId}`} />
      <div className="pt-16 pb-32 px-4">
        {/* Category chip */}
        <div className="mt-4 mb-3">
          <p className="text-[11px] font-semibold text-[#7A8C7E] uppercase tracking-wider">
            {tAdv('orderBuilder.categoryLabel')}
          </p>
          <p className="text-sm font-bold text-[#6B3F1F] mt-0.5">
            {category === 'PESTICIDE' ? tAdv('orderBuilder.categoryPesticide') : tAdv('orderBuilder.categoryFertilizer')}
          </p>
        </div>

        {/* Unified orderable list — tapped practice(s) pre-ticked, all
            others opt-in. Every row uses the same tickbox affordance
            so the tapped items don't visually claim a "special" locked
            status. Farmer can un-tick any row, including the tapped
            one (if they change their mind before continuing). */}
        {orderableCandidates.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden mb-4">
            <div className="px-4 py-2 bg-[#F5F0E8] border-b border-[#DDD0B8] flex items-center justify-between">
              <p className="text-xs font-bold text-[#6B3F1F] uppercase tracking-wide">
                {tAdv('orderBuilder.dueList', { count: orderableCandidates.length })}
              </p>
              {orderableCandidates.length > 1 && !allTicked && (
                <button
                  onClick={includeAllAvailable}
                  className="text-[11px] font-semibold text-emerald-700 underline">
                  {tAdv('orderBuilder.includeAll')}
                </button>
              )}
            </div>
            <ul className="divide-y divide-slate-100">
              {orderableCandidates.map(({ p, tl }) => {
                const active = ticked.has(p.id)
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => toggleTick(p.id)}
                      className="w-full px-4 py-3 flex items-start gap-3 text-left active:bg-[#F5F0E8]">
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 rounded-full border shrink-0 mt-0.5 ${
                          active
                            ? 'bg-emerald-600 border-emerald-700 text-white'
                            : 'bg-white border-[#DDD0B8] text-transparent'
                        }`}>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                        </svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#6B3F1F] truncate">
                          {p.l2_name_loc || p.l2_type || 'Input'}
                        </p>
                        {chemistryLine(p.elements) && (
                          <p className="text-xs font-semibold text-[#6B3F1F] truncate">
                            {chemistryLine(p.elements)}
                          </p>
                        )}
                        {brandLabel(p) && (
                          <p className="text-xs text-[#7A8C7E] truncate">{brandLabel(p)}</p>
                        )}
                        <p className="text-[11px] text-[#7A8C7E] mt-0.5">
                          {tAdv('orderBuilder.dueLabel')}: {formatWindow(tl.from_date, tl.to_date)}
                        </p>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* Already handled — read-only informational */}
        {handledCandidates.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-4 opacity-80">
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                {tAdv('orderBuilder.alreadyHandled', { count: handledCandidates.length })}
              </p>
            </div>
            <ul className="divide-y divide-slate-100">
              {handledCandidates.map(({ p, reason }) => (
                <li key={p.id} className="px-4 py-2.5 flex items-start gap-3">
                  <span className="text-slate-400 text-sm shrink-0 mt-0.5">·</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-600 truncate">
                      {p.l2_name_loc || p.l2_type || 'Input'}
                    </p>
                    {chemistryLine(p.elements) && (
                      <p className="text-xs font-semibold text-slate-500 truncate">
                        {chemistryLine(p.elements)}
                      </p>
                    )}
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {reason === 'ordered'
                        ? tAdv('orderBuilder.reasonOrdered')
                        : tAdv('orderBuilder.reasonPurchased')}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Continue */}
        <div className="fixed inset-x-0 bottom-16 bg-white border-t border-[#DDD0B8] px-4 py-3 shadow-lg">
          <button
            onClick={onContinue}
            disabled={!canContinue}
            className="w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
            style={{ background: '#3A7D44' }}>
            {tAdv('orderBuilder.continue', { count: ticked.size })}
          </button>
        </div>
      </div>
      <BottomNav activeRole="FARMER" />
    </div>
  )
}
