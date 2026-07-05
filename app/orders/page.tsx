'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import QRScannerModal from '@/components/QRScannerModal'
import api from '@/lib/api'

// 2026-06-20 — Re-scoped as the farmer's cross-crop retrospective
// surface. Two tabs:
//   - Orders:   every terminal-state order (history)
//   - Received: every input item the farmer has confirmed receipt of
//
// Active orders + their per-crop Manage tab still live on each Crop
// dashboard — duplicating those here was confusing (mixed-crop list
// without context), so they were removed. The retrospective views
// have no other home and are genuinely useful, so they stay.

type Order = {
  id: string; status: string; date_from: string
  date_to: string; created_at: string
  item_count?: number
  category?: 'PESTICIDE' | 'FERTILIZER' | null
  recipient_name?: string | null
  recipient_phone?: string | null
  recipient_shop_name?: string | null
  recipient_role?: 'DEALER' | 'FACILITATOR' | null
  subscription_id?: string | null
  crop_name?: string | null
  company_name?: string | null
  crop_start_date?: string | null
  planting_year?: number | null
}

type PurchasedItem = {
  id: string; brand_name: string | null; l1_type: string | null; l2_type: string | null
  given_volume: number | null; volume_unit: string | null; price: number | null
  scan_verified: boolean; order_id: string; created_at: string
  timeline_from_type?: 'DAS' | 'DBS' | 'CALENDAR' | null
  application_date_from?: string | null
  application_date_to?: string | null
  frequency_days?: number | null
  recipient_name?: string | null
  recipient_shop_name?: string | null
  recipient_phone?: string | null
  recipient_role?: 'DEALER' | 'FACILITATOR' | null
}

const HISTORY_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'REROUTED'])

const STATUS_COLOUR: Record<string, string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-stone-100 text-[#7A8C7E]',
  EXPIRED:   'bg-stone-100 text-[#7A8C7E]',
  REJECTED:  'bg-rose-100 text-rose-700',
  REROUTED:  'bg-stone-100 text-[#7A8C7E]',
}

export default function OrderHistoryPage() {
  const router = useRouter()
  const locale = useLocale()
  const tQr = useTranslations('qrScan')
  const [tab, setTab] = useState<'orders' | 'received'>('orders')
  const [orders, setOrders] = useState<Order[]>([])
  const [purchased, setPurchased] = useState<PurchasedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [scanTarget, setScanTarget] = useState<string | null>(null)

  const refreshPurchased = () => {
    api.get<PurchasedItem[]>('/farmer/purchased-items')
      .then(res => setPurchased(res.data))
      .catch(() => { /* silent — parent list keeps showing what it had */ })
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    Promise.allSettled([
      api.get<Order[]>('/farmer/orders?include_husks=true'),
      api.get<PurchasedItem[]>('/farmer/purchased-items'),
    ]).then(([ordersRes, purchasedRes]) => {
      if (ordersRes.status === 'fulfilled') setOrders(ordersRes.value.data)
      if (purchasedRes.status === 'fulfilled') setPurchased(purchasedRes.value.data)
    }).finally(() => setLoading(false))
  }, [router])

  const history = orders.filter(o => HISTORY_STATUSES.has(o.status))

  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      <PWAHeader title="Order History" activeRole="FARMER" back="/home" />
      <div className="pt-16 pb-20">
        {/* Two-tab retrospective view. Hint copy clarifies that
            active work lives on the per-crop Manage tab. */}
        <div className="flex bg-white border-b border-[#DDD0B8]">
          {(['orders', 'received'] as const).map(k => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${
                tab === k ? 'border-[#3A7D44] text-[#3A7D44]' : 'border-transparent text-[#7A8C7E]'
              }`}>
              {k === 'orders' ? 'Orders' : 'Received items'}
            </button>
          ))}
        </div>
        <p className="text-xs text-[#7A8C7E] mt-3 mb-3 leading-relaxed px-4">
          {tab === 'orders'
            ? "Every order you've placed across all your crops, newest first. Active orders live on each crop's Manage tab."
            : "Every input you've confirmed receipt of, across all your crops. The per-crop Received tab shows the same items scoped to one crop."}
        </p>

        <div className="px-4">
          {loading ? (
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
          ) : tab === 'orders' ? (
            history.length === 0 ? (
              <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center mt-2">
                <p className="text-4xl mb-2">📦</p>
                <p className="text-sm font-semibold text-[#6B3F1F] mb-1">No order history yet</p>
                <p className="text-xs text-[#7A8C7E]">Completed or cancelled orders will appear here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map(order => (
                  <button key={order.id}
                    onClick={() => router.push(`/orders/${order.id}`)}
                    className="w-full bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm text-left active:scale-[0.98] transition-transform">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[order.status] || 'bg-stone-100 text-[#7A8C7E]'}`}>
                        {order.status.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-[#7A8C7E]">{new Date(order.created_at).toLocaleDateString(locale)}</span>
                    </div>
                    {(order.crop_name || order.company_name) && (
                      <div className="mb-2">
                        <p className="text-sm font-semibold text-[#6B3F1F]">
                          {order.crop_name || '—'}
                          {order.company_name && (
                            <span className="text-xs text-[#7A8C7E] font-normal"> · {order.company_name}</span>
                          )}
                        </p>
                        {(order.crop_start_date || order.planting_year) && (
                          <p className="text-[11px] text-[#7A8C7E] mt-0.5">
                            {order.crop_start_date
                              ? `Sown ${new Date(order.crop_start_date).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })}`
                              : `Planted ${order.planting_year}`}
                            {order.category && ` · ${order.category.toLowerCase()}`}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-[#6B3F1F]">
                        {new Date(order.date_from).toLocaleDateString(locale)} — {new Date(order.date_to).toLocaleDateString(locale)}
                      </p>
                      {order.item_count !== undefined && order.item_count > 0 && (
                        <span className="text-xs text-[#7A8C7E] shrink-0">
                          {order.item_count} item{order.item_count !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <RecipientLineFlat
                      name={order.recipient_name}
                      shopName={order.recipient_shop_name}
                      phone={order.recipient_phone}
                      role={order.recipient_role}
                    />
                  </button>
                ))}
              </div>
            )
          ) : (
            purchased.length === 0 ? (
              <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center mt-2">
                <p className="text-4xl mb-2">🧺</p>
                <p className="text-sm font-semibold text-[#6B3F1F] mb-1">No items received yet</p>
                <p className="text-xs text-[#7A8C7E]">Once a dealer hands over inputs and you confirm receipt, they&apos;ll appear here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {purchased.map(item => {
                  const dFrom = item.application_date_from ? new Date(item.application_date_from) : null
                  const dTo = item.application_date_to ? new Date(item.application_date_to) : null
                  const today = new Date(); today.setHours(0, 0, 0, 0)
                  let badge: { label: string; cls: string } | null = null
                  if (dFrom && dTo) {
                    if (dFrom > today) badge = { label: 'Apply later', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
                    else if (dTo < today) badge = { label: 'Window passed', cls: 'bg-stone-100 text-[#7A8C7E] border-[#DDD0B8]' }
                    else badge = { label: 'Apply now', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
                  }
                  const fmt = (d: Date) => d.toLocaleDateString(locale, { day: '2-digit', month: 'short' })
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
                          {item.scan_verified ? (
                            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">✓ {tQr('verified')}</span>
                          ) : (
                            <button onClick={() => setScanTarget(item.id)}
                              className="text-xs bg-[#3A7D44] text-white px-3 py-1 rounded-full font-medium">
                              {tQr('scanButton')}
                            </button>
                          )}
                          {badge && (
                            <span className={`text-[10px] border px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                          )}
                        </div>
                      </div>
                      <RecipientLineFlat
                        name={item.recipient_name}
                        shopName={item.recipient_shop_name}
                        phone={item.recipient_phone}
                        role={item.recipient_role}
                      />
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>
      </div>
      <BottomNav color="#3A7D44" />
      {scanTarget && (
        <QRScannerModal
          orderItemId={scanTarget}
          onClose={() => setScanTarget(null)}
          onVerified={refreshPurchased}
        />
      )}
    </div>
  )
}

function RecipientLineFlat({
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
