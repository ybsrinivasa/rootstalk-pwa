'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface Order {
  id: string; status: string; farmer_user_id: string; client_id: string
  dealer_user_id: string | null; date_from: string; date_to: string
  created_at: string; item_count: number; pending_count: number
}

const STATUS_COLOUR: Record<string, string> = {
  SENT: 'bg-purple-100 text-purple-700',
  ACCEPTED: 'bg-blue-100 text-blue-700',
  PROCESSING: 'bg-sky-100 text-sky-700',
  SENT_FOR_APPROVAL: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
}

export default function FacilitatorOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<Order[]>('/facilitator/orders')
      .then(r => setOrders(r.data))
      .finally(() => setLoading(false))
  }, [])

  const pending = orders.filter(o => !['COMPLETED', 'CANCELLED'].includes(o.status))
  const done = orders.filter(o => ['COMPLETED', 'CANCELLED'].includes(o.status))

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Facilitator — Orders" activeRole="FACILITATOR" />
      <div className="pt-16 pb-20 px-4">
        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
          ) : orders.length === 0 ? (
            <div className="text-center py-20">
              <span className="text-4xl">🌾</span>
              <p className="text-slate-400 text-sm mt-3">No orders routed to you yet</p>
            </div>
          ) : (
            <>
              {pending.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Pending ({pending.length})</p>
                  {pending.map(order => (
                    <OrderCard key={order.id} order={order} onPress={() => router.push(`/facilitator/orders/${order.id}`)} />
                  ))}
                </>
              )}
              {done.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4">Completed</p>
                  {done.map(order => (
                    <OrderCard key={order.id} order={order} onPress={() => router.push(`/facilitator/orders/${order.id}`)} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
      <BottomNav color="#7D4E00" activeRole="FACILITATOR" />
    </div>
  )
}

function OrderCard({ order, onPress }: { order: { id: string; status: string; date_from: string; date_to: string; created_at: string; item_count: number; dealer_user_id: string | null }; onPress: () => void }) {
  const STATUS_COLOUR: Record<string, string> = {
    SENT: 'bg-purple-100 text-purple-700', ACCEPTED: 'bg-blue-100 text-blue-700',
    PROCESSING: 'bg-sky-100 text-sky-700', SENT_FOR_APPROVAL: 'bg-amber-100 text-amber-700',
    COMPLETED: 'bg-emerald-100 text-emerald-700', CANCELLED: 'bg-slate-100 text-slate-500',
  }
  return (
    <button onClick={onPress}
      className="w-full bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-left active:scale-98 transition-transform">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[order.status] || 'bg-slate-100 text-slate-500'}`}>
          {order.status.replace(/_/g, ' ')}
        </span>
        <span className="text-xs text-slate-400">{new Date(order.created_at).toLocaleDateString()}</span>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-800">{order.item_count} items</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {new Date(order.date_from).toLocaleDateString()} — {new Date(order.date_to).toLocaleDateString()}
          </p>
        </div>
        <div className="text-right">
          {order.dealer_user_id
            ? <p className="text-xs text-green-600">Dealer assigned</p>
            : <p className="text-xs text-amber-600">No dealer yet</p>
          }
        </div>
      </div>
    </button>
  )
}
