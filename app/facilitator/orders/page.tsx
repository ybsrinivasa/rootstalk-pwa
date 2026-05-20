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

const COLOUR = '#7D4E00'

const STATUS_COLOUR: Record<string, string> = {
  SENT: 'bg-purple-100 text-purple-700',
  ACCEPTED: 'bg-sky-100 text-sky-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  SENT_FOR_APPROVAL: 'bg-amber-100 text-amber-700',
  PARTIALLY_APPROVED: 'bg-orange-100 text-orange-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-[#7A8C7E]',
}

export default function FacilitatorOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [tab, setTab] = useState<'pending' | 'done'>('pending')

  const load = () =>
    api.get<Order[]>('/facilitator/orders')
      .then(r => setOrders(r.data))
      .finally(() => setLoading(false))

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [])

  async function accept(id: string) {
    setActing(id)
    try {
      await api.put(`/facilitator/orders/${id}/accept`, {})
      router.push(`/facilitator/orders/${id}`)
    } finally { setActing(null) }
  }

  async function reject(id: string) {
    if (!confirm('Reject this order? It will be returned to the farmer.')) return
    setActing(id)
    try {
      await api.put(`/facilitator/orders/${id}/reject`, { reason: 'Unable to process' })
      load()
    } finally { setActing(null) }
  }

  const pending = orders.filter(o => !['COMPLETED', 'CANCELLED'].includes(o.status))
  const done = orders.filter(o => ['COMPLETED', 'CANCELLED'].includes(o.status))

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Acting as Facilitator" activeRole="FACILITATOR" />
      <div className="pt-16 pb-20">
        <div className="flex bg-white border-b border-[#DDD0B8]">
          {(['pending', 'done'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t
                ? 'border-[#7D4E00] text-[#7D4E00]' : 'border-transparent text-[#7A8C7E]'}`}>
              {t === 'pending' ? `Active (${pending.length})` : 'Done'}
            </button>
          ))}
        </div>

        <div className="px-4 mt-4 space-y-3 max-w-lg mx-auto">
          {loading ? (
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
          ) : (tab === 'pending' ? pending : done).length === 0 ? (
            <div className="text-center py-20">
              <span className="text-4xl">🌾</span>
              <p className="text-[#7A8C7E] text-sm mt-3">No orders here</p>
            </div>
          ) : (
            (tab === 'pending' ? pending : done).map(order => (
              <div key={order.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
                <button onClick={() => router.push(`/facilitator/orders/${order.id}`)}
                  className="w-full p-4 text-left">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[order.status] || 'bg-slate-100 text-[#7A8C7E]'}`}>
                      {order.status.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-[#7A8C7E]">{new Date(order.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[#6B3F1F]">{order.item_count} items</p>
                      <p className="text-xs text-[#7A8C7E] mt-0.5">
                        {new Date(order.date_from).toLocaleDateString()} — {new Date(order.date_to).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      {order.dealer_user_id
                        ? <p className="text-xs text-green-600 font-medium">Dealer assigned ✓</p>
                        : <p className="text-xs text-amber-600">Awaiting dealer</p>
                      }
                    </div>
                  </div>
                </button>

                {/* New order — accept/reject inline */}
                {order.status === 'SENT' && (
                  <div className="flex gap-2 px-4 pb-4">
                    <button onClick={() => accept(order.id)} disabled={acting === order.id}
                      className="flex-1 py-2.5 rounded-xl text-white text-xs font-semibold disabled:opacity-50"
                      style={{ background: COLOUR }}>
                      {acting === order.id ? 'Processing…' : '✓ Accept & Forward'}
                    </button>
                    <button onClick={() => reject(order.id)} disabled={acting === order.id}
                      className="flex-1 py-2.5 rounded-xl border border-[#DDD0B8] text-[#D4682E] text-xs font-semibold disabled:opacity-50">
                      ✗ Reject
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="FACILITATOR" />
    </div>
  )
}
