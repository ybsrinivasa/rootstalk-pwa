'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

// 2026-06-07 — For Pickup basket.
// Spec: separate surface for approved items waiting on the
// facilitator's physical task — pickup from dealer + handover to
// farmer. The ONE place where items persist past timeline expiry.
// Lead identifier: Packing ID. Order ID as reference. Items list
// (brand · qty · ₹) is fully visible (post-approval).

interface PickupItem {
  id: string
  brand_name: string | null
  given_volume: number | null
  volume_unit: string | null
  price: number | null
}

interface PickupOrder {
  order_id: string
  reference_number: string | null
  packing_code: string | null
  packing_shared_at: string | null
  picked_up_at: string | null
  created_at: string
  subscription_id: string | null
  crop_name: string | null
  farmer_name: string | null
  farmer_phone: string | null
  farmer_photo_url: string | null
  dealer_name: string | null
  dealer_phone: string | null
  dealer_shop_name: string | null
  dealer_shop_address: string | null
  dealer_shop_gps_lat: number | null
  dealer_shop_gps_lng: number | null
  items: PickupItem[]
  total_amount: number
}

const COLOUR = '#7D4E00'

function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

export default function FacilitatorPickupPage() {
  const router = useRouter()
  const t = useTranslations('facilitator.pickup')
  const [pickups, setPickups] = useState<PickupOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmPickup, setConfirmPickup] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () =>
    api.get<PickupOrder[]>('/facilitator/pickup')
      .then(r => setPickups(r.data))
      .finally(() => setLoading(false))

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [])

  async function markPickedUp(orderId: string) {
    setBusy(orderId)
    try {
      await api.put(`/facilitator/orders/${orderId}/packing-list/mark-picked-up`, {})
      setConfirmPickup(null)
      load()
    } catch {
      alert(t('errorPickup'))
    } finally { setBusy(null) }
  }

  // 2026-06-07 — Order-ID grouped. Same lineage may have multiple
  // sub-orders with approved items (dealer A delivered some, then
  // a reroute to dealer B delivered the rest). Each is a separate
  // physical pickup trip, so render flat sub-cards under one
  // group header per Order ID.
  const groups = useMemo(() => {
    const map = new Map<string, PickupOrder[]>()
    for (const p of pickups) {
      const key = p.reference_number || `legacy:${p.order_id}`
      const list = map.get(key)
      if (list) list.push(p)
      else map.set(key, [p])
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    const out = Array.from(map.entries())
    out.sort(([, a], [, b]) => {
      const aT = Math.max(...a.map(p => new Date(p.created_at).getTime()))
      const bT = Math.max(...b.map(p => new Date(p.created_at).getTime()))
      return bT - aT
    })
    return out
  }, [pickups])

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FACILITATOR" back="/facilitator/home" />
      <div className="pt-16 pb-20">
        <div className="px-4 pt-4 space-y-4 max-w-lg mx-auto">
          {loading ? (
            <div className="h-32 bg-white rounded-2xl animate-pulse" />
          ) : groups.length === 0 ? (
            <div className="text-center py-20">
              <span className="text-5xl">📦</span>
              <p className="text-[#7A8C7E] text-sm mt-3">{t('emptyTitle')}</p>
              <p className="text-[#7A8C7E] text-xs mt-1">
                {t('emptyBody')}
              </p>
            </div>
          ) : (
            groups.map(([key, subs]) => {
              const head = subs[0]
              const orderId = head?.reference_number || head?.order_id || 'unknown'
              return (
                <div key={key} className="space-y-2">
                  {/* Group header per Order ID — small, scoped to the
                      farmer + crop context. The individual pickup
                      cards below carry the Packing ID + dealer info
                      because each sub-order is its own trip. */}
                  <div className="px-2 flex items-center gap-2">
                    {head?.farmer_photo_url ? (
                      <img src={head.farmer_photo_url} alt={head?.farmer_name || t('farmerFallback')}
                        className="w-8 h-8 rounded-full object-cover border border-[#DDD0B8] shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[#7D4E00]/10 border border-[#DDD0B8] shrink-0 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-[#7D4E00]">{initials(head?.farmer_name)}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#6B3F1F] truncate">
                        {head?.farmer_name || t('unknownFarmer')}{head?.crop_name && ` · ${head.crop_name}`}
                      </p>
                      <p className="text-[10px] font-mono tracking-wide text-[#7D4E00]">{orderId}</p>
                    </div>
                  </div>

                  {subs.map(sub => (
                    <PickupCard key={sub.order_id} pickup={sub}
                      onPickupClick={() => setConfirmPickup(sub.order_id)}
                      busy={busy === sub.order_id} />
                  ))}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Confirm pickup sheet */}
      {confirmPickup && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end"
          onClick={() => busy !== confirmPickup && setConfirmPickup(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">{t('confirmTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mt-2">
              {t('confirmBody')}
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmPickup(null)} disabled={busy === confirmPickup}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                {t('cancel')}
              </button>
              <button onClick={() => markPickedUp(confirmPickup)} disabled={busy === confirmPickup}
                className="flex-1 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50"
                style={{ background: COLOUR }}>
                {busy === confirmPickup ? '…' : t('confirmCta')}
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav color={COLOUR} activeRole="FACILITATOR" />
    </div>
  )
}


function PickupCard({
  pickup, onPickupClick, busy,
}: {
  pickup: PickupOrder
  onPickupClick: () => void
  busy: boolean
}) {
  const t = useTranslations('facilitator.pickup')
  const pickedUp = !!pickup.picked_up_at
  const mapsHref = (pickup.dealer_shop_gps_lat != null && pickup.dealer_shop_gps_lng != null)
    ? `https://maps.google.com/?q=${pickup.dealer_shop_gps_lat},${pickup.dealer_shop_gps_lng}`
    : null
  return (
    <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm overflow-hidden">
      {/* Packing ID — lead identifier. Paper-friendly, dealer & farmer
          all reference the same batch. */}
      {pickup.packing_code && (
        <div className="px-4 py-2 bg-emerald-600 text-white flex items-baseline justify-between">
          <p className="text-[10px] uppercase tracking-wider opacity-75">{t('packingIdLabel')}</p>
          <p className="text-base font-bold font-mono tracking-widest">{pickup.packing_code}</p>
        </div>
      )}

      {/* Pickup status note */}
      {pickedUp ? (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100">
          <p className="text-[11px] text-amber-800 font-medium">
            {pickup.picked_up_at
              ? t('pickedUpOn', { date: new Date(pickup.picked_up_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) })
              : t('pickedUpNoDate')}
          </p>
        </div>
      ) : (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100">
          <p className="text-[11px] text-amber-800 font-medium">{t('awaitingPickup')}</p>
        </div>
      )}

      {/* Pickup-from: dealer block */}
      <div className="px-4 py-3 border-b border-emerald-50">
        <p className="text-[10px] font-semibold text-[#7A8C7E] uppercase tracking-wider mb-1">{t('pickupFrom')}</p>
        <p className="text-sm font-semibold text-[#6B3F1F] truncate">
          {pickup.dealer_shop_name || pickup.dealer_name || t('dealerFallback')}
        </p>
        {pickup.dealer_shop_address && (
          <p className="text-[11px] text-[#7A8C7E] mt-0.5">{pickup.dealer_shop_address}</p>
        )}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {pickup.dealer_phone && (
            <a href={`tel:${pickup.dealer_phone}`}
              className="text-[11px] font-semibold text-[#7D4E00] bg-amber-50 px-2 py-0.5 rounded-md">
              📞 {pickup.dealer_phone}
            </a>
          )}
          {mapsHref && (
            <a href={mapsHref} target="_blank" rel="noreferrer"
              className="text-[11px] font-semibold text-[#085041] bg-emerald-50 px-2 py-0.5 rounded-md">
              🗺️ Maps
            </a>
          )}
        </div>
      </div>

      {/* Items list — post-approval, full detail allowed */}
      <div className="divide-y divide-emerald-50">
        {pickup.items.map(it => (
          <div key={it.id} className="px-4 py-2.5 flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#6B3F1F] truncate">
                {it.brand_name || t('itemFallback')}
              </p>
              {it.given_volume != null && (
                <p className="text-[11px] text-[#7A8C7E]">
                  {it.given_volume} {it.volume_unit || ''}
                </p>
              )}
            </div>
            {it.price != null && (
              <p className="text-sm font-bold text-[#085041] shrink-0">₹{it.price.toLocaleString('en-IN')}</p>
            )}
          </div>
        ))}
      </div>
      <div className="px-4 py-2 bg-emerald-50/40 border-t border-emerald-100 flex items-center justify-between">
        <p className="text-[11px] text-[#7A8C7E]">{t('totalLabel')}</p>
        <p className="text-sm font-bold text-[#085041]">₹{pickup.total_amount.toLocaleString('en-IN')}</p>
      </div>

      {/* Handoff-to: farmer block */}
      <div className="px-4 py-3 bg-[#F5F0E8]/40 border-t border-emerald-50">
        <p className="text-[10px] font-semibold text-[#7A8C7E] uppercase tracking-wider mb-1">{t('handOffTo')}</p>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[#6B3F1F] truncate">
            {pickup.farmer_name || t('farmerFallback')}
          </p>
          {pickup.farmer_phone && (
            <a href={`tel:${pickup.farmer_phone}`}
              className="text-[11px] font-semibold text-[#7D4E00] bg-amber-50 px-2 py-0.5 rounded-md shrink-0">
              📞 {pickup.farmer_phone}
            </a>
          )}
        </div>
      </div>

      {/* Pickup CTA — only when not yet picked up. After pickup the
          card persists with the status note above until the farmer
          marks received. */}
      {!pickedUp && (
        <div className="px-4 py-3">
          <button onClick={onPickupClick} disabled={busy}
            className="w-full py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
            style={{ background: COLOUR }}>
            {busy ? '…' : t('pickupCta')}
          </button>
        </div>
      )}
    </div>
  )
}
