'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

// 2026-06-09 — Per-crop farmer History.
// Holds terminal sub-orders (COMPLETED / PURCHASED on the
// Completed tab; CANCELLED / EXPIRED / REJECTED / REROUTED on the
// Cancelled tab). Order-ID grouped — each terminal sub-order lists
// independently under one shared Order ID header. Informational
// only; no actions here (Forward / Delete live on active surfaces).
// Accessed via the 📁 History chip on the Manage tab.

type SubOrder = {
  kind: 'REGULAR' | 'SEED'
  id: string
  status: string
  reference_number?: string | null
  lineage_root_id?: string
  date_from?: string; date_to?: string
  created_at: string
  item_count?: number
  category?: 'PESTICIDE' | 'FERTILIZER' | null
  variety_name?: string | null
  recipient_name?: string | null
  recipient_shop_name?: string | null
  recipient_role?: 'DEALER' | 'FACILITATOR' | null
}

type Tab = 'completed' | 'cancelled'

// COMPLETED + PURCHASED are the positive terminals (the order
// fulfilled its purpose). Everything else terminal is "cancelled" in
// the farmer's mental model (CANCELLED / EXPIRED / REJECTED /
// REROUTED — REROUTED is a lineage husk that the farmer-facing
// surface naturally lumps with cancellations).
function isCompleted(o: SubOrder): boolean {
  return o.status === 'COMPLETED' || o.status === 'PURCHASED'
}
const CANCELLED_STATUSES = new Set([
  'CANCELLED', 'EXPIRED', 'REJECTED', 'REROUTED',
])
function isCancelled(o: SubOrder): boolean {
  return CANCELLED_STATUSES.has(o.status)
}

const STATUS_COLOUR: Record<string, string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  PURCHASED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-[#7A8C7E]',
  EXPIRED: 'bg-slate-100 text-[#7A8C7E]',
  REJECTED: 'bg-rose-100 text-rose-600',
  REROUTED: 'bg-slate-100 text-[#7A8C7E]',
}

export default function FarmerOrderHistoryPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const router = useRouter()
  const [orders, setOrders] = useState<SubOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('completed')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<{ orders: SubOrder[] }>(`/farmer/subscriptions/${subscriptionId}/orders`)
      .then(r => setOrders(r.data.orders || []))
      .finally(() => setLoading(false))
  }, [subscriptionId, router])

  const visible = useMemo(() => {
    const filtered = orders.filter(tab === 'completed' ? isCompleted : isCancelled)
    // Group by reference_number (Order ID); within each group,
    // sort by created_at ascending so the original root comes first.
    const map = new Map<string, SubOrder[]>()
    for (const o of filtered) {
      const key = o.reference_number || o.lineage_root_id || o.id
      const list = map.get(key)
      if (list) list.push(o)
      else map.set(key, [o])
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    // Sort groups by newest sub-order desc.
    const out = Array.from(map.entries())
    out.sort(([, a], [, b]) => {
      const aT = Math.max(...a.map(o => new Date(o.created_at).getTime()))
      const bT = Math.max(...b.map(o => new Date(o.created_at).getTime()))
      return bT - aT
    })
    return out
  }, [orders, tab])

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="History" activeRole="FARMER"
        back={`/crop-detail/${subscriptionId}/orders?tab=manage`} />
      <div className="pt-16 pb-24">
        <div className="flex bg-white border-b border-[#DDD0B8]">
          {(['completed', 'cancelled'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === t ? 'border-[#3A7D44] text-[#3A7D44]' : 'border-transparent text-[#7A8C7E]'
              }`}>
              {t}
            </button>
          ))}
        </div>

        <div className="px-4 mt-4 space-y-3 max-w-lg mx-auto">
          {loading ? (
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
          ) : visible.length === 0 ? (
            <div className="text-center py-20">
              <span className="text-4xl">📁</span>
              <p className="text-[#7A8C7E] text-sm mt-3">No {tab} sub-orders</p>
              {tab === 'cancelled' && (
                <p className="text-[#7A8C7E] text-xs mt-1">
                  Cancelled or expired orders will appear here.
                </p>
              )}
            </div>
          ) : (
            visible.map(([key, subs]) => {
              const head = subs[0]
              const orderId = head?.reference_number || head?.id || 'unknown'
              return (
                <div key={key}
                  className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
                  <div className="px-4 py-3 bg-[#F5F0E8]/40">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] font-semibold text-[#7A8C7E] uppercase tracking-wider">
                        {head?.kind === 'SEED' ? 'Seed' : (head?.category?.toLowerCase() || 'order')}
                      </span>
                      <span className="text-[10px] text-[#7A8C7E]">
                        {head?.created_at && new Date(head.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono tracking-wide text-[#3A7D44]">
                      {orderId}
                    </p>
                    {head?.kind === 'SEED' ? (
                      <p className="text-sm text-[#6B3F1F] truncate mt-1">{head.variety_name || 'Seed order'}</p>
                    ) : (
                      head?.date_from && head?.date_to && (
                        <p className="text-sm text-[#6B3F1F] mt-1">
                          {new Date(head.date_from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} —
                          {' '}{new Date(head.date_to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </p>
                      )
                    )}
                  </div>
                  <div className="divide-y divide-[#F0E5D0]">
                    {subs.map(sub => (
                      <div key={sub.id}
                        className="px-4 py-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-[#6B3F1F] truncate">
                            {sub.recipient_shop_name || sub.recipient_name || 'No recipient'}
                          </p>
                          <p className="text-[10px] text-[#7A8C7E]">
                            {new Date(sub.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            {sub.item_count !== undefined && sub.item_count > 0 && (
                              <> · {sub.item_count} item{sub.item_count === 1 ? '' : 's'}</>
                            )}
                          </p>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLOUR[sub.status] || 'bg-slate-100 text-[#7A8C7E]'}`}>
                          {sub.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
