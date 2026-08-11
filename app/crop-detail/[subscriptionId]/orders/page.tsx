'use client'
// Phase 3 of the Orders restructure (2026-06-02). Per-package Orders
// surface, tabbed:
//
//   Tab "Order"    — new orders. Three accordions: Seed/Seedling,
//                    Pesticide, Fertilizer. Pesticide/Fertilizer
//                    expose a Pre-sowing sub-mode when today is
//                    behind the subscription's crop_start_date.
//   Tab "Manage"   — orders in flight. Inline Approve (when items
//                    await farmer approval); Cancel always; Forward /
//                    Delete appear once a cancel is acknowledged.
//   Tab "Received" — purchased items for this subscription.
//
// Deep-link from Advisory tap: ?open=pesticide|fertilizer&date_from=..&date_to=..
// opens that accordion pre-filled with the date range. Direct entry
// from the Orders button on the crop dashboard opens the page with
// nothing pre-filled.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import ClientCropChip from '@/components/ClientCropChip'
import api from '@/lib/api'
import QRScannerModal from '@/components/QRScannerModal'

type Subscription = {
  id: string
  crop_start_date: string | null
  package_name?: string | null
  client_name?: string | null
  crop_cosh_id?: string | null
}

type SubOrder = {
  kind: 'REGULAR' | 'SEED'
  id: string; status: string
  // 2026-06-07 — Human-readable Order ID shared across the lineage.
  // Surfaces on the Manage card so the farmer can recognise the
  // same order on dealer/facilitator calls.
  reference_number?: string | null
  date_from?: string; date_to?: string
  created_at: string
  item_count?: number; is_max_count?: boolean
  // Per-status item breakdown (added 2026-06-02). The Manage card
  // surfaces only counts; item names stay hidden from the farmer
  // to prevent identity-based manipulation.
  awaiting_approval_count?: number
  returned_count?: number
  postponed_count?: number
  // 2026-06-06 — Approved items awaiting farmer-confirmed pickup.
  // Drives the emerald "Pick up N items from X" banner.
  pickup_ready_count?: number
  // 2026-06-08 — When 'FACILITATOR', the banner switches from
  // "Pick up N items from X" → "Receive N items from X" (the
  // facilitator has already collected from the dealer; the farmer
  // is now receiving them from the facilitator).
  packing_picked_up_by_role?: 'FARMER' | 'FACILITATOR' | null
  // 2026-06-09 — Packing ID for the Pickup chunk lead (mirrors the
  // Facilitator pickup card composition).
  packing_code?: string | null
  // 2026-06-03 — Lineage so the Manage tab can group reroute-child
  // orders under one card. Root of the chain has lineage_root_id ===
  // its own id (backend backfills this on first reroute).
  lineage_root_id?: string
  category?: 'PESTICIDE' | 'FERTILIZER' | null
  variety_name?: string | null
  unit?: string | null; quantity?: number | null; total_price?: number | null
  // Recipient (dealer or facilitator) so the farmer can track who's
  // holding the order without drilling in. Phone is a tel: link.
  recipient_name?: string | null
  recipient_phone?: string | null
  recipient_shop_name?: string | null
  recipient_role?: 'DEALER' | 'FACILITATOR' | null
  // 2026-06-06 — When a facilitator owns the order, returned items
  // stay with the facilitator (not the farmer). Drives the
  // returned-items strip suppression on this tab — see the
  // `returnedN > 0` block below.
  facilitator_user_id?: string | null
  // 2026-08-11 — Cancel-migrate marker (Model B). TRUE on DRAFT rows
  // created when the farmer taps Cancel Order — the items come back
  // as a batch the farmer can Forward or Discard. Populates the
  // Returned pill and unlocks the "Don't need these now" action.
  is_returned_to_farmer?: boolean
  // 2026-08-11 — 30s heartbeat lease from the dealer PWA. When set
  // and in the future, the dealer is actively viewing the order —
  // the farmer's cancel handler short-circuits the confirm dialog
  // and shows "The dealer has opened your order..." directly.
  dealer_viewing_until?: string | null
  // 2026-08-11 — Outgoing-recipient context ("Cancelled by you · from
  // X") for the returned-DRAFT card. Null on every other order shape.
  released_from_recipient_name?: string | null
  released_from_recipient_shop_name?: string | null
  released_from_recipient_role?: 'DEALER' | 'FACILITATOR' | null
}

type DBSPreview = {
  category: 'PESTICIDE' | 'FERTILIZER'
  count: number
  available: boolean
  reason: string | null
  has_locked_brand: boolean
  practice_ids: string[]
  client_id: string
}

type PurchasedItem = {
  id: string; brand_name: string | null; manufacturer_name?: string | null
  l1_type: string | null; l2_type: string | null
  given_volume: number | null; volume_unit: string | null; price: number | null
  scan_verified: boolean
  qr_available?: boolean
  order_id: string; created_at: string
  timeline_name?: string | null
  application_date_from?: string | null
  application_date_to?: string | null
  // 2026-06-03 — set when the backend consolidates same-brand rows
  // across multiple timelines. Lets the UI show "Applied across N
  // timelines" instead of pretending it's a single-timeline row.
  merged_timeline_count?: number
  // 2026-06-06 — Recipient context per item so every Received card
  // can render shop / name + phone (matching the seed-order card
  // shape). Role-aware: an order may have been handled by a
  // dealer OR a facilitator (mutually exclusive backend-side).
  recipient_role?: 'DEALER' | 'FACILITATOR' | null
  recipient_name?: string | null
  recipient_phone?: string | null
  recipient_shop_name?: string | null
  received_at?: string | null
}

const STATUS_COLOUR: Record<string, string> = {
  SENT:               'bg-purple-100 text-purple-700',
  PROCESSING:         'bg-blue-100 text-blue-700',
  SENT_FOR_APPROVAL:  'bg-amber-100 text-amber-700',
  PARTIALLY_APPROVED: 'bg-orange-100 text-orange-700',
  COMPLETED:          'bg-emerald-100 text-emerald-700',
  CANCELLED:          'bg-stone-100 text-[#7A8C7E]',
  DRAFT:              'bg-stone-100 text-[#7A8C7E]',
  APPROVED:           'bg-blue-100 text-blue-700',
  PURCHASED:          'bg-emerald-100 text-emerald-700',
}

export default function CropOrdersPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const router = useRouter()
  const search = useSearchParams()
  const t = useTranslations('orders.cropOrders')
  // 2026-06-23 — Default tab is now Manage (was Order). Per user
  // direction: the farmer's most common need on this page is to act
  // on in-flight orders. The Order tab is for placing new ones —
  // they come here from advisory/CTAs that already pre-fill it.
  const [tab, setTab] = useState<'order' | 'manage' | 'received'>(
    (search.get('tab') as 'order' | 'manage' | 'received') || 'manage',
  )
  const [sub, setSub] = useState<Subscription | null>(null)

  // 2026-06-23 — Manage tab orders hoisted to the parent so the
  // tab strip can render a count badge of in-flight orders, AND so
  // ManageTab can pick its default pill dynamically (priority:
  // approval > returned > pickup > routed) based on what's actually
  // pending. ManageTab still owns mutations; the parent owns the
  // fetch + a reload callback that ManageTab calls after each
  // mutation.
  const [manageOrders, setManageOrders] = useState<SubOrder[] | null>(null)
  const loadManageOrders = useCallback(async () => {
    try {
      const { data } = await api.get<{ orders: SubOrder[] }>(
        `/farmer/subscriptions/${subscriptionId}/orders`,
      )
      // 2026-07-28 — Manage-tab inclusion is now derived from
      // subBelongsToPill: an order belongs in Manage iff it renders
      // in at least one of the four pills. Ties the badge count and
      // the pill counts to the same source of truth so terminal
      // statuses (CANCELLED / REJECTED / REROUTED / EXPIRED /
      // PURCHASED) and empty-COMPLETED orders can't inflate the
      // badge while showing 0 in every pill (user bug 2026-07-28:
      // badge 1, all pills 0 — a REJECTED/CANCELLED order was
      // slipping through the old two-source filter).
      setManageOrders((data.orders || []).filter(o =>
        PILLS.some(p => subBelongsToPill(o, p)),
      ))
    } catch {
      setManageOrders([])
    }
  }, [subscriptionId])

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // No single-subscription endpoint exists today; reuse the list and
    // filter. Cheap enough — payload is small + already cached by /home.
    api.get<Subscription[]>('/farmer/my-subscriptions')
      .then(({ data }) => {
        const match = (data || []).find(s => s.id === subscriptionId)
        if (match) setSub(match)
      })
      .catch(() => {})
    loadManageOrders()
  }, [subscriptionId, router, loadManageOrders])

  // Manage tab badge count + pill counts. Badge = number of distinct
  // order groups in the Manage tab (each is something the farmer is
  // tracking). Pill counts feed ManageTab's dynamic-default-pill pick.
  const { pillCounts, manageBadgeCount } = useMemo(() => {
    if (!manageOrders) {
      return {
        pillCounts: { routed: 0, approval: 0, returned: 0, pickup: 0 } as Record<Pill, number>,
        manageBadgeCount: 0,
      }
    }
    const groupMap = new Map<string, SubOrder[]>()
    for (const o of manageOrders) {
      const key = o.reference_number || o.lineage_root_id || o.id
      const list = groupMap.get(key)
      if (list) list.push(o)
      else groupMap.set(key, [o])
    }
    const counts: Record<Pill, number> = { routed: 0, approval: 0, returned: 0, pickup: 0 }
    for (const list of groupMap.values()) {
      for (const p of PILLS) {
        if (list.some(o => subBelongsToPill(o, p))) counts[p] += 1
      }
    }
    return { pillCounts: counts, manageBadgeCount: groupMap.size }
  }, [manageOrders])

  const todayBeforeStart = useMemo(() => {
    if (!sub?.crop_start_date) return true   // no start date yet → pre-sowing window open
    const start = new Date(sub.crop_start_date)
    return new Date() < start
  }, [sub])
  // Duration-based orders need a start_date reference to compute the
  // DAS-anchored practice windows. Pre-sowing sub-mode still renders
  // without one (it just shows the empty-state line).
  const hasStartDate = !!sub?.crop_start_date

  const tabClass = (k: typeof tab) =>
    `flex-1 py-3 text-sm font-medium transition-colors border-b-2 inline-flex items-center justify-center gap-1.5 ${
      tab === k ? 'border-[#3A7D44] text-[#3A7D44]' : 'border-transparent text-[#7A8C7E]'
    }`

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FARMER" back={`/crop-detail/${subscriptionId}`} />
      <div className="pt-16 pb-20">
        {/* Same company/crop anchor the Advisory / Diagnose / Ask
            Expert surfaces use, so the farmer is grounded the
            instant the page opens. */}
        <ClientCropChip subscriptionId={subscriptionId} />

        {/* 2026-06-23 — Tab order: Manage first (highest-frequency
            need), then Order, then Received. */}
        <div className="flex bg-white border-b border-[#DDD0B8] sticky top-16 z-30">
          <button onClick={() => setTab('manage')}   className={tabClass('manage')}>
            <span>{t('tabs.manage')}</span>
            {manageBadgeCount > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                tab === 'manage'
                  ? 'bg-[#3A7D44] text-white'
                  : 'bg-[#3A7D44]/15 text-[#3A7D44]'
              }`}>{manageBadgeCount}</span>
            )}
          </button>
          <button onClick={() => setTab('order')}    className={tabClass('order')}>{t('tabs.order')}</button>
          <button onClick={() => setTab('received')} className={tabClass('received')}>{t('tabs.received')}</button>
        </div>

        {tab === 'manage' && (
          <ManageTab
            subscriptionId={subscriptionId}
            orders={manageOrders}
            reload={loadManageOrders}
            pillCounts={pillCounts}
          />
        )}
        {tab === 'order' && (
          <OrderTab
            subscriptionId={subscriptionId}
            todayBeforeStart={todayBeforeStart}
            hasStartDate={hasStartDate}
            openHint={(search.get('open') || '').toLowerCase() as 'seed' | 'pesticide' | 'fertilizer' | ''}
            initialDateFrom={search.get('date_from') || ''}
            initialDateTo={search.get('date_to') || ''}
          />
        )}
        {tab === 'received' && <ReceivedTab subscriptionId={subscriptionId} />}
      </div>
    </div>
  )
}


// ── Tab: Order ──────────────────────────────────────────────────────────────
// Three accordions. Pesticide/Fertilizer optionally surface a Pre-sowing
// sub-mode when today < crop_start_date.

function OrderTab({
  subscriptionId, todayBeforeStart, hasStartDate, openHint, initialDateFrom, initialDateTo,
}: {
  subscriptionId: string
  todayBeforeStart: boolean
  hasStartDate: boolean
  openHint: 'seed' | 'pesticide' | 'fertilizer' | ''
  initialDateFrom: string
  initialDateTo: string
}) {
  const [open, setOpen] = useState<'seed' | 'pesticide' | 'fertilizer' | null>(
    openHint || null,
  )
  const t = useTranslations('orders.cropOrders.accordions')
  return (
    <div className="p-4 space-y-2">
      <Accordion title={t('seed')} emoji="🌱" open={open === 'seed'} onToggle={() => setOpen(o => o === 'seed' ? null : 'seed')}>
        <SeedSection subscriptionId={subscriptionId} />
      </Accordion>
      <Accordion title={t('pesticide')} emoji="🧪" open={open === 'pesticide'} onToggle={() => setOpen(o => o === 'pesticide' ? null : 'pesticide')}>
        <CategorySection
          subscriptionId={subscriptionId}
          category="PESTICIDE"
          todayBeforeStart={todayBeforeStart}
          hasStartDate={hasStartDate}
          initialDateFrom={initialDateFrom}
          initialDateTo={initialDateTo}
        />
      </Accordion>
      <Accordion title={t('fertilizer')} emoji="🌾" open={open === 'fertilizer'} onToggle={() => setOpen(o => o === 'fertilizer' ? null : 'fertilizer')}>
        <CategorySection
          subscriptionId={subscriptionId}
          category="FERTILIZER"
          todayBeforeStart={todayBeforeStart}
          hasStartDate={hasStartDate}
          initialDateFrom={initialDateFrom}
          initialDateTo={initialDateTo}
        />
      </Accordion>
    </div>
  )
}

function Accordion({ title, emoji, open, onToggle, children }: {
  title: string; emoji: string
  open: boolean; onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#DDD0B8] overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{emoji}</span>
          <p className="font-semibold text-[#6B3F1F] text-sm">{title}</p>
        </div>
        <span className={`text-[#7A8C7E] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && <div className="px-4 pb-4 border-t border-[#F0E5D0]">{children}</div>}
    </div>
  )
}


function SeedSection({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.seedSection')
  return (
    <div className="pt-3 space-y-3">
      <p className="text-xs text-[#7A8C7E]">
        {t('body')}
      </p>
      <button onClick={() => router.push(`/subscribe/seed-varieties/${subscriptionId}`)}
        className="w-full py-3 rounded-xl text-white text-sm font-semibold"
        style={{ background: '#3A7D44' }}>
        {t('browseCta')}
      </button>
    </div>
  )
}


function CategorySection({
  subscriptionId, category, todayBeforeStart, hasStartDate, initialDateFrom, initialDateTo,
}: {
  subscriptionId: string
  category: 'PESTICIDE' | 'FERTILIZER'
  todayBeforeStart: boolean
  hasStartDate: boolean
  initialDateFrom: string
  initialDateTo: string
}) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.category')
  // 2026-06-03 — dateFrom is locked to today. The deep-link param is
  // ignored for From (we no longer let advisory pre-fill it to a past
  // date) — orders only flow forward from "now". To stays editable.
  const todayISO = new Date().toISOString().slice(0, 10)
  const [dateFrom, setDateFrom] = useState(todayISO)
  const [dateTo, setDateTo] = useState(initialDateTo || '')
  const [preview, setPreview] = useState<{ count: number; practice_ids: string[] } | null>(null)
  const [loading, setLoading] = useState(false)

  // Auto-preview when To-date is set. The server defaults date_from
  // to today; the From input here is purely informational and used
  // when handing off to /order/new below.
  useEffect(() => {
    if (!dateTo) { setPreview(null); return }
    let cancelled = false
    setLoading(true)
    api.get<{ count: number; practices: { id: string }[] }>(
      `/farmer/subscriptions/${subscriptionId}/order-preview?category=${category}&to_date=${dateTo}`,
    )
      .then(({ data }) => {
        if (!cancelled) {
          // Hold practice_ids alongside the count — /order/new needs
          // them in the URL so its POST hits the right bundle. Without
          // this hand-off the page's defensive empty-practices guard
          // redirects without posting.
          setPreview({
            count: data.count,
            practice_ids: (data.practices || []).map(p => p.id),
          })
        }
      })
      .catch(() => { if (!cancelled) setPreview(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [subscriptionId, category, dateTo])

  const canContinue = !!(dateFrom && dateTo && preview && preview.count > 0)

  return (
    <div className="pt-3 space-y-3">
      {/* Pre-sowing sub-mode — visible whenever today < start_date.
          We ALWAYS render it in the window so the farmer isn't
          surprised that the option doesn't appear; an empty pool
          shows an explicit "nothing recommended" line. */}
      {todayBeforeStart && (
        <PreSowingSubMode subscriptionId={subscriptionId} category={category} />
      )}

      {!hasStartDate ? (
        // Without a crop_start_date the DAS-anchored date-range
        // section just stays out. Mentioning "start date" here was
        // confusing — the farmer reads "date" and assumes it's the
        // order's date range. The dashboard owns the start-date
        // decision; this screen only surfaces what's actionable now.
        // (Reported 2026-06-02.)
        null
      ) : (
        <div>
          <p className="text-[11px] font-semibold text-[#7A8C7E] uppercase tracking-wider mb-2">
            {category === 'PESTICIDE' ? t('headerPesticide') : t('headerFertilizer')}
          </p>
          {/* 2026-06-03 — From is a locked "Today" pill (no input).
              To is a styled button overlaying a hidden native date
              picker so we control the visible DD/MM/YYYY format. */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] text-[#7A8C7E]">{t('fromLabel')}</p>
              <div className="mt-1 w-full border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm bg-stone-50 text-[#6B3F1F] font-medium">
                {t('todayPill')}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-[#7A8C7E]">{t('toLabel')}</p>
              <div className="mt-1 relative w-full border border-[#DDD0B8] rounded-lg bg-white">
                <p className={`px-3 py-2 text-sm ${dateTo ? 'text-[#6B3F1F] font-medium' : 'text-[#7A8C7E]'}`}>
                  {dateTo
                    ? new Date(dateTo).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
                    : t('pickDate')}
                </p>
                <input type="date" value={dateTo} min={todayISO}
                  onChange={e => setDateTo(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              </div>
            </div>
          </div>
          {dateTo && (
            <p className="text-xs text-[#7A8C7E] mt-2">
              {loading ? t('checking') :
               preview && preview.count > 0 ? t('recommendedInWindow', { count: preview.count }) :
               preview ? t('nothingInWindow') : t('noPreview')}
            </p>
          )}
          <button
            disabled={!canContinue}
            onClick={() => {
              const params = new URLSearchParams({
                category,
                order_type: category,
                date_from: dateFrom,
                date_to: dateTo,
                practice_ids: (preview?.practice_ids || []).join(','),
              })
              router.push(`/order/new/${subscriptionId}?${params.toString()}`)
            }}
            className="mt-3 w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
            style={{ background: '#3A7D44' }}>
            {t('continueBtn')}
          </button>
        </div>
      )}
    </div>
  )
}


function PreSowingSubMode({ subscriptionId, category }: { subscriptionId: string; category: 'PESTICIDE' | 'FERTILIZER' }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.preSowing')
  const [preview, setPreview] = useState<DBSPreview | null>(null)

  useEffect(() => {
    let cancelled = false
    api.get<DBSPreview>(
      `/farmer/subscriptions/${subscriptionId}/dbs-bulk-preview?category=${category}`,
    )
      .then(({ data }) => { if (!cancelled) setPreview(data) })
      .catch(() => { if (!cancelled) setPreview(null) })
    return () => { cancelled = true }
  }, [subscriptionId, category])

  if (!preview) return null
  // Spec correction (2026-06-02) — show the sub-mode in the
  // pre-sowing window even when count is zero, so the farmer
  // doesn't worry that the option is missing.

  return (
    <div className="bg-emerald-50/40 border border-[#3A7D44]/20 rounded-xl p-3">
      <p className="text-[11px] font-semibold text-[#3A7D44] uppercase tracking-wider">
        {category === 'PESTICIDE' ? t('headerPesticides') : t('headerFertilizers')}
      </p>
      {preview.available ? (
        <>
          <p className="text-sm text-[#6B3F1F] mt-1">
            {t('recommendedBeforeSowing', { count: preview.count })}
            {preview.has_locked_brand && <span className="text-[11px] text-[#7A8C7E] block mt-0.5">{t('lockedBrandApplies')}</span>}
          </p>
          <button
            onClick={() => {
              // Reuse the existing DBS flow on the Advisory page until
              // we ship a dedicated bulk-DBS surface here. Phase 3
              // mid-step: takes the farmer back to Advisory where the
              // DBS picker is wired. (Will inline in a follow-on.)
              router.push(`/advisory/${subscriptionId}`)
            }}
            className="mt-2 w-full py-2 rounded-lg text-white text-xs font-semibold"
            style={{ background: '#3A7D44' }}>
            {category === 'PESTICIDE' ? t('ctaPesticides') : t('ctaFertilizers')}
          </button>
        </>
      ) : (
        <p className="text-xs text-[#7A8C7E] mt-1">
          {t('empty')}
        </p>
      )}
    </div>
  )
}


// ── Tab: Manage ─────────────────────────────────────────────────────────────

// 2026-06-09 — Mirror Facilitator pattern on Farmer Manage tab:
// Order-ID grouped cards + 4 action pills (Routed / For Approval /
// Returned / Pickup). "With Farmer" on the facilitator is "For
// Approval" here — the farmer is the one approving. An Order ID
// card appears in multiple pills if its sub-orders span multiple
// statuses (same rule as Facilitator).
type Pill = 'routed' | 'approval' | 'returned' | 'pickup'

const PILLS: readonly Pill[] = ['routed', 'approval', 'returned', 'pickup'] as const

function subBelongsToPill(o: SubOrder, pill: Pill): boolean {
  // Terminal sub-orders never show in active pills — they belong
  // to History (separate surface, Batch 3).
  // 2026-06-20 — EXPIRED added: an order whose window lapsed without
  // farmer-receipt is terminal too. Pre-fix it leaked into Routed and
  // its tap-target crashed (user report).
  if (['CANCELLED', 'PURCHASED', 'REJECTED', 'REROUTED', 'EXPIRED'].includes(o.status)) {
    return false
  }
  // 2026-08-11 — COMPLETED is "approval work done" — order status flips
  // once every item is APPROVED. But the farmer may still need to pick
  // items up. So COMPLETED belongs on the Pickup pill (until pickup is
  // confirmed and pickup_ready_count drops to 0), NOT on Routed /
  // Approval / Returned. Earlier fix put it in the outright-terminal
  // list, which sent pickup-pending orders to the Received tab — wrong
  // surface, farmer looks under Received for something they haven't
  // received yet.
  if (o.status === 'COMPLETED' && pill !== 'pickup') {
    return false
  }

  if (o.kind === 'SEED') {
    // 2026-08-11 — A seed DRAFT with is_returned_to_farmer=true was
    // moved back to the farmer by their own cancel; belongs on the
    // Returned pill, NOT Routed, so the forward-or-discard prompt is
    // visible there.
    if (o.status === 'DRAFT' && o.is_returned_to_farmer) {
      return pill === 'returned'
    }
    // Seed lifecycle uses status directly (no per-item counts).
    switch (pill) {
      case 'routed':
        return ['DRAFT', 'SENT', 'ACCEPTED', 'AVAILABLE', 'POSTPONED'].includes(o.status)
      case 'approval':
        return o.status === 'SENT_FOR_APPROVAL'
      case 'returned':
        return o.status === 'NOT_AVAILABLE'
      case 'pickup':
        // 2026-06-19 — Seeds now have a physical-pickup step.
        // Farmer-approve lands the order at READY_FOR_PICKUP; the
        // Pickup pill surfaces it with an inline "I've picked up
        // the seed" button. Either farmer or dealer (via /handover)
        // closes the order — whichever taps first wins.
        return o.status === 'READY_FOR_PICKUP'
    }
  }

  // 2026-08-11 — Cancel-migrate DRAFT (Model B, pesticide/fert).
  // The DRAFT carries the items the farmer released from a cancelled
  // dealer engagement and belongs exclusively on the Returned pill —
  // NOT Routed — so the whole-batch forward/discard prompt is the
  // visible action.
  if (o.status === 'DRAFT' && o.is_returned_to_farmer) {
    return pill === 'returned'
  }

  const awaiting = o.awaiting_approval_count ?? 0
  const returned = o.returned_count ?? 0
  const pickup = o.pickup_ready_count ?? 0
  // 2026-06-21 — For facilitator-routed orders, returned items live
  // in the facilitator's queue (their /facilitator/orders Returned
  // pill carries the reroute action). The farmer only ever sees the
  // order back on their Returned pill AFTER the facilitator hits
  // return-to-farmer (which creates a fresh DRAFT with
  // facilitator_user_id=NULL). For Approval + Pickup always go to
  // the farmer regardless of routing.
  const facilitatorOwned = !!o.facilitator_user_id
  switch (pill) {
    case 'routed':
      // Direct: dealer is processing or order is DRAFT awaiting send.
      // Facilitator-routed: ignore returned (facilitator handles).
      // Approval + pickup pull the order out either way.
      if (facilitatorOwned) return awaiting === 0 && pickup === 0
      return awaiting === 0 && returned === 0 && pickup === 0
    case 'approval':
      return awaiting > 0
    case 'returned':
      // Hide facilitator-routed orders — those are in the
      // facilitator's queue. They only resurface here after
      // facilitator's return-to-farmer creates a fresh DRAFT.
      return returned > 0 && !facilitatorOwned
    case 'pickup':
      return pickup > 0
  }
}

function ManageTab({
  subscriptionId, orders, reload, pillCounts,
}: {
  subscriptionId: string
  orders: SubOrder[] | null
  reload: () => Promise<void>
  pillCounts: Record<Pill, number>
}) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.manage')
  const search = useSearchParams()
  const [busy, setBusy] = useState<string | null>(null)
  // 2026-06-19 — Pill is URL-controllable via ?pill=, mirroring the
  // pattern on /dealer/orders. Lets handlers from other pages
  // (seed approve, mark-received redirects) land the farmer on
  // the right pill without an extra tap.
  // 2026-06-23 — Dynamic default: when no ?pill= is given (the
  // farmer just landed on Manage), pick the highest-priority pill
  // that actually has activity: approval > returned > pickup >
  // routed. So a fresh order submission lands on Routed (only thing
  // with items), but the moment the dealer marks something
  // available the next visit lands on For Approval, etc. User
  // direction.
  const initialUrlPill = (search.get('pill') as Pill) || null
  const [pill, setPillRaw] = useState<Pill>(initialUrlPill || 'approval')
  const [pillUserPicked, setPillUserPicked] = useState(!!initialUrlPill)
  function setPill(p: Pill) { setPillRaw(p); setPillUserPicked(true) }
  // Once orders load, if the user hasn't picked a pill and no URL
  // param forced one, snap to the highest-priority non-empty pill.
  useEffect(() => {
    if (pillUserPicked) return
    if (orders === null) return
    const priority: Pill[] = ['approval', 'returned', 'pickup', 'routed']
    for (const p of priority) {
      if (pillCounts[p] > 0) { setPillRaw(p); return }
    }
    // All empty — leave at the default ('approval'). The empty-state
    // copy then reads "Nothing under For Approval" which is the
    // calmest read of "you have no orders right now."
  }, [orders, pillCounts, pillUserPicked])
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  // 2026-06-23 — `load` is now a no-arg call to the parent's
  // hoisted reload. Kept as a local alias so the existing handler
  // bodies don't change shape.
  const load = reload

  async function cancel(orderId: string, kind: 'REGULAR' | 'SEED') {
    // 2026-08-11 — Tap-time server eligibility check. The dealer's
    // heartbeat can be freshly stamped between our list fetch and
    // the farmer's tap, so cached dealer_viewing_until is stale by
    // definition. GET the authoritative state now — if not
    // eligible, alert the specific reason and stop (no confirm
    // dialog for a cancel the server would immediately refuse).
    setBusy(orderId)
    try {
      const path = kind === 'SEED' ? '/farmer/seed-orders' : '/farmer/orders'
      const { data: elig } = await api.get<{
        can_cancel: boolean; code: string | null; message: string | null
      }>(`${path}/${orderId}/cancel-eligibility`)
      if (!elig.can_cancel) {
        alert(elig.message || 'This order cannot be cancelled right now.')
        return
      }
      // 2026-08-11 — Cancel-migrate (Model B). Release the dealer;
      // pending / postponed items come back to the farmer as a
      // returned batch on the Returned pill. From there the farmer
      // chooses to Send to another dealer OR Set aside (discard).
      const cancelMsg =
        "Cancel this order? Your dealer will be released. Your pending items will come back to you " +
        "on the Returned pill — you can send them to another dealer or set them aside."
      if (!confirm(cancelMsg)) return
      await api.put(`${path}/${orderId}/cancel`, {})
      await load()
    } catch (err) {
      // Server-side 409 stays as the safety net for the (tiny) race
      // window between the eligibility GET and the cancel PUT — the
      // dealer could open the order in that gap.
      surfaceApiError(err, 'Could not cancel this order. Please try again.')
    } finally { setBusy(null) }
  }

  async function deleteOrder(orderId: string, kind: 'REGULAR' | 'SEED') {
    // 2026-06-09 — Delete now covers two cases: CANCELLED husks
    // (existing) and DRAFT (e.g. from dealer-decline cancel-and-
    // migrate where the farmer wants to discard rather than send).
    // Look up the order's current status so the confirm copy reads
    // right.
    const target = (orders || []).find(o => o.id === orderId)
    const isDraft = target?.status === 'DRAFT'
    if (!confirm(isDraft ? t('confirmDeleteDraft') : t('confirmDeleteCancelled'))) return
    setBusy(orderId)
    try {
      if (kind === 'SEED') {
        await api.delete(`/farmer/seed-orders/${orderId}`)
      } else {
        await api.delete(`/farmer/orders/${orderId}`)
      }
      await load()
    } finally { setBusy(null) }
  }

  async function approveAll(orderId: string, kind: 'REGULAR' | 'SEED') {
    setBusy(orderId)
    try {
      if (kind === 'SEED') {
        await api.put(`/farmer/seed-orders/${orderId}/approve`, {})
        // 2026-06-19 — Seed-approve moves the order into the Pickup
        // pill where the farmer's mark-received button lives. Hop the
        // pill so the next CTA is visible without a fresh tap.
        setPill('pickup')
      } else {
        await api.put(`/farmer/orders/${orderId}/items/approve-all`, {})
      }
      await load()
    } finally { setBusy(null) }
  }

  // 2026-06-19 — Farmer confirms physical pickup of a seed order.
  // Either-actor-wins: dealer's /handover does the same transition
  // (READY_FOR_PICKUP → PURCHASED); whichever side taps first wins.
  async function markReceivedSeed(orderId: string) {
    setBusy(orderId)
    try {
      await api.put(`/farmer/seed-orders/${orderId}/mark-received`, {})
      await load()
    } catch {
      alert(t('errorMarkReceivedSeed'))
    } finally { setBusy(null) }
  }

  // 2026-06-06 — Inline reroute action routes directly to the focused
  // forward page (which handles the postponed nudge + picker without
  // a review-page detour). User direction: keep the Manage card
  // tap-target scoped to the two underlined links only.
  function rerouteReturned(orderId: string) {
    router.push(`/orders/${orderId}/forward`)
  }

  // 2026-08-11 — Shared error-surfacer for cancel / discard endpoints.
  // Backend gates return 409 with `detail.message`; we alert() that
  // verbatim so the farmer sees the specific reason (dealer viewing,
  // items awaiting your approval, etc.) instead of the failed action
  // just doing nothing.
  function surfaceApiError(err: unknown, fallback: string) {
    const e = err as {
      response?: { data?: { detail?: string | { code?: string; message?: string } } }
    }
    const detail = e?.response?.data?.detail
    const msg =
      typeof detail === 'object' && detail !== null && detail.message
        ? detail.message
        : (typeof detail === 'string' ? detail : null)
    alert(msg || fallback)
  }

  // 2026-08-11 — Cancel-migrate DRAFT (Model B) discard. "Don't need
  // these now" — DRAFT → CANCELLED, items → REROUTED on the backend
  // so advisory re-offers the practice with an Order CTA on the next
  // pull. Soft confirm (destructive-ish but recoverable via advisory).
  async function discardReturnedDraft(orderId: string, kind: 'REGULAR' | 'SEED') {
    if (!confirm(
      "Set these items aside? They'll show back up in your advisory so you can order them again later.",
    )) return
    setBusy(orderId)
    try {
      if (kind === 'SEED') {
        await api.put(`/farmer/seed-orders/${orderId}/discard`, {})
      } else {
        await api.put(`/farmer/orders/${orderId}/discard`, {})
      }
      await load()
    } catch (err) {
      surfaceApiError(err, 'Could not set these items aside. Please try again.')
    } finally { setBusy(null) }
  }

  // 2026-08-11 — Dealer-returned discard. Symmetry with the forward
  // flow: if the same source order also has POSTPONED items sitting
  // with the current dealer, we show a nudge sheet asking "discard
  // those too, or leave them?" — parallel to the include-postponed
  // nudge on /forward. When no postponed items exist, we fall back
  // to a plain confirm.
  const [discardNudge, setDiscardNudge] = useState<SubOrder | null>(null)
  function openDiscardReturnedItems(sub: SubOrder) {
    if ((sub.postponed_count ?? 0) > 0) {
      setDiscardNudge(sub)
      return
    }
    // No postponed items — plain confirm, then fire.
    if (!confirm(
      "Set these returned items aside? They'll show back up in your advisory so you can order them again later.",
    )) return
    void commitDiscardReturnedItems(sub, false)
  }
  async function commitDiscardReturnedItems(sub: SubOrder, includePostponed: boolean) {
    setDiscardNudge(null)
    setBusy(sub.id)
    try {
      await api.put(`/farmer/orders/${sub.id}/discard-returned-items`, {
        include_postponed: includePostponed,
      })
      await load()
    } catch (err) {
      surfaceApiError(err, 'Could not set these items aside. Please try again.')
    } finally { setBusy(null) }
  }

  if (orders === null) return <div className="m-4 h-20 bg-white/60 rounded-2xl animate-pulse" />
  // Keep pills + History visible even with zero orders — per-pill empty state handles the copy.
  const groups = (() => {
    const map = new Map<string, SubOrder[]>()
    for (const o of orders || []) {
      const key = o.reference_number || o.lineage_root_id || o.id
      const list = map.get(key)
      if (list) list.push(o)
      else map.set(key, [o])
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    return map
  })()

  // 2026-06-05 — Approval queue (kept inside the For Approval pill
  // per user direction 2026-06-09). Show approvals one at a time in
  // arrival order with a "1 of N" peek so the farmer knows others
  // are queued. Independent decisions (Returned / Pickup / Routed)
  // are shown all-at-once on their respective pills.
  const allAwaiting = (orders || [])
    .filter(o => (o.awaiting_approval_count || 0) > 0)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const currentAwaiting = allAwaiting[0]
  const otherAwaiting = allAwaiting.slice(1)

  // 2026-06-23 — Pill counts are now computed at the parent (so
  // the tab strip can render a Manage badge and the dynamic-default-
  // pill effect can read them on mount). Alias here so the existing
  // pill-tile render below keeps reading `counts[p]`.
  const counts = pillCounts

  // Visible groups for the selected pill.
  const visibleGroups: { key: string; subs: SubOrder[]; matching: SubOrder[] }[] = []
  for (const [key, list] of groups.entries()) {
    let matching = list.filter(o => subBelongsToPill(o, pill))
    // Approval-queue: only the earliest approval sub-order shows
    // when on the For Approval pill — others wait behind.
    if (pill === 'approval' && matching.length > 0 && currentAwaiting) {
      matching = matching.filter(o => o.id === currentAwaiting.id)
    }
    if (matching.length > 0) {
      visibleGroups.push({ key, subs: list, matching })
    }
  }
  visibleGroups.sort((a, b) => {
    const aT = Math.max(...a.subs.map(o => new Date(o.created_at).getTime()))
    const bT = Math.max(...b.subs.map(o => new Date(o.created_at).getTime()))
    return bT - aT
  })

  return (
    <div className="p-4 space-y-3">
      {/* Pill row + History link. Mirrors the dealer-orders feed
          layout (2026-06-19): pills wrap naturally (no horizontal
          scroll), History sits absolute at row-2 right, aligned
          with the wrapped pill — emerging behind the 4-pill row's
          empty slot. */}
      <div className="relative">
        <div className="flex flex-wrap gap-2">
          {PILLS.map(p => {
            const active = pill === p
            const n = counts[p]
            return (
              <button key={p} onClick={() => setPill(p)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  active
                    ? 'bg-[#3A7D44] text-white border-[#3A7D44]'
                    : 'bg-white text-[#6B3F1F] border-[#DDD0B8]'
                }`}>
                <span>{t(`pill.${p}`)}</span>
                {/* 2026-06-09 — Count badge: filled circle so the
                    task-load reads at a glance. Tinted for the
                    active pill (white on green), role accent for
                    inactive pills. Zero is muted so the eye skips. */}
                <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                  active
                    ? 'bg-white/25 text-white'
                    : n === 0
                      ? 'bg-stone-100 text-[#7A8C7E]'
                      : 'bg-[#3A7D44]/15 text-[#3A7D44]'
                }`}>{n}</span>
              </button>
            )
          })}
        </div>
        {/* History — absolute at row-2 right (mirrors the dealer
            feed). Row 2 typically holds the 4th pill alone on a
            phone-width column, leaving generous empty space to the
            right where History sits. */}
        <button onClick={() => router.push(`/crop-detail/${subscriptionId}/orders/history`)}
          className="absolute top-[40px] right-0 text-xs font-semibold text-[#7A8C7E] active:text-[#3A7D44]">
          📁 {t('historyChip')} →
        </button>
      </div>

      {/* Approval 1-of-N peek banner — only shown on the For
          Approval pill when more approvals are queued behind the
          current one. Per user direction 2026-06-09. */}
      {pill === 'approval' && currentAwaiting && otherAwaiting.length > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2 text-xs text-indigo-800">
          {t('approvalPeek')} <strong>{t('approvalPeekProgress', { total: allAwaiting.length })}</strong> ·{' '}
          <span className="text-indigo-600">{t('approvalPeekHint')}</span>
        </div>
      )}

      {visibleGroups.length === 0 && (
        <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center">
          <p className="text-sm text-[#7A8C7E]">{t('emptyPill', { pillName: t(`pill.${pill}`) })}</p>
        </div>
      )}

      {visibleGroups.map(({ key, subs, matching }) => (
        <OrderIdCard
          key={key}
          orderId={subs[0]?.reference_number || subs[0]?.id || 'unknown'}
          subs={subs}
          matching={matching}
          pill={pill}
          expanded={expandedGroup === key}
          onToggleExpand={() => setExpandedGroup(expandedGroup === key ? null : key)}
          onCancel={(id, kind) => cancel(id, kind)}
          onDelete={(id, kind) => deleteOrder(id, kind)}
          onForwardReturned={rerouteReturned}
          onDiscard={discardReturnedDraft}
          onDiscardReturnedItems={openDiscardReturnedItems}
          onMarkReceivedSeed={markReceivedSeed}
          busy={busy}
        />
      ))}

      {/* 2026-08-11 — Dealer-returned discard nudge. Parallel to the
          include-postponed nudge on /forward — asks the farmer to
          decide the fate of any POSTPONED items still with the same
          dealer when they Discard the returned items. */}
      {discardNudge && (() => {
        const returnedN = discardNudge.returned_count
          ?? (discardNudge.status === 'NOT_AVAILABLE' ? 1 : 0)
        const postponedN = discardNudge.postponed_count ?? 0
        return (
          <div className="fixed inset-0 z-[60] bg-black/50 flex items-end">
            <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
              style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}>
              <p className="font-bold text-[#6B3F1F]">Set them aside?</p>
              <p className="text-xs text-[#7A8C7E] mt-2 leading-relaxed">
                The dealer still has <strong className="text-[#6B3F1F]">{postponedN} postponed item{postponedN === 1 ? '' : 's'}</strong> waiting for delivery,
                separate from the {returnedN} returned item{returnedN === 1 ? '' : 's'} you want to set aside.
                What should we do with the postponed one{postponedN === 1 ? '' : 's'}?
              </p>
              <div className="space-y-2 mt-4">
                <button
                  onClick={() => void commitDiscardReturnedItems(discardNudge, true)}
                  className="w-full py-3 rounded-xl text-white text-sm font-semibold"
                  style={{ background: 'linear-gradient(135deg, #b45309, #92400e)' }}>
                  Set aside all {returnedN + postponedN} items
                </button>
                <button
                  onClick={() => void commitDiscardReturnedItems(discardNudge, false)}
                  className="w-full py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium">
                  Only the {returnedN} returned — leave postponed with dealer
                </button>
                <button
                  onClick={() => setDiscardNudge(null)}
                  className="w-full py-2 text-[#7A8C7E] text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── Per-pill chunk renderers + Order-ID card (Batch 1, 2026-06-09) ─────────

function OrderIdCard({
  orderId, subs, matching, pill, expanded, onToggleExpand,
  onCancel, onDelete, onForwardReturned, onDiscard,
  onDiscardReturnedItems, onMarkReceivedSeed, busy,
}: {
  orderId: string
  subs: SubOrder[]
  matching: SubOrder[]
  pill: Pill
  expanded: boolean
  onToggleExpand: () => void
  onCancel: (id: string, kind: 'REGULAR' | 'SEED') => void
  onDelete: (id: string, kind: 'REGULAR' | 'SEED') => void
  onForwardReturned: (id: string) => void
  onDiscard: (id: string, kind: 'REGULAR' | 'SEED') => void
  onDiscardReturnedItems: (sub: SubOrder) => void
  onMarkReceivedSeed: (id: string) => void
  busy: string | null
}) {
  const t = useTranslations('orders.cropOrders.manage')
  const head = subs[0]
  // Single-chunk inline; multi-chunk (e.g. lineage has two sibling
  // sub-orders both with returned items) renders as rows with
  // "Sub-order · date" micro-header.
  const renderRows = matching.length > 1

  // Cancel allowed when source has live work + farmer hasn't
  // already cancelled it. Cancel walks the lineage server-side
  // (per Batch 6: cascade across siblings, all migrate to one
  // new DRAFT). So we offer Cancel at the Order-ID level.
  const liveSubs = subs.filter(s =>
    !['CANCELLED', 'PURCHASED', 'COMPLETED', 'REJECTED', 'REROUTED', 'EXPIRED'].includes(s.status),
  )
  // 2026-06-09 — Cancel-on-DRAFT was visually a no-op (cancel-and-
  // migrate creates another DRAFT with the same items, so the user
  // sees no change and thinks Cancel failed). DRAFT now offers a
  // Delete action instead (different button below) — the review
  // page already excludes DRAFT from canCancel.
  const cancellable = liveSubs.find(s => {
    if (s.kind === 'SEED') {
      return !['DRAFT', 'SENT_FOR_APPROVAL'].includes(s.status)
    }
    return s.status !== 'DRAFT' && (s.awaiting_approval_count || 0) === 0
  })
  // A DRAFT sub-order is deletable. Typically arrives via
  // dealer-decline cancel-and-migrate; farmer can discard it
  // entirely instead of picking a recipient.
  // 2026-08-11 — Skip returned-from-cancel DRAFTs: the ReturnedChunk
  // above already exposes "Don't need these now" (soft discard →
  // advisory re-offers), which is the semantically correct action
  // for that batch. Showing "Delete draft" alongside is redundant
  // and confusing.
  const deletable = liveSubs.find(s =>
    s.kind === 'REGULAR' && s.status === 'DRAFT' && !s.is_returned_to_farmer,
  )

  return (
    <div className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
      <OrderCardHeader head={head} subCount={subs.length} expanded={expanded}
        onToggleExpand={onToggleExpand} orderId={orderId} />
      <div className="divide-y divide-[#F0E5D0]">
        {renderRows
          ? matching.map(sub => (
              <FarmerPillChunk key={sub.id} sub={sub} pill={pill}
                onForwardReturned={onForwardReturned}
                onDiscard={onDiscard}
                onDiscardReturnedItems={onDiscardReturnedItems}
                onMarkReceivedSeed={onMarkReceivedSeed}
                busy={busy} showSubHeader />
            ))
          : matching.length === 1 && (
              <FarmerPillChunk sub={matching[0]} pill={pill}
                onForwardReturned={onForwardReturned}
                onDiscard={onDiscard}
                onDiscardReturnedItems={onDiscardReturnedItems}
                onMarkReceivedSeed={onMarkReceivedSeed}
                busy={busy} />
            )
        }
      </div>
      {expanded && (
        <ExpandedSubOrderList subs={subs} />
      )}
      {/* Cancel / cleanup row — surfaced at the Order ID level
          because cancel cascades across the lineage. */}
      {cancellable && (
        <div className="border-t border-[#F0E5D0] px-4 py-2">
          <button onClick={() => onCancel(cancellable.id, cancellable.kind)}
            disabled={busy === cancellable.id}
            className="w-full py-1.5 rounded-lg border border-red-300 text-red-600 text-xs font-medium disabled:opacity-50">
            {busy === cancellable.id ? '…' : t('cancelOrderBtn')}
          </button>
        </div>
      )}
      {/* 2026-06-09 — Delete DRAFT. Per user direction: cancel-and-
          migrate on a DRAFT is a no-op visually (it creates an
          identical DRAFT), so DRAFT gets a real Delete instead. */}
      {!cancellable && deletable && (
        <div className="border-t border-[#F0E5D0] px-4 py-2">
          <button onClick={() => onDelete(deletable.id, deletable.kind)}
            disabled={busy === deletable.id}
            className="w-full py-1.5 rounded-lg border border-red-300 text-red-600 text-xs font-medium disabled:opacity-50">
            {busy === deletable.id ? '…' : t('deleteDraftBtn')}
          </button>
        </div>
      )}
    </div>
  )
}

function OrderCardHeader({
  head, subCount, expanded, onToggleExpand, orderId,
}: {
  head: SubOrder | undefined
  subCount: number
  expanded: boolean
  onToggleExpand: () => void
  orderId: string
}) {
  const t = useTranslations('orders.cropOrders.orderHeader')
  const tRecipient = useTranslations('orders.cropOrders.recipient')
  const locale = useLocale()
  // 2026-06-20 — Order ID promoted from text-[10px] font-mono to the
  // same prominence the dealer's card gives it (text-xs font-semibold
  // mono, emerald). Order ID is the primary cross-role identifier;
  // farmer / dealer / facilitator all confirm it over the phone.
  // Recipient block (name + role) follows so the farmer immediately
  // sees who's currently processing without expanding the chunk.
  const recipientName = head?.recipient_role === 'DEALER'
    ? (head?.recipient_shop_name || head?.recipient_name)
    : (head?.recipient_name || head?.recipient_shop_name)
  const recipientRoleLabel = head?.recipient_role === 'FACILITATOR'
    ? tRecipient('facilitatorLabel')
    : tRecipient('dealerLabel')
  return (
    <div className="px-4 py-3 bg-[#F5F0E8]/40">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-xs font-mono font-semibold text-[#3A7D44] tracking-wide truncate">
          {orderId}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-semibold text-[#7A8C7E] uppercase tracking-wider">
            {head?.kind === 'SEED' ? t('kindSeed') : (head?.category?.toLowerCase() || t('kindFallback'))}
          </span>
          <span className="text-[10px] text-[#7A8C7E]">
            {head?.created_at && new Date(head.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
          </span>
        </div>
      </div>
      {head?.kind === 'SEED' ? (
        <p className="text-sm text-[#6B3F1F] truncate mt-0.5">{head.variety_name || t('seedFallback')}</p>
      ) : (
        <p className="text-sm text-[#6B3F1F] mt-0.5">
          {head?.date_from && head?.date_to ? (
            <>
              {new Date(head.date_from).toLocaleDateString(locale, { day: '2-digit', month: 'short' })} —
              {' '}{new Date(head.date_to).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
            </>
          ) : null}
        </p>
      )}
      {/* Recipient line — name + role inline, phone tap-call on the
          right. Renders whenever the order has a recipient set; the
          fallback "—" appears when the recipient fields are null
          (data anomaly) so the farmer still sees the slot. */}
      {(recipientName || head?.recipient_phone) && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="text-[11px] text-[#6B3F1F] truncate">
            <span className="text-[#7A8C7E]">{tRecipient('routedToPrefix')} </span>
            <span className="font-semibold">{recipientName || '—'}</span>
            {recipientName && (
              <span className="text-[#7A8C7E]"> · {recipientRoleLabel}</span>
            )}
          </p>
          {head?.recipient_phone && (
            <a href={`tel:${head.recipient_phone}`}
              onClick={e => e.stopPropagation()}
              className="text-[10px] font-semibold text-[#3A7D44] px-2 py-0.5 rounded-lg bg-emerald-50 shrink-0">
              📞
            </a>
          )}
        </div>
      )}
      {subCount > 1 && (
        <button onClick={onToggleExpand}
          className="text-[10px] font-semibold text-[#7A8C7E] mt-2 flex items-center gap-1">
          {expanded ? '▾' : '▸'} {t('expandSubs', { count: subCount })}
        </button>
      )}
    </div>
  )
}

function FarmerPillChunk({
  sub, pill, onForwardReturned, onDiscard, onDiscardReturnedItems,
  onMarkReceivedSeed, busy, showSubHeader,
}: {
  sub: SubOrder
  pill: Pill
  onForwardReturned: (id: string) => void
  onDiscard: (id: string, kind: 'REGULAR' | 'SEED') => void
  onDiscardReturnedItems: (sub: SubOrder) => void
  onMarkReceivedSeed: (id: string) => void
  busy: string | null
  showSubHeader?: boolean
}) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.chunk')
  const locale = useLocale()
  return (
    <div className="px-4 py-3 space-y-2">
      {showSubHeader && (
        <p className="text-[10px] font-mono tracking-wide text-[#7A8C7E]">
          {t('subOrderPrefix')} {new Date(sub.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
        </p>
      )}
      <RecipientLine
        name={sub.recipient_name}
        shopName={sub.recipient_shop_name}
        phone={sub.recipient_phone}
        role={sub.recipient_role}
      />
      {pill === 'routed' && <RoutedChunk sub={sub} />}
      {pill === 'approval' && <ApprovalChunk sub={sub} />}
      {pill === 'returned' && (
        <ReturnedChunk sub={sub} onForwardReturned={onForwardReturned}
          onDiscard={onDiscard}
          onDiscardReturnedItems={onDiscardReturnedItems}
          busy={busy} />
      )}
      {pill === 'pickup' && (
        sub.kind === 'SEED' ? (
          <SeedPickupChunk sub={sub} onMarkReceived={onMarkReceivedSeed} busy={busy} />
        ) : (
          <PickupChunk sub={sub} />
        )
      )}
      {(pill === 'routed' || pill === 'approval') && (
        <PostponedStrip sub={sub} pill={pill} />
      )}
    </div>
  )
}

// 2026-06-19 — Farmer-side seed pickup confirmation. Mirrors the
// dealer's inline handover chunk on /dealer/orders Packing pill:
// banner + single CTA, no surface hop. Either-actor-wins semantics
// against /dealer/seed-orders/{id}/handover.
function SeedPickupChunk({
  sub, onMarkReceived, busy,
}: {
  sub: SubOrder
  onMarkReceived: (id: string) => void
  busy: string | null
}) {
  const t = useTranslations('orders.cropOrders.chunk')
  return (
    <div className="bg-emerald-50 rounded-xl p-3 space-y-2">
      <p className="text-xs text-emerald-900 text-center font-medium">
        {t('seedPickupBanner')}
      </p>
      <button onClick={() => onMarkReceived(sub.id)}
        disabled={busy === sub.id}
        className="w-full bg-emerald-600 disabled:bg-emerald-300 text-white text-xs font-semibold py-2.5 rounded-xl">
        {busy === sub.id ? t('seedPickupBusy') : t('seedPickupCta')}
      </button>
    </div>
  )
}

// 2026-06-09 — Postponed strip with three render variants:
// - Active "Send to another dealer" — direct dealer + Routed pill
//   (no SFA / NA / pickup in play here, so the farmer can act).
//   Routes to /orders/[id]/forward where the include-postponed
//   nudge sheet already lives. The user picks "Include postponed"
//   in the nudge → /reroute-returned fires with include_postponed:
//   true → server flips postponed items to NA and bundles them
//   into the new DRAFT.
// - Passive "your facilitator is handling" — facilitator owns the
//   order; postponed items belong to the facilitator's queue.
// - Passive "dealer is following up" — fallback (Approval pill,
//   seeds, etc.) where the farmer shouldn't act yet.
function PostponedStrip({ sub, pill }: { sub: SubOrder; pill: Pill }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.chunk')
  const n = sub.postponed_count ?? 0
  if (n === 0) return null

  if (sub.facilitator_user_id) {
    return (
      <div className="bg-amber-50/40 rounded-lg px-3 py-2">
        <p className="text-xs text-amber-800">
          {t('postponedFacilitatorHandling', { count: n })}
        </p>
      </div>
    )
  }

  // Active variant: Routed pill on a regular (non-seed) order.
  // Seeds don't go through /forward; passive fallback for them.
  if (pill === 'routed' && sub.kind === 'REGULAR') {
    return (
      <div className="bg-amber-50/60 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
        <p className="text-xs text-amber-800">
          {t('postponedCount', { count: n })}
        </p>
        <button onClick={() => router.push(`/orders/${sub.id}/forward`)}
          className="text-xs font-semibold text-amber-800 underline">
          {t('sendToAnotherDealer')}
        </button>
      </div>
    )
  }

  return (
    <div className="bg-amber-50/40 rounded-lg px-3 py-2">
      <p className="text-xs text-amber-800">
        {t('postponedDealerFollowUp', { count: n })}
      </p>
    </div>
  )
}

function RoutedChunk({ sub }: { sub: SubOrder }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.chunk')
  if (sub.kind === 'REGULAR' && sub.status === 'DRAFT') {
    return (
      <div className="space-y-2">
        <p className="text-xs text-amber-700">
          {t('draftPickRecipient')}
        </p>
        <button onClick={() => router.push(`/orders/${sub.id}`)}
          className="w-full py-2 rounded-lg text-white text-xs font-semibold"
          style={{ background: '#3A7D44' }}>
          {t('pickRecipientCta')}
        </button>
      </div>
    )
  }
  if (sub.kind === 'SEED' && sub.status === 'DRAFT') {
    return (
      <div className="space-y-2">
        <p className="text-xs text-amber-700">
          {t('draftPickRecipient')}
        </p>
        <button onClick={() => router.push(`/seed-orders/${sub.id}`)}
          className="w-full py-2 rounded-lg text-white text-xs font-semibold"
          style={{ background: '#3A7D44' }}>
          {t('pickRecipientCta')}
        </button>
      </div>
    )
  }
  // 2026-06-22 — For facilitator-routed orders that have no dealer-
  // actionable items left (just NA items the facilitator is rerouting
  // + already-received APPROVED items), the "N items · Dealer is
  // processing" line is misleading. The dealer is done; the
  // facilitator is the one with work to do. Show the truth.
  const returned = sub.returned_count ?? 0
  if (sub.facilitator_user_id && returned > 0) {
    return (
      <p className="text-xs text-amber-800">
        {t('returnedFacilitatorHandling', { count: returned })}
      </p>
    )
  }
  return (
    <p className="text-xs text-[#7A8C7E]">
      {sub.item_count !== undefined && sub.item_count > 0
        ? t('itemsCountPrefix', { count: sub.item_count })
        : ''}
      {t('dealerProcessing')}
    </p>
  )
}

function ApprovalChunk({ sub }: { sub: SubOrder }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.chunk')
  const awaiting = sub.awaiting_approval_count ?? 0
  return (
    <div className="bg-emerald-50/40 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
      <p className="text-xs text-[#3A7D44]">
        {t('awaitingApproval', { count: awaiting })}
      </p>
      <button
        onClick={() => router.push(sub.kind === 'SEED' ? `/seed-orders/${sub.id}` : `/orders/${sub.id}`)}
        className="text-xs font-semibold text-white px-3 py-1 rounded-lg"
        style={{ background: '#3A7D44' }}>
        {t('approveCta')}
      </button>
    </div>
  )
}

function ReturnedChunk({
  sub, onForwardReturned, onDiscard, onDiscardReturnedItems, busy,
}: {
  sub: SubOrder
  onForwardReturned: (id: string) => void
  onDiscard: (id: string, kind: 'REGULAR' | 'SEED') => void
  onDiscardReturnedItems: (sub: SubOrder) => void
  busy: string | null
}) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.chunk')
  // 2026-08-11 — Cancel-migrate DRAFT (Model B). The DRAFT carries
  // items the farmer released from a cancelled dealer engagement.
  // Whole-batch decision: forward to another dealer (existing DRAFT
  // pick-recipient page → PUT /send) or discard ("Don't need these
  // now" → PUT /discard, items flip to REROUTED so advisory re-offers
  // the practice with an Order CTA).
  if (sub.is_returned_to_farmer && sub.status === 'DRAFT') {
    const count = sub.item_count ?? 0
    // 2026-08-11 — Regular DRAFTs use the focused /forward page that
    // mirrors the /order/new picker (map + Call/Send Order per row).
    // Seed doesn't have a /forward page today — /seed-orders/[id]
    // auto-opens its picker sheet for returned DRAFTs.
    const forwardHref =
      sub.kind === 'SEED' ? `/seed-orders/${sub.id}` : `/orders/${sub.id}/forward`
    // 2026-08-11 — "Cancelled by you · from X" context line. Shop
    // name wins over person name when both are available (mirrors
    // RecipientLine's preference for shop identity on the dealer).
    const releasedFromLabel =
      sub.released_from_recipient_shop_name
      || sub.released_from_recipient_name
      || null
    return (
      <div className="bg-amber-50/60 rounded-lg px-3 py-2 space-y-2">
        <p className="text-[10px] text-amber-700/80 font-medium uppercase tracking-wide">
          Cancelled by you
          {releasedFromLabel && (
            <> · from <span className="text-amber-800 normal-case font-semibold">{releasedFromLabel}</span></>
          )}
        </p>
        <p className="text-xs text-amber-800">
          {count === 1
            ? '1 item returned to you. Send to another dealer or set it aside.'
            : `${count} items returned to you. Send to another dealer or set them aside.`}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => router.push(forwardHref)}
            disabled={busy === sub.id}
            className="flex-1 py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-50"
            style={{ background: '#3A7D44' }}>
            Send to another dealer
          </button>
          <button
            onClick={() => onDiscard(sub.id, sub.kind)}
            disabled={busy === sub.id}
            className="flex-1 py-2 rounded-lg border border-amber-700/40 text-amber-900 text-xs font-semibold disabled:opacity-50">
            {busy === sub.id ? '…' : "Don't need these now"}
          </button>
        </div>
      </div>
    )
  }
  const returned = sub.returned_count ?? (sub.status === 'NOT_AVAILABLE' ? 1 : 0)
  // 2026-06-21 — Facilitator-owned orders no longer reach this chunk
  // — the Returned pill predicate filters them out. The passive
  // "your facilitator is handling" branch that used to live here has
  // been removed along with its dead code path.
  // 2026-08-11 — Symmetry with the cancel-migrate DRAFT card: farmer
  // gets both actions on dealer-returned items too. If the source
  // order also has POSTPONED items still with the dealer, the discard
  // handler opens a nudge modal (parallel to /forward's nudge).
  return (
    <div className="bg-amber-50/60 rounded-lg px-3 py-2 space-y-2">
      <p className="text-xs text-amber-800">
        {t('returnedCount', { count: returned })}
      </p>
      <div className="flex gap-2">
        <button onClick={() => onForwardReturned(sub.id)} disabled={busy === sub.id}
          className="flex-1 py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-50"
          style={{ background: '#3A7D44' }}>
          {busy === sub.id ? '…' : t('sendToAnotherDealer')}
        </button>
        <button onClick={() => onDiscardReturnedItems(sub)} disabled={busy === sub.id}
          className="flex-1 py-2 rounded-lg border border-amber-700/40 text-amber-900 text-xs font-semibold disabled:opacity-50">
          {busy === sub.id ? '…' : "Don't need these now"}
        </button>
      </div>
    </div>
  )
}

// 2026-06-09 — Pickup chunk parity with the Facilitator pickup
// card composition. Packing ID is the lead identifier (mono
// banner); the count + recipient line sits beneath; the Confirm
// CTA routes to the full /orders/[id]/pickup surface where the
// item list + total + I-have-received button live.
function PickupChunk({ sub }: { sub: SubOrder }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.chunk')
  const count = sub.pickup_ready_count ?? 0
  const receiveMode = sub.packing_picked_up_by_role === 'FACILITATOR'
  const fromName = sub.recipient_shop_name || sub.recipient_name
  return (
    <button
      onClick={() => router.push(`/orders/${sub.id}/pickup`)}
      className="w-full bg-white rounded-lg border border-emerald-300 overflow-hidden text-left active:bg-emerald-50/50">
      {sub.packing_code && (
        <div className="px-3 py-1.5 bg-emerald-600 text-white flex items-baseline justify-between">
          <p className="text-[9px] uppercase tracking-wider opacity-75">{t('packingIdLabel')}</p>
          <p className="text-xs font-bold font-mono tracking-widest">{sub.packing_code}</p>
        </div>
      )}
      <div className="px-3 py-2 flex items-center justify-between gap-3 bg-emerald-50">
        <p className="text-xs text-emerald-800">
          {receiveMode ? t('receivePrefix') : t('pickupPrefix')}{' '}
          <strong>{t('pickupItemCount', { count })}</strong>
          {fromName && (
            <> {t('fromConnector')} <strong>{fromName}</strong></>
          )}
        </p>
        <span className="text-xs font-semibold text-emerald-700 underline shrink-0">
          {t('confirmCta')}
        </span>
      </div>
    </button>
  )
}

// 2026-06-20 — Terminal sub-orders (EXPIRED, CANCELLED, REJECTED,
// REROUTED) shown in the expanded lineage list for context, but their
// row isn't tappable — the order detail page assumes a live order and
// crashes on terminal statuses. Live rows still tap through.
const TERMINAL_SUB_STATUSES = new Set([
  'EXPIRED', 'CANCELLED', 'REJECTED', 'REROUTED', 'PURCHASED', 'COMPLETED',
])

function ExpandedSubOrderList({ subs }: { subs: SubOrder[] }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.expanded')
  const tOrdersCommon = useTranslations('orders.common')
  const locale = useLocale()
  return (
    <div className="bg-[#F5F0E8]/50 px-4 py-3 border-t border-[#F0E5D0]">
      <p className="text-[10px] font-semibold text-[#7A8C7E] uppercase tracking-wider mb-2">
        {t('allSubOrders', { count: subs.length })}
      </p>
      <div className="space-y-2">
        {subs.map(sub => {
          const terminal = TERMINAL_SUB_STATUSES.has(sub.status)
          const body = (
            <>
              <div className="min-w-0">
                <p className="text-xs text-[#6B3F1F] truncate">
                  {sub.recipient_shop_name || sub.recipient_name || t('noRecipient')}
                </p>
                <p className="text-[10px] text-[#7A8C7E]">
                  {new Date(sub.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
                  {sub.item_count !== undefined && sub.item_count > 0 && (
                    <> · {tOrdersCommon('itemsCount', { count: sub.item_count })}</>
                  )}
                </p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLOUR[sub.status] || 'bg-slate-100 text-[#7A8C7E]'}`}>
                {sub.status.replace(/_/g, ' ')}
              </span>
            </>
          )
          if (terminal) {
            return (
              <div key={sub.id}
                className="w-full flex items-center justify-between gap-2 bg-white/60 border border-[#DDD0B8] rounded-lg px-3 py-2 opacity-70">
                {body}
              </div>
            )
          }
          return (
            <button key={sub.id}
              onClick={() => router.push(sub.kind === 'SEED' ? `/seed-orders/${sub.id}` : `/orders/${sub.id}`)}
              className="w-full text-left flex items-center justify-between gap-2 bg-white border border-[#DDD0B8] rounded-lg px-3 py-2">
              {body}
            </button>
          )
        })}
      </div>
    </div>
  )
}



// ── Tab: Received ───────────────────────────────────────────────────────────

interface SeedPurchased {
  id: string; status: string; variety_name?: string | null
  variety_id?: string | null
  unit?: string | null; quantity?: number | null
  total_price?: number | null; created_at: string
  subscription_id: string
  recipient_name?: string | null
  recipient_shop_name?: string | null
  recipient_phone?: string | null
  recipient_role?: 'DEALER' | 'FACILITATOR' | null
  // 2026-07-06 — Scan-verify state, parity with pesticide/fertilizer.
  scan_verified?: boolean
  qr_available?: boolean
}

function ReceivedTab({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter()
  const t = useTranslations('orders.cropOrders.received')
  const tChunk = useTranslations('orders.cropOrders.chunk')
  const tQr = useTranslations('qrScan')
  const locale = useLocale()
  const [items, setItems] = useState<PurchasedItem[] | null>(null)
  const [seeds, setSeeds] = useState<SeedPurchased[] | null>(null)
  const [scanSeedId, setScanSeedId] = useState<string | null>(null)
  const [scanItemId, setScanItemId] = useState<string | null>(null)
  // 2026-06-09 (restored) — "Ready to pick up" strip on top of the
  // Received tab. Surfaces approved-but-not-yet-confirmed orders
  // (pickup_ready_count > 0) so the farmer is naturally nudged to
  // confirm receipt before browsing their actually-received items.
  // Mirror of the Manage tab's Pickup pill but with the awaiting
  // items front-and-centre on the receiving surface.
  const [pickupReady, setPickupReady] = useState<SubOrder[] | null>(null)
  useEffect(() => {
    api.get<PurchasedItem[]>(`/farmer/purchased-items?subscription_id=${subscriptionId}`)
      .then(({ data }) => setItems(data))
      .catch(() => setItems([]))
    api.get<SeedPurchased[]>(`/farmer/seed-orders`)
      .then(({ data }) => setSeeds(data.filter(s =>
        s.subscription_id === subscriptionId && s.status === 'PURCHASED'
      )))
      .catch(() => setSeeds([]))
    api.get<{ orders: SubOrder[] }>(`/farmer/subscriptions/${subscriptionId}/orders`)
      .then(({ data }) => setPickupReady(
        (data.orders || []).filter(o => (o.pickup_ready_count ?? 0) > 0)
      ))
      .catch(() => setPickupReady([]))
  }, [subscriptionId])

  if (items === null || seeds === null || pickupReady === null) return <div className="m-4 h-20 bg-white/60 rounded-2xl animate-pulse" />
  if (items.length === 0 && seeds.length === 0 && pickupReady.length === 0) {
    return (
      <div className="p-4">
        <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center">
          <p className="text-sm text-[#7A8C7E]">{t('emptyTitle')}</p>
          <p className="text-xs text-[#7A8C7E] mt-1">
            {t('emptyHint')}
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="p-4 space-y-3">
      {pickupReady.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wider px-1">
            {pickupReady.every(o => o.packing_picked_up_by_role === 'FACILITATOR')
              ? t('readyToReceive')
              : t('readyToPickUp')}
          </p>
          {pickupReady.map(o => {
            const receiveMode = o.packing_picked_up_by_role === 'FACILITATOR'
            const fromName = o.recipient_shop_name || o.recipient_name
            return (
              <button key={o.id}
                onClick={() => router.push(`/orders/${o.id}/pickup`)}
                className="w-full bg-white rounded-2xl border border-emerald-300 shadow-sm overflow-hidden text-left active:scale-[0.99] transition-transform">
                {o.packing_code && (
                  <div className="px-4 py-1.5 bg-emerald-600 text-white flex items-baseline justify-between">
                    <p className="text-[10px] uppercase tracking-wider opacity-75">{tChunk('packingIdLabel')}</p>
                    <p className="text-sm font-bold font-mono tracking-widest">{o.packing_code}</p>
                  </div>
                )}
                <div className="p-4">
                  <p className="text-sm text-emerald-800">
                    {receiveMode ? t('receivePrefix') : t('pickupPrefix')}{' '}
                    <strong>{tChunk('pickupItemCount', { count: o.pickup_ready_count ?? 0 })}</strong>
                    {fromName && <> {tChunk('fromConnector')} <strong>{fromName}</strong></>}
                  </p>
                  <p className="text-[11px] text-emerald-700 mt-1 font-semibold">
                    {t('tapToConfirm')}
                  </p>
                </div>
              </button>
            )
          })}
        </section>
      )}
      {seeds.map(s => (
        <div key={s.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] uppercase tracking-wide text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded-full font-semibold">{t('seedBadge')}</span>
              <p className="font-semibold text-[#6B3F1F] truncate mt-1">{s.variety_name || t('seedVarietyFallback')}</p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {s.quantity != null && s.unit && (
                <p className="text-xs text-[#7A8C7E]">{s.quantity} {s.unit}{s.total_price != null ? ` · ₹${s.total_price}` : ''}</p>
              )}
              {/* 2026-07-06 — Scan verification chip / CTA, parity
                  with the pesticide/fertilizer row. Only shows when
                  the client has an ACTIVE ProductQRCode for this
                  variety (qr_available). Verified chip once the
                  scan has landed a MATCH server-side. */}
              {s.scan_verified ? (
                <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">✓ {tQr('verified')}</span>
              ) : s.qr_available ? (
                <button onClick={() => setScanSeedId(s.id)}
                  className="text-xs bg-[#3A7D44] text-white px-3 py-1 rounded-full font-medium">
                  {tQr('scanButton')}
                </button>
              ) : null}
            </div>
          </div>
          <p className="text-[11px] text-[#7A8C7E] mt-1">
            {t('purchasedOn', { date: new Date(s.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' }) })}
          </p>
          <RecipientLine
            name={s.recipient_name}
            shopName={s.recipient_shop_name}
            phone={s.recipient_phone}
            role={s.recipient_role}
          />
        </div>
      ))}
      {scanSeedId && (
        <QRScannerModal
          seedOrderId={scanSeedId}
          onClose={() => setScanSeedId(null)}
          onVerified={() => {
            // Refresh the seed list so the ✓ Verified chip lights up.
            api.get<SeedPurchased[]>(`/farmer/seed-orders`)
              .then(({ data }) => setSeeds(data.filter(x =>
                x.subscription_id === subscriptionId && x.status === 'PURCHASED'
              )))
              .catch(() => { /* silent — chip appears on next mount */ })
          }}
        />
      )}
      {items.map(it => (
        <div key={it.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
          <div className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[#6B3F1F] truncate">{it.brand_name || t('unknownBrand')}</p>
                {it.manufacturer_name && (
                  <p className="text-xs text-[#7A8C7E] truncate">{t('byManufacturer', { manufacturer: it.manufacturer_name })}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {it.given_volume != null && it.volume_unit && (
                  <p className="text-xs text-[#7A8C7E]">{it.given_volume} {it.volume_unit}{it.price != null ? ` · ₹${it.price}` : ''}</p>
                )}
                {/* 2026-07-06 — Scan verification chip / CTA, parity
                    with the /orders top-level Received tab. Only
                    shows when qr_available (client has an ACTIVE
                    ProductQRCode for this brand). */}
                {it.scan_verified ? (
                  <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">✓ {tQr('verified')}</span>
                ) : it.qr_available ? (
                  <button onClick={() => setScanItemId(it.id)}
                    className="text-xs bg-[#3A7D44] text-white px-3 py-1 rounded-full font-medium">
                    {tQr('scanButton')}
                  </button>
                ) : null}
              </div>
            </div>
            {(it.application_date_from && it.application_date_to) && (
              <p className="text-[11px] text-[#7A8C7E] mt-1">
                {t('applyDates', {
                  from: new Date(it.application_date_from).toLocaleDateString(locale, { day: '2-digit', month: 'short' }),
                  to: new Date(it.application_date_to).toLocaleDateString(locale, { day: '2-digit', month: 'short' }),
                })}
                {it.merged_timeline_count && it.merged_timeline_count > 1 && (
                  <span className="ml-1 text-[#7A8C7E]">{t('acrossTimelines', { count: it.merged_timeline_count })}</span>
                )}
              </p>
            )}
            {it.l2_type && (
              <p className="text-[10px] text-[#7A8C7E] mt-0.5">{it.l2_type.replace(/_/g, ' ')}</p>
            )}
            {it.received_at && (
              <p className="text-[11px] text-[#7A8C7E] mt-1">
                {t('receivedOn', { date: new Date(it.received_at).toLocaleDateString(locale, { day: '2-digit', month: 'short' }) })}
              </p>
            )}
          </div>
          {/* 2026-06-06 — Recipient line on every Received card so the
              farmer can call the dealer / facilitator easily. Matches
              the seed-order card shape. Phone is a tel: link. */}
          {(it.recipient_shop_name || it.recipient_name || it.recipient_phone) && (
            <RecipientCardLine
              recipientName={it.recipient_name}
              recipientShopName={it.recipient_shop_name}
              recipientPhone={it.recipient_phone}
              recipientRole={it.recipient_role}
            />
          )}
        </div>
      ))}
      {scanItemId && (
        <QRScannerModal
          orderItemId={scanItemId}
          onClose={() => setScanItemId(null)}
          onVerified={() => {
            // Refresh items so the ✓ Verified chip lights up.
            api.get<PurchasedItem[]>(`/farmer/purchased-items?subscription_id=${subscriptionId}`)
              .then(({ data }) => setItems(data))
              .catch(() => { /* silent — chip appears on next mount */ })
          }}
        />
      )}
    </div>
  )
}


// Recipient sub-line on every Order card. Shop name leads when the
// holder is a dealer (that's how farmers recognise them); for a
// facilitator the personal name leads. Phone is a tel: link so it
// dials on tap. All nullable — renders nothing if every field is
// blank (e.g. a DRAFT order with no recipient set yet).
function RecipientLine({
  name, shopName, phone, role,
}: {
  name?: string | null
  shopName?: string | null
  phone?: string | null
  role?: 'DEALER' | 'FACILITATOR' | null
}) {
  const t = useTranslations('orders.cropOrders.recipient')
  if (!name && !shopName && !phone) return null
  const primary = role === 'DEALER' ? (shopName || name) : (name || shopName)
  const secondary = role === 'DEALER'
    ? (name && shopName && name !== shopName ? t('nameWithDealer', { name }) : t('dealerLabel'))
    : t('facilitatorLabel')
  return (
    <div className="mt-1.5 pt-1.5 border-t border-[#F0E5D0] flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#6B3F1F] truncate">{primary || secondary}</p>
        {primary && (
          <p className="text-[10px] text-[#7A8C7E] truncate">{secondary}</p>
        )}
      </div>
      {phone && (
        <a href={`tel:${phone}`}
          onClick={e => e.stopPropagation()}
          className="text-[11px] font-semibold text-[#3A7D44] px-2 py-1 rounded-lg bg-emerald-50 shrink-0">
          📞 {phone}
        </a>
      )}
    </div>
  )
}

// Variant of RecipientLine for the Received tab's per-item recipient
// card. Uses the bordered card layout and renders the "(Dealer)" /
// "(Facilitator)" annotation slightly differently.
function RecipientCardLine({
  recipientName, recipientShopName, recipientPhone, recipientRole,
}: {
  recipientName?: string | null
  recipientShopName?: string | null
  recipientPhone?: string | null
  recipientRole?: 'DEALER' | 'FACILITATOR' | null
}) {
  const t = useTranslations('orders.cropOrders.recipient')
  return (
    <div className="border-t border-[#F0E5D0] px-4 py-2 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#6B3F1F] truncate">
          {recipientShopName || recipientName}
        </p>
        {(recipientShopName && recipientName) || recipientRole === 'FACILITATOR' ? (
          <p className="text-[10px] text-[#7A8C7E] truncate">
            {recipientRole === 'FACILITATOR'
              ? t('nameWithFacilitator', { name: recipientName ?? '' })
              : t('nameWithDealer', { name: recipientName ?? '' })}
          </p>
        ) : null}
      </div>
      {recipientPhone && (
        <a href={`tel:${recipientPhone}`}
          className="text-[11px] font-semibold text-[#3A7D44] px-2 py-1 rounded-lg bg-emerald-50 shrink-0">
          📞 {recipientPhone}
        </a>
      )}
    </div>
  )
}
