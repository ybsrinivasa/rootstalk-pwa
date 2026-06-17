'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

type Order = {
  id: string; status: string; date_from: string
  date_to: string; dealer_user_id: string | null; created_at: string
  item_count?: number
  is_max_count?: boolean
  category?: 'PESTICIDE' | 'FERTILIZER' | null
  // 2026-06-02 — recipient (dealer / facilitator) surface so the
  // farmer can track who's holding the order without drilling in.
  recipient_name?: string | null
  recipient_phone?: string | null
  recipient_shop_name?: string | null
  recipient_role?: 'DEALER' | 'FACILITATOR' | null
  // Phase 1 of the Orders restructure (2026-06-02) — every card
  // shows crop name / company / start date so the farmer can read
  // the list without re-attaching context per row.
  subscription_id?: string | null
  package_id?: string | null
  package_name?: string | null
  crop_name?: string | null
  company_name?: string | null
  company_short_name?: string | null
  crop_start_date?: string | null
  planting_year?: number | null
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

type SubscriptionLite = {
  id: string; status: string; client_id: string
  crop_start_date: string | null; reference_number: string | null
}
type ClientInfo = { display_name: string }

export default function OrdersPage() {
  const router = useRouter()
  const locale = useLocale()
  const [tab, setTab] = useState<'active' | 'history' | 'purchased'>('active')
  const [orders, setOrders] = useState<Order[]>([])
  const [purchased, setPurchased] = useState<PurchasedItem[]>([])
  const [subs, setSubs] = useState<SubscriptionLite[]>([])
  const [clientNames, setClientNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  // "All roads lead to Rome" (2026-06-02) — the Orders button on
  // bottom nav lands the farmer on a package picker first; tapping a
  // crop routes to that crop's Orders page. The cross-subscription
  // pool view (Active / History / Purchased tabs) is still here but
  // collapsed by default so it doesn't compete with the picker.
  const [poolOpen, setPoolOpen] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    Promise.allSettled([
      api.get<Order[]>('/farmer/orders'),
      api.get<PurchasedItem[]>('/farmer/purchased-items').catch(() => ({ data: [] as PurchasedItem[] })),
      api.get<SubscriptionLite[]>('/farmer/my-subscriptions'),
    ]).then(async ([ordersRes, purchasedRes, subsRes]) => {
      if (ordersRes.status === 'fulfilled') setOrders(ordersRes.value.data)
      if (purchasedRes.status === 'fulfilled') setPurchased((purchasedRes.value as { data: PurchasedItem[] }).data)
      if (subsRes.status === 'fulfilled') {
        const ss = subsRes.value.data
        setSubs(ss)
        // Branding lookup for the picker (display_name only).
        const clientIds = [...new Set(ss.map(s => s.client_id))]
        const results = await Promise.allSettled(clientIds.map(id =>
          api.get<ClientInfo>(`/client/${id}/info`).then(res => ({ id, name: res.data.display_name })),
        ))
        const m: Record<string, string> = {}
        results.forEach(r => { if (r.status === 'fulfilled') m[r.value.id] = r.value.name })
        setClientNames(m)
      }
    }).finally(() => setLoading(false))
  }, [router])

  const activeSubs = subs.filter(s => s.status === 'ACTIVE')
  const activeOrderCountBySub = useMemo(() => {
    const m: Record<string, number> = {}
    for (const o of orders) {
      if (['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(o.status)) continue
      if (!o.subscription_id) continue
      m[o.subscription_id] = (m[o.subscription_id] || 0) + 1
    }
    return m
  }, [orders])

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
        {/* Phase 3 part 2 (2026-06-02) — "All roads lead to Rome".
            The bottom-nav Orders button lands the farmer on a package
            picker. Tapping a crop routes to /crop-detail/[id]/orders
            so they stay anchored to one package context. The pool
            view (Active / History / Purchased) is still here but
            collapsed by default. */}
        <div className="px-4 mt-4">
          <p className="text-xs font-semibold text-[#6B3F1F] uppercase tracking-wider mb-2">
            Order for a crop
          </p>
          {loading ? (
            <div className="h-20 bg-white rounded-2xl animate-pulse" />
          ) : activeSubs.length === 0 ? (
            <div className="bg-white border border-[#DDD0B8] rounded-2xl p-4 text-center">
              <p className="text-xs text-[#7A8C7E]">No active crops yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeSubs.map(s => (
                <button key={s.id}
                  onClick={() => router.push(`/crop-detail/${s.id}/orders`)}
                  className="w-full bg-white rounded-2xl p-3 border border-[#DDD0B8] shadow-sm text-left active:scale-[0.98] transition-transform">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#6B3F1F] truncate">
                        {clientNames[s.client_id] || '—'}
                      </p>
                      {s.reference_number && (
                        <p className="text-[10px] text-[#7A8C7E] font-mono mt-0.5">
                          {s.reference_number}
                        </p>
                      )}
                    </div>
                    {(activeOrderCountBySub[s.id] || 0) > 0 ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 shrink-0">
                        {activeOrderCountBySub[s.id]} in flight
                      </span>
                    ) : (
                      <span className="text-[#7A8C7E] text-sm shrink-0">→</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 mt-6">
          <button onClick={() => setPoolOpen(o => !o)}
            className="w-full flex items-center justify-between text-left">
            <p className="text-xs font-semibold text-[#6B3F1F] uppercase tracking-wider">
              All my orders (pool view)
            </p>
            <span className={`text-[#7A8C7E] text-sm transition-transform ${poolOpen ? 'rotate-180' : ''}`}>▾</span>
          </button>
        </div>

        {!poolOpen ? null : <>
        {/* Three tabs */}
        <div className="flex bg-white border-b border-[#DDD0B8] mt-2">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${
                tab === t.key ? 'border-[#3A7D44] text-[#3A7D44]' : 'border-transparent text-[#7A8C7E]'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

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
                        {item.scan_verified && (
                          <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">✓ Verified</span>
                        )}
                        {badge && (
                          <span className={`text-[10px] border px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-[#DDD0B8] mt-2">{new Date(item.created_at).toLocaleDateString(locale)}</p>
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
                    <span className="text-xs text-[#7A8C7E]">{new Date(order.created_at).toLocaleDateString(locale)}</span>
                  </div>
                  {/* Phase 1 (2026-06-02) — package-anchor header.
                      Crop and company go first because they're how a
                      farmer with multiple subscriptions tells two
                      otherwise-similar orders apart. */}
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
                        {order.is_max_count ? 'Max ' : ''}{order.item_count} item{order.item_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <RecipientLineFlat
                    name={order.recipient_name}
                    shopName={order.recipient_shop_name}
                    phone={order.recipient_phone}
                    role={order.recipient_role}
                  />
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
        </>}
      </div>
      <BottomNav color="#3A7D44" />
    </div>
  )
}


// Same shape as the per-package Orders page (RecipientLine there);
// duplicated here so the two surfaces stay aligned without sharing a
// component file. If a third surface needs it, lift to /components.
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
