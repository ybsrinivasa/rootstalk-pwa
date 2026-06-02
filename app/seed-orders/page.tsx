'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

// Orders V2 Batch 14 — farmer-side seed orders list. Mirrors the
// pesticide/fertiliser /orders surface so the farmer's mental model
// stays consistent across the three categories.

interface SeedOrder {
  id: string
  status: string
  variety_name?: string | null
  crop_cosh_id?: string | null
  unit: string | null
  quantity: number | null
  total_price: number | null
  created_at: string
  dealer_user_id?: string | null
  facilitator_user_id?: string | null
  // 2026-06-02 — recipient (dealer / facilitator) name + shop +
  // phone so the farmer can track who's holding the seed order.
  recipient_name?: string | null
  recipient_phone?: string | null
  recipient_shop_name?: string | null
  recipient_role?: 'DEALER' | 'FACILITATOR' | null
  // Phase 1 of the Orders restructure (2026-06-02) — package-anchor
  // metadata so the seed card reads consistently with /orders.
  subscription_id?: string | null
  package_name?: string | null
  crop_name?: string | null
  company_name?: string | null
  crop_start_date?: string | null
  planting_year?: number | null
}

const STATUS_COLOUR: Record<string, string> = {
  DRAFT:             'bg-stone-100 text-[#7A8C7E]',
  SENT:              'bg-purple-100 text-purple-700',
  ACCEPTED:          'bg-blue-100 text-blue-700',
  AVAILABLE:         'bg-blue-100 text-blue-700',
  POSTPONED:         'bg-amber-100 text-amber-800',
  NOT_AVAILABLE:     'bg-red-100 text-[#D4682E]',
  SENT_FOR_APPROVAL: 'bg-amber-100 text-amber-700',
  PURCHASED:         'bg-emerald-100 text-emerald-700',
  REJECTED:          'bg-rose-100 text-rose-600',
  CANCELLED:         'bg-stone-100 text-[#7A8C7E]',
  REROUTED:          'bg-stone-100 text-[#7A8C7E]',
}

const STATUS_FARMER: Record<string, string> = {
  DRAFT: 'Draft — pick a recipient',
  SENT: 'Sent — waiting for dealer',
  ACCEPTED: 'Dealer processing',
  AVAILABLE: 'Dealer processing',
  POSTPONED: 'Delayed',
  NOT_AVAILABLE: 'Returned — action needed',
  SENT_FOR_APPROVAL: 'Ready for your approval',
  PURCHASED: 'Purchased',
  REJECTED: 'Rejected by you',
  CANCELLED: 'Cancelled',
  REROUTED: 'Re-routed',
}

export default function FarmerSeedOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<SeedOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'active' | 'history'>('active')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<SeedOrder[]>('/farmer/seed-orders')
      .then(r => setOrders(r.data))
      .finally(() => setLoading(false))
  }, [router])

  const active = orders.filter(o =>
    !['PURCHASED', 'CANCELLED', 'REJECTED', 'REROUTED'].includes(o.status),
  )
  const history = orders.filter(o =>
    ['PURCHASED', 'CANCELLED', 'REJECTED', 'REROUTED'].includes(o.status),
  )
  const list = tab === 'active' ? active : history

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Seed Orders" activeRole="FARMER" back="/orders" />
      <div className="pt-16 pb-24">
        <div className="flex bg-white border-b border-[#DDD0B8]">
          {(['active', 'history'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-green-700 text-green-800' : 'border-transparent text-[#7A8C7E]'}`}>
              {t === 'active' ? `Active${active.length ? ` (${active.length})` : ''}` : 'History'}
            </button>
          ))}
        </div>

        <div className="px-4 mt-4 space-y-3 max-w-lg mx-auto">
          {loading ? (
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
          ) : list.length === 0 ? (
            <div className="text-center py-16">
              <span className="text-4xl">🌱</span>
              <p className="text-[#7A8C7E] text-sm mt-3">
                {tab === 'active' ? 'No active seed orders' : 'No seed-order history yet'}
              </p>
            </div>
          ) : (
            list.map(order => (
              <button key={order.id}
                onClick={() => router.push(`/seed-orders/${order.id}`)}
                className="w-full text-left bg-white rounded-2xl border border-[#DDD0B8] shadow-sm p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#6B3F1F] truncate">{order.variety_name || 'Unknown variety'}</p>
                    {/* Phase 1 (2026-06-02) — crop name comes from the
                        package via backend (preferred over the in-PWA
                        cropDisplayName lookup which can fall behind). */}
                    <p className="text-xs text-[#7A8C7E]">
                      {order.crop_name || cropDisplayName(order.crop_cosh_id ?? null)}
                      {order.company_name && <span> · {order.company_name}</span>}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLOUR[order.status] || 'bg-slate-100'}`}>
                    {STATUS_FARMER[order.status] || order.status.replace(/_/g, ' ')}
                  </span>
                </div>
                {(order.crop_start_date || order.planting_year) && (
                  <p className="text-[11px] text-[#7A8C7E]">
                    {order.crop_start_date
                      ? `Sown ${new Date(order.crop_start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                      : `Planted ${order.planting_year}`}
                  </p>
                )}
                {order.unit && order.quantity != null && (
                  <p className="text-xs text-[#7A8C7E]">
                    {order.quantity} {order.unit}
                    {order.total_price != null && order.status === 'PURCHASED' ? ` · ₹${order.total_price}` : ''}
                  </p>
                )}
                <SeedRecipientLine
                  name={order.recipient_name}
                  shopName={order.recipient_shop_name}
                  phone={order.recipient_phone}
                  role={order.recipient_role}
                />
              </button>
            ))
          )}
        </div>
      </div>
      <BottomNav activeRole="FARMER" />
    </div>
  )
}


function SeedRecipientLine({
  name, shopName, phone, role,
}: {
  name?: string | null
  shopName?: string | null
  phone?: string | null
  role?: 'DEALER' | 'FACILITATOR' | null
}) {
  if (!name && !shopName && !phone) return null
  const primary = role === 'DEALER' ? (shopName || name) : (name || shopName)
  const secondary = role === 'DEALER'
    ? (name && shopName && name !== shopName ? `${name} (Dealer)` : 'Dealer')
    : 'Facilitator'
  return (
    <div className="mt-2 pt-2 border-t border-[#F0E5D0] flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#6B3F1F] truncate">{primary || secondary}</p>
        {primary && (
          <p className="text-[10px] text-[#7A8C7E] truncate">{secondary}</p>
        )}
      </div>
      {phone && (
        <a href={`tel:${phone}`}
          onClick={e => e.stopPropagation()}
          className="text-[11px] font-semibold text-[#3A7D44] px-2 py-1 rounded-lg bg-emerald-50 shrink-0">
          📞 {phone}
        </a>
      )}
    </div>
  )
}
