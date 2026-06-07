'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

// 2026-06-07 — Facilitator History.
// Holds Completed + Cancelled sub-orders, Order-ID grouped. Each
// sub-order lists independently with the same Order ID surfaced so
// the facilitator can mentally group them. Informational only — no
// actions. Accessed via the header chip on /facilitator/orders.

interface Order {
  id: string
  status: string
  reference_number: string | null
  farmer_name?: string | null
  farmer_photo_url?: string | null
  dealer_shop_name?: string | null
  dealer_name?: string | null
  crop_name?: string | null
  date_from: string
  date_to: string
  created_at: string
  item_count: number
}

const COLOUR = '#7D4E00'

type Tab = 'completed' | 'cancelled'

function isCompleted(o: Order): boolean {
  return o.status === 'COMPLETED'
}
function isCancelled(o: Order): boolean {
  return o.status === 'CANCELLED'
}

function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

export default function FacilitatorHistoryPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('completed')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // 2026-06-07 — Pass include_husks=true so the audit deep-dive
    // surfaces every terminal sub-order in the lineage, not just the
    // live leaf. History is the right surface for husks.
    api.get<Order[]>('/facilitator/orders?include_husks=true')
      .then(r => setOrders(r.data))
      .finally(() => setLoading(false))
  }, [router])

  const visible = useMemo(() => {
    const filtered = orders.filter(tab === 'completed' ? isCompleted : isCancelled)
    // Group by reference_number; within group, sort by created_at asc.
    const map = new Map<string, Order[]>()
    for (const o of filtered) {
      const key = o.reference_number || `legacy:${o.id}`
      const list = map.get(key)
      if (list) list.push(o)
      else map.set(key, [o])
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    // Sort groups by their newest sub-order desc.
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
      <PWAHeader title="History" activeRole="FACILITATOR" back="/facilitator/orders" />
      <div className="pt-16 pb-20">
        <div className="flex bg-white border-b border-[#DDD0B8]">
          {(['completed', 'cancelled'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === t ? 'border-[#7D4E00] text-[#7D4E00]' : 'border-transparent text-[#7A8C7E]'
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
            </div>
          ) : (
            visible.map(([key, subs]) => {
              const head = subs[0]
              const orderId = head?.reference_number || head?.id || 'unknown'
              return (
                <div key={key}
                  className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
                  <div className="px-4 py-3 bg-[#F5F0E8]/40">
                    <div className="flex items-start gap-3">
                      {head?.farmer_photo_url ? (
                        <img src={head.farmer_photo_url} alt={head?.farmer_name || 'Farmer'}
                          className="w-10 h-10 rounded-full object-cover border border-[#DDD0B8] shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-[#7D4E00]/10 border border-[#DDD0B8] shrink-0 flex items-center justify-center">
                          <span className="text-xs font-bold text-[#7D4E00]">{initials(head?.farmer_name)}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[#6B3F1F] truncate">
                          {head?.farmer_name || 'Unknown farmer'}
                        </p>
                        {head?.crop_name && (
                          <p className="text-xs text-[#7A8C7E] truncate">{head.crop_name}</p>
                        )}
                        <p className="text-[10px] font-mono tracking-wide text-[#7D4E00] mt-0.5">
                          {orderId}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="divide-y divide-[#F0E5D0]">
                    {subs.map(sub => (
                      <div key={sub.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-[#6B3F1F] truncate">
                            {sub.dealer_shop_name || sub.dealer_name || 'No dealer'}
                          </p>
                          <p className="text-[10px] text-[#7A8C7E]">
                            {new Date(sub.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            {' · '}
                            {sub.item_count} item{sub.item_count === 1 ? '' : 's'}
                          </p>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${
                          tab === 'completed'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-[#7A8C7E]'
                        }`}>
                          {tab === 'completed' ? 'Completed' : 'Cancelled'}
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
      <BottomNav color={COLOUR} activeRole="FACILITATOR" />
    </div>
  )
}
