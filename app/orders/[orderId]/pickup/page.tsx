'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

// 2026-06-06 — Focused pickup-confirmation surface. Routes from the
// Manage tab's "Pick up from X" banner. Shows ONLY the packing
// details + confirm — no approval queue, no Returned section, no
// review-page noise. Once the farmer taps confirm, /mark-received
// fires and we pop back to the Manage tab.

interface ApprovedItem {
  id: string
  brand_name: string | null
  manufacturer_name: string | null
  given_volume: number | null
  volume_unit: string | null
  price: number | null
  merged_timeline_count?: number
}

interface OrderForPickup {
  id: string
  status: string
  subscription_id: string
  dealer_user_id: string | null
  dealer_name: string | null
  facilitator_user_id: string | null
  facilitator_name: string | null
  approved_items?: ApprovedItem[]
  packing_code?: string | null
  packing_shared_at?: string | null
  packing_picked_up_at?: string | null
  packing_picked_up_by_role?: 'FARMER' | 'FACILITATOR' | null
  packing_farmer_received_at?: string | null
}

export default function FarmerPickupPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<OrderForPickup | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<OrderForPickup>(`/farmer/orders/${orderId}`)
      .then(r => setOrder(r.data))
      .finally(() => setLoading(false))
  }, [orderId, router])

  async function markReceived() {
    if (!order) return
    setBusy(true)
    try {
      await api.put(`/farmer/orders/${order.id}/packing-list/mark-received`, {})
      router.replace(`/crop-detail/${order.subscription_id}/orders?tab=manage`)
    } catch { alert('Could not confirm receipt. Please try again.') }
    finally { setBusy(false); setConfirm(false) }
  }

  if (loading || !order) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title="Pick up" activeRole="FARMER" back />
        <div className="pt-16 px-4 mt-4">
          <div className="h-28 bg-white/60 rounded-2xl animate-pulse" />
        </div>
      </div>
    )
  }

  const items = order.approved_items || []
  const total = items.reduce((s, i) => s + (i.price || 0), 0)
  const already = !!order.packing_farmer_received_at
  const facilitatorPickedUp =
    order.packing_picked_up_at && order.packing_picked_up_by_role === 'FACILITATOR'
  const from = facilitatorPickedUp
    ? (order.facilitator_name || 'the facilitator')
    : (order.dealer_name || 'the dealer')

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Pick up" activeRole="FARMER"
        back={`/crop-detail/${order.subscription_id}/orders?tab=manage`} />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto space-y-3">

        {/* Packing ID + From */}
        <div className="bg-white rounded-2xl border border-emerald-200 overflow-hidden mt-3">
          {order.packing_code && (
            <div className="px-4 py-2 bg-emerald-600 text-white flex items-baseline justify-between">
              <p className="text-[10px] uppercase tracking-wider opacity-75">Packing ID</p>
              <p className="text-base font-bold font-mono tracking-widest">{order.packing_code}</p>
            </div>
          )}
          <div className="p-4">
            <p className="text-xs text-[#7A8C7E] uppercase tracking-wider">From</p>
            <p className="text-base font-semibold text-[#6B3F1F] mt-0.5">{from}</p>
            <p className="text-[11px] text-[#7A8C7E] mt-2 leading-relaxed">
              Cross-check the Packing ID with what {facilitatorPickedUp ? 'your facilitator' : 'the dealer'} shared
              before tapping confirm below.
            </p>
          </div>
        </div>

        {/* Items list */}
        {items.length > 0 && (
          <div className="bg-white rounded-2xl border border-emerald-200 overflow-hidden">
            <div className="divide-y divide-emerald-100">
              {items.map(it => (
                <div key={it.id} className="p-4 flex items-baseline justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#6B3F1F] truncate">{it.brand_name || 'Item'}</p>
                    {it.manufacturer_name && (
                      <p className="text-xs text-[#7A8C7E] mt-0.5">by {it.manufacturer_name}</p>
                    )}
                    {it.given_volume != null && (
                      <p className="text-xs text-[#7A8C7E] mt-0.5">{it.given_volume} {it.volume_unit || ''}</p>
                    )}
                  </div>
                  {it.price != null && (
                    <p className="text-base font-bold text-[#085041] shrink-0">₹{it.price.toLocaleString('en-IN')}</p>
                  )}
                </div>
              ))}
            </div>
            <div className="px-4 py-2 bg-emerald-50/40 border-t border-emerald-100 flex items-center justify-between">
              <p className="text-[11px] text-[#7A8C7E] uppercase tracking-wider">Total</p>
              <p className="text-sm font-bold text-[#085041]">₹{total.toLocaleString('en-IN')}</p>
            </div>
          </div>
        )}

        {/* Action */}
        {already ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-3 text-sm text-emerald-800 text-center font-medium">
            ✓ You confirmed receipt on{' '}
            {new Date(order.packing_farmer_received_at!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
            {' '}at{' '}
            {new Date(order.packing_farmer_received_at!).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.
          </div>
        ) : (
          <button onClick={() => setConfirm(true)}
            className="w-full py-4 rounded-2xl bg-[#085041] text-white font-semibold text-sm">
            ✓ I have picked up these items
          </button>
        )}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={() => !busy && setConfirm(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">Confirm pickup?</p>
            <p className="text-xs text-[#7A8C7E] mt-2">
              By confirming, you tell the dealer the items are in your hands.
              They will mark the order as completed. Only do this when the
              items are physically with you.
            </p>
            {order.packing_code && (
              <p className="text-xs text-[#6B3F1F] mt-2">
                Packing ID: <strong className="font-mono tracking-widest">{order.packing_code}</strong>
              </p>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirm(false)} disabled={busy}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                Cancel
              </button>
              <button onClick={markReceived} disabled={busy}
                className="flex-1 bg-[#085041] text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {busy ? '…' : 'Yes, I have them'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
