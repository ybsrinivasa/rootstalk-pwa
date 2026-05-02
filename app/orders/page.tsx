'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

type Order = {
  id: string; status: string; date_from: string
  date_to: string; dealer_user_id: string | null; created_at: string
}

const STATUS_COLOUR: Record<string, string> = {
  SENT: 'bg-purple-100 text-purple-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  SENT_FOR_APPROVAL: 'bg-amber-100 text-amber-700',
  PARTIALLY_APPROVED: 'bg-orange-100 text-orange-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
}

export default function OrdersPage() {
  const router = useRouter()
  const [tab, setTab] = useState<'active' | 'purchased'>('active')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [router])

  async function load() {
    try {
      const { data } = await api.get<Order[]>('/farmer/orders')
      setOrders(data)
    } finally { setLoading(false) }
  }

  const active = orders.filter(o => !['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(o.status))
  const completed = orders.filter(o => ['COMPLETED', 'CANCELLED'].includes(o.status))

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Orders" activeRole="FARMER" />
      <div className="pt-16 pb-20">
        {/* Tabs */}
        <div className="flex bg-white border-b border-slate-100">
          {(['active', 'purchased'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium capitalize transition-colors border-b-2 ${tab === t ? 'border-green-600 text-green-700' : 'border-transparent text-slate-400'}`}>
              {t === 'active' ? `Active (${active.length})` : 'History'}
            </button>
          ))}
        </div>

        <div className="px-4 mt-4 space-y-3">
          {loading
            ? <div className="h-20 bg-white rounded-2xl animate-pulse" />
            : (tab === 'active' ? active : completed).length === 0
              ? (
                <div className="text-center py-16">
                  <span className="text-4xl">📦</span>
                  <p className="text-slate-400 text-sm mt-3">{tab === 'active' ? 'No active orders' : 'No order history'}</p>
                </div>
              )
              : (tab === 'active' ? active : completed).map(order => (
                <button key={order.id}
                  onClick={() => router.push(`/orders/${order.id}`)}
                  className="w-full bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-left active:scale-98 transition-transform">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[order.status] || 'bg-slate-100 text-slate-500'}`}>
                      {order.status.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-slate-400">{new Date(order.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-600">
                      {new Date(order.date_from).toLocaleDateString()} — {new Date(order.date_to).toLocaleDateString()}
                    </p>
                    <span className="text-slate-300 text-xl">›</span>
                  </div>
                  {order.status === 'SENT_FOR_APPROVAL' && (
                    <div className="mt-2 bg-amber-50 rounded-lg px-3 py-2">
                      <p className="text-xs text-amber-700 font-medium">⚡ Tap to review and approve</p>
                    </div>
                  )}
                </button>
              ))

          }
        </div>
      </div>
      <BottomNav color="#1A5C2A" />
    </div>
  )
}
