'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

interface OrderItem {
  id: string; practice_id: string; status: string
  brand_cosh_id: string | null; brand_name: string | null
  given_volume: number | null; estimated_volume: number | null
  volume_unit: string | null; price: number | null
}
interface Order {
  id: string; status: string; farmer_user_id: string; client_id: string
  date_from: string; date_to: string; created_at: string
  items: OrderItem[]
}
interface PackingItem {
  id: string; brand_name: string | null; given_volume: number | null
  volume_unit: string | null; price: number | null; status: string
}
interface PackingList {
  order_id: string; farmer_name: string | null; farmer_phone: string | null
  items: PackingItem[]; total_amount: number
}

const STATUS_COLOUR: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  AVAILABLE: 'bg-green-100 text-green-700',
  POSTPONED: 'bg-amber-100 text-amber-700',
  NOT_AVAILABLE: 'bg-red-100 text-red-600',
  SENT_FOR_APPROVAL: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-rose-100 text-rose-600',
}

export default function DealerOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<Order | null>(null)
  const [packingList, setPackingList] = useState<PackingList | null>(null)
  const [showPacking, setShowPacking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [itemEdit, setItemEdit] = useState({ brand_name: '', given_volume: '', volume_unit: 'kg', price: '' })
  const [estimating, setEstimating] = useState(false)
  const [estimate, setEstimate] = useState<{ volume: number; unit: string } | null>(null)

  const load = async () => {
    try {
      const { data } = await api.get<Order>(`/dealer/orders/${orderId}`)
      setOrder(data)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [orderId])

  async function acceptOrder() {
    setAccepting(true)
    try {
      await api.put(`/dealer/orders/${orderId}/accept`, {})
      load()
    } finally { setAccepting(false) }
  }

  async function getEstimate(itemId: string) {
    setEstimating(true)
    setEstimate(null)
    try {
      const { data } = await api.get(`/dealer/orders/${orderId}/items/${itemId}/volume-estimate`)
      if (data.estimated_volume) {
        setEstimate({ volume: data.estimated_volume, unit: data.volume_unit })
        setItemEdit(f => ({ ...f, given_volume: String(data.estimated_volume), volume_unit: data.volume_unit || f.volume_unit }))
      }
    } catch { /* no estimate available */ } finally { setEstimating(false) }
  }

  async function markAvailable(itemId: string) {
    if (!itemEdit.given_volume) return
    await api.put(`/dealer/orders/${orderId}/items/${itemId}/available`, {
      brand_name: itemEdit.brand_name || null,
      brand_cosh_id: null,
      given_volume: parseFloat(itemEdit.given_volume),
      volume_unit: itemEdit.volume_unit,
      price: itemEdit.price ? parseFloat(itemEdit.price) : null,
    })
    setEditingItem(null)
    setEstimate(null)
    setItemEdit({ brand_name: '', given_volume: '', volume_unit: 'kg', price: '' })
    load()
  }

  async function markPostpone(itemId: string) {
    await api.put(`/dealer/orders/${orderId}/items/${itemId}/postpone`, {})
    load()
  }

  async function markUnavailable(itemId: string) {
    await api.put(`/dealer/orders/${orderId}/items/${itemId}/not-available`, {})
    load()
  }

  async function submitForApproval() {
    if (!order) return
    setSubmitting(true)
    const availableItems = order.items.filter(i => i.status === 'AVAILABLE')
    const itemsPayload: Record<string, { given_volume: number; volume_unit: string; price?: number }> = {}
    for (const item of availableItems) {
      if (item.given_volume) {
        itemsPayload[item.id] = {
          given_volume: item.given_volume,
          volume_unit: item.volume_unit || 'kg',
          price: item.price ?? undefined,
        }
      }
    }
    try {
      await api.put(`/dealer/orders/${orderId}/submit-for-approval`, { items: itemsPayload })
      load()
    } finally { setSubmitting(false) }
  }

  async function loadPackingList() {
    const { data } = await api.get<PackingList>(`/dealer/orders/${orderId}/packing-list`)
    setPackingList(data)
    setShowPacking(true)
  }

  if (loading || !order) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#085041] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const canSubmit = order.items.some(i => i.status === 'AVAILABLE') &&
    order.status === 'PROCESSING' &&
    order.items.filter(i => i.status === 'AVAILABLE').every(i => i.given_volume)

  const showPL = ['SENT_FOR_APPROVAL', 'PARTIALLY_APPROVED', 'COMPLETED'].includes(order.status)

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Order Details" activeRole="DEALER" />
      <div className="pt-16 pb-24 px-4 space-y-4 max-w-lg mx-auto">

        {/* Header card */}
        <div className="bg-white rounded-2xl p-4 border border-slate-100 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">Order status</p>
              <p className="font-semibold text-slate-800">{order.status.replace(/_/g, ' ')}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Date range</p>
              <p className="text-xs text-slate-600">
                {new Date(order.date_from).toLocaleDateString()} — {new Date(order.date_to).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        {/* Accept CTA */}
        {order.status === 'SENT' && (
          <button onClick={acceptOrder} disabled={accepting}
            className="w-full py-4 rounded-2xl bg-[#085041] text-white font-semibold text-sm disabled:opacity-50">
            {accepting ? 'Accepting…' : 'Accept Order & Start Processing'}
          </button>
        )}

        {/* Items */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-700 px-1">Items ({order.items.length})</p>
          {order.items.map(item => (
            <div key={item.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[item.status] || 'bg-slate-100 text-slate-600'}`}>
                      {item.status.replace(/_/g, ' ')}
                    </span>
                    <p className="text-xs text-slate-400 font-mono mt-1.5 truncate">{item.practice_id}</p>
                    {item.brand_name && <p className="text-sm font-semibold text-slate-800 mt-1">{item.brand_name}</p>}
                    {item.given_volume != null && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        {item.given_volume} {item.volume_unit}
                        {item.price != null ? ` · ₹${item.price}` : ''}
                      </p>
                    )}
                  </div>
                </div>

                {/* Action buttons for PROCESSING orders */}
                {order.status === 'PROCESSING' && item.status === 'PENDING' && editingItem !== item.id && (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => { setEditingItem(item.id); setEstimate(null) }}
                      className="flex-1 bg-green-600 text-white text-xs font-semibold py-2.5 rounded-xl">
                      ✓ Available
                    </button>
                    <button onClick={() => markPostpone(item.id)}
                      className="flex-1 bg-amber-100 text-amber-700 text-xs font-semibold py-2.5 rounded-xl">
                      ⏰ Later
                    </button>
                    <button onClick={() => markUnavailable(item.id)}
                      className="flex-1 bg-red-100 text-red-600 text-xs font-semibold py-2.5 rounded-xl">
                      ✗ N/A
                    </button>
                  </div>
                )}

                {/* Inline form */}
                {editingItem === item.id && (
                  <div className="mt-3 space-y-2.5 bg-slate-50 rounded-xl p-3">
                    <input value={itemEdit.brand_name}
                      onChange={e => setItemEdit(f => ({ ...f, brand_name: e.target.value }))}
                      placeholder="Brand name"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />

                    {/* Volume estimate button */}
                    <button onClick={() => getEstimate(item.id)} disabled={estimating}
                      className="w-full text-xs font-medium text-[#085041] bg-[#085041]/5 border border-[#085041]/20 rounded-lg py-2 disabled:opacity-50">
                      {estimating ? 'Calculating…' : estimate ? `Est. ${estimate.volume} ${estimate.unit} — apply` : '⚡ Auto-calculate estimated volume'}
                    </button>

                    <div className="grid grid-cols-3 gap-2">
                      <input type="number" value={itemEdit.given_volume}
                        onChange={e => setItemEdit(f => ({ ...f, given_volume: e.target.value }))}
                        placeholder="Qty *"
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
                      <select value={itemEdit.volume_unit}
                        onChange={e => setItemEdit(f => ({ ...f, volume_unit: e.target.value }))}
                        className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                        <option value="kg">kg</option>
                        <option value="L">L</option>
                        <option value="g">g</option>
                        <option value="mL">mL</option>
                        <option value="bag">bag</option>
                        <option value="number">no.</option>
                      </select>
                      <input type="number" value={itemEdit.price}
                        onChange={e => setItemEdit(f => ({ ...f, price: e.target.value }))}
                        placeholder="₹ Price"
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => markAvailable(item.id)}
                        disabled={!itemEdit.given_volume}
                        className="flex-1 bg-green-600 text-white text-xs font-semibold py-2.5 rounded-xl disabled:opacity-40">
                        Confirm Available
                      </button>
                      <button onClick={() => { setEditingItem(null); setEstimate(null) }}
                        className="px-4 border border-slate-200 text-slate-600 text-xs font-medium py-2.5 rounded-xl">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Submit CTA */}
        {canSubmit && (
          <button onClick={submitForApproval} disabled={submitting}
            className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #054a3a, #085041)' }}>
            {submitting ? 'Sending…' : '✓ Send to Farmer for Approval'}
          </button>
        )}

        {/* Waiting state */}
        {order.status === 'SENT_FOR_APPROVAL' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
            <p className="text-amber-700 font-semibold text-sm">Waiting for farmer approval</p>
            <p className="text-amber-500 text-xs mt-1">Farmer will review and approve / reject each item</p>
          </div>
        )}

        {/* Packing list */}
        {showPL && (
          <button onClick={loadPackingList}
            className="w-full py-3.5 rounded-2xl border-2 border-[#085041] text-[#085041] font-semibold text-sm">
            View Packing List
          </button>
        )}

        {/* Completed */}
        {order.status === 'COMPLETED' && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
            <p className="text-emerald-700 font-semibold text-sm">Order Complete</p>
            <p className="text-emerald-500 text-xs mt-1">All items approved by farmer</p>
          </div>
        )}
      </div>

      {/* Packing list bottom sheet */}
      {showPacking && packingList && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setShowPacking(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5 pb-10 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-bold text-slate-800 text-base">Packing List</p>
                {packingList.farmer_name && (
                  <p className="text-xs text-slate-500">{packingList.farmer_name} · {packingList.farmer_phone}</p>
                )}
              </div>
              <button onClick={() => setShowPacking(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-light">✕</button>
            </div>
            <div className="space-y-2">
              {packingList.items.map((item, i) => (
                <div key={item.id} className="flex items-center justify-between py-3 border-b border-slate-100">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{item.brand_name || `Item ${i + 1}`}</p>
                    <p className="text-xs text-slate-500">{item.given_volume} {item.volume_unit}</p>
                  </div>
                  {item.price != null && (
                    <p className="text-sm font-bold text-slate-700">₹{item.price}</p>
                  )}
                </div>
              ))}
            </div>
            {packingList.total_amount > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between">
                <p className="font-semibold text-slate-700">Total</p>
                <p className="font-bold text-lg text-slate-800">₹{packingList.total_amount.toFixed(2)}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
