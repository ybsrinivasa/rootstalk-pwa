'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

// Variety-blind by design (Point 4b, 2026-06-18). The backend never
// ships `variety_name` on this surface; the facilitator is a routing
// role for seeds and brand secrecy makes the brand-lock meaningful.
interface FacilitatorSeedOrder {
  id: string
  status: string
  category: string
  crop_cosh_id: string | null
  farmer_user_id: string
  farmer_name: string | null
  farmer_phone: string | null
  farmer_photo_url: string | null
  farm_area_acres: number | null
  client_id: string
  client_name: string | null
  dealer_user_id: string | null
  created_at: string
}

const STATUS_COLOUR: Record<string, string> = {
  SENT: 'bg-indigo-100 text-indigo-700',
  ACCEPTED: 'bg-sky-100 text-sky-700',
  REJECTED: 'bg-rose-100 text-rose-600',
  CANCELLED: 'bg-slate-100 text-[#7A8C7E]',
  PURCHASED: 'bg-emerald-100 text-emerald-700',
  POSTPONED: 'bg-amber-100 text-amber-800',
  NOT_AVAILABLE: 'bg-red-100 text-[#D4682E]',
  SENT_FOR_APPROVAL: 'bg-amber-100 text-amber-700',
}

const PENDING_STATUSES = new Set(['SENT', 'ACCEPTED'])

export default function FacilitatorSeedOrdersPage() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('facilitator.seedOrders')
  const [orders, setOrders] = useState<FacilitatorSeedOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [tab, setTab] = useState<'pending' | 'done'>('pending')
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    api.get<FacilitatorSeedOrder[]>('/facilitator/seed-orders')
      .then(r => setOrders(r.data))
      .finally(() => setLoading(false))

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [router])

  async function acceptOrder(id: string) {
    setProcessing(id); setError(null)
    try {
      await api.put(`/facilitator/seed-orders/${id}/accept`, {})
      await load()
    } catch {
      setError(t('errors.acceptFailed'))
    } finally { setProcessing(null) }
  }

  async function rejectOrder(id: string) {
    if (!confirm(t('confirmReject'))) return
    setProcessing(id); setError(null)
    try {
      await api.put(`/facilitator/seed-orders/${id}/reject`, {})
      await load()
    } catch {
      setError(t('errors.rejectFailed'))
    } finally { setProcessing(null) }
  }

  const visible = orders.filter(o =>
    tab === 'pending' ? PENDING_STATUSES.has(o.status) : !PENDING_STATUSES.has(o.status),
  )

  return (
    <div className="min-h-screen bg-[#F5F0E8] pb-24">
      <PWAHeader title={t('headerTitle')} activeRole="FACILITATOR" back="/facilitator/home" />
      <div className="pt-16 px-4 max-w-lg mx-auto">
        <div className="flex gap-2 mt-4 mb-4">
          {(['pending', 'done'] as const).map(k => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${tab === k ? 'bg-[#085041] text-white' : 'bg-white border border-[#DDD0B8] text-[#6B3F1F]'}`}>
              {t(k === 'pending' ? 'tabPending' : 'tabDone')}
            </button>
          ))}
        </div>

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

        {!loading && visible.length === 0 && (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] p-6 text-center">
            <p className="text-3xl mb-2">🌱</p>
            <p className="text-sm text-[#6B3F1F]">{t('empty')}</p>
          </div>
        )}

        {!loading && visible.length > 0 && (
          <div className="space-y-3">
            {visible.map(order => (
              <div key={order.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <span className="inline-block bg-indigo-50 text-indigo-600 text-xs font-semibold px-2 py-0.5 rounded-full mb-1">
                        {t('seedTag')}
                      </span>
                      {/* Variety name is intentionally NOT shown — see
                          module note. Crop is the closest identifier
                          the facilitator gets. */}
                      <p className="font-bold text-[#6B3F1F]">{cropDisplayName(order.crop_cosh_id)}</p>
                      {order.client_name && (
                        <p className="text-xs text-[#7A8C7E]">{order.client_name}</p>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLOUR[order.status] || 'bg-slate-100 text-[#7A8C7E]'}`}>
                      {order.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <div className="bg-[#F5F0E8] rounded-xl p-3 text-xs text-[#6B3F1F] space-y-1">
                    <p>
                      <span className="text-[#7A8C7E]">{t('farmerLabel')}</span>{' '}
                      <span className="font-medium">{order.farmer_name || '—'}</span>
                    </p>
                    {order.farmer_phone && (
                      <p>
                        <a href={`tel:${order.farmer_phone}`}
                          className="text-[#085041] font-medium">📞 {order.farmer_phone}</a>
                      </p>
                    )}
                    {order.farm_area_acres != null && (
                      <p>
                        <span className="text-[#7A8C7E]">{t('farmAreaLabel')}</span>{' '}
                        <span>{t('farmAreaValue', { acres: order.farm_area_acres })}</span>
                      </p>
                    )}
                    <p className="text-[#7A8C7E]">
                      {new Date(order.created_at).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  </div>

                  {order.status === 'SENT' && (
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => rejectOrder(order.id)}
                        disabled={processing === order.id}
                        className="flex-1 py-2.5 rounded-xl border border-[#DDD0B8] text-[#D4682E] text-sm font-semibold disabled:opacity-50">
                        {t('reject')}
                      </button>
                      <button onClick={() => acceptOrder(order.id)}
                        disabled={processing === order.id}
                        className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #054a3a, #085041)' }}>
                        {processing === order.id ? '…' : t('accept')}
                      </button>
                    </div>
                  )}
                  {order.status === 'ACCEPTED' && (
                    <button onClick={() => router.push(`/facilitator/seed-orders/${order.id}/forward`)}
                      className="mt-3 w-full py-2.5 rounded-xl text-white text-sm font-semibold"
                      style={{ background: 'linear-gradient(135deg, #054a3a, #085041)' }}>
                      {t('forwardToDealer')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <BottomNav color="#085041" />
    </div>
  )
}
