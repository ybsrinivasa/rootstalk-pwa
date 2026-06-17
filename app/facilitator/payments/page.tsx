'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
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
  // 2026-05-29: backend decorates the row with the context the
  // Facilitator needs to decide whether to pay — farmer name +
  // phone for tap-to-call, package name + crop name, and
  // `hours_remaining` so the UI can show a countdown.
  farmer_name?: string | null
  farmer_phone?: string | null
  package_id?: string
  package_name?: string | null
  crop_cosh_id?: string | null
  crop_name?: string | null
  hours_remaining?: number
  amount: number; status: string; expires_at: string; created_at: string
}

const COLOUR = '#7D4E00'

export default function FacilitatorPaymentsPage() {
  const router = useRouter()
  const t = useTranslations('facilitator.payments')
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
        // Attribution: facilitator pays for the software infrastructure
        // rootsTALK.in provides on behalf of the farmer — not paying
        // the company whose advisory it is.
        name: t('razorpayName'),
        description: t('razorpayDescription'),
        order_id: order.razorpay_order_id,
        prefill: { name: user?.name || '', contact: user?.phone || '' },
        theme: { color: COLOUR },
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          try {
            await api.post(`/dealer/payment-requests/${req.id}/verify`, response)
            load()
          } catch { setError(t('errorVerify')) }
        },
      }
      new window.Razorpay(options).open()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || t('errorInitiate'))
    } finally { setPaying(null) }
  }

  async function decline(reqId: string) {
    await api.put(`/facilitator/payment-requests/${reqId}/decline`)
    load()
  }

  // Backend filters to PENDING since 2026-05-29 — `done` no longer
  // populates from this endpoint. Keep the alias for readability of
  // the empty-state guard below.
  const pending = requests.filter(r => r.status === 'PENDING')
  const done: PaymentRequest[] = []

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={t('headerTitle')} activeRole="FACILITATOR" back="/facilitator/home" />
        <div className="pt-16 pb-20 px-4 max-w-lg mx-auto">
          <div className="mt-4 space-y-3">
            {error && <p className="text-sm text-[#D4682E] bg-red-50 px-4 py-2 rounded-xl">{error}</p>}
            {loading ? (
              <div className="h-24 bg-white rounded-2xl animate-pulse" />
            ) : pending.length === 0 && done.length === 0 ? (
              <div className="text-center py-16">
                <span className="text-4xl">💳</span>
                <p className="text-[#7A8C7E] text-sm mt-3">{t('emptyTitle')}</p>
              </div>
            ) : (
              <>
                {pending.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide">{t('pendingHeader', { count: pending.length })}</p>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
                      {t('attributionPrefix')}<strong>{t('razorpayName')}</strong>{t('attributionMiddle')}<em>{t('attributionEm')}</em>{t('attributionSuffix')}
                    </div>
                    {pending.map(req => {
                      const cropPackage = req.crop_name || ''
                      const hoursLow = typeof req.hours_remaining === 'number' && req.hours_remaining <= 6
                      return (
                        <div key={req.id} className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm">
                          {/* Farmer + context block */}
                          <div className="flex items-start justify-between mb-3 gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-[#6B3F1F] text-sm truncate">
                                {req.farmer_name || t('farmerFallback')}
                              </p>
                              {cropPackage && (
                                <p className="text-[12px] text-[#7A8C7E] truncate">{cropPackage}</p>
                              )}
                              {req.farmer_phone && (
                                <a href={`tel:${req.farmer_phone}`}
                                  className="inline-flex items-center gap-1 mt-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full"
                                  style={{ background: '#F5F0E8', color: COLOUR, border: `1px solid ${COLOUR}33` }}>
                                  📞 {req.farmer_phone}
                                </a>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="font-bold text-[#6B3F1F] text-xl leading-none">₹{Number(req.amount).toFixed(0)}</p>
                              {typeof req.hours_remaining === 'number' && (
                                <p className={`text-[11px] font-medium mt-1 ${hoursLow ? 'text-[#B85C00]' : 'text-[#7A8C7E]'}`}>
                                  {req.hours_remaining === 0
                                    ? t('expiringSoon')
                                    : t('hoursRemaining', { hours: req.hours_remaining })}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => openPayment(req)} disabled={paying === req.id}
                              className="flex-1 py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
                              style={{ background: `linear-gradient(135deg, #5a3800, ${COLOUR})` }}>
                              {paying === req.id ? t('opening') : t('payCta', { amount: Number(req.amount).toFixed(0) })}
                            </button>
                            <button onClick={() => decline(req.id)}
                              className="px-5 py-3 rounded-xl border border-[#DDD0B8] text-[#7A8C7E] text-sm">
                              {t('decline')}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}
                {/* Past Requests section dropped 2026-05-29 — backend
                    now returns PENDING rows only. History view can
                    be added back as a separate route if needed. */}
              </>
            )}
          </div>
        </div>
        <BottomNav color={COLOUR} activeRole="FACILITATOR" />
      </div>
    </>
  )
}
