'use client'
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'


interface DealerRow {
  user_id: string
  name: string | null
  phone: string | null
  distance_km: number
  shop_name: string | null
  shop_address: string | null
  gps_lat: number | null
  gps_lng: number | null
  sell_categories: string[] | null
}


/**
 * Advisory-Only Mode — Nearby Dealers screen.
 *
 * Read-only informational list of the 5 nearest onboarded dealers.
 * Reused from the existing /nearby-dealers backend endpoint (same
 * query the subscribe-flow dealer picker uses). Farmer sees shop
 * details + can Call the dealer + can View on Map. No Orders.
 *
 * Reached only from the crop-dashboard "Nearby Dealers" tile, which
 * itself only appears when subscription.dealer_list_enabled === true.
 */
export default function NearbyDealersPage() {
  const router = useRouter()
  const params = useParams()
  const subscriptionId = params.subscriptionId as string
  const t = useTranslations('advisoryOnly.nearbyDealers')

  const [dealers, setDealers] = useState<DealerRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    (async () => {
      try {
        const r = await api.get<DealerRow[]>(
          `/farmer/subscriptions/${subscriptionId}/nearby-dealers`,
        )
        setDealers(r.data)
      } catch {
        setError(t('loadError'))
      } finally {
        setLoading(false)
      }
    })()
  }, [subscriptionId, router, t])

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('title')} activeRole="FARMER" back={`/crop-detail/${subscriptionId}`} />
      <div className="pt-16 pb-32 px-4 max-w-lg mx-auto">
        {loading ? (
          <div className="mt-4 space-y-3">
            <div className="h-20 bg-white rounded-2xl animate-pulse" />
            <div className="h-20 bg-white rounded-2xl animate-pulse" />
            <div className="h-20 bg-white rounded-2xl animate-pulse" />
          </div>
        ) : error ? (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
            {error}
          </div>
        ) : !dealers || dealers.length === 0 ? (
          <div className="mt-8 text-center py-8">
            <p className="text-[#7A8C7E] text-sm">{t('empty')}</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium mt-4 mb-2">
              {t('header', { count: dealers.length })}
            </p>
            <div className="space-y-3">
              {dealers.map(d => (
                <div key={d.user_id}
                  className="bg-white rounded-2xl border border-[#DDD0B8] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[#6B3F1F]">
                        {d.shop_name || d.name || t('unnamedFallback')}
                      </p>
                      {d.name && d.shop_name && (
                        <p className="text-xs text-[#7A8C7E] mt-0.5">{d.name}</p>
                      )}
                      {d.shop_address && (
                        <p className="text-xs text-[#7A8C7E] mt-1 leading-snug">
                          {d.shop_address}
                        </p>
                      )}
                      <p className="text-[11px] text-[#7A8C7E] mt-1">
                        {t('distanceAway', { km: d.distance_km.toFixed(1) })}
                      </p>
                      {d.sell_categories && d.sell_categories.length > 0 && (
                        <div className="mt-2 flex gap-1 flex-wrap">
                          {d.sell_categories.map(cat => (
                            <span key={cat}
                              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#F5F0E8] text-[#6B3F1F]">
                              {cat}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      {d.phone && (
                        <a href={`tel:${d.phone}`}
                          aria-label={t('callAria')}
                          className="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center active:scale-95">
                          <span>📞</span>
                        </a>
                      )}
                      {d.gps_lat != null && d.gps_lng != null && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${d.gps_lat},${d.gps_lng}`}
                          target="_blank" rel="noreferrer"
                          aria-label={t('mapAria')}
                          className="w-10 h-10 rounded-full bg-[#7D4196] text-white flex items-center justify-center active:scale-95">
                          <span>📍</span>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[#7A8C7E] leading-relaxed mt-4">
              {t('footerNote')}
            </p>
          </>
        )}
      </div>
      <BottomNav color="#3A7D44" />
    </div>
  )
}
