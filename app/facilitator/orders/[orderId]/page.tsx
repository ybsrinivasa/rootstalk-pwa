'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

interface OrderDetail {
  id: string; status: string; farmer_user_id: string; client_id: string
  dealer_user_id: string | null; date_from: string; date_to: string
  items: { id: string; practice_id: string; status: string; brand_name: string | null; given_volume: number | null; volume_unit: string | null; price: number | null }[]
}

export default function FacilitatorOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [routing, setRouting] = useState(false)
  const [dealerPhone, setDealerPhone] = useState('')
  const [routeError, setRouteError] = useState('')
  const [dealerUserId, setDealerUserId] = useState('')

  const load = async () => {
    try {
      const { data } = await api.get<OrderDetail>(`/facilitator/orders/${orderId}`)
      setOrder(data)
      if (data.dealer_user_id) setDealerUserId(data.dealer_user_id)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [orderId])

  async function routeToDealer() {
    if (!dealerUserId) return
    setRouting(true); setRouteError('')
    try {
      await api.put(`/facilitator/orders/${orderId}/route-to-dealer`, { dealer_user_id: dealerUserId })
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setRouteError(msg || 'Failed to route order.')
    } finally { setRouting(false) }
  }

  if (loading || !order) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#7D4E00] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const STATUS_COLOUR: Record<string, string> = {
    PENDING: 'bg-slate-100 text-slate-600', AVAILABLE: 'bg-green-100 text-green-700',
    POSTPONED: 'bg-amber-100 text-amber-700', NOT_AVAILABLE: 'bg-red-100 text-red-600',
    SENT_FOR_APPROVAL: 'bg-blue-100 text-blue-700', APPROVED: 'bg-emerald-100 text-emerald-700',
    REJECTED: 'bg-rose-100 text-rose-600',
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Order Details" activeRole="FACILITATOR" />
      <div className="pt-16 pb-24 px-4 space-y-4">
        {/* Summary */}
        <div className="bg-white rounded-2xl p-4 border border-slate-100 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">Status</p>
              <p className="font-semibold text-slate-800 capitalize">{order.status.replace(/_/g, ' ')}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">{order.items.length} items</p>
              <p className="text-xs text-slate-500">{new Date(order.date_from).toLocaleDateString()} — {new Date(order.date_to).toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        {/* Route to dealer */}
        {!order.dealer_user_id && order.status === 'SENT' && (
          <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <p className="font-semibold text-slate-800 text-sm mb-1">Route to Dealer</p>
            <p className="text-slate-400 text-xs mb-3">Enter the dealer's user ID to route this order to them for processing.</p>
            <input value={dealerUserId} onChange={e => setDealerUserId(e.target.value)}
              placeholder="Dealer User ID"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none mb-2 font-mono" />
            {routeError && <p className="text-xs text-red-600 mb-2">{routeError}</p>}
            <button onClick={routeToDealer} disabled={routing || !dealerUserId}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
              style={{ background: '#7D4E00' }}>
              {routing ? 'Routing…' : '→ Route to Dealer'}
            </button>
          </div>
        )}

        {order.dealer_user_id && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
            ✓ Order routed to dealer for processing
          </div>
        )}

        {/* Items */}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-700 px-1">Order Items</p>
          {order.items.map(item => (
            <div key={item.id} className="bg-white rounded-2xl p-4 border border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[item.status] || 'bg-slate-100'}`}>
                    {item.status.replace(/_/g, ' ')}
                  </span>
                  {item.brand_name && <p className="text-sm font-medium text-slate-800 mt-1">{item.brand_name}</p>}
                  {item.given_volume && (
                    <p className="text-xs text-slate-500 mt-0.5">{item.given_volume} {item.volume_unit} — ₹{item.price}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
