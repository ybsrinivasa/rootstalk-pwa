'use client'
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'
import LocationSourceToggle, { type LocationSource } from '@/components/orders/LocationSourceToggle'
import RecipientMap, { type MapPoint } from '@/components/orders/RecipientMap'


interface DealerRow {
  user_id: string
  name: string | null
  phone: string | null
  distance_km: number
  shop_name: string | null
  shop_address: string | null
  // 2026-09-24: storefront photo captured in the dealer Shop Profile.
  // When present, an icon renders on the row → tap opens a full-
  // screen preview. Hidden when the dealer hasn't uploaded one.
  shop_photo_url?: string | null
  sell_categories: string[] | null
  // v1.9.4: origin coords exposed so the map component can pin them.
  shop_gps_lat?: number | null
  shop_gps_lng?: number | null
}


/**
 * Advisory-Only Mode — Nearby Dealers screen.
 *
 * Read-only directory of the client's onboarded dealers (filtered to
 * `ClientPromoter` rows for `sub.client_id` since v1.9.3). Farmer sees
 * shop details + Call + Directions per row; can flip origin between
 * profile GPS (default) and current device GPS; can pop a map showing
 * all dealers on one canvas.
 *
 * No orders route through this screen — that's the checkbox-3 flow
 * (not yet designed).
 */
export default function NearbyDealersPage() {
  const router = useRouter()
  const params = useParams()
  const subscriptionId = params.subscriptionId as string
  const t = useTranslations('advisoryOnly.nearbyDealers')
  const tOrdersCommon = useTranslations('orders.common')

  const [dealers, setDealers] = useState<DealerRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // v1.9.4: profile ↔ current GPS toggle + collapsible map, mirroring
  // the regular-mode order picker (see /order/new/[subscriptionId]).
  const [locSource, setLocSource] = useState<LocationSource>('profile')
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [refetching, setRefetching] = useState(false)
  // 2026-09-24: shop photo preview modal. Holds the URL of the shop
  // whose photo is currently being viewed; null when the modal is
  // closed. Device-back is intercepted via a sentinel history entry
  // (same pattern as the advisory-page purchase-photo preview).
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!photoPreviewUrl) return
    window.history.pushState({ rtModal: 'shopPhoto' }, '')
    const onPop = () => setPhotoPreviewUrl(null)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if ((window.history.state as { rtModal?: string } | null)?.rtModal === 'shopPhoto') {
        window.history.back()
      }
    }
  }, [photoPreviewUrl])

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

  async function handleLocationChange(
    next: LocationSource,
    coords?: { lat: number; lng: number },
  ) {
    setLocSource(next)
    if (next === 'current' && coords) setCurrentCoords(coords)
    const useCoords = next === 'current' ? (coords || currentCoords) : null
    const geoParam = useCoords ? `?lat=${useCoords.lat}&lng=${useCoords.lng}` : ''
    setRefetching(true)
    try {
      const r = await api.get<DealerRow[]>(
        `/farmer/subscriptions/${subscriptionId}/nearby-dealers${geoParam}`,
      )
      setDealers(r.data)
    } catch { /* keep previous list */ }
    finally { setRefetching(false) }
  }

  const farmerUser = getUser()
  const mapOrigin = (() => {
    if (locSource === 'current' && currentCoords) return currentCoords
    if (farmerUser?.gps_lat && farmerUser?.gps_lng) {
      return { lat: Number(farmerUser.gps_lat), lng: Number(farmerUser.gps_lng) }
    }
    return null
  })()

  const mapPoints: MapPoint[] = (dealers || []).reduce<MapPoint[]>((acc, d) => {
    if (d.shop_gps_lat != null && d.shop_gps_lng != null) {
      acc.push({
        user_id: d.user_id,
        name: d.name,
        shop_name: d.shop_name,
        lat: d.shop_gps_lat,
        lng: d.shop_gps_lng,
        distance_km: d.distance_km,
      })
    }
    return acc
  }, [])

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
            {/* v1.9.4 — profile/current toggle + collapsible map,
                borrowed from the regular-mode order picker. */}
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-[#7A8C7E]">
                  {tOrdersCommon('map.locationSourceLabel')}
                </span>
                <LocationSourceToggle
                  source={locSource}
                  currentCoords={currentCoords}
                  onChange={handleLocationChange}
                  busy={refetching}
                  labels={{
                    profile: tOrdersCommon('map.locationProfile'),
                    current: tOrdersCommon('map.locationCurrent'),
                    requesting: tOrdersCommon('map.locationRequesting'),
                    denied: tOrdersCommon('map.locationDenied'),
                  }}
                />
              </div>
              {mapOrigin && mapPoints.length > 0 && (
                <>
                  <button
                    onClick={() => setShowMap(v => !v)}
                    className="w-full text-xs text-[#3A7D44] font-medium py-2 rounded-lg border border-[#DDD0B8] bg-white active:bg-[#F7F0E0]">
                    {showMap ? tOrdersCommon('map.hideBtn') : tOrdersCommon('map.showBtn')}
                  </button>
                  {showMap && (
                    <RecipientMap
                      origin={mapOrigin}
                      points={mapPoints}
                      selectedUserId={null}
                      onSelect={uid => {
                        // Scroll the tapped dealer's row into view.
                        setTimeout(() => {
                          const el = document.getElementById(`dealer-${uid}`)
                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        }, 50)
                      }}
                    />
                  )}
                </>
              )}
            </div>

            <p className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium mt-4 mb-2">
              {t('header', { count: dealers.length })}
            </p>
            <div className="space-y-3">
              {dealers.map(d => (
                <div key={d.user_id} id={`dealer-${d.user_id}`}
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
                      {d.shop_gps_lat != null && d.shop_gps_lng != null && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${d.shop_gps_lat},${d.shop_gps_lng}`}
                          target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-[#3A7D44] font-medium mt-2">
                          <span>📍</span>
                          <span>{tOrdersCommon('map.directionsBtn')}</span>
                        </a>
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
                      {/* 2026-09-24: shop photo (storefront) preview.
                          Thumbnail is the button — farmer sees the
                          shop at a glance, tap enlarges. Avoids the
                          "camera icon = capture" ambiguity. Renders
                          only when the dealer has uploaded a photo. */}
                      {d.shop_photo_url && (
                        <button
                          onClick={() => setPhotoPreviewUrl(d.shop_photo_url || null)}
                          aria-label={t('viewPhotoAria')}
                          className="w-10 h-10 rounded-lg border border-[#DDD0B8] overflow-hidden active:scale-95">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={d.shop_photo_url}
                            alt=""
                            className="w-full h-full object-cover" />
                        </button>
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
      {/* Shop photo preview modal (2026-09-24). Backdrop dismisses;
          device back dismisses via the popstate handler above. */}
      {photoPreviewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setPhotoPreviewUrl(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoPreviewUrl}
            alt=""
            className="max-w-full max-h-full rounded-lg"
            onClick={e => e.stopPropagation()} />
          <button
            onClick={() => setPhotoPreviewUrl(null)}
            className="absolute top-4 right-4 text-white text-2xl"
            aria-label={t('closePhotoAria')}>
            ✕
          </button>
        </div>
      )}
      <BottomNav color="#3A7D44" />
    </div>
  )
}
