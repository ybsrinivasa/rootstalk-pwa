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
  purchase_locked_by_order?: boolean
  fulfilment?: Fulfilment | null
  occurrence_date?: string
  // Advisory-page render order + relation metadata. Used to:
  //  - Sort orderable candidates in advisory order (was Map insertion)
  //  - Derive OR camps for the ENTIRE cluster (not just the tapped
  //    Part's OR) so the basket-builder enforces mutex on every OR
  //    group, not only the one the farmer originated the tap from.
  display_order: number
  relation_id?: string | null
  relation_role?: string | null    // e.g. "PART_1__OPT_2__POS_1"
  relation_type?: 'AND' | 'OR' | 'IF' | null
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

  // v2 (2026-09-23 OR-in-Checkbox3, refactored 2026-09-23 evening) —
  // OR mutex structure as groups-of-camps. ((A OR B) + (C OR D))
  // has TWO independent OR groups: ticking in one must not affect
  // the other. Flattening to camps alone (my earlier cut) lost that.
  //   Pure OR-of-singles (A OR B)          → [[[A],[B]]]
  //   Compound OR ((A+B) OR (C+D))         → [[[A,B],[C,D]]]
  //   Independent ORs ((A OR B) + (C OR D))→ [[[A],[B]], [[C],[D]]]
  //
  // Derivation strategy: try to reconstruct from cluster metadata
  // (relation_id + relation_role + relation_type). If the flat
  // tl.practices[] response doesn't include those fields for every
  // practice — which it may not — fall back to parsing the URL's
  // or_mutex param. URL camps form ONE group (the OR the farmer
  // tapped from). Two independent ORs would need cluster metadata
  // to be enforced simultaneously.
  const urlOrCamps = useMemo(() => {
    const raw = searchParams.get('or_mutex') || ''
    if (!raw) return [] as string[][]
    return raw.split('|').map(camp =>
      camp.split(',').map(s => s.trim()).filter(Boolean),
    ).filter(camp => camp.length > 0)
  }, [searchParams])
  const orMutexGroups = useMemo(() => {
    const clusterGroups: string[][][] = []
    if (advisory) {
      // Don't require relation_type on every practice — the backend
      // may only set it on the first row of a relation (advisory page
      // uses .find() to pluck it). Use STRUCTURE instead: any Part in
      // any Relation with 2+ Options IS an OR (that's what "Choose
      // one" means). Standalones and single-Option Parts are ignored.
      const byRelation = new Map<string, Map<number, Map<number, string[]>>>()
      const walk = (tls?: TimelineItem[]) => {
        for (const tl of tls || []) {
          for (const p of tl.practices || []) {
            if (!p.relation_id) continue
            const role = p.relation_role || ''
            const m = /^PART_(\d+)__OPT_(\d+)__POS_(\d+)$/.exec(role)
            if (!m) continue
            const part = +m[1]
            const option = +m[2]
            if (!byRelation.has(p.relation_id)) {
              byRelation.set(p.relation_id, new Map())
            }
            const partMap = byRelation.get(p.relation_id)!
            if (!partMap.has(part)) partMap.set(part, new Map())
            const optMap = partMap.get(part)!
            if (!optMap.has(option)) optMap.set(option, [])
            optMap.get(option)!.push(p.id)
          }
        }
      }
      walk(advisory.timelines)
      walk(advisory.ongoing_timelines)
      for (const [, partMap] of byRelation) {
        for (const [, optMap] of partMap) {
          if (optMap.size < 2) continue
          const camps: string[][] = []
          for (const [, ids] of optMap) camps.push(ids)
          clusterGroups.push(camps)
        }
      }
    }
    if (clusterGroups.length > 0) return clusterGroups
    // Fallback: URL camps form one group (the tapped OR only).
    return urlOrCamps.length > 1 ? [urlOrCamps] : []
  }, [advisory, urlOrCamps])
  // Flat lookups for rendering + toggle enforcement.
  const orMutexIds = useMemo(
    () => orMutexGroups.flatMap(g => g.flat()),
    [orMutexGroups],
  )
  const campForId = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const g of orMutexGroups) for (const camp of g) for (const id of camp) m.set(id, camp)
    return m
  }, [orMutexGroups])
  const groupForId = useMemo(() => {
    const m = new Map<string, string[][]>()
    for (const g of orMutexGroups) for (const camp of g) for (const id of camp) m.set(id, g)
    return m
  }, [orMutexGroups])
  // Back-compat alias: rest of the file uses `orMutexCamps` for the
  // flattened camp list (mutex enforcement wraps in groupForId to
  // stay group-aware).
  const orMutexCamps = useMemo(
    () => orMutexGroups.flatMap(g => g),
    [orMutexGroups],
  )

  // Derive the category from the first tapped practice — all group
  // callers pass same-category practice ids together (AND/OR groups
  // are homogeneous by L1).
  // v2 (2026-09-23 complex-in-Checkbox3): shared "Order one of these"
  // flow may omit lockedIds (mutex demands explicit choice) — fall
  // back to any mutex member for category derivation.
  const category = useMemo<'PESTICIDE' | 'FERTILIZER' | null>(() => {
    const candidates = lockedIds.length > 0 ? lockedIds : orMutexIds
    for (const id of candidates) {
      const hit = allPractices.get(id)
      if (hit) {
        const c = basketCategoryFor(hit.p.l1_type)
        if (c) return c
      }
    }
    return null
  }, [lockedIds, orMutexIds, allPractices])

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
    const handled: {
      p: Practice; tl: TimelineItem;
      reason: 'ordered' | 'purchased_ack' | 'or_alternative';
    }[] = []
    if (!category) return { orderableCandidates: orderable, handledCandidates: handled }
    const l1s = l1sForCategory(category)
    // v2 (2026-09-23 complex-in-Checkbox3): if any camp of the OR
    // mutex has already been committed (any of its practices is
    // purchased or order-locked), the practices in OTHER camps are
    // effectively out of play — the farmer has chosen the alternative.
    // Move them into "already handled" with a distinct reason instead
    // of showing them as tickable in "Due for order." Single reset
    // path stays on the advisory (un-tick the chosen ack).
    const committedCampIds = new Set<string>()
    for (const camp of orMutexCamps) {
      const anyCommitted = camp.some(id => {
        const hit = allPractices.get(id)
        if (!hit) return false
        return !!hit.p.purchased_at
          || !!hit.p.fulfilment
          || !!hit.p.purchase_locked_by_order
      })
      if (anyCommitted) for (const id of camp) committedCampIds.add(id)
    }
    const losingCampIds = new Set<string>()
    if (committedCampIds.size > 0) {
      for (const camp of orMutexCamps) {
        const inCommittedCamp = camp.every(id => committedCampIds.has(id))
        if (inCommittedCamp) continue
        for (const id of camp) losingCampIds.add(id)
      }
    }
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
      if (losingCampIds.has(entry.p.id)) {
        handled.push({ ...entry, reason: 'or_alternative' })
        continue
      }
      orderable.push(entry)
    }
    // v2 (2026-09-23 evening): sort in advisory render order via the
    // per-practice display_order. Previously we sorted "tapped items
    // first" which shuffled the sequence relative to what the farmer
    // just saw on the advisory — disorienting mental-model break. The
    // tapped practice is still visually highlighted by its ✓ pre-tick;
    // no need to reorder the list.
    // Sort in advisory render order: primary display_order; tiebreak
    // on relation_role's (PART, OPT, POS) so practices within the
    // same Relation follow their nested tree order. If backend sends
    // display_order = 0 for all (or is missing), the relation_role
    // tiebreak still produces the right sequence for the OR/AND
    // practices the farmer just tapped from.
    const roleKey = (role?: string | null) => {
      const m = /^PART_(\d+)__OPT_(\d+)__POS_(\d+)$/.exec(role || '')
      if (!m) return 0
      return (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3])
    }
    orderable.sort((a, b) => {
      const dA = a.p.display_order ?? 0
      const dB = b.p.display_order ?? 0
      if (dA !== dB) return dA - dB
      return roleKey(a.p.relation_role) - roleKey(b.p.relation_role)
    })
    return { orderableCandidates: orderable, handledCandidates: handled }
  }, [allPractices, category, orMutexCamps])

  // Initialise `ticked` with the tapped practices when they become
  // available in the resolved orderable list. Empty until the load
  // completes; refreshed when lockedIds change.
  // v2 (2026-09-23 OR-in-Checkbox3, updated for complex): lockedIds
  // is now the pure "pre-tick intent" — the caller (advisory page)
  // already suppresses lockedIds for the shared OR-button flow (where
  // mutex demands an explicit choice). Per-item Order taps INSIDE an
  // OR camp still get their tapped id pre-ticked; farmer un-ticks it
  // if they change their mind.
  useEffect(() => {
    if (orderableCandidates.length === 0) return
    const orderableSet = new Set(orderableCandidates.map(x => x.p.id))
    const initial = new Set(
      lockedIds.filter(id => orderableSet.has(id)),
    )
    setTicked(initial)
  }, [orderableCandidates, lockedIds])

  const canContinue = ticked.size > 0 && !!category

  function toggleTick(id: string) {
    setTicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        // Group-aware OR mutex: ticking a member of camp X in group G
        // un-ticks all members of OTHER camps IN G. Camps in OTHER
        // groups are untouched (independent ORs). Same-camp members
        // co-exist (compound-OR mix ingredients).
        const myCamp = campForId.get(id)
        const myGroup = groupForId.get(id)
        if (myCamp && myGroup) {
          for (const camp of myGroup) {
            if (camp === myCamp) continue
            for (const otherId of camp) next.delete(otherId)
          }
        }
      }
      return next
    })
  }

  function includeAllAvailable() {
    // v2 (2026-09-23 OR-in-Checkbox3, updated): "Include all" cannot
    // violate any OR group — pick every non-mutex candidate PLUS the
    // first camp of EACH group. For ((A OR B) + (C OR D)) that means
    // one from each OR (A + C by default). Farmer can still swap by
    // tapping a different camp; group-aware toggle handles the swap.
    const chosenCampIds = new Set<string>()
    for (const group of orMutexGroups) {
      const first = group[0]
      if (first) for (const id of first) chosenCampIds.add(id)
    }
    const mutexSet = new Set(orMutexIds)
    const next = new Set<string>()
    for (const { p } of orderableCandidates) {
      if (mutexSet.has(p.id)) {
        if (chosenCampIds.has(p.id)) next.add(p.id)
      } else {
        next.add(p.id)
      }
    }
    setTicked(next)
  }

  // "Include all" hides once every non-mutex candidate is ticked and
  // one whole camp is picked per group — the effective ceiling.
  const mutexSetForCap = new Set(orMutexIds)
  const nonMutexCount = orderableCandidates.filter(x => !mutexSetForCap.has(x.p.id)).length
  const oneCampPerGroupTotal = orMutexGroups.reduce(
    (n, g) => n + (g[0]?.length ?? 0),
    0,
  )
  const effectiveMax = nonMutexCount + oneCampPerGroupTotal
  const allTicked = ticked.size === effectiveMax
  // Number of OR camps that still have at least one member in the
  // orderable list. Drives the OR-chip + hint: they only make sense
  // when the farmer actually has an alternative to choose from here.
  const campsVisibleInOrderable = useMemo(() => {
    if (orMutexCamps.length === 0) return 0
    const orderableIds = new Set(orderableCandidates.map(x => x.p.id))
    return orMutexCamps.filter(camp => camp.some(id => orderableIds.has(id))).length
  }, [orMutexCamps, orderableCandidates])

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
  // v2 (2026-09-23 complex-in-Checkbox3): shared OR-button flow omits
  // lockedIds — fall back to orMutexIds so tappedFound still gates on
  // "did we resolve at least one candidate from the intended set."
  const tappedFound = (lockedIds.length > 0 ? lockedIds : orMutexIds)
    .some(id => orderableCandidates.some(x => x.p.id === id))
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
            one (if they change their mind before continuing).
            v2 (2026-09-23 OR-in-Checkbox3): rows in an OR mutex set
            get a small blue "OR" chip; ticking one un-ticks the
            others in the same set. A hint at the top of the list
            explains the rule. */}
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
            {campsVisibleInOrderable > 1 && (
              <div className="px-4 py-2 bg-blue-50 border-b border-blue-100">
                <p className="text-[11px] text-blue-800">
                  <span className="inline-block px-1.5 py-0.5 rounded bg-blue-600 text-white font-bold text-[10px] mr-1.5">OR</span>
                  {tAdv('orderBuilder.orMutexHint')}
                </p>
              </div>
            )}
            <ul className="divide-y divide-slate-100">
              {orderableCandidates.map(({ p, tl }) => {
                const active = ticked.has(p.id)
                // v2 (2026-09-23 complex-in-Checkbox3): OR chip only
                // makes sense when there ARE still alternatives visible
                // to the farmer. Once a camp is committed on advisory
                // and the losing camp is moved to "already handled,"
                // the surviving practice has no live alternative here.
                const isMutex = orMutexIds.includes(p.id) && campsVisibleInOrderable > 1
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
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-[#6B3F1F] truncate">
                            {p.l2_name_loc || p.l2_type || 'Input'}
                          </p>
                          {isMutex && (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-blue-600 text-white font-bold text-[10px] shrink-0">OR</span>
                          )}
                        </div>
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
                        : reason === 'or_alternative'
                          ? tAdv('orderBuilder.reasonOrAlternative')
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
