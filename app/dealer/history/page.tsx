'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

// 2026-06-09 — Dealer History.
// Terminal sub-orders for the dealer: Completed (sold + delivered)
// and Cancelled (cancelled / expired / declined / migrated husk).
// Order-ID grouped — each terminal sub-order lists independently
// under one shared Order ID header. Informational only — actions
// live on the active /dealer/orders surface. Mirrors
// /facilitator/history + /crop-detail/[id]/orders/history.

interface ItemStatusCounts {
  pending: number
  available: number
  postponed: number
  not_available: number
  sent_for_approval: number
  approved: number
  rejected: number
}

interface DealerOrder {
  id: string
  status: string
  reference_number: string | null
  farmer_user_id: string
  farmer_name: string | null
  farmer_photo_url: string | null
  client_id: string
  client_name: string | null
  category: string | null
  date_from: string
  date_to: string
  created_at: string
  item_status_counts: ItemStatusCounts
  packing_list_removed_at: string | null
  packing_farmer_received_at: string | null
  is_seed?: boolean
  variety_name?: string | null
}

interface SeedOrderRaw {
  id: string
  status: string
  category: string | null
  variety_name: string | null
  farmer_user_id: string
  farmer_name: string | null
  farmer_photo_url: string | null
  client_id: string
  client_name: string | null
  created_at: string
}

type Tab = 'completed' | 'cancelled'

// Dealer's mental "completed" mirrors the previous Completed-pill
// rule: every item has reached a terminal decision AND the dealer's
// hand-off has wrapped (no approved items OR removed packing OR
// farmer received). PURCHASED on seeds is the seed-side analogue.
function isCompleted(o: DealerOrder): boolean {
  if (o.is_seed) return o.status === 'PURCHASED'
  const c = o.item_status_counts
  return (
    c.pending === 0 && c.available === 0 && c.postponed === 0 &&
    c.sent_for_approval === 0 &&
    (c.approved === 0 || !!o.packing_list_removed_at || !!o.packing_farmer_received_at)
  ) && (
    // Also require at least one item to have closed somehow —
    // otherwise an empty-shell COMPLETED row would surface here.
    c.approved > 0 || c.not_available > 0 || c.rejected > 0 ||
    o.status === 'COMPLETED'
  )
}

const CANCELLED_STATUSES = new Set([
  'CANCELLED', 'EXPIRED', 'REJECTED', 'REROUTED',
])
function isCancelled(o: DealerOrder): boolean {
  return CANCELLED_STATUSES.has(o.status)
}

const STATUS_COLOUR: Record<string, string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  PARTIALLY_APPROVED: 'bg-emerald-100 text-emerald-700',
  PURCHASED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-[#7A8C7E]',
  EXPIRED: 'bg-slate-100 text-[#7A8C7E]',
  REJECTED: 'bg-rose-100 text-rose-600',
  REROUTED: 'bg-slate-100 text-[#7A8C7E]',
}

function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

function adaptSeedOrder(s: SeedOrderRaw): DealerOrder {
  return {
    id: s.id,
    status: s.status,
    reference_number: null,
    farmer_user_id: s.farmer_user_id,
    farmer_name: s.farmer_name,
    farmer_photo_url: s.farmer_photo_url,
    client_id: s.client_id,
    client_name: s.client_name,
    category: s.category || 'SEED',
    date_from: s.created_at,
    date_to: s.created_at,
    created_at: s.created_at,
    item_status_counts: {
      pending: 0, available: 0, postponed: 0, not_available: 0,
      sent_for_approval: 0, approved: 0, rejected: 0,
    },
    packing_list_removed_at: null,
    packing_farmer_received_at: null,
    is_seed: true,
    variety_name: s.variety_name,
  }
}

export default function DealerHistoryPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<DealerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('completed')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // 2026-06-09 — Pass include_husks=true so the audit deep-dive
    // surfaces CANCELLED / EXPIRED orders AND REROUTED-only husks
    // (lineage parents that migrated their items away). The active
    // /dealer/orders feed filters both by default.
    Promise.all([
      api.get<DealerOrder[]>('/dealer/orders?include_husks=true').catch(() => ({ data: [] as DealerOrder[] })),
      api.get<SeedOrderRaw[]>('/dealer/seed-orders').catch(() => ({ data: [] as SeedOrderRaw[] })),
    ]).then(([regular, seeds]) => {
      setOrders([
        ...regular.data,
        ...seeds.data.map(adaptSeedOrder),
      ])
    }).finally(() => setLoading(false))
  }, [router])

  const visible = useMemo(() => {
    const filtered = orders.filter(tab === 'completed' ? isCompleted : isCancelled)
    const map = new Map<string, DealerOrder[]>()
    for (const o of filtered) {
      const key = o.reference_number || `legacy:${o.id}`
      const list = map.get(key)
      if (list) list.push(o)
      else map.set(key, [o])
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
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
      <PWAHeader title="History" activeRole="DEALER" back="/dealer/orders" />
      <div className="pt-16 pb-20">
        <div className="flex bg-white border-b border-[#DDD0B8]">
          {(['completed', 'cancelled'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === t ? 'border-[#085041] text-[#085041]' : 'border-transparent text-[#7A8C7E]'
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
                  Cancelled, expired, or migrated husks will appear here.
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
                    <div className="flex items-start gap-3">
                      {head?.farmer_photo_url ? (
                        <img src={head.farmer_photo_url} alt={head?.farmer_name || 'Farmer'}
                          className="w-10 h-10 rounded-full object-cover border border-[#DDD0B8] shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-[#085041]/10 border border-[#DDD0B8] shrink-0 flex items-center justify-center">
                          <span className="text-xs font-bold text-[#085041]">{initials(head?.farmer_name)}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[#6B3F1F] truncate">
                          {head?.farmer_name || 'Unknown farmer'}
                        </p>
                        {head?.client_name && (
                          <p className="text-xs text-[#7A8C7E] truncate">{head.client_name}</p>
                        )}
                        <p className="text-[10px] font-mono tracking-wide text-[#085041] mt-0.5">
                          {orderId}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="divide-y divide-[#F0E5D0]">
                    {subs.map(sub => (
                      <div key={sub.id}
                        className="px-4 py-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] text-[#6B3F1F] truncate">
                            {sub.is_seed
                              ? (sub.variety_name || 'Seed order')
                              : (sub.category?.toLowerCase() || 'order')}
                            {' · '}
                            {new Date(sub.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </p>
                          {tab === 'completed' && !sub.is_seed && (
                            <p className="text-[10px] text-[#7A8C7E]">
                              {sub.item_status_counts.approved} sold
                              {sub.item_status_counts.not_available > 0 && `, ${sub.item_status_counts.not_available} unavailable`}
                            </p>
                          )}
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
      <BottomNav color="#085041" activeRole="DEALER" />
    </div>
  )
}
