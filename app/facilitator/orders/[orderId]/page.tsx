'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

interface OrderDetail {
  id: string; status: string; farmer_user_id: string; client_id: string
  dealer_user_id: string | null; facilitator_user_id: string | null
  date_from: string; date_to: string
  items: { id: string; practice_id: string; status: string; brand_name: string | null
           given_volume: number | null; volume_unit: string | null; price: number | null }[]
}
interface NearbyDealer {
  user_id: string; name: string | null; phone: string | null; shop_name: string | null
  shop_address: string | null; distance_km: number; sell_categories: string[]
}
interface User { id: string; name: string | null; phone: string | null }
interface PackingList {
  order_id: string; farmer_name: string | null; farmer_phone: string | null
  items: { id: string; brand_name: string | null; given_volume: number | null; volume_unit: string | null; price: number | null }[]
  total_amount: number
}

const COLOUR = '#7D4E00'

export default function FacilitatorOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [nearbyDealers, setNearbyDealers] = useState<NearbyDealer[]>([])
  const [loading, setLoading] = useState(true)
  const [forwarding, setForwarding] = useState(false)
  const [returning, setReturning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [showDealerSelect, setShowDealerSelect] = useState(false)
  const [loadingDealers, setLoadingDealers] = useState(false)
  const [packingList, setPackingList] = useState<PackingList | null>(null)
  const [showPacking, setShowPacking] = useState(false)
  const [farmer, setFarmer] = useState<User | null>(null)
  const [dealer, setDealer] = useState<User | null>(null)
  const [packingShared, setPackingShared] = useState(false)

  const load = async () => {
    try {
      const { data } = await api.get<OrderDetail>(`/facilitator/orders/${orderId}`)
      setOrder(data)
      // Load farmer info
      if (data.farmer_user_id) {
        api.get<User>(`/admin/users/${data.farmer_user_id}`).then(r => setFarmer(r.data)).catch(() => {})
      }
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [orderId])

  async function openDealerSelect() {
    setShowDealerSelect(true)
    setLoadingDealers(true)
    try {
      const { data } = await api.get<NearbyDealer[]>('/facilitator/nearby-dealers')
      setNearbyDealers(data)
    } finally { setLoadingDealers(false) }
  }

  async function forwardToDealer(dealerUserId: string) {
    setForwarding(true)
    try {
      await api.put(`/facilitator/orders/${orderId}/route-to-dealer`, { dealer_user_id: dealerUserId })
      setShowDealerSelect(false)
      load()
    } finally { setForwarding(false) }
  }

  async function returnToFarmer() {
    if (!confirm('Return unresourceable items to the farmer?')) return
    setReturning(true)
    try {
      await api.put(`/facilitator/orders/${orderId}/return-to-farmer`, {})
      load()
    } finally { setReturning(false) }
  }

  async function openPacking() {
    const { data } = await api.get<PackingList>(`/dealer/orders/${orderId}/packing-list`).catch(async () => {
      // Try facilitator endpoint fallback — packing list readable by facilitator
      return { data: null }
    })
    if (data) { setPackingList(data); setShowPacking(true) }
  }

  async function markShared() {
    await api.put(`/dealer/orders/${orderId}/packing-list/mark-shared`, {})
    setPackingShared(true)
  }

  async function confirmDelivery() {
    setConfirming(true)
    try {
      await api.put(`/facilitator/orders/${orderId}/confirm-delivery`, {})
      load()
    } finally { setConfirming(false) }
  }

  if (loading || !order) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#7D4E00] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const approvedItems = order.items.filter(i => ['APPROVED', 'SENT_FOR_APPROVAL'].includes(i.status))
  const notAvailableItems = order.items.filter(i => i.status === 'NOT_AVAILABLE')
  const showPackingBand = approvedItems.length > 0 && ['PARTIALLY_APPROVED', 'COMPLETED', 'SENT_FOR_APPROVAL'].includes(order.status)
  const isCompleted = order.status === 'COMPLETED'

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Order Details" activeRole="FACILITATOR" back="/facilitator/orders" />
      <div className="pt-16 pb-24 px-4 space-y-4 max-w-lg mx-auto">

        {/* Status card */}
        <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] mt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[#7A8C7E]">Status</p>
              <p className="font-semibold text-[#6B3F1F]">{order.status.replace(/_/g, ' ')}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[#7A8C7E]">{order.items.length} items</p>
              <p className="text-xs text-[#7A8C7E]">{new Date(order.date_from).toLocaleDateString()} — {new Date(order.date_to).toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        {/* ── Packing screen: two-band collect + deliver ── */}
        {showPackingBand && (
          <div className="space-y-3">
            {/* Green band — collect from dealer */}
            <div className="rounded-2xl overflow-hidden">
              <div className="px-4 py-3" style={{ background: '#166534' }}>
                <p className="text-white font-bold text-sm">Collect from Dealer</p>
              </div>
              <div className="bg-green-50 border border-green-200 px-4 py-4 space-y-1">
                {order.dealer_user_id && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-green-900">{dealer?.name || 'Dealer assigned'}</p>
                    {dealer?.phone && (
                      <a href={`tel:${dealer.phone}`}
                        className="text-xs bg-green-700 text-white px-3 py-1.5 rounded-lg font-medium">
                        📞 Call
                      </a>
                    )}
                  </div>
                )}
                <div className="mt-2 space-y-1">
                  {approvedItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <p className="text-green-800">{item.brand_name || 'Item'}</p>
                      {item.given_volume && (
                        <p className="text-green-600">{item.given_volume} {item.volume_unit} {item.price ? `· ₹${item.price}` : ''}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Amber band — deliver to farmer */}
            <div className="rounded-2xl overflow-hidden">
              <div className="px-4 py-3" style={{ background: '#92400e' }}>
                <p className="text-white font-bold text-sm">Deliver to Farmer</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 px-4 py-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-amber-900">{farmer?.name || 'Farmer'}</p>
                  {farmer?.phone && (
                    <a href={`tel:${farmer.phone}`}
                      className="text-xs bg-amber-700 text-white px-3 py-1.5 rounded-lg font-medium">
                      📞 Call
                    </a>
                  )}
                </div>
                <div>
                  <p className="text-xs text-amber-600 font-semibold mt-1">Total: ₹{approvedItems.reduce((s, i) => s + (i.price || 0), 0)}</p>
                </div>
              </div>
            </div>

            {/* Packing + delivery actions */}
            {!isCompleted && (
              <div className="space-y-2">
                <button onClick={openPacking}
                  className="w-full py-3.5 rounded-2xl border-2 font-semibold text-sm"
                  style={{ borderColor: COLOUR, color: COLOUR }}>
                  View Delivery List
                </button>
                {packingShared && (
                  <button onClick={confirmDelivery} disabled={confirming}
                    className="w-full py-3.5 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
                    style={{ background: COLOUR }}>
                    {confirming ? 'Confirming…' : '✓ Done — Delivery Complete'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Forward to dealer */}
        {!order.dealer_user_id && ['ACCEPTED', 'SENT'].includes(order.status) && (
          <button onClick={openDealerSelect}
            className="w-full py-4 rounded-2xl text-white font-semibold text-sm"
            style={{ background: COLOUR }}>
            → Forward to Dealer
          </button>
        )}

        {/* Dealer assigned info */}
        {order.dealer_user_id && order.status !== 'COMPLETED' && !showPackingBand && (
          <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4">
            <p className="text-sky-800 font-semibold text-sm">Order forwarded to dealer</p>
            <p className="text-sky-600 text-xs mt-1">Waiting for dealer to process and send for approval</p>
          </div>
        )}

        {/* Not available — return to farmer */}
        {notAvailableItems.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <p className="text-red-700 font-semibold text-sm">{notAvailableItems.length} item{notAvailableItems.length > 1 ? 's' : ''} unavailable</p>
            <div className="flex gap-2 mt-3">
              <button onClick={openDealerSelect}
                className="flex-1 py-2.5 rounded-xl text-white text-xs font-semibold"
                style={{ background: COLOUR }}>
                Try another dealer
              </button>
              <button onClick={returnToFarmer} disabled={returning}
                className="flex-1 py-2.5 rounded-xl border border-red-300 text-[#D4682E] text-xs font-semibold disabled:opacity-50">
                {returning ? 'Returning…' : 'Return to farmer'}
              </button>
            </div>
          </div>
        )}

        {isCompleted && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
            <p className="text-emerald-700 font-semibold">Delivery Complete</p>
            <p className="text-emerald-500 text-xs mt-1">All items delivered to farmer</p>
          </div>
        )}
      </div>

      {/* Dealer selection bottom sheet */}
      {showDealerSelect && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setShowDealerSelect(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl pb-10 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#DDD0B8]">
              <p className="font-bold text-[#6B3F1F]">Select a Dealer</p>
              <button onClick={() => setShowDealerSelect(false)} className="text-[#7A8C7E] text-xl">✕</button>
            </div>
            {loadingDealers ? (
              <div className="p-8 text-center">
                <div className="w-8 h-8 border-2 border-[#7D4E00] border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : nearbyDealers.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-4xl mb-3">🏪</p>
                <p className="text-[#7A8C7E] font-medium">No nearby dealers found</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {nearbyDealers.map(d => (
                  <div key={d.user_id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="font-semibold text-[#6B3F1F]">{d.shop_name || d.name || 'Dealer'}</p>
                        <p className="text-xs text-[#7A8C7E] mt-0.5">{d.distance_km} km away</p>
                        {d.shop_address && <p className="text-xs text-[#7A8C7E]">{d.shop_address}</p>}
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {d.sell_categories.map(c => (
                            <span key={c} className="text-xs bg-slate-100 text-[#7A8C7E] px-1.5 py-0.5 rounded">{c}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        {d.phone && (
                          <a href={`tel:${d.phone}`}
                            className="text-xs bg-slate-100 text-[#6B3F1F] px-3 py-1.5 rounded-lg text-center font-medium">
                            📞 Call
                          </a>
                        )}
                        <button onClick={() => forwardToDealer(d.user_id)} disabled={forwarding}
                          className="text-xs text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                          style={{ background: COLOUR }}>
                          {forwarding ? '…' : 'Forward'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Packing list bottom sheet */}
      {showPacking && packingList && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setShowPacking(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5 pb-10 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-bold text-[#6B3F1F] text-base">Delivery List</p>
              <button onClick={() => setShowPacking(false)} className="text-[#7A8C7E] text-xl">✕</button>
            </div>
            <div className="space-y-2 mb-4">
              {packingList.items.map((item, i) => (
                <div key={item.id} className="flex justify-between py-2.5 border-b border-[#DDD0B8]">
                  <div>
                    <p className="text-sm font-semibold text-[#6B3F1F]">{item.brand_name || `Item ${i + 1}`}</p>
                    <p className="text-xs text-[#7A8C7E]">{item.given_volume} {item.volume_unit}</p>
                  </div>
                  {item.price && <p className="text-sm font-bold text-[#6B3F1F]">₹{item.price}</p>}
                </div>
              ))}
            </div>
            {packingList.total_amount > 0 && (
              <div className="flex justify-between font-bold text-[#6B3F1F] pt-2">
                <span>Total</span><span>₹{packingList.total_amount.toFixed(2)}</span>
              </div>
            )}
            {!packingShared && (
              <button onClick={markShared}
                className="w-full mt-4 py-3.5 rounded-2xl text-white font-semibold text-sm"
                style={{ background: COLOUR }}>
                Share Delivery List ↗
              </button>
            )}
            {packingShared && (
              <div className="mt-3 text-center text-xs text-emerald-600 font-medium">✓ Shared — you can now mark delivery as done</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
