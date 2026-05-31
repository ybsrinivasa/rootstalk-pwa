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
interface Order {
  id: string; status: string; date_from: string; date_to: string; created_at: string
  dealer_user_id: string | null; facilitator_user_id: string | null
  subscription_id: string; category: string | null
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
    await api.put(`/farmer/orders/${orderId}/items/approve-all`, {})
    load()
  }

  async function approveItem(itemId: string) {
    await api.put(`/farmer/orders/${orderId}/items/${itemId}/approve`, {})
    load()
  }

  async function rejectItem(itemId: string) {
    await api.put(`/farmer/orders/${orderId}/items/${itemId}/reject`, {})
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
  const canCancel = !['DRAFT', 'CANCELLED', 'COMPLETED', 'EXPIRED'].includes(order.status)
  const canDeleteHusk = order.status === 'CANCELLED'
  const isDraft = order.status === 'DRAFT'

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Order Details" activeRole="FARMER" back="/orders" />
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

        {/* Approve all CTA */}
        {awaitingApproval.length > 0 && (
          <button onClick={approveAll}
            className="w-full py-4 rounded-2xl text-white font-semibold text-sm"
            style={{ background: 'linear-gradient(135deg, #3A7D44, #22773a)' }}>
            ✓ Approve All ({awaitingApproval.length} item{awaitingApproval.length > 1 ? 's' : ''})
          </button>
        )}

        {/* Items */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-[#6B3F1F] px-1">Items ({order.items.length})</p>
          {order.items.map(item => (
            <div key={item.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[item.status] || 'bg-slate-100'}`}>
                    {STATUS_FARMER[item.status] || item.status.replace(/_/g, ' ')}
                  </span>
                  <p className="text-xs text-[#7A8C7E] font-mono mt-1.5 truncate">{item.practice_id}</p>

                  {/* Brand shown only after approval */}
                  {item.status === 'APPROVED' && item.brand_name && (
                    <div className="mt-2 bg-emerald-50 rounded-lg px-3 py-2">
                      <p className="text-xs text-emerald-600 font-medium">Brand</p>
                      <p className="text-sm font-bold text-emerald-800">{item.brand_name}</p>
                      {item.given_volume && (
                        <p className="text-xs text-emerald-600">{item.given_volume} {item.volume_unit}
                          {item.price ? ` · ₹${item.price}` : ''}</p>
                      )}
                    </div>
                  )}

                  {/* Approval pending — show qty/price but not brand */}
                  {item.status === 'SENT_FOR_APPROVAL' && (
                    <div className="mt-2 bg-purple-50 rounded-lg px-3 py-2">
                      <p className="text-xs text-purple-600">
                        {item.given_volume} {item.volume_unit}
                        {item.price ? ` · ₹${item.price}` : ''}
                      </p>
                      <p className="text-xs text-[#7A8C7E] mt-0.5">Brand shown after approval</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions for items awaiting approval */}
              {item.status === 'SENT_FOR_APPROVAL' && (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => approveItem(item.id)}
                    className="flex-1 bg-green-600 text-white text-xs font-semibold py-2.5 rounded-xl">
                    ✓ Approve
                  </button>
                  <button onClick={() => rejectItem(item.id)}
                    className="flex-1 bg-red-100 text-[#D4682E] text-xs font-semibold py-2.5 rounded-xl">
                    ✗ Reject
                  </button>
                </div>
              )}

              {/* Actions for NOT_AVAILABLE items */}
              {item.status === 'NOT_AVAILABLE' && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-[#D4682E] font-medium">Dealer cannot fulfil this item</p>
                  {rerouting === item.id ? (
                    <div className="space-y-2">
                      <input value={newDealerPhone}
                        onChange={e => setNewDealerPhone(e.target.value)}
                        placeholder="Dealer phone number"
                        className="w-full border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            setRerouting(null)
                            setNewDealerPhone('')
                          }}
                          className="flex-1 bg-slate-100 text-[#6B3F1F] text-xs font-medium py-2 rounded-xl">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => setRerouting(item.id)}
                        className="flex-1 bg-blue-100 text-blue-700 text-xs font-semibold py-2 rounded-xl">
                        Try another dealer
                      </button>
                      <button onClick={() => skipItem(item.id)}
                        className="flex-1 bg-slate-100 text-[#6B3F1F] text-xs font-semibold py-2 rounded-xl">
                        Skip for now
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Remove item (before approval) */}
              {['PENDING', 'AVAILABLE', 'POSTPONED'].includes(item.status) && order.status === 'PROCESSING' && (
                <button onClick={() => removeItem(item.id)}
                  className="mt-2 text-xs text-[#D4682E] underline">
                  Remove item
                </button>
              )}
            </div>
          ))}
        </div>

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
    </div>
  )
}
