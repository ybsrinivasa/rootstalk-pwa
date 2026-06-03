'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

interface OrderItem {
  id: string; practice_id: string; status: string
  brand_name: string | null; given_volume: number | null
  volume_unit: string | null; price: number | null
}
// 2026-06-03 — bucketed row shape from the review endpoint. The
// approval + approved buckets are consolidated (one row per
// brand+unit, summed across timelines), so the row's `id` keys to
// the FIRST merged OrderItem and `merged_item_ids` lists the others.
interface ReviewRow {
  id: string; practice_id?: string | null
  practice_name?: string | null
  status: string
  brand_cosh_id?: string | null
  brand_name: string | null
  manufacturer_name?: string | null
  given_volume: number | null
  volume_unit: string | null
  price: number | null
  postponed_until?: string | null
  merged_item_ids?: string[]
  merged_timeline_count?: number
}
interface Order {
  id: string; status: string; date_from: string; date_to: string; created_at: string
  dealer_user_id: string | null; facilitator_user_id: string | null
  subscription_id: string; category: string | null
  approval_items?: ReviewRow[]
  approved_items?: ReviewRow[]
  postponed_items?: ReviewRow[]
  returned_items?: ReviewRow[]
  items: OrderItem[]
}
interface Recipient {
  user_id: string; name: string; phone: string
  shop_name?: string | null; shop_address?: string | null
  sell_categories?: string[]; distance_km?: number
  is_promoter?: boolean
}

const STATUS_COLOUR: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  AVAILABLE: 'bg-blue-100 text-blue-700',
  POSTPONED: 'bg-amber-100 text-amber-700',
  NOT_AVAILABLE: 'bg-red-100 text-[#D4682E]',
  SENT_FOR_APPROVAL: 'bg-purple-100 text-purple-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-rose-100 text-rose-600',
  NOT_NEEDED: 'bg-slate-100 text-[#7A8C7E]',
  SKIPPED: 'bg-slate-100 text-[#7A8C7E]',
  REMOVED: 'bg-slate-100 text-[#7A8C7E]',
}

const STATUS_FARMER: Record<string, string> = {
  PENDING: 'Dealer processing',
  AVAILABLE: 'Dealer processing',
  POSTPONED: 'Delayed',
  NOT_AVAILABLE: 'Not available — action needed',
  SENT_FOR_APPROVAL: 'Ready for your approval',
  APPROVED: 'Purchased',
  REJECTED: 'Rejected by you',
  NOT_NEEDED: 'Not required',
  SKIPPED: 'Skipped',
  REMOVED: 'Removed',
}

export default function FarmerOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [rerouting, setRerouting] = useState<string | null>(null)
  const [newDealerPhone, setNewDealerPhone] = useState('')

  // Orders V2 Batch 4/5 — DRAFT recipient picker
  // 2026-06-03 — confirmation state for destructive actions on the
  // review page. confirmDelete holds the row being deleted from the
  // approval list; confirmCancelPostponed holds a postponed row about
  // to flip into Returned.
  const [confirmDelete, setConfirmDelete] = useState<ReviewRow | null>(null)
  const [confirmCancelPostponed, setConfirmCancelPostponed] = useState<ReviewRow | null>(null)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTab, setPickerTab] = useState<'dealers' | 'facilitators'>('dealers')
  const [dealers, setDealers] = useState<Recipient[]>([])
  const [facilitators, setFacilitators] = useState<Recipient[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const [lockedBrandExplainer, setLockedBrandExplainer] = useState<string | null>(null)

  const load = async () => {
    try {
      const { data } = await api.get<Order>(`/farmer/orders/${orderId}`)
      setOrder(data)
    } catch { router.replace('/orders') } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [orderId])

  // 2026-06-03 — Bundled re-route flow with a soft nudge when the
  // farmer still has postponed items with the original dealer. The
  // nudge sheet asks "cancel those and send together, or keep them
  // with the current dealer?" — the farmer chooses, then we either
  // POST with include_postponed=true (cancel + bundle) or without
  // (leave postpones, send only the already-returned items).
  const [rerouteNudge, setRerouteNudge] = useState(false)

  async function startReroute() {
    if (!order) return
    // If postponed items exist on this order, show the nudge sheet;
    // otherwise go straight to the confirm-and-send path.
    if ((order.postponed_items?.length ?? 0) > 0) {
      setRerouteNudge(true)
      return
    }
    await doReroute(false)
  }

  async function doReroute(includePostponed: boolean) {
    if (!order) return
    setRerouteNudge(false)
    try {
      const { data } = await api.post<{ new_draft_order_id: string; rerouted_count: number }>(
        `/farmer/orders/${order.id}/reroute-returned`,
        { include_postponed: includePostponed },
      )
      router.replace(`/orders/${data.new_draft_order_id}`)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: { code?: string; message?: string } } } }
      const detail = e?.response?.data?.detail
      if (detail && typeof detail === 'object' && detail.message) {
        alert(detail.message)
      } else {
        alert('Could not re-route the items. Please try again.')
      }
    }
  }

  async function openPicker() {
    if (!order) return
    setPickerOpen(true)
    setPickerLoading(true)
    try {
      // Batch 5 — single endpoint that applies the licence-category
      // gate AND the locked-brand gate server-side. The PWA just
      // renders what comes back. Locked-brand orders get an explainer
      // banner above the lists; facilitators come back empty.
      const { data } = await api.get<{
        category: string | null
        has_locked_brand: boolean
        locked_brand_explainer: string | null
        dealers: Recipient[]
        facilitators: Recipient[]
      }>(`/farmer/orders/${order.id}/eligible-recipients`)
      setDealers(data.dealers || [])
      setFacilitators(data.facilitators || [])
      setLockedBrandExplainer(data.locked_brand_explainer)
      // Force the dealers tab when only dealers are eligible.
      if (data.has_locked_brand) setPickerTab('dealers')
    } finally { setPickerLoading(false) }
  }

  async function sendToRecipient(r: Recipient, isDealer: boolean) {
    setSending(r.user_id)
    try {
      const payload = isDealer
        ? { dealer_user_id: r.user_id }
        : { facilitator_user_id: r.user_id }
      await api.put(`/farmer/orders/${orderId}/send`, payload)
      setPickerOpen(false)
      load()  // refresh — status flips DRAFT → SENT
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { detail?: { code?: string; message?: string } } } }
      const detail = e?.response?.data?.detail
      if (detail && typeof detail === 'object' && detail.message) {
        alert(detail.message)
      } else {
        alert('Could not send the order. Please try again.')
      }
    } finally { setSending(null) }
  }

  async function deleteCancelledOrder() {
    if (!confirm('Delete this cancelled order from your list? Your items are safe in the draft.')) return
    try {
      await api.delete(`/farmer/orders/${orderId}`)
      router.replace('/orders')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: { code?: string; message?: string } } } }
      const detail = e?.response?.data?.detail
      if (detail && typeof detail === 'object' && detail.code === 'must_cancel_first') {
        alert(detail.message || 'Cancel the order first.')
      } else {
        alert('Could not delete the order. Please try again.')
      }
    }
  }

  async function cancelOrder() {
    if (!confirm('Cancel this order? Your items will be saved in a new draft so you can re-send them.')) return
    try {
      // Orders V2 Batch 3: cancel migrates items to a fresh DRAFT
      // and returns its id. We route the farmer to the draft so
      // they can pick a new recipient. If migration produced no
      // items (e.g. the order had none to migrate), fall back to
      // the orders list.
      const { data } = await api.put<{
        status: string
        new_draft_order_id?: string
        migrated_item_count?: number
      }>(`/farmer/orders/${orderId}/cancel`, {})
      const draftId = data?.new_draft_order_id
      const count = data?.migrated_item_count ?? 0
      if (draftId && count > 0) {
        alert(`Cancelled. ${count} item${count === 1 ? ' has' : 's have'} been saved in a new draft — pick a new dealer or facilitator to send to.`)
        router.replace(`/orders/${draftId}`)
      } else {
        router.replace('/orders')
      }
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { detail?: { code?: string; message?: string } } } }
      const detail = e?.response?.data?.detail
      if (e?.response?.status === 409 && detail && typeof detail === 'object' && detail.code === 'dealer_currently_viewing') {
        alert(detail.message || 'The dealer is reviewing this order right now. Try again in a minute.')
      } else {
        alert('Could not cancel the order. Please try again.')
      }
    }
  }

  async function approveAll() {
    try {
      await api.put(`/farmer/orders/${orderId}/items/approve-all`, {})
      // 2026-06-03 — Per user direction: after Approve all, take the
      // farmer back to the Manage tab. The cleared order shows as
      // COMPLETED there; no need to stay on the review page.
      if (order?.subscription_id) {
        router.replace(`/crop-detail/${order.subscription_id}/orders?tab=manage`)
      } else {
        router.replace('/orders')
      }
    } catch {
      alert('Could not approve. Please try again.')
    }
  }

  // 2026-06-03 — Per-row actions on the bucketed review. A "row" can
  // be a consolidated brand (covering N underlying OrderItem rows
  // per yesterday's task 4) so the action walks merged_item_ids.
  // Returns void; reload happens after the whole batch.
  async function rejectRow(row: ReviewRow) {
    const ids = row.merged_item_ids?.length ? row.merged_item_ids : [row.id]
    for (const id of ids) {
      try { await api.put(`/farmer/orders/${orderId}/items/${id}/reject`, {}) }
      catch { /* surface via load + status */ }
    }
    setConfirmDelete(null)
    load()
  }
  async function cancelPostponedRow(row: ReviewRow) {
    try {
      await api.put(`/farmer/orders/${orderId}/items/${row.id}/cancel-postponed`, {})
    } catch { /* surface via load + status */ }
    setConfirmCancelPostponed(null)
    load()
  }

  async function skipItem(itemId: string) {
    await api.put(`/farmer/orders/${orderId}/items/${itemId}/skip`, {})
    load()
  }

  async function removeItem(itemId: string) {
    if (!confirm('Remove this item from the order?')) return
    await api.delete(`/farmer/orders/${orderId}/items/${itemId}`)
    load()
  }

  if (loading || !order) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-green-700 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const awaitingApproval = order.items.filter(i => i.status === 'SENT_FOR_APPROVAL')
  // Orders V2 (2026-05-31): farmer keeps cancel rights through every
  // non-terminal status. The backend gates on live dealer presence,
  // not on a status threshold.
  // 2026-06-03 — Per user direction: Cancel Order and "Send returned
  // items" are GATED on the approval task being complete. While there
  // are any SENT_FOR_APPROVAL items on the order, the farmer can
  // neither cancel nor bundle-reroute — both decisions depend on
  // what they choose for the awaiting items first. Once approvals
  // are cleared (approved or deleted), the gates reopen.
  const approvalPending = (order.approval_items?.length ?? 0) > 0
  const canCancel = !approvalPending &&
    !['DRAFT', 'CANCELLED', 'COMPLETED', 'EXPIRED'].includes(order.status)
  const canDeleteHusk = order.status === 'CANCELLED'
  const isDraft = order.status === 'DRAFT'
  // Bundle re-route is offered for NOT_AVAILABLE + REJECTED +
  // POSTPONED items, BUT only after the approval task is complete.
  const reroutableItems = order.items.filter(i =>
    ['NOT_AVAILABLE', 'REJECTED', 'POSTPONED'].includes(i.status),
  )
  const canBundleReroute = !approvalPending && !isDraft && reroutableItems.length > 0
    && !['CANCELLED', 'COMPLETED', 'EXPIRED'].includes(order.status)

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Order Details" activeRole="FARMER"
        back={order.subscription_id ? `/crop-detail/${order.subscription_id}/orders?tab=manage` : '/orders'} />
      <div className="pt-16 pb-24 px-4 space-y-4 max-w-lg mx-auto">

        {/* Status card */}
        <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] mt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[#7A8C7E]">Status</p>
              <p className="font-semibold text-[#6B3F1F]">{order.status.replace(/_/g, ' ')}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[#7A8C7E]">Date</p>
              <p className="text-xs text-[#6B3F1F]">
                {new Date(order.date_from).toLocaleDateString()} — {new Date(order.date_to).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        {/* 2026-06-03 — Top "Approve All" CTA removed per user
            direction. For legal traceability the farmer must approve
            item-by-item; the per-row Approve button on each card is
            now the only path to approval.

            Bundle-reroute "Send N returned items" remains, but is
            now gated by canBundleReroute (which requires the
            approval task to be complete first). */}
        {canBundleReroute && (
          <button onClick={startReroute}
            className="w-full py-4 rounded-2xl text-white font-semibold text-sm"
            style={{ background: 'linear-gradient(135deg, #b45309, #92400e)' }}>
            Send {reroutableItems.length} returned item{reroutableItems.length === 1 ? '' : 's'} to a different dealer
          </button>
        )}

        {/* 2026-06-03 — Bucketed review sections. The backend returns
            approval_items / postponed_items / returned_items /
            approved_items already partitioned by status and (for the
            approval + approved sections) consolidated by brand+unit
            across timelines. */}

        {(order.approval_items?.length ?? 0) > 0 && (
          <section className="space-y-2">
            <p className="text-sm font-semibold text-[#6B3F1F] px-1">
              Awaiting your approval ({order.approval_items!.length})
            </p>
            {order.approval_items!.map(row => (
              <div key={row.id} className="bg-white rounded-2xl border border-purple-200 shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#6B3F1F] truncate">{row.brand_name || 'Brand pending'}</p>
                    {row.manufacturer_name && (
                      <p className="text-xs text-[#7A8C7E] mt-0.5">by {row.manufacturer_name}</p>
                    )}
                    <p className="text-sm text-[#6B3F1F] mt-1.5">
                      {row.given_volume ?? '—'} {row.volume_unit ?? ''}
                    </p>
                    {row.merged_timeline_count && row.merged_timeline_count > 1 && (
                      <p className="text-[11px] text-[#7A8C7E] mt-0.5">
                        across {row.merged_timeline_count} timelines
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {row.price != null ? (
                      <p className="text-lg font-bold text-[#085041]">₹{row.price.toLocaleString('en-IN')}</p>
                    ) : (
                      <p className="text-[11px] text-amber-700 italic">Price not provided</p>
                    )}
                  </div>
                </div>
                {/* 2026-06-03 — Per-row Approve removed. The farmer's
                    approval action is the single bottom "Approve all"
                    button. Per-row affordance is Remove only, which
                    pulls the row out of the approval batch before the
                    bulk commit. Reasoning: avoids partial-approval
                    cumbersomeness AND keeps the legal "looked before
                    approving" intent — they're still seeing every
                    row + brand + price right here. */}
                <button onClick={() => setConfirmDelete(row)}
                  className="w-full mt-3 bg-red-50 border border-red-200 text-[#D4682E] text-xs font-semibold py-2 rounded-xl">
                  🗑 Remove
                </button>
              </div>
            ))}
            <button onClick={approveAll}
              className="w-full py-4 rounded-2xl text-white font-semibold text-sm"
              style={{ background: 'linear-gradient(135deg, #3A7D44, #22773a)' }}>
              ✓ Approve all ({order.approval_items!.length} item{order.approval_items!.length === 1 ? '' : 's'})
            </button>
          </section>
        )}

        {(order.postponed_items?.length ?? 0) > 0 && (
          <section className="space-y-2">
            <p className="text-sm font-semibold text-[#6B3F1F] px-1">
              Postponed by dealer ({order.postponed_items!.length})
            </p>
            {order.postponed_items!.map(row => (
              <div key={row.id} className="bg-white rounded-2xl border border-amber-200 shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#6B3F1F] truncate">{row.brand_name || row.practice_name || 'Item'}</p>
                    {row.postponed_until && (
                      <p className="text-xs text-amber-700 mt-1">
                        Dealer will revisit by {new Date(row.postponed_until).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      </p>
                    )}
                  </div>
                </div>
                <button onClick={() => setConfirmCancelPostponed(row)}
                  className="mt-3 w-full bg-red-50 border border-red-200 text-[#D4682E] text-xs font-semibold py-2 rounded-xl">
                  Cancel — don't want to wait
                </button>
              </div>
            ))}
          </section>
        )}

        {/* 2026-06-03 — Returned section hidden while there are any
            SENT_FOR_APPROVAL items. Per user: returned actions
            depend on the approval decision; expose them only after
            the approval task is complete. */}
        {!approvalPending && (order.returned_items?.length ?? 0) > 0 && (
          <section className="space-y-2">
            <p className="text-sm font-semibold text-[#6B3F1F] px-1">
              Returned ({order.returned_items!.length})
            </p>
            <p className="text-[11px] text-[#7A8C7E] px-1 -mt-1">
              These items can't be fulfilled. Send the whole returned batch to a different dealer with the button above, or leave them for now.
            </p>
            {order.returned_items!.map(row => (
              <div key={row.id} className="bg-white rounded-2xl border border-red-200 shadow-sm p-4">
                <p className="font-semibold text-[#6B3F1F] truncate">
                  {row.brand_name || row.practice_name || 'Item'}
                </p>
                <p className="text-xs text-[#D4682E] mt-1">
                  {row.status === 'REJECTED' ? 'Deleted from approval' : 'Not available at dealer'}
                </p>
              </div>
            ))}
          </section>
        )}

        {(order.approved_items?.length ?? 0) > 0 && (
          <section className="space-y-2">
            <p className="text-sm font-semibold text-[#6B3F1F] px-1">
              Approved — Received ({order.approved_items!.length})
            </p>
            {order.approved_items!.map(row => (
              <div key={row.id} className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#6B3F1F] truncate">{row.brand_name || 'Item'}</p>
                    {row.manufacturer_name && (
                      <p className="text-xs text-[#7A8C7E] mt-0.5">by {row.manufacturer_name}</p>
                    )}
                    <p className="text-sm text-emerald-700 mt-1.5">
                      {row.given_volume ?? '—'} {row.volume_unit ?? ''}
                    </p>
                  </div>
                  {row.price != null && (
                    <p className="text-lg font-bold text-[#085041]">₹{row.price.toLocaleString('en-IN')}</p>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* DRAFT — items migrated here from a cancelled order; the
            farmer picks a new recipient via the picker sheet. */}
        {isDraft && (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900 leading-relaxed">
              <p className="font-semibold mb-1">This is a draft</p>
              <p>
                These items were saved when you cancelled the original order.
                Pick a new dealer or facilitator and send them on their way.
              </p>
            </div>
            <button onClick={openPicker}
              className="w-full py-4 rounded-2xl text-white font-semibold text-sm"
              style={{ background: 'linear-gradient(135deg, #3A7D44, #22773a)' }}>
              Pick a recipient →
            </button>
          </>
        )}

        {/* Cancel order */}
        {canCancel && (
          <button onClick={cancelOrder}
            className="w-full py-3 rounded-2xl border-2 border-red-200 text-[#D4682E] font-semibold text-sm">
            Cancel Order
          </button>
        )}

        {/* Delete the empty CANCELLED husk. Items already moved to a
            fresh draft on cancel; this just removes the historical
            husk row from the farmer's order list. Events table keeps
            the lineage trail via SET NULL on order_id. */}
        {canDeleteHusk && (
          <button onClick={deleteCancelledOrder}
            className="w-full py-3 rounded-2xl border-2 border-slate-200 text-slate-600 font-semibold text-sm">
            Delete Cancelled Order
          </button>
        )}
      </div>

      {/* DRAFT recipient picker — bottom sheet with two tabs.
          The same nearby-* endpoints `/order/new` uses so ranking
          (Promoter pinned, then by distance) stays consistent. */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => !sending && setPickerOpen(false)}>
          <div className="bg-white rounded-t-2xl w-full max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
            <div className="px-4 py-3 border-b border-[#DDD0B8] flex items-center justify-between">
              <p className="font-semibold text-[#6B3F1F]">Send to</p>
              <button onClick={() => !sending && setPickerOpen(false)} className="text-[#7A8C7E] text-xl">×</button>
            </div>
            {lockedBrandExplainer && (
              <div className="mx-4 mt-3 bg-purple-50 border border-purple-200 rounded-xl px-3 py-2.5 text-xs text-purple-800 leading-relaxed">
                <p className="font-semibold mb-0.5">Brand-locked order</p>
                <p>{lockedBrandExplainer}</p>
              </div>
            )}
            <div className="flex border-b border-[#DDD0B8]">
              {(['dealers', 'facilitators'] as const).map(t => {
                // Hide the facilitators tab entirely for locked-brand
                // orders — they're not an eligible path. Keep both
                // tabs present otherwise so an empty list still has
                // its own pane and "0" reads naturally.
                if (t === 'facilitators' && lockedBrandExplainer) return null
                return (
                  <button key={t} onClick={() => setPickerTab(t)}
                    className={`flex-1 py-3 text-sm font-medium ${pickerTab === t ? 'text-[#6B3F1F] border-b-2 border-[#3A7D44]' : 'text-[#7A8C7E]'}`}>
                    {t === 'dealers' ? `Dealers (${dealers.length})` : `Facilitators (${facilitators.length})`}
                  </button>
                )
              })}
            </div>
            <div className="p-4 space-y-3">
              {pickerLoading ? (
                [1, 2, 3].map(i => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)
              ) : (pickerTab === 'dealers' ? dealers : facilitators).length === 0 ? (
                <div className="text-center py-10 text-sm text-[#7A8C7E]">
                  No {pickerTab} found nearby.
                </div>
              ) : (
                (pickerTab === 'dealers' ? dealers : facilitators).map(r => {
                  const isDealer = pickerTab === 'dealers'
                  const busy = sending === r.user_id
                  return (
                    <div key={r.user_id} className="bg-white border border-[#DDD0B8] rounded-xl p-3 flex items-center justify-between">
                      <div className="min-w-0 mr-3">
                        <p className="font-semibold text-[#6B3F1F] text-sm truncate">{r.name}</p>
                        {isDealer && r.shop_name && <p className="text-xs text-[#7A8C7E] truncate">{r.shop_name}</p>}
                        {typeof r.distance_km === 'number' && <p className="text-xs text-[#7A8C7E]">{r.distance_km} km away</p>}
                        {r.is_promoter && <span className="text-[10px] text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded-full font-medium">Promoter</span>}
                      </div>
                      <button onClick={() => sendToRecipient(r, isDealer)}
                        disabled={!!sending}
                        className="shrink-0 px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                        style={{ background: '#3A7D44' }}>
                        {busy ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2026-06-03 — Confirm modal for Delete (reject) from the
          approval bucket. Per user's note: confirm deletion. */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5 pb-10" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">Delete this item?</p>
            <p className="text-xs text-[#7A8C7E] mt-1.5">
              <strong className="text-[#6B3F1F]">{confirmDelete.brand_name || 'Item'}</strong> will be moved to your Returned list. You can send it to another dealer from there.
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl">
                Cancel
              </button>
              <button onClick={() => rejectRow(confirmDelete)}
                className="flex-1 bg-red-100 text-[#D4682E] text-sm font-semibold py-2.5 rounded-xl">
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmCancelPostponed && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => setConfirmCancelPostponed(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5 pb-10" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">Cancel postponed item?</p>
            <p className="text-xs text-[#7A8C7E] mt-1.5">
              <strong className="text-[#6B3F1F]">{confirmCancelPostponed.brand_name || confirmCancelPostponed.practice_name || 'Item'}</strong> will move to your Returned list. You can send it to another dealer from there.
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmCancelPostponed(null)}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl">
                Keep waiting
              </button>
              <button onClick={() => cancelPostponedRow(confirmCancelPostponed)}
                className="flex-1 bg-red-100 text-[#D4682E] text-sm font-semibold py-2.5 rounded-xl">
                Yes, cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2026-06-03 — Reroute nudge sheet. Surfaces the dealer's name
          and the postponed-item count, lets the farmer choose between
          "cancel and bundle" or "keep with current dealer". */}
      {rerouteNudge && order && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => setRerouteNudge(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5 pb-10" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">Send returned items to another dealer</p>
            <p className="text-xs text-[#7A8C7E] mt-2 leading-relaxed">
              You have <strong className="text-[#6B3F1F]">{order.postponed_items?.length ?? 0} postponed item{(order.postponed_items?.length ?? 0) === 1 ? '' : 's'}</strong> still
              with the current dealer. Do you want to cancel them and send everything together to a new dealer,
              or leave them with the current dealer in case they deliver later?
            </p>
            <div className="space-y-2 mt-4">
              <button onClick={() => doReroute(true)}
                className="w-full py-3 rounded-xl text-white text-sm font-semibold"
                style={{ background: 'linear-gradient(135deg, #b45309, #92400e)' }}>
                Cancel postponed & send everything ({(order.returned_items?.length ?? 0) + (order.postponed_items?.length ?? 0)} items)
              </button>
              <button onClick={() => doReroute(false)}
                className="w-full py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium">
                Keep postponed with current dealer · send only returned ({order.returned_items?.length ?? 0})
              </button>
              <button onClick={() => setRerouteNudge(false)}
                className="w-full py-2 text-[#7A8C7E] text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
