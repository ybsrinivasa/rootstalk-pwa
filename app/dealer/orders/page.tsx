'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface Order {
  id: string; status: string; farmer_user_id: string; client_id: string
  facilitator_user_id: string | null; date_from: string; date_to: string
  created_at: string; item_count: number; pending_count: number
}

const STATUS_COLOUR: Record<string, string> = {
  SENT: 'bg-purple-100 text-purple-700',
  ACCEPTED: 'bg-blue-100 text-blue-700',
  PROCESSING: 'bg-sky-100 text-sky-700',
  SENT_FOR_APPROVAL: 'bg-amber-100 text-amber-700',
  PARTIALLY_APPROVED: 'bg-orange-100 text-orange-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-[#7A8C7E]',
}

export default function DealerOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending' | 'done'>('pending')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<Order[]>('/dealer/orders')
      .then(r => setOrders(r.data))
      .finally(() => setLoading(false))
  }, [])

  const pending = orders.filter(o => !['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(o.status))
  const done = orders.filter(o => ['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(o.status))

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Dealer — Orders" activeRole="DEALER" />
      <div className="pt-16 pb-20">
        {/* Shortcuts row */}
        <div className="flex gap-2 px-4 pt-3">
          <button onClick={() => router.push('/dealer/dealerships')}
            className="flex-1 text-xs font-medium text-[#085041] bg-[#085041]/5 rounded-xl py-2">
            🏭 My Dealerships
          </button>
          <button onClick={() => router.push('/dealer/profile')}
            className="flex-1 text-xs font-medium text-[#6B3F1F] bg-slate-100 rounded-xl py-2">
            ⚙ Shop Profile
          </button>
        </div>
        <div className="flex bg-white border-b border-[#DDD0B8] mt-3">
          {(['pending', 'done'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium capitalize border-b-2 transition-colors ${tab === t ? 'border-[#085041] text-[#085041]' : 'border-transparent text-[#7A8C7E]'}`}>
              {t === 'pending' ? `Pending (${pending.length})` : 'Completed'}
            </button>
          ))}
        </div>

        <div className="px-4 mt-4 space-y-3">
          {loading ? (
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
          ) : (tab === 'pending' ? pending : done).length === 0 ? (
            <div className="text-center py-16">
              <span className="text-4xl">📋</span>
              <p className="text-[#7A8C7E] text-sm mt-3">
                {tab === 'pending' ? 'No pending orders' : 'No completed orders'}
              </p>
            </div>
          ) : (
            (tab === 'pending' ? pending : done).map(order => (
              <button key={order.id} onClick={() => router.push(`/dealer/orders/${order.id}`)}
                className="w-full bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left active:scale-98 transition-transform">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[order.status] || 'bg-slate-100 text-[#7A8C7E]'}`}>
                    {order.status.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-[#7A8C7E]">{new Date(order.created_at).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[#6B3F1F]">
                      {order.item_count} item{order.item_count !== 1 ? 's' : ''}
                      {order.pending_count > 0 && (
                        <span className="ml-2 text-xs text-amber-600">({order.pending_count} to process)</span>
                      )}
                    </p>
                    <p className="text-xs text-[#7A8C7E] mt-0.5">
                      {new Date(order.date_from).toLocaleDateString()} — {new Date(order.date_to).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-[#DDD0B8] text-xl">›</span>
                </div>
                {order.status === 'SENT' && (
                  <div className="mt-2 bg-purple-50 rounded-lg px-3 py-1.5">
                    <p className="text-xs text-purple-700 font-medium">New order — tap to process</p>
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
      <BottomNav color="#085041" activeRole="DEALER" />
    </div>
  )
}
