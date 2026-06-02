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

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import ClientCropChip from '@/components/ClientCropChip'
import api from '@/lib/api'

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
  date_from?: string; date_to?: string
  created_at: string
  item_count?: number; is_max_count?: boolean
  // Per-status item breakdown (added 2026-06-02). The Manage card
  // surfaces only counts; item names stay hidden from the farmer
  // to prevent identity-based manipulation.
  awaiting_approval_count?: number
  returned_count?: number
  category?: 'PESTICIDE' | 'FERTILIZER' | null
  variety_name?: string | null
  unit?: string | null; quantity?: number | null; total_price?: number | null
  // Recipient (dealer or facilitator) so the farmer can track who's
  // holding the order without drilling in. Phone is a tel: link.
  recipient_name?: string | null
  recipient_phone?: string | null
  recipient_shop_name?: string | null
  recipient_role?: 'DEALER' | 'FACILITATOR' | null
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
  id: string; brand_name: string | null; l1_type: string | null; l2_type: string | null
  given_volume: number | null; volume_unit: string | null; price: number | null
  scan_verified: boolean; order_id: string; created_at: string
  timeline_name?: string | null
  application_date_from?: string | null
  application_date_to?: string | null
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
  const [tab, setTab] = useState<'order' | 'manage' | 'received'>(
    (search.get('tab') as 'order' | 'manage' | 'received') || 'order',
  )
  const [sub, setSub] = useState<Subscription | null>(null)

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
  }, [subscriptionId, router])

  const todayBeforeStart = useMemo(() => {
    if (!sub?.crop_start_date) return true   // no start date yet → pre-sowing window open
    const start = new Date(sub.crop_start_date)
    return new Date() < start
  }, [sub])

  const tabClass = (k: typeof tab) =>
    `flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${
      tab === k ? 'border-[#3A7D44] text-[#3A7D44]' : 'border-transparent text-[#7A8C7E]'
    }`

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Orders" activeRole="FARMER" back={`/crop-detail/${subscriptionId}`} />
      <div className="pt-16 pb-20">
        {/* Same company/crop anchor the Advisory / Diagnose / Ask
            Expert surfaces use, so the farmer is grounded the
            instant the page opens. */}
        <ClientCropChip subscriptionId={subscriptionId} />

        <div className="flex bg-white border-b border-[#DDD0B8] sticky top-16 z-30">
          <button onClick={() => setTab('order')}    className={tabClass('order')}>Order</button>
          <button onClick={() => setTab('manage')}   className={tabClass('manage')}>Manage</button>
          <button onClick={() => setTab('received')} className={tabClass('received')}>Received</button>
        </div>

        {tab === 'order' && (
          <OrderTab
            subscriptionId={subscriptionId}
            todayBeforeStart={todayBeforeStart}
            openHint={(search.get('open') || '').toLowerCase() as 'seed' | 'pesticide' | 'fertilizer' | ''}
            initialDateFrom={search.get('date_from') || ''}
            initialDateTo={search.get('date_to') || ''}
          />
        )}
        {tab === 'manage'   && <ManageTab subscriptionId={subscriptionId} />}
        {tab === 'received' && <ReceivedTab subscriptionId={subscriptionId} />}
      </div>
    </div>
  )
}


// ── Tab: Order ──────────────────────────────────────────────────────────────
// Three accordions. Pesticide/Fertilizer optionally surface a Pre-sowing
// sub-mode when today < crop_start_date.

function OrderTab({
  subscriptionId, todayBeforeStart, openHint, initialDateFrom, initialDateTo,
}: {
  subscriptionId: string
  todayBeforeStart: boolean
  openHint: 'seed' | 'pesticide' | 'fertilizer' | ''
  initialDateFrom: string
  initialDateTo: string
}) {
  const [open, setOpen] = useState<'seed' | 'pesticide' | 'fertilizer' | null>(
    openHint || null,
  )
  return (
    <div className="p-4 space-y-2">
      <Accordion title="Seed / Seedling" emoji="🌱" open={open === 'seed'} onToggle={() => setOpen(o => o === 'seed' ? null : 'seed')}>
        <SeedSection subscriptionId={subscriptionId} />
      </Accordion>
      <Accordion title="Pesticide" emoji="🧪" open={open === 'pesticide'} onToggle={() => setOpen(o => o === 'pesticide' ? null : 'pesticide')}>
        <CategorySection
          subscriptionId={subscriptionId}
          category="PESTICIDE"
          todayBeforeStart={todayBeforeStart}
          initialDateFrom={initialDateFrom}
          initialDateTo={initialDateTo}
        />
      </Accordion>
      <Accordion title="Fertilizer" emoji="🌾" open={open === 'fertilizer'} onToggle={() => setOpen(o => o === 'fertilizer' ? null : 'fertilizer')}>
        <CategorySection
          subscriptionId={subscriptionId}
          category="FERTILIZER"
          todayBeforeStart={todayBeforeStart}
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
  return (
    <div className="pt-3 space-y-3">
      <p className="text-xs text-[#7A8C7E]">
        Browse and order seed varieties recommended for this crop.
      </p>
      <button onClick={() => router.push(`/subscribe/seed-varieties/${subscriptionId}`)}
        className="w-full py-3 rounded-xl text-white text-sm font-semibold"
        style={{ background: '#3A7D44' }}>
        Browse varieties
      </button>
    </div>
  )
}


function CategorySection({
  subscriptionId, category, todayBeforeStart, initialDateFrom, initialDateTo,
}: {
  subscriptionId: string
  category: 'PESTICIDE' | 'FERTILIZER'
  todayBeforeStart: boolean
  initialDateFrom: string
  initialDateTo: string
}) {
  const router = useRouter()
  const [dateFrom, setDateFrom] = useState(initialDateFrom || new Date().toISOString().slice(0, 10))
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

      <div>
        <p className="text-[11px] font-semibold text-[#7A8C7E] uppercase tracking-wider mb-2">
          Order {category.toLowerCase()}s by date range
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-[#7A8C7E]">From
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="mt-1 w-full border border-[#DDD0B8] rounded-lg px-2 py-2 text-sm" />
          </label>
          <label className="text-[11px] text-[#7A8C7E]">To
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="mt-1 w-full border border-[#DDD0B8] rounded-lg px-2 py-2 text-sm" />
          </label>
        </div>
        {dateTo && (
          <p className="text-xs text-[#7A8C7E] mt-2">
            {loading ? 'Checking…' :
             preview && preview.count > 0 ? `${preview.count} item${preview.count === 1 ? '' : 's'} recommended in this window.` :
             preview ? 'Nothing recommended in this window.' : 'No preview available.'}
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
          Continue
        </button>
      </div>
    </div>
  )
}


function PreSowingSubMode({ subscriptionId, category }: { subscriptionId: string; category: 'PESTICIDE' | 'FERTILIZER' }) {
  const router = useRouter()
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
        Pre-sowing {category === 'PESTICIDE' ? 'pesticides' : 'fertilizers'}
      </p>
      {preview.available ? (
        <>
          <p className="text-sm text-[#6B3F1F] mt-1">
            {preview.count} item{preview.count === 1 ? '' : 's'} recommended before sowing.
            {preview.has_locked_brand && <span className="text-[11px] text-[#7A8C7E] block mt-0.5">Locked brand applies.</span>}
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
            Order pre-sowing {category === 'PESTICIDE' ? 'pesticides' : 'fertilizers'}
          </button>
        </>
      ) : (
        <p className="text-xs text-[#7A8C7E] mt-1">
          Nothing recommended for pre-sowing in this package.
        </p>
      )}
    </div>
  )
}


// ── Tab: Manage ─────────────────────────────────────────────────────────────

function ManageTab({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter()
  const [orders, setOrders] = useState<SubOrder[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    const { data } = await api.get<{ orders: SubOrder[] }>(
      `/farmer/subscriptions/${subscriptionId}/orders`,
    )
    setOrders((data.orders || []).filter(o => !['COMPLETED', 'PURCHASED'].includes(o.status)))
  }
  useEffect(() => { load().catch(() => setOrders([])) }, [subscriptionId])

  async function cancel(orderId: string) {
    if (!confirm('Cancel this order? You can still forward or delete it after.')) return
    setBusy(orderId)
    try {
      await api.put(`/farmer/orders/${orderId}/cancel`, {})
      await load()
    } finally { setBusy(null) }
  }

  async function deleteOrder(orderId: string) {
    if (!confirm('Delete this cancelled order permanently?')) return
    setBusy(orderId)
    try {
      await api.delete(`/farmer/orders/${orderId}`)
      await load()
    } finally { setBusy(null) }
  }

  async function approveAll(orderId: string) {
    setBusy(orderId)
    try {
      await api.put(`/farmer/orders/${orderId}/items/approve-all`, {})
      await load()
    } finally { setBusy(null) }
  }

  async function rerouteReturned(orderId: string) {
    if (!confirm('Send the returned items to a different dealer or facilitator? Your other items stay where they are.')) return
    setBusy(orderId)
    try {
      const { data } = await api.post<{ new_draft_order_id: string }>(
        `/farmer/orders/${orderId}/reroute-returned`,
      )
      // /order/new is the existing dealer-picker for a draft order.
      router.push(`/order/new/${subscriptionId}?from=draft&order_id=${data.new_draft_order_id}`)
    } finally { setBusy(null) }
  }

  if (orders === null) return <div className="m-4 h-20 bg-white/60 rounded-2xl animate-pulse" />
  if (orders.length === 0) {
    return (
      <div className="p-4">
        <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center">
          <p className="text-sm text-[#7A8C7E]">No orders are awaiting action right now.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      {orders.map(o => {
        const cancelled = o.status === 'CANCELLED'
        const awaitingN = o.awaiting_approval_count || 0
        const returnedN = o.returned_count || 0
        // The card no longer routes to /orders/[id] (per
        // 2026-06-02: item identity hidden from the farmer; the
        // counts + inline actions are everything they need to act).
        return (
          <div key={`${o.kind}:${o.id}`}
            className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
            <div className="p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-[#7A8C7E] uppercase tracking-wider">
                    {o.kind === 'SEED' ? 'Seed' : (o.category?.toLowerCase() || 'order')}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[o.status] || 'bg-stone-100 text-[#7A8C7E]'}`}>
                    {o.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <span className="text-[10px] text-[#7A8C7E]">
                  {new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                </span>
              </div>
              {o.kind === 'SEED' ? (
                <p className="text-sm text-[#6B3F1F] truncate">{o.variety_name || 'Seed order'}</p>
              ) : (
                <p className="text-sm text-[#6B3F1F]">
                  {o.date_from && o.date_to ? (
                    <>
                      {new Date(o.date_from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} —
                      {' '}{new Date(o.date_to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </>
                  ) : null}
                  {o.item_count !== undefined && o.item_count > 0 && (
                    <span className="text-xs text-[#7A8C7E]"> · {o.is_max_count ? 'Max ' : ''}{o.item_count} item{o.item_count === 1 ? '' : 's'}</span>
                  )}
                </p>
              )}
              <RecipientLine
                name={o.recipient_name}
                shopName={o.recipient_shop_name}
                phone={o.recipient_phone}
                role={o.recipient_role}
              />
            </div>

            {/* Returned items — inline action; never names an item. */}
            {!cancelled && returnedN > 0 && (
              <div className="border-t border-[#F0E5D0] bg-amber-50/60 px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-xs text-amber-800">
                  {returnedN} returned item{returnedN === 1 ? '' : 's'}
                </p>
                <button onClick={() => rerouteReturned(o.id)} disabled={busy === o.id}
                  className="text-xs font-semibold text-amber-800 underline disabled:opacity-50">
                  {busy === o.id ? '…' : 'Send to another dealer'}
                </button>
              </div>
            )}

            {/* Awaiting-approval — same anti-naming principle.
                The farmer trusts the count and approves in one tap;
                they read brand + qty after approval lands. */}
            {!cancelled && awaitingN > 0 && (
              <div className="border-t border-[#F0E5D0] bg-emerald-50/40 px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-xs text-[#3A7D44]">
                  {awaitingN} item{awaitingN === 1 ? '' : 's'} awaiting approval
                </p>
                <button onClick={() => approveAll(o.id)} disabled={busy === o.id}
                  className="text-xs font-semibold text-white px-3 py-1 rounded-lg disabled:opacity-50"
                  style={{ background: '#3A7D44' }}>
                  {busy === o.id ? '…' : 'Approve all'}
                </button>
              </div>
            )}

            <div className="border-t border-[#F0E5D0] px-4 py-2 flex gap-2">
              {!cancelled ? (
                o.kind !== 'SEED' ? (
                  <button onClick={() => cancel(o.id)} disabled={busy === o.id}
                    className="flex-1 py-1.5 rounded-lg border border-red-300 text-red-600 text-xs font-medium disabled:opacity-50">
                    {busy === o.id ? '…' : 'Cancel order'}
                  </button>
                ) : null
              ) : (
                <>
                  <button onClick={() => rerouteReturned(o.id)} disabled={busy === o.id}
                    className="flex-1 py-1.5 rounded-lg border border-[#DDD0B8] text-[#6B3F1F] text-xs font-medium disabled:opacity-50">
                    {busy === o.id ? '…' : 'Forward'}
                  </button>
                  <button onClick={() => deleteOrder(o.id)} disabled={busy === o.id}
                    className="flex-1 py-1.5 rounded-lg border border-red-300 text-red-600 text-xs font-medium disabled:opacity-50">
                    {busy === o.id ? '…' : 'Delete'}
                  </button>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}


// ── Tab: Received ───────────────────────────────────────────────────────────

function ReceivedTab({ subscriptionId }: { subscriptionId: string }) {
  const [items, setItems] = useState<PurchasedItem[] | null>(null)
  useEffect(() => {
    api.get<PurchasedItem[]>(`/farmer/purchased-items?subscription_id=${subscriptionId}`)
      .then(({ data }) => setItems(data))
      .catch(() => setItems([]))
  }, [subscriptionId])

  if (items === null) return <div className="m-4 h-20 bg-white/60 rounded-2xl animate-pulse" />
  if (items.length === 0) {
    return (
      <div className="p-4">
        <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center">
          <p className="text-sm text-[#7A8C7E]">No items received yet for this crop.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="p-4 space-y-3">
      {items.map(it => (
        <div key={it.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-semibold text-[#6B3F1F] truncate">{it.brand_name || 'Unknown brand'}</p>
            {it.given_volume != null && it.volume_unit && (
              <p className="text-xs text-[#7A8C7E] shrink-0">{it.given_volume} {it.volume_unit}{it.price != null ? ` · ₹${it.price}` : ''}</p>
            )}
          </div>
          {(it.application_date_from && it.application_date_to) && (
            <p className="text-[11px] text-[#7A8C7E] mt-1">
              Apply: {new Date(it.application_date_from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – {new Date(it.application_date_to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
            </p>
          )}
          {it.l2_type && (
            <p className="text-[10px] text-[#7A8C7E] mt-0.5">{it.l2_type.replace(/_/g, ' ')}</p>
          )}
        </div>
      ))}
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
  if (!name && !shopName && !phone) return null
  const primary = role === 'DEALER' ? (shopName || name) : (name || shopName)
  const secondary = role === 'DEALER'
    ? (name && shopName && name !== shopName ? `${name} (Dealer)` : 'Dealer')
    : 'Facilitator'
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
