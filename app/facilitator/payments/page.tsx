'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

declare global {
  interface Window { Razorpay: new (o: Record<string, unknown>) => { open(): void } }
}

interface PaymentRequest {
  id: string; subscription_id: string; farmer_user_id: string
  amount: number; status: string; expires_at: string; created_at: string
}

const COLOUR = '#7D4E00'

export default function FacilitatorPaymentsPage() {
  const router = useRouter()
  const user = getUser()
  const [requests, setRequests] = useState<PaymentRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<PaymentRequest[]>('/facilitator/payment-requests')
      .then(r => setRequests(r.data))
      .finally(() => setLoading(false))
  }, [])

  const load = () => api.get<PaymentRequest[]>('/facilitator/payment-requests')
    .then(r => setRequests(r.data)).catch(() => {})

  async function openPayment(req: PaymentRequest) {
    setPaying(req.id); setError('')
    try {
      const { data: order } = await api.post(`/dealer/payment-requests/${req.id}/create-order`)
      const options = {
        key: order.key_id, amount: order.amount, currency: order.currency,
        name: 'RootsTalk', description: 'Farmer Subscription Payment',
        order_id: order.razorpay_order_id,
        prefill: { name: user?.name || '', contact: user?.phone || '' },
        theme: { color: COLOUR },
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          try {
            await api.post(`/dealer/payment-requests/${req.id}/verify`, response)
            load()
          } catch { setError('Payment verification failed.') }
        },
      }
      new window.Razorpay(options).open()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Could not initiate payment.')
    } finally { setPaying(null) }
  }

  async function decline(reqId: string) {
    await api.put(`/facilitator/payment-requests/${reqId}/decline`)
    load()
  }

  const pending = requests.filter(r => r.status === 'PENDING')
  const done = requests.filter(r => r.status !== 'PENDING')

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title="Farmer Payments" activeRole="FACILITATOR" back="/facilitator/home" />
        <div className="pt-16 pb-20 px-4 max-w-lg mx-auto">
          <div className="mt-4 space-y-3">
            {error && <p className="text-sm text-[#D4682E] bg-red-50 px-4 py-2 rounded-xl">{error}</p>}
            {loading ? (
              <div className="h-24 bg-white rounded-2xl animate-pulse" />
            ) : pending.length === 0 && done.length === 0 ? (
              <div className="text-center py-16">
                <span className="text-4xl">💳</span>
                <p className="text-[#7A8C7E] text-sm mt-3">No payment requests yet</p>
              </div>
            ) : (
              <>
                {pending.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide">Pending ({pending.length})</p>
                    {pending.map(req => (
                      <div key={req.id} className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="font-semibold text-[#6B3F1F] text-lg">₹{Number(req.amount).toFixed(0)}</p>
                            <p className="text-xs text-[#7A8C7E]">Farmer subscription</p>
                            <p className="text-xs text-[#7A8C7E]">Expires: {new Date(req.expires_at).toLocaleDateString()}</p>
                          </div>
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">PENDING</span>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => openPayment(req)} disabled={paying === req.id}
                            className="flex-1 py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
                            style={{ background: `linear-gradient(135deg, #5a3800, ${COLOUR})` }}>
                            {paying === req.id ? 'Opening…' : `Pay ₹${Number(req.amount).toFixed(0)}`}
                          </button>
                          <button onClick={() => decline(req.id)}
                            className="px-5 py-3 rounded-xl border border-[#DDD0B8] text-[#7A8C7E] text-sm">
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {done.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide mt-4">Past Requests</p>
                    {done.map(req => (
                      <div key={req.id} className="bg-white rounded-2xl p-4 border border-[#DDD0B8]">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-[#6B3F1F]">₹{Number(req.amount).toFixed(0)}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${req.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-[#7A8C7E]'}`}>
                            {req.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <BottomNav color={COLOUR} activeRole="FACILITATOR" />
      </div>
    </>
  )
}
