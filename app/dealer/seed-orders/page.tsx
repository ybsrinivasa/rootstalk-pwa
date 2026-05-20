'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

interface SeedOrder {
  id: string; status: string; variety_name: string | null; crop_cosh_id: string | null
  farmer_name: string | null; farm_area_acres: number | null
  unit: string | null; quantity: number | null; total_price: number | null
  created_at: string
}

const STATUS_COLOUR: Record<string, string> = {
  SENT: 'bg-indigo-100 text-indigo-700',
  ACCEPTED: 'bg-sky-100 text-sky-700',
  SENT_FOR_APPROVAL: 'bg-amber-100 text-amber-700',
  PURCHASED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-[#7A8C7E]',
  REJECTED: 'bg-rose-100 text-rose-600',
}

const UNITS = ['Grams', 'Kilograms', 'Numbers']

export default function DealerSeedOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<SeedOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [form, setForm] = useState({ unit: 'Kilograms', quantity: '', total_price: '' })
  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState<'pending' | 'done'>('pending')

  const load = () =>
    api.get<SeedOrder[]>('/dealer/seed-orders')
      .then(r => setOrders(r.data))
      .finally(() => setLoading(false))

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [])

  async function accept(id: string) {
    await api.put(`/dealer/seed-orders/${id}/accept`, {})
    load()
  }

  async function submit(id: string) {
    if (!form.quantity) return
    setSubmitting(true)
    try {
      await api.put(`/dealer/seed-orders/${id}/submit-for-approval`, {
        unit: form.unit,
        quantity: parseFloat(form.quantity),
        total_price: form.total_price ? parseFloat(form.total_price) : null,
      })
      setProcessing(null)
      setForm({ unit: 'Kilograms', quantity: '', total_price: '' })
      load()
    } finally { setSubmitting(false) }
  }

  const pending = orders.filter(o => !['PURCHASED', 'CANCELLED', 'REJECTED'].includes(o.status))
  const done = orders.filter(o => ['PURCHASED', 'CANCELLED', 'REJECTED'].includes(o.status))

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Seed Orders" activeRole="DEALER" />
      <div className="pt-16 pb-24">
        <div className="flex bg-white border-b border-[#DDD0B8]">
          {(['pending', 'done'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium capitalize border-b-2 transition-colors ${tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-[#7A8C7E]'}`}>
              {t === 'pending' ? `Active (${pending.length})` : 'Completed'}
            </button>
          ))}
        </div>

        <div className="px-4 mt-4 space-y-3 max-w-lg mx-auto">
          {loading ? <div className="h-24 bg-white rounded-2xl animate-pulse" /> :
            (tab === 'pending' ? pending : done).length === 0 ? (
              <div className="text-center py-16">
                <span className="text-4xl">🌱</span>
                <p className="text-[#7A8C7E] text-sm mt-3">No seed orders</p>
              </div>
            ) : (
              (tab === 'pending' ? pending : done).map(order => (
                <div key={order.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <span className="inline-block bg-indigo-50 text-indigo-600 text-xs font-semibold px-2 py-0.5 rounded-full mb-1">
                          Seed/Seedling
                        </span>
                        <p className="font-bold text-[#6B3F1F]">{order.variety_name || 'Unknown variety'}</p>
                        <p className="text-xs text-[#7A8C7E]">{cropDisplayName(order.crop_cosh_id)}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLOUR[order.status] || ''}`}>
                        {order.status.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="bg-[#F5F0E8] rounded-xl p-3 text-xs text-[#6B3F1F] space-y-1">
                      {order.farmer_name && <p><span className="text-[#7A8C7E]">Farmer: </span>{order.farmer_name}</p>}
                      {order.farm_area_acres && <p><span className="text-[#7A8C7E]">Farm area: </span>{order.farm_area_acres} acres</p>}
                      {order.unit && order.quantity && (
                        <p><span className="text-[#7A8C7E]">Qty: </span>{order.quantity} {order.unit}
                          {order.total_price ? ` · ₹${order.total_price}` : ''}
                        </p>
                      )}
                    </div>

                    {/* Action buttons */}
                    {order.status === 'SENT' && processing !== order.id && (
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => accept(order.id)}
                          className="flex-1 bg-sky-100 text-sky-700 text-xs font-semibold py-2.5 rounded-xl">
                          Accept Order
                        </button>
                        <button onClick={() => { setProcessing(order.id); setForm({ unit: 'Kilograms', quantity: '', total_price: '' }) }}
                          className="flex-1 bg-indigo-600 text-white text-xs font-semibold py-2.5 rounded-xl">
                          Process
                        </button>
                      </div>
                    )}

                    {(order.status === 'ACCEPTED' || order.status === 'SENT') && processing !== order.id && (
                      <button onClick={() => { setProcessing(order.id); setForm({ unit: 'Kilograms', quantity: '', total_price: '' }) }}
                        className="w-full mt-3 bg-indigo-600 text-white text-xs font-semibold py-2.5 rounded-xl">
                        {order.status === 'ACCEPTED' ? 'Enter Quantity & Price' : 'Process & Send for Approval'}
                      </button>
                    )}

                    {/* Processing form */}
                    {processing === order.id && (
                      <div className="mt-3 bg-[#F5F0E8] rounded-xl p-4 space-y-3">
                        <p className="text-xs font-semibold text-[#6B3F1F]">Enter quantity and price</p>
                        <div>
                          <label className="block text-xs text-[#7A8C7E] mb-1">Unit *</label>
                          <div className="flex gap-2">
                            {UNITS.map(u => (
                              <button key={u}
                                onClick={() => setForm(f => ({ ...f, unit: u }))}
                                className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                                  form.unit === u ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-[#6B3F1F] border-[#DDD0B8]'
                                }`}>
                                {u}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs text-[#7A8C7E] mb-1">Quantity *</label>
                            <input type="number" value={form.quantity}
                              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                              placeholder={`Amount in ${form.unit}`}
                              className="w-full border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
                          </div>
                          <div>
                            <label className="block text-xs text-[#7A8C7E] mb-1">Total Price (₹)</label>
                            <input type="number" value={form.total_price}
                              onChange={e => setForm(f => ({ ...f, total_price: e.target.value }))}
                              placeholder="Optional"
                              className="w-full border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => submit(order.id)} disabled={submitting || !form.quantity}
                            className="flex-1 bg-indigo-600 text-white text-xs font-semibold py-2.5 rounded-xl disabled:opacity-40">
                            {submitting ? 'Sending…' : 'Send for Approval'}
                          </button>
                          <button onClick={() => setProcessing(null)}
                            className="px-4 border border-[#DDD0B8] text-[#6B3F1F] text-xs font-medium py-2.5 rounded-xl">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {order.status === 'SENT_FOR_APPROVAL' && (
                      <div className="mt-3 bg-amber-50 rounded-xl p-3 text-xs text-amber-700 text-center font-medium">
                        Waiting for farmer approval
                      </div>
                    )}
                    {order.status === 'PURCHASED' && (
                      <div className="mt-3 bg-emerald-50 rounded-xl p-3 text-xs text-emerald-700 text-center font-medium">
                        Order complete — farmer approved
                      </div>
                    )}
                  </div>
                </div>
              ))
            )
          }
        </div>
      </div>
    </div>
  )
}
