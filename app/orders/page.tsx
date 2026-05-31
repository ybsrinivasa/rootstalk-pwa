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
  item_count?: number
  is_max_count?: boolean
}
type PurchasedItem = {
  id: string; brand_name: string | null; l1_type: string | null; l2_type: string | null
  given_volume: number | null; volume_unit: string | null; price: number | null
  scan_verified: boolean; order_id: string; created_at: string
  timeline_name?: string | null
  timeline_from_type?: 'DAS' | 'DBS' | 'CALENDAR' | null
  timeline_from_value?: number | null
  timeline_to_value?: number | null
  application_date_from?: string | null
  application_date_to?: string | null
  frequency_days?: number | null
}

const STATUS_COLOUR: Record<string, string> = {
  SENT:               'bg-purple-100 text-purple-700',
  PROCESSING:         'bg-blue-100 text-blue-700',
  SENT_FOR_APPROVAL:  'bg-amber-100 text-amber-700',
  PARTIALLY_APPROVED: 'bg-orange-100 text-orange-700',
  COMPLETED:          'bg-emerald-100 text-emerald-700',
  CANCELLED:          'bg-stone-100 text-[#7A8C7E]',
}

export default function OrdersPage() {
  const router = useRouter()
  const [tab, setTab] = useState<'active' | 'history' | 'purchased'>('active')
  const [orders, setOrders] = useState<Order[]>([])
  const [purchased, setPurchased] = useState<PurchasedItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    Promise.allSettled([
      api.get<Order[]>('/farmer/orders'),
      api.get<PurchasedItem[]>('/farmer/purchased-items').catch(() => ({ data: [] as PurchasedItem[] })),
    ]).then(([ordersRes, purchasedRes]) => {
      if (ordersRes.status === 'fulfilled') setOrders(ordersRes.value.data)
      if (purchasedRes.status === 'fulfilled') setPurchased((purchasedRes.value as { data: PurchasedItem[] }).data)
    }).finally(() => setLoading(false))
  }, [router])

  const active    = orders.filter(o => !['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(o.status))
  const history   = orders.filter(o => ['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(o.status))

  const TABS = [
    { key: 'active',    label: `Active${active.length ? ` (${active.length})` : ''}` },
    { key: 'history',   label: 'History' },
    { key: 'purchased', label: 'Purchased' },
  ] as const

  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      <PWAHeader title="Orders" activeRole="FARMER" back="/home" />
      <div className="pt-16 pb-20">
        {/* Three tabs */}
        <div className="flex bg-white border-b border-[#DDD0B8] sticky top-16 z-30">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${
                tab === t.key ? 'border-[#3A7D44] text-[#3A7D44]' : 'border-transparent text-[#7A8C7E]'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Batch 14 — quick entry to the farmer-side seed-orders
            surface. Seeds aren't part of the pesticide/fertiliser
            list, but the farmer's mental model is "all my orders
            live here" so we surface the link at the top of /orders. */}
        <button onClick={() => router.push('/seed-orders')}
          className="mx-4 mt-4 w-[calc(100%-2rem)] bg-white border border-[#DDD0B8] rounded-2xl px-4 py-3 flex items-center justify-between text-left shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🌱</span>
            <p className="font-semibold text-[#6B3F1F] text-sm">Seed orders</p>
          </div>
          <span className="text-[#7A8C7E]">→</span>
        </button>

        <div className="px-4 mt-4 space-y-3">
          {loading ? (
            <div className="h-20 bg-white rounded-2xl animate-pulse" />
          ) : tab === 'purchased' ? (
            purchased.length === 0 ? (
              <div className="text-center py-16">
                <svg className="w-12 h-12 text-[#DDD0B8] mx-auto" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                </svg>
                <p className="text-[#7A8C7E] text-sm mt-3">No purchased inputs yet</p>
              </div>
            ) : (
              purchased.map(item => {
                const dFrom = item.application_date_from ? new Date(item.application_date_from) : null
                const dTo = item.application_date_to ? new Date(item.application_date_to) : null
                const today = new Date(); today.setHours(0, 0, 0, 0)
                let badge: { label: string; cls: string } | null = null
                if (dFrom && dTo) {
                  if (dFrom > today) badge = { label: 'Apply later', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
                  else if (dTo < today) badge = { label: 'Window passed', cls: 'bg-stone-100 text-[#7A8C7E] border-[#DDD0B8]' }
                  else badge = { label: 'Apply now', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
                }
                const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                const isPreSowing = item.timeline_from_type === 'DBS'
                const applyText = (dFrom && dTo)
                  ? `Apply: ${isPreSowing ? '(Pre-sowing) ' : ''}${fmt(dFrom)} – ${fmt(dTo)}`
                  : 'Apply: Set crop start date to see'
                return (
                  <div key={item.id} className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[#6B3F1F] text-sm">{item.brand_name || item.l2_type || item.l1_type || 'Item'}</p>
                        {item.l1_type && <p className="text-xs text-[#7A8C7E] mt-0.5">{item.l1_type}{item.l2_type ? ` · ${item.l2_type}` : ''}</p>}
                        {item.given_volume && (
                          <p className="text-xs text-[#7A8C7E] mt-1">
                            {item.given_volume} {item.volume_unit}
                            {item.price ? ` · ₹${item.price}` : ''}
                          </p>
                        )}
                        <p className="text-xs text-[#7A8C7E] mt-1">{applyText}</p>
                        {item.frequency_days != null && item.frequency_days > 0 && (
                          <p className="text-xs text-amber-700 mt-1">
                            ↻ {item.frequency_days === 1 ? 'Every day' : `Every ${item.frequency_days} days`} until window ends
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {item.scan_verified && (
                          <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">✓ Verified</span>
                        )}
                        {badge && (
                          <span className={`text-[10px] border px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-[#DDD0B8] mt-2">{new Date(item.created_at).toLocaleDateString('en-IN')}</p>
                  </div>
                )
              })
            )
          ) : (
            (tab === 'active' ? active : history).length === 0 ? (
              <div className="text-center py-16">
                <svg className="w-12 h-12 text-[#DDD0B8] mx-auto" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                </svg>
                <p className="text-[#7A8C7E] text-sm mt-3">{tab === 'active' ? 'No active orders' : 'No order history yet'}</p>
              </div>
            ) : (
              (tab === 'active' ? active : history).map(order => (
                <button key={order.id} onClick={() => router.push(`/orders/${order.id}`)}
                  className="w-full bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left active:scale-[0.98] transition-transform">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[order.status] || 'bg-stone-100 text-[#7A8C7E]'}`}>
                      {order.status.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-[#7A8C7E]">{new Date(order.created_at).toLocaleDateString('en-IN')}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-[#6B3F1F]">
                      {new Date(order.date_from).toLocaleDateString('en-IN')} — {new Date(order.date_to).toLocaleDateString('en-IN')}
                    </p>
                    {order.item_count !== undefined && order.item_count > 0 && (
                      <span className="text-xs text-[#7A8C7E] shrink-0">
                        {order.is_max_count ? 'Max ' : ''}{order.item_count} item{order.item_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {order.status === 'SENT_FOR_APPROVAL' && (
                    <div className="mt-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                      <p className="text-xs text-amber-700 font-medium">Action needed — tap to review and approve</p>
                    </div>
                  )}
                </button>
              ))
            )
          )}
        </div>
      </div>
      <BottomNav color="#3A7D44" />
    </div>
  )
}
