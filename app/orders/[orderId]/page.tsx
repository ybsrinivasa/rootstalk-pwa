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
  items: OrderItem[]
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
            farmer still needs to pick a new recipient and send.
            The send affordance arrives in Batch 4; for now we tell
            the farmer what this is and let them delete the draft if
            they don't want to re-send. */}
        {isDraft && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900 leading-relaxed">
            <p className="font-semibold mb-1">This is a draft</p>
            <p>
              These items were saved when you cancelled the original order.
              Picking a new dealer or facilitator and sending is coming soon —
              for now your draft is safe here.
            </p>
          </div>
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
    </div>
  )
}
