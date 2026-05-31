'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

// Orders V2 Batch 14 — farmer-side seed order detail. Same
// affordances as the pesticide/fertiliser detail
// (/orders/[orderId]) so the farmer's interaction stays consistent
// across categories: status badge, cancel, DRAFT recipient picker,
// delete cancelled husk, approve / reject when dealer's submitted.

interface SeedOrder {
  id: string
  status: string
  variety_id: string
  variety_name: string | null
  crop_cosh_id: string | null
  unit: string | null
  quantity: number | null
  total_price: number | null
  dealer_user_id: string | null
  facilitator_user_id: string | null
  subscription_id: string
  client_id: string
  postponed_until: string | null
  created_at: string
}

interface Recipient {
  user_id: string
  name: string
  phone: string
  shop_name?: string | null
  shop_address?: string | null
  distance_km?: number
  is_promoter?: boolean
}

const STATUS_FARMER: Record<string, { copy: string; tone: string }> = {
  DRAFT:             { copy: 'Draft — pick a recipient',  tone: 'bg-stone-100 text-[#7A8C7E]' },
  SENT:              { copy: 'Sent — waiting for dealer', tone: 'bg-purple-100 text-purple-700' },
  ACCEPTED:          { copy: 'Dealer processing',         tone: 'bg-blue-100 text-blue-700' },
  AVAILABLE:         { copy: 'Dealer processing',         tone: 'bg-blue-100 text-blue-700' },
  POSTPONED:         { copy: 'Delayed',                   tone: 'bg-amber-100 text-amber-800' },
  NOT_AVAILABLE:     { copy: 'Returned — action needed',  tone: 'bg-red-100 text-[#D4682E]' },
  SENT_FOR_APPROVAL: { copy: 'Ready for your approval',   tone: 'bg-amber-100 text-amber-700' },
  PURCHASED:         { copy: 'Purchased',                 tone: 'bg-emerald-100 text-emerald-700' },
  REJECTED:          { copy: 'Rejected by you',           tone: 'bg-rose-100 text-rose-600' },
  CANCELLED:         { copy: 'Cancelled',                 tone: 'bg-stone-100 text-[#7A8C7E]' },
  REROUTED:          { copy: 'Re-routed',                 tone: 'bg-stone-100 text-[#7A8C7E]' },
}

export default function FarmerSeedOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<SeedOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // DRAFT recipient picker
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTab, setPickerTab] = useState<'dealers' | 'facilitators'>('dealers')
  const [dealers, setDealers] = useState<Recipient[]>([])
  const [facilitators, setFacilitators] = useState<Recipient[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [sending, setSending] = useState<string | null>(null)

  const load = async () => {
    try {
      const { data } = await api.get<SeedOrder>(`/farmer/seed-orders/${orderId}`)
      setOrder(data)
    } catch {
      router.replace('/seed-orders')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  async function cancelOrder() {
    if (!order) return
    if (!confirm('Cancel this seed order? Your variety + quantity will be saved in a new draft so you can re-send.')) return
    setBusy(true)
    try {
      const { data } = await api.put<{ status: string; new_draft_seed_order_id?: string }>(
        `/farmer/seed-orders/${order.id}/cancel`, {},
      )
      const draftId = data?.new_draft_seed_order_id
      if (draftId) {
        alert('Cancelled. Pick a new dealer or facilitator on the next screen.')
        router.replace(`/seed-orders/${draftId}`)
      } else {
        router.replace('/seed-orders')
      }
    } catch {
      alert('Could not cancel. Please try again.')
    } finally { setBusy(false) }
  }

  async function deleteHusk() {
    if (!order) return
    if (!confirm('Delete this cancelled seed order from your list?')) return
    setBusy(true)
    try {
      await api.delete(`/farmer/seed-orders/${order.id}`)
      router.replace('/seed-orders')
    } catch {
      alert('Could not delete. Please try again.')
    } finally { setBusy(false) }
  }

  async function approveOrder() {
    if (!order) return
    setBusy(true)
    try {
      await api.put(`/farmer/seed-orders/${order.id}/approve`, {})
      load()
    } catch {
      alert('Could not approve. Please try again.')
    } finally { setBusy(false) }
  }

  async function rejectOrder() {
    if (!order) return
    if (!confirm('Reject the dealer\'s quantity and price?')) return
    setBusy(true)
    try {
      await api.put(`/farmer/seed-orders/${order.id}/reject`, {})
      load()
    } catch {
      alert('Could not reject. Please try again.')
    } finally { setBusy(false) }
  }

  async function openPicker() {
    if (!order) return
    setPickerOpen(true)
    setPickerLoading(true)
    try {
      const [d, f] = await Promise.allSettled([
        api.get<Recipient[]>(`/farmer/subscriptions/${order.subscription_id}/nearby-dealers?order_type=SEED`),
        api.get<Recipient[]>(`/farmer/subscriptions/${order.subscription_id}/nearby-facilitators`),
      ])
      setDealers(d.status === 'fulfilled' ? d.value.data : [])
      setFacilitators(f.status === 'fulfilled' ? f.value.data : [])
    } finally { setPickerLoading(false) }
  }

  async function sendToRecipient(r: Recipient, isDealer: boolean) {
    if (!order) return
    setSending(r.user_id)
    try {
      const payload = isDealer
        ? { dealer_user_id: r.user_id }
        : { facilitator_user_id: r.user_id }
      await api.put(`/farmer/seed-orders/${order.id}/send`, payload)
      setPickerOpen(false)
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: { message?: string } } } }
      alert(e?.response?.data?.detail?.message || 'Could not send. Please try again.')
    } finally { setSending(null) }
  }

  if (loading) return (
    <div className="min-h-screen bg-[#F5F0E8] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-green-700 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!order) return null

  const isDraft = order.status === 'DRAFT'
  const isCancelled = order.status === 'CANCELLED'
  const canCancel = !['DRAFT', 'CANCELLED', 'PURCHASED', 'REJECTED', 'REROUTED'].includes(order.status)
  const canApprove = order.status === 'SENT_FOR_APPROVAL'
  const tone = STATUS_FARMER[order.status] ?? { copy: order.status, tone: 'bg-slate-100' }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Seed Order" activeRole="FARMER" back="/seed-orders" />
      <div className="pt-16 pb-24 px-4 space-y-4 max-w-lg mx-auto">

        <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] mt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-[#6B3F1F] truncate">{order.variety_name || 'Unknown variety'}</p>
              <p className="text-xs text-[#7A8C7E]">{cropDisplayName(order.crop_cosh_id)}</p>
            </div>
            <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${tone.tone}`}>
              {tone.copy}
            </span>
          </div>
          {order.unit && order.quantity != null && (
            <p className="text-xs text-[#7A8C7E] mt-2">
              {order.quantity} {order.unit}
              {order.total_price != null && order.status === 'PURCHASED' ? ` · ₹${order.total_price}` : ''}
            </p>
          )}
        </div>

        {/* Dealer-submitted qty/price awaiting farmer approval */}
        {canApprove && order.unit && order.quantity != null && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-sm font-semibold text-amber-900 mb-2">Dealer has submitted</p>
            <div className="space-y-1 text-sm text-[#6B3F1F]">
              <p><span className="text-[#7A8C7E]">Quantity: </span>{order.quantity} {order.unit}</p>
              {order.total_price != null && (
                <p><span className="text-[#7A8C7E]">Price: </span>₹{order.total_price}</p>
              )}
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={approveOrder} disabled={busy}
                className="flex-1 py-3 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #3A7D44, #22773a)' }}>
                ✓ Approve
              </button>
              <button onClick={rejectOrder} disabled={busy}
                className="px-5 py-3 rounded-2xl bg-red-100 text-[#D4682E] font-semibold text-sm">
                ✗ Reject
              </button>
            </div>
          </div>
        )}

        {/* DRAFT — picker CTA */}
        {isDraft && (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900 leading-relaxed">
              <p className="font-semibold mb-1">This is a draft</p>
              <p>This variety + quantity was saved when you cancelled the previous order. Pick a new dealer or facilitator and send.</p>
            </div>
            <button onClick={openPicker}
              className="w-full py-4 rounded-2xl text-white font-semibold text-sm"
              style={{ background: 'linear-gradient(135deg, #3A7D44, #22773a)' }}>
              Pick a recipient →
            </button>
          </>
        )}

        {/* POSTPONED — explainer + cancel CTA below */}
        {order.status === 'POSTPONED' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900 leading-relaxed">
            The dealer has delayed this seed order. It will auto-return to you when the window expires; you can also cancel below to send it to someone else right now.
          </div>
        )}

        {/* NOT_AVAILABLE — explainer + cancel CTA below */}
        {order.status === 'NOT_AVAILABLE' && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800 leading-relaxed">
            The dealer can&apos;t fulfil this seed order. Cancel below to send it to a different dealer or facilitator.
          </div>
        )}

        {/* Cancel */}
        {canCancel && (
          <button onClick={cancelOrder} disabled={busy}
            className="w-full py-3 rounded-2xl border-2 border-red-200 text-[#D4682E] font-semibold text-sm disabled:opacity-50">
            Cancel Order
          </button>
        )}

        {/* Delete husk */}
        {isCancelled && (
          <button onClick={deleteHusk} disabled={busy}
            className="w-full py-3 rounded-2xl border-2 border-slate-200 text-slate-600 font-semibold text-sm disabled:opacity-50">
            Delete Cancelled Order
          </button>
        )}
      </div>

      {/* Picker sheet — same shape as /orders/[id] for consistency */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => !sending && setPickerOpen(false)}>
          <div className="bg-white rounded-t-2xl w-full max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
            <div className="px-4 py-3 border-b border-[#DDD0B8] flex items-center justify-between">
              <p className="font-semibold text-[#6B3F1F]">Send to</p>
              <button onClick={() => !sending && setPickerOpen(false)} className="text-[#7A8C7E] text-xl">×</button>
            </div>
            <div className="flex border-b border-[#DDD0B8]">
              {(['dealers', 'facilitators'] as const).map(t => (
                <button key={t} onClick={() => setPickerTab(t)}
                  className={`flex-1 py-3 text-sm font-medium ${pickerTab === t ? 'text-[#6B3F1F] border-b-2 border-[#3A7D44]' : 'text-[#7A8C7E]'}`}>
                  {t === 'dealers' ? `Dealers (${dealers.length})` : `Facilitators (${facilitators.length})`}
                </button>
              ))}
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
