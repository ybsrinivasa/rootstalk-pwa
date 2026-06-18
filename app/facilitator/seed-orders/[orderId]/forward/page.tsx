'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

interface Dealer {
  user_id: string
  name: string | null
  phone: string | null
  shop_name: string | null
  shop_address: string | null
  distance_km: number
}

export default function FacilitatorSeedForwardPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const t = useTranslations('facilitator.seedOrders.forward')
  const [dealers, setDealers] = useState<Dealer[]>([])
  const [loading, setLoading] = useState(true)
  const [placing, setPlacing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<Dealer[]>(`/facilitator/seed-orders/${orderId}/nearby-dealers`)
      .then(r => setDealers(r.data))
      .catch(() => setDealers([]))
      .finally(() => setLoading(false))
  }, [orderId, router])

  async function routeTo(dealer: Dealer) {
    setPlacing(dealer.user_id); setError(null)
    try {
      await api.put(`/facilitator/seed-orders/${orderId}/route-to-dealer`, {
        dealer_user_id: dealer.user_id,
      })
      router.replace('/facilitator/seed-orders')
    } catch (e: unknown) {
      // Brand-lock safety net — the picker already filtered to
      // onboarded dealers, but a stale list could still hit this.
      const err = e as { response?: { data?: { detail?: { code?: string; message?: string } | string } } }
      const detail = err.response?.data?.detail
      if (detail && typeof detail === 'object' && detail.code === 'locked_brand_requires_onboarded_dealer') {
        setError(t('errors.brandLock'))
      } else {
        setError(t('errors.forwardFailed'))
      }
      setPlacing(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8] pb-24">
      <PWAHeader title={t('headerTitle')} activeRole="FACILITATOR"
        back={`/facilitator/seed-orders`} />
      <div className="pt-16 px-4 max-w-lg mx-auto">
        <p className="text-xs text-[#7A8C7E] mt-4 mb-4 leading-relaxed">
          {t('helpText')}
        </p>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-[#085041] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && dealers.length === 0 && (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] p-6 text-center">
            <p className="text-3xl mb-2">🤷</p>
            <p className="text-sm text-[#6B3F1F] font-medium">{t('noDealersTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mt-1">{t('noDealersBody')}</p>
          </div>
        )}

        {!loading && dealers.length > 0 && (
          <div className="space-y-3">
            {dealers.map(d => (
              <div key={d.user_id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[#6B3F1F]">{d.shop_name || d.name || '—'}</p>
                    {d.shop_name && d.name && (
                      <p className="text-xs text-[#7A8C7E]">{d.name}</p>
                    )}
                    <p className="text-xs text-[#7A8C7E] mt-0.5">{t('kmAway', { distance: d.distance_km })}</p>
                    {d.shop_address && (
                      <p className="text-xs text-[#7A8C7E] truncate">{d.shop_address}</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    {d.phone && (
                      <a href={`tel:${d.phone}`}
                        className="text-xs bg-slate-100 text-[#6B3F1F] px-3 py-1.5 rounded-lg text-center font-medium">
                        📞
                      </a>
                    )}
                    <button onClick={() => routeTo(d)} disabled={placing === d.user_id}
                      className="text-xs text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                      style={{ background: '#085041' }}>
                      {placing === d.user_id ? '…' : t('forward')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
