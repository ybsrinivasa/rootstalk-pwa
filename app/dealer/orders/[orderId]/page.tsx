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

const ITEM_STATUS_COLOUR: Record<string, string> = {
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
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [itemEdit, setItemEdit] = useState({ brand_name: '', given_volume: '', volume_unit: 'kg', price: '' })

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

  async function markAvailable(itemId: string) {
    await api.put(`/dealer/orders/${orderId}/items/${itemId}/available`, {
      brand_name: itemEdit.brand_name || null,
      given_volume: itemEdit.given_volume ? parseFloat(itemEdit.given_volume) : null,
      volume_unit: itemEdit.volume_unit || null,
      price: itemEdit.price ? parseFloat(itemEdit.price) : null,
    })
    setEditingItem(null)
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
    setSubmitting(true)
    try {
      await api.put(`/dealer/orders/${orderId}/submit-for-approval`, {})
      load()
    } finally { setSubmitting(false) }
  }

  if (loading || !order) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#085041] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const allProcessed = order.items.every(i => i.status !== 'PENDING')
  const canSubmit = order.items.some(i => i.status === 'AVAILABLE') && order.status === 'PROCESSING'

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Order Details" activeRole="DEALER" />
      <div className="pt-16 pb-24 px-4 space-y-4">
        {/* Header */}
        <div className="bg-white rounded-2xl p-4 border border-slate-100 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">Order status</p>
              <p className="font-semibold text-slate-800 capitalize">{order.status.replace(/_/g, ' ')}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Date range</p>
              <p className="text-xs text-slate-600">
                {new Date(order.date_from).toLocaleDateString()} — {new Date(order.date_to).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-700 px-1">
            Items ({order.items.length})
          </p>
          {order.items.map(item => (
            <div key={item.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ITEM_STATUS_COLOUR[item.status] || 'bg-slate-100 text-slate-600'}`}>
                      {item.status.replace(/_/g, ' ')}
                    </span>
                    <p className="text-sm text-slate-600 font-mono mt-1.5 text-xs">{item.practice_id.slice(0, 8)}…</p>
                    {item.brand_name && <p className="text-sm font-medium text-slate-800 mt-1">{item.brand_name}</p>}
                    {item.given_volume && (
                      <p className="text-xs text-slate-500">{item.given_volume} {item.volume_unit} — ₹{item.price}</p>
                    )}
                  </div>
                </div>

                {/* Action buttons for PENDING items */}
                {item.status === 'PENDING' && editingItem !== item.id && (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => setEditingItem(item.id)}
                      className="flex-1 bg-green-600 text-white text-xs font-semibold py-2.5 rounded-xl">
                      ✓ Available
                    </button>
                    <button onClick={() => markPostpone(item.id)}
                      className="flex-1 bg-amber-100 text-amber-700 text-xs font-semibold py-2.5 rounded-xl">
                      ⏰ Postpone
                    </button>
                    <button onClick={() => markUnavailable(item.id)}
                      className="flex-1 bg-red-100 text-red-600 text-xs font-semibold py-2.5 rounded-xl">
                      ✗ N/A
                    </button>
                  </div>
                )}

                {/* Inline form to set volume/price */}
                {editingItem === item.id && (
                  <div className="mt-3 space-y-2 bg-slate-50 rounded-xl p-3">
                    <input value={itemEdit.brand_name}
                      onChange={e => setItemEdit(f => ({ ...f, brand_name: e.target.value }))}
                      placeholder="Brand name (optional)"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
                    <div className="grid grid-cols-3 gap-2">
                      <input type="number" value={itemEdit.given_volume}
                        onChange={e => setItemEdit(f => ({ ...f, given_volume: e.target.value }))}
                        placeholder="Qty"
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
                      <select value={itemEdit.volume_unit}
                        onChange={e => setItemEdit(f => ({ ...f, volume_unit: e.target.value }))}
                        className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                        <option value="kg">kg</option>
                        <option value="L">L</option>
                        <option value="g">g</option>
                        <option value="mL">mL</option>
                        <option value="bag">bag</option>
                      </select>
                      <input type="number" value={itemEdit.price}
                        onChange={e => setItemEdit(f => ({ ...f, price: e.target.value }))}
                        placeholder="₹ Price"
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => markAvailable(item.id)}
                        className="flex-1 bg-green-600 text-white text-xs font-semibold py-2.5 rounded-xl">
                        Confirm Available
                      </button>
                      <button onClick={() => setEditingItem(null)}
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
            {submitting ? 'Sending for approval…' : '✓ Send to Farmer for Approval'}
          </button>
        )}

        {order.status === 'SENT_FOR_APPROVAL' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
            <p className="text-amber-700 font-medium text-sm">Waiting for farmer approval</p>
            <p className="text-amber-500 text-xs mt-1">The farmer will review and approve/reject each item</p>
          </div>
        )}
      </div>
    </div>
  )
}
