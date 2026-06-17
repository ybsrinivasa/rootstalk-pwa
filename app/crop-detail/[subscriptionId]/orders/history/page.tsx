'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
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
  // 2026-06-09 — REROUTED-only husks (lineage parents that
  // migrated their items away) have rerouted_count > 0 and no
  // live items. Their status is typically PROCESSING /
  // PARTIALLY_APPROVED, not CANCELLED — so the Cancelled tab
  // surfaces them via this field, not via order.status.
  rerouted_count?: number
  awaiting_approval_count?: number
  returned_count?: number
  postponed_count?: number
  pickup_ready_count?: number
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
// 2026-06-09 — A lineage husk is an order with at least one
// REROUTED item AND no live work remaining. Order.status is
// typically still PROCESSING / PARTIALLY_APPROVED, so the status
// check alone misses these. Detect via rerouted_count + zero live
// activity. Folded into the Cancelled tab since these orders are
// terminal from the farmer's perspective.
function isHusk(o: SubOrder): boolean {
  const rerouted = o.rerouted_count ?? 0
  if (rerouted === 0) return false
  const live = (o.awaiting_approval_count ?? 0)
    + (o.returned_count ?? 0)
    + (o.postponed_count ?? 0)
    + (o.pickup_ready_count ?? 0)
  return live === 0
}
function isCancelled(o: SubOrder): boolean {
  return CANCELLED_STATUSES.has(o.status) || isHusk(o)
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
  const t = useTranslations('orders.history')
  const tOrdersCommon = useTranslations('orders.common')
  const locale = useLocale()
  const [orders, setOrders] = useState<SubOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('completed')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // 2026-06-09 — Pass include_husks=true so REROUTED-only
    // lineage husks surface in History (Cancelled tab via
    // isHusk()). Active Manage tab keeps the default filter.
    api.get<{ orders: SubOrder[] }>(`/farmer/subscriptions/${subscriptionId}/orders?include_husks=true`)
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
      <PWAHeader title={t('headerTitle')} activeRole="FARMER"
        back={`/crop-detail/${subscriptionId}/orders?tab=manage`} />
      <div className="pt-16 pb-24">
        <div className="flex bg-white border-b border-[#DDD0B8]">
          {(['completed', 'cancelled'] as const).map(tabKey => (
            <button key={tabKey} onClick={() => setTab(tabKey)}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === tabKey ? 'border-[#3A7D44] text-[#3A7D44]' : 'border-transparent text-[#7A8C7E]'
              }`}>
              {tabKey === 'completed' ? t('tabCompleted') : t('tabCancelled')}
            </button>
          ))}
        </div>

        <div className="px-4 mt-4 space-y-3 max-w-lg mx-auto">
          {loading ? (
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
          ) : visible.length === 0 ? (
            <div className="text-center py-20">
              <span className="text-4xl">📁</span>
              <p className="text-[#7A8C7E] text-sm mt-3">{tab === 'completed' ? t('emptyCompleted') : t('emptyCancelled')}</p>
              {tab === 'cancelled' && (
                <p className="text-[#7A8C7E] text-xs mt-1">
                  {t('cancelledHint')}
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
                        {head?.kind === 'SEED' ? t('kindSeed') : (head?.category?.toLowerCase() || t('kindOrderFallback'))}
                      </span>
                      <span className="text-[10px] text-[#7A8C7E]">
                        {head?.created_at && new Date(head.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono tracking-wide text-[#3A7D44]">
                      {orderId}
                    </p>
                    {head?.kind === 'SEED' ? (
                      <p className="text-sm text-[#6B3F1F] truncate mt-1">{head.variety_name || t('seedFallback')}</p>
                    ) : (
                      head?.date_from && head?.date_to && (
                        <p className="text-sm text-[#6B3F1F] mt-1">
                          {new Date(head.date_from).toLocaleDateString(locale, { day: '2-digit', month: 'short' })} —
                          {' '}{new Date(head.date_to).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
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
                            {sub.recipient_shop_name || sub.recipient_name || t('noRecipient')}
                          </p>
                          <p className="text-[10px] text-[#7A8C7E]">
                            {new Date(sub.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })}
                            {sub.item_count !== undefined && sub.item_count > 0 && (
                              <> · {tOrdersCommon('itemsCount', { count: sub.item_count })}</>
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
