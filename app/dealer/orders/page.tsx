'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

// 2026-06-03 — dealer orders feed redesign per user direction:
// - per-card: farmer name + photo, company name, status, received-date
// - top: status filter chips (replaces the two "My Dealerships" /
//   "Shop Profile" shortcuts, which already exist on the home and
//   profile pages and don't belong here)
// - item count deferred (relations make the headline number lie;
//   user will revisit)

interface Order {
  id: string
  status: string
  farmer_user_id: string
  farmer_name: string | null
  farmer_photo_url: string | null
  client_id: string
  client_name: string | null
  category: string | null
  date_from: string
  date_to: string
  created_at: string
}

const STATUS_LABEL: Record<string, string> = {
  SENT: 'New',
  ACCEPTED: 'Accepted',
  PROCESSING: 'Processing',
  SENT_FOR_APPROVAL: 'With farmer',
  PARTIALLY_APPROVED: 'Partial',
  COMPLETED: 'Completed',
}

const STATUS_COLOUR: Record<string, string> = {
  SENT:               'bg-purple-100 text-purple-700 border-purple-200',
  ACCEPTED:           'bg-blue-100 text-blue-700 border-blue-200',
  PROCESSING:         'bg-sky-100 text-sky-700 border-sky-200',
  SENT_FOR_APPROVAL:  'bg-amber-100 text-amber-700 border-amber-200',
  PARTIALLY_APPROVED: 'bg-orange-100 text-orange-700 border-orange-200',
  COMPLETED:          'bg-emerald-100 text-emerald-700 border-emerald-200',
}

const FILTER_ORDER = [
  'SENT', 'ACCEPTED', 'PROCESSING',
  'SENT_FOR_APPROVAL', 'PARTIALLY_APPROVED', 'COMPLETED',
]

function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

export default function DealerOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  // null = "all"; otherwise a specific status to filter to.
  const [filter, setFilter] = useState<string | null>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<Order[]>('/dealer/orders')
      .then(r => setOrders(r.data))
      .finally(() => setLoading(false))
  }, [])

  // Per-status counts for the chip row.
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const o of orders) c[o.status] = (c[o.status] || 0) + 1
    return c
  }, [orders])

  const visible = filter ? orders.filter(o => o.status === filter) : orders
  const visibleStatuses = FILTER_ORDER.filter(s => (counts[s] || 0) > 0)

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Orders" activeRole="DEALER" back="/dealer/home" />
      <div className="pt-16 pb-20">

        {/* Status filter chips. Horizontal scroll on overflow so the
            screen never gets crowded. Each chip carries the count so
            the dealer can scan workload at a glance. */}
        <div className="px-4 pt-3 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            <button onClick={() => setFilter(null)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors ${
                filter === null
                  ? 'bg-[#085041] text-white border-[#085041]'
                  : 'bg-white text-[#6B3F1F] border-[#DDD0B8]'
              }`}>
              All · {orders.length}
            </button>
            {visibleStatuses.map(status => {
              const active = filter === status
              const colour = active
                ? 'bg-[#085041] text-white border-[#085041]'
                : `${STATUS_COLOUR[status] || 'bg-white text-[#6B3F1F] border-[#DDD0B8]'}`
              return (
                <button key={status} onClick={() => setFilter(active ? null : status)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors ${colour}`}>
                  {STATUS_LABEL[status] || status.replace(/_/g, ' ')} · {counts[status]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Order list */}
        <div className="px-4 mt-4 space-y-3">
          {loading ? (
            <div className="h-28 bg-white rounded-2xl animate-pulse" />
          ) : visible.length === 0 ? (
            <div className="text-center py-20">
              <span className="text-5xl">📋</span>
              <p className="text-[#7A8C7E] text-sm mt-3">
                {filter ? `No orders in "${STATUS_LABEL[filter] || filter}"` : 'No orders yet'}
              </p>
              {filter && (
                <button onClick={() => setFilter(null)}
                  className="text-xs text-[#085041] underline mt-2">
                  Show all orders
                </button>
              )}
            </div>
          ) : (
            visible.map(order => (
              <button key={order.id} onClick={() => router.push(`/dealer/orders/${order.id}`)}
                className="w-full bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left active:scale-[0.99] transition-transform">
                <div className="flex items-start gap-3">

                  {/* Farmer photo / initial avatar */}
                  {order.farmer_photo_url ? (
                    <img src={order.farmer_photo_url}
                      alt={order.farmer_name || 'Farmer'}
                      className="w-12 h-12 rounded-full object-cover border border-[#DDD0B8] shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-[#085041]/10 border border-[#DDD0B8] shrink-0 flex items-center justify-center">
                      <span className="text-sm font-bold text-[#085041]">{initials(order.farmer_name)}</span>
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-[#6B3F1F] truncate">
                        {order.farmer_name || 'Unknown farmer'}
                      </p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border whitespace-nowrap shrink-0 ${STATUS_COLOUR[order.status] || 'bg-slate-100 text-[#7A8C7E] border-[#DDD0B8]'}`}>
                        {STATUS_LABEL[order.status] || order.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {order.client_name && (
                      <p className="text-xs text-[#7A8C7E] truncate">{order.client_name}</p>
                    )}
                    <div className="flex items-center justify-between mt-1.5">
                      <p className="text-[11px] text-[#7A8C7E]">
                        {order.category && (
                          <span className="uppercase tracking-wider font-medium text-[10px]">
                            {order.category.toLowerCase()}
                          </span>
                        )}
                        {order.category && ' · '}
                        Received {new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      </p>
                      <span className="text-[#DDD0B8] text-lg">›</span>
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
      <BottomNav color="#085041" activeRole="DEALER" />
    </div>
  )
}
