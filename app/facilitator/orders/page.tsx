'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface ItemStatusCounts {
  pending: number
  available: number
  postponed: number
  not_available: number
  sent_for_approval: number
  approved: number
  rejected: number
}

interface Order {
  id: string; status: string; farmer_user_id: string; client_id: string
  dealer_user_id: string | null; date_from: string; date_to: string
  created_at: string; item_count: number; pending_count: number
  // 2026-06-06 — Enriched payload (see backend /facilitator/orders).
  item_status_counts?: ItemStatusCounts
  farmer_name?: string | null
  farmer_phone?: string | null
  farmer_photo_url?: string | null
  dealer_name?: string | null
  dealer_phone?: string | null
  dealer_shop_name?: string | null
}

interface NearbyDealer {
  user_id: string; name: string | null; phone: string | null; shop_name: string | null
  shop_address: string | null; distance_km: number; sell_categories: string[]
}

const COLOUR = '#7D4E00'

const STATUS_COLOUR: Record<string, string> = {
  SENT: 'bg-purple-100 text-purple-700',
  ACCEPTED: 'bg-sky-100 text-sky-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  SENT_FOR_APPROVAL: 'bg-amber-100 text-amber-700',
  PARTIALLY_APPROVED: 'bg-orange-100 text-orange-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-[#7A8C7E]',
}

export default function FacilitatorOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [tab, setTab] = useState<'pending' | 'done'>('pending')

  const load = () =>
    api.get<Order[]>('/facilitator/orders')
      .then(r => setOrders(r.data))
      .finally(() => setLoading(false))

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [])

  async function accept(id: string) {
    setActing(id)
    try {
      await api.put(`/facilitator/orders/${id}/accept`, {})
      router.push(`/facilitator/orders/${id}`)
    } finally { setActing(null) }
  }

  // 2026-06-06 — Reject = cancel-and-migrate. Husk goes CANCELLED;
  // backend spins a new DRAFT for the farmer's Manage tab. Use a
  // confirm sheet (z-[60]) instead of window.confirm so the action
  // matches the dealer-side blind-decline pattern.
  const [confirmReject, setConfirmReject] = useState<string | null>(null)
  async function reject(id: string) {
    setActing(id)
    try {
      await api.put(`/facilitator/orders/${id}/reject`, {})
      setConfirmReject(null)
      load()
    } finally { setActing(null) }
  }

  // 2026-06-06 — Returned-items strip + re-route picker. Returned
  // items belong to the facilitator's queue while the facilitator
  // owns the order. Tap opens the nearby-dealers picker; on commit
  // the new DRAFT lands on the facilitator's list as a fresh SENT
  // order (single-step, no separate /send).
  const [rerouteOrderId, setRerouteOrderId] = useState<string | null>(null)
  const [nearbyDealers, setNearbyDealers] = useState<NearbyDealer[]>([])
  const [loadingDealers, setLoadingDealers] = useState(false)
  const [rerouting, setRerouting] = useState(false)
  async function openRerouteSheet(orderId: string) {
    setRerouteOrderId(orderId)
    setLoadingDealers(true)
    try {
      const { data } = await api.get<NearbyDealer[]>('/facilitator/nearby-dealers')
      setNearbyDealers(data)
    } catch { setNearbyDealers([]) }
    finally { setLoadingDealers(false) }
  }
  async function rerouteToDealer(dealerUserId: string) {
    if (!rerouteOrderId) return
    setRerouting(true)
    try {
      await api.post(`/facilitator/orders/${rerouteOrderId}/reroute-returned`, {
        dealer_user_id: dealerUserId,
      })
      setRerouteOrderId(null)
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: { message?: string } | string } } }
      const detail = e?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string } | undefined)?.message
      alert(msg || 'Could not re-route. Please try again.')
    } finally { setRerouting(false) }
  }

  const pending = orders.filter(o => !['COMPLETED', 'CANCELLED'].includes(o.status))
  const done = orders.filter(o => ['COMPLETED', 'CANCELLED'].includes(o.status))

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Acting as Facilitator" activeRole="FACILITATOR" back="/facilitator/home" />
      <div className="pt-16 pb-20">
        <div className="flex bg-white border-b border-[#DDD0B8]">
          {(['pending', 'done'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t
                ? 'border-[#7D4E00] text-[#7D4E00]' : 'border-transparent text-[#7A8C7E]'}`}>
              {t === 'pending' ? `Active (${pending.length})` : 'Done'}
            </button>
          ))}
        </div>

        <div className="px-4 mt-4 space-y-3 max-w-lg mx-auto">
          {loading ? (
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
          ) : (tab === 'pending' ? pending : done).length === 0 ? (
            <div className="text-center py-20">
              <span className="text-4xl">🌾</span>
              <p className="text-[#7A8C7E] text-sm mt-3">No orders here</p>
            </div>
          ) : (
            (tab === 'pending' ? pending : done).map(order => {
              const counts = order.item_status_counts
              const returnedN = counts?.not_available ?? 0
              const awaitingN = counts?.sent_for_approval ?? 0
              const approvedN = counts?.approved ?? 0
              return (
              <div key={order.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
                <button onClick={() => router.push(`/facilitator/orders/${order.id}`)}
                  className="w-full p-4 text-left">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[order.status] || 'bg-slate-100 text-[#7A8C7E]'}`}>
                      {order.status.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-[#7A8C7E]">{new Date(order.created_at).toLocaleDateString()}</span>
                  </div>
                  {/* Farmer → Dealer chain (when assigned) */}
                  <div className="space-y-1 mb-2">
                    {order.farmer_name && (
                      <p className="text-sm font-semibold text-[#6B3F1F] truncate">
                        {order.farmer_name}
                      </p>
                    )}
                    {order.dealer_user_id && (
                      <p className="text-xs text-[#7A8C7E] truncate">
                        → {order.dealer_shop_name || order.dealer_name || 'Dealer assigned'}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[#6B3F1F]">{order.item_count} items</p>
                      <p className="text-xs text-[#7A8C7E] mt-0.5">
                        {new Date(order.date_from).toLocaleDateString()} — {new Date(order.date_to).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      {!order.dealer_user_id && order.status !== 'CANCELLED' && (
                        <p className="text-xs text-amber-600">Awaiting dealer</p>
                      )}
                      {awaitingN > 0 && (
                        <p className="text-xs text-amber-700 font-medium">{awaitingN} awaiting farmer ✓</p>
                      )}
                      {approvedN > 0 && (
                        <p className="text-xs text-emerald-700 font-medium">{approvedN} approved</p>
                      )}
                    </div>
                  </div>
                </button>

                {/* New order — accept/reject inline */}
                {order.status === 'SENT' && !order.dealer_user_id && (
                  <div className="flex gap-2 px-4 pb-4">
                    <button onClick={() => accept(order.id)} disabled={acting === order.id}
                      className="flex-1 py-2.5 rounded-xl text-white text-xs font-semibold disabled:opacity-50"
                      style={{ background: COLOUR }}>
                      {acting === order.id ? 'Processing…' : '✓ Accept & Forward'}
                    </button>
                    <button onClick={() => setConfirmReject(order.id)} disabled={acting === order.id}
                      className="flex-1 py-2.5 rounded-xl border border-[#DDD0B8] text-[#D4682E] text-xs font-semibold disabled:opacity-50">
                      ✗ Reject
                    </button>
                  </div>
                )}

                {/* 2026-06-06 — Returned items strip. Per spec, returned
                    items belong to the facilitator (not the farmer)
                    while the facilitator owns the order. Tap opens the
                    nearby-dealers picker; on commit the items move to a
                    fresh SENT order routed to the picked dealer. */}
                {returnedN > 0 && order.status !== 'CANCELLED' && (
                  <div className="border-t border-[#F0E5D0] bg-amber-50/60 px-4 py-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-amber-800">
                      {returnedN} returned item{returnedN === 1 ? '' : 's'}
                    </p>
                    <button onClick={() => openRerouteSheet(order.id)} disabled={rerouting}
                      className="text-xs font-semibold text-amber-800 underline disabled:opacity-50">
                      Forward to another dealer
                    </button>
                  </div>
                )}
              </div>
              )
            })
          )}
        </div>
      </div>

      {/* 2026-06-06 — Reject confirmation. Backend cancel-and-migrates
          the husk: a fresh DRAFT carrying the items lands on the
          farmer's Manage tab, so they can pick a new recipient
          without re-keying. */}
      {confirmReject && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end"
          onClick={() => acting !== confirmReject && setConfirmReject(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">Reject this order?</p>
            <p className="text-xs text-[#7A8C7E] mt-2">
              The farmer will get a fresh draft on their Manage tab so they
              can send the same items to someone else.
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmReject(null)} disabled={acting === confirmReject}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                Cancel
              </button>
              <button onClick={() => reject(confirmReject)} disabled={acting === confirmReject}
                className="flex-1 bg-red-100 text-[#D4682E] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {acting === confirmReject ? '…' : 'Yes, reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2026-06-06 — Reroute returned-items picker. Same shape as the
          dealer detail page picker but driven from the list so the
          facilitator doesn't have to drill in. */}
      {rerouteOrderId && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end"
          onClick={() => !rerouting && setRerouteOrderId(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl max-h-[80vh] overflow-y-auto"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#DDD0B8]">
              <p className="font-bold text-[#6B3F1F]">Forward returned items to</p>
              <button onClick={() => !rerouting && setRerouteOrderId(null)} className="text-[#7A8C7E] text-xl">✕</button>
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
                        <button onClick={() => rerouteToDealer(d.user_id)} disabled={rerouting}
                          className="text-xs text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                          style={{ background: COLOUR }}>
                          {rerouting ? '…' : 'Forward'}
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

      <BottomNav color={COLOUR} activeRole="FACILITATOR" />
    </div>
  )
}
