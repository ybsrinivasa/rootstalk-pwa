'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

type Subscription = {
  id: string; client_id: string; package_id: string
  status: string; reference_number: string | null; crop_start_date: string | null
  // 2026-05-20 — backend now decorates rows with these on
  // /farmer/my-subscriptions. crop_name lets us show the real
  // crop label instead of a 36-char package_id UUID;
  // package_name carries the SE-authored variant ("Chilli
  // Package 1") when there are multiple PoPs on the same crop.
  crop_cosh_id?: string | null
  crop_name?: string | null
  package_name?: string | null
  // 2026-06-22 — plot discriminators shown on the card so the
  // farmer can tell apart multiple subscriptions of the same crop
  // (different acres / start date / origin).
  subscription_type?: 'SELF' | 'ASSIGNED' | null
  crop_measure?: 'AREA_WISE' | 'PLANT_WISE' | null
  farm_area_acres?: number | null
  area_unit?: string | null
  number_of_plants?: number | null
  planting_year?: number | null
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function formatStartDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

type ClientInfo = {
  id: string; display_name: string; primary_colour: string
  tagline: string | null; logo_url: string | null
  support_phone: string | null; office_phone: string | null
  website: string | null; social_links: Record<string, string>
}

// Social handles rendered in the contact strip. Order + label match
// the CA profile form so the farmer sees the same sequence the CA
// authored. Icons are SVG path strings sized against a 24×24 viewbox.
const SOCIAL_PLATFORMS: { key: string; label: string; path: string }[] = [
  { key: 'twitter', label: 'X',
    path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' },
  { key: 'facebook', label: 'Facebook',
    path: 'M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z' },
  { key: 'instagram', label: 'Instagram',
    path: 'M12 2.163c3.204 0 3.584.012 4.849.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.849.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z' },
  { key: 'youtube', label: 'YouTube',
    path: 'M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z' },
  { key: 'linkedin', label: 'LinkedIn',
    path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' },
]

// Legacy de-slugger kept for any caller that hasn't migrated to
// the shared cropDisplayName yet. Not used after 2026-05-20.
function _legacyFormatCropName(coshId: string): string {
  return coshId
    .replace(/^crop_/, '')
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// 2026-06-19 — Per-sub attention bucket (matches the Crop dashboard
// shape). Drives the per-crop attention badge on this Company view.
// 2026-06-20 — urgency tier added (RED last-day / YELLOW penultimate).
interface AttentionBucket {
  subscription_id: string
  client_id: string
  total: number
  urgency?: 'RED' | 'YELLOW' | null
}
interface DashboardAttention {
  by_subscription?: Record<string, AttentionBucket>
}

export default function BrandedSpacePage() {
  const { clientId } = useParams<{ clientId: string }>()
  const router = useRouter()
  const [branding, setBranding] = useState<ClientInfo | null>(null)
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [attention, setAttention] = useState<Record<string, AttentionBucket>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
    load()
  }, [clientId])

  async function load() {
    try {
      const [infoRes, subsRes, attentionRes] = await Promise.allSettled([
        api.get<ClientInfo>(`/client/${clientId}/info`),
        api.get<Subscription[]>('/farmer/my-subscriptions'),
        api.get<DashboardAttention>('/farmer/dashboard/attention'),
      ])
      if (infoRes.status === 'fulfilled') setBranding(infoRes.value.data)
      if (attentionRes.status === 'fulfilled' && attentionRes.value.data.by_subscription) {
        setAttention(attentionRes.value.data.by_subscription)
      }
      if (subsRes.status === 'fulfilled') {
        // Only ACTIVE subs are real "crops the farmer is being
        // advised on". CANCELLED / WAITLISTED / LAPSED rows
        // pollute the list and confuse the farmer (e.g. a
        // cancelled-then-resubscribed pair both showing as
        // "Chilli Package 3"). Pending-payment WAITLISTED rows
        // already surface in their own Home card above this tile.
        setSubscriptions(
          subsRes.value.data
            .filter(s => s.client_id === clientId)
            .filter(s => s.status === 'ACTIVE'),
        )
      }
    } finally { setLoading(false) }
  }

  const colour = branding?.primary_colour || '#3A7D44'
  const initials = (branding?.display_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F0E8]">
      <div className="w-8 h-8 border-2 border-[#DDD0B8] border-t-[#3A7D44] rounded-full animate-spin"/>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      {/* Branded top header (not using PWAHeader — custom branded) */}
      <div className="sticky top-0 z-40" style={{ background: colour }}>
        <div className="flex items-center px-4 pt-12 pb-4">
          <button onClick={() => router.push('/home')}
            aria-label="Back"
            className="text-white opacity-90 mr-3 text-[28px] leading-none w-9 h-9 flex items-center justify-center font-light pb-1">
            ‹
          </button>
          <div className="flex-1 flex flex-col items-center">
            {branding?.logo_url ? (
              <img src={branding.logo_url} alt={branding.display_name}
                className="w-14 h-14 rounded-full object-contain bg-white p-1.5 mb-1"/>
            ) : (
              <div className="w-14 h-14 rounded-full bg-white flex items-center justify-center mb-1"
                style={{ color: colour }}>
                <span className="font-bold text-lg">{initials}</span>
              </div>
            )}
            <p className="text-white font-bold text-xl">{branding?.display_name || ''}</p>
            {branding?.tagline && (
              <p className="text-white/70 text-sm">{branding.tagline}</p>
            )}
          </div>
          {/* Spacer to keep title centred */}
          <div className="w-5"/>
        </div>
      </div>

      <div className="pb-24">
        {/* Contact strip */}
        {(branding?.support_phone || branding?.office_phone || branding?.website ||
          (branding?.social_links && Object.values(branding.social_links).some(v => !!v))) && (
          <div className="px-4 py-3 flex gap-2 overflow-x-auto">
            {branding?.support_phone && (
              <a href={`tel:${branding.support_phone}`}
                className="flex items-center gap-1.5 shrink-0 bg-[#F5F0E8] border border-[#DDD0B8] rounded-full px-3 py-1.5 text-sm text-[#6B3F1F]">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
                </svg>
                {branding.support_phone}
              </a>
            )}
            {branding?.office_phone && branding.office_phone !== branding.support_phone && (
              <a href={`tel:${branding.office_phone}`}
                className="flex items-center gap-1.5 shrink-0 bg-[#F5F0E8] border border-[#DDD0B8] rounded-full px-3 py-1.5 text-sm text-[#6B3F1F]">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
                </svg>
                {branding.office_phone}
              </a>
            )}
            {branding?.website && (
              <a href={branding.website} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 shrink-0 bg-[#F5F0E8] border border-[#DDD0B8] rounded-full px-3 py-1.5 text-sm text-[#6B3F1F]">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" strokeLinecap="round"/>
                </svg>
                Website
              </a>
            )}
            {/* Social handles — same order the CA profile form uses, so
                the farmer sees them in a predictable sequence. Each chip
                renders only when the CA has stored a non-empty URL. Any
                platform key returned by the backend that isn't in this
                fixed list is skipped (defensive — CA form only writes
                these five). */}
            {SOCIAL_PLATFORMS.map(({ key, label, path }) => {
              const url = branding?.social_links?.[key]
              if (!url) return null
              return (
                <a key={key} href={url} target="_blank" rel="noopener noreferrer"
                  aria-label={label}
                  className="flex items-center gap-1.5 shrink-0 bg-[#F5F0E8] border border-[#DDD0B8] rounded-full px-3 py-1.5 text-sm text-[#6B3F1F]">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d={path}/>
                  </svg>
                  {label}
                </a>
              )
            })}
          </div>
        )}

        {/* Your Crops section */}
        <p className="text-[#6B3F1F] font-semibold text-base px-4 pt-5 pb-3">Your Crops</p>

        {subscriptions.length === 0 ? (
          <div className="mx-4 bg-white border border-[#DDD0B8] rounded-2xl px-4 py-6 text-center">
            <p className="text-[#7A8C7E] text-sm">No crops found for this company.</p>
          </div>
        ) : (
          // 2026-06-19 — Sort crops by descending attention count so
          // the farmer's eye lands on what needs action first. Ties
          // fall back to natural array order (i.e. backend order).
          [...subscriptions]
            .sort((a, b) =>
              (attention[b.id]?.total ?? 0) - (attention[a.id]?.total ?? 0)
            )
            .map(sub => {
            const hasStartDate = !!sub.crop_start_date
            const cropLabel = cropDisplayName(sub.crop_cosh_id, sub.crop_name)
            const attentionCount = attention[sub.id]?.total ?? 0
            const urgency = attention[sub.id]?.urgency ?? null
            // Plot discriminators — origin, size, time anchor.
            // Skipped silently when the underlying field is missing
            // so partly-filled subscriptions don't render orphans.
            const originLabel = sub.subscription_type === 'ASSIGNED'
              ? 'Assigned by company'
              : sub.subscription_type === 'SELF'
                ? 'Self-subscribed'
                : null
            const measure = sub.crop_measure ?? 'AREA_WISE'
            let sizeLabel: string | null = null
            if (measure === 'PLANT_WISE' && sub.number_of_plants != null) {
              sizeLabel = `${sub.number_of_plants} plants`
            } else if (measure !== 'PLANT_WISE' && sub.farm_area_acres != null) {
              const unit = sub.area_unit || 'acres'
              sizeLabel = `${sub.farm_area_acres} ${unit}`
            }
            const startLabel = formatStartDate(sub.crop_start_date)
            const timeLabel = measure === 'PLANT_WISE'
              ? (sub.planting_year ? `Planted ${sub.planting_year}` : null)
              : (startLabel ? `Started ${startLabel}` : null)
            const detailSegments = [originLabel, sizeLabel, timeLabel].filter(Boolean) as string[]
            return (
              <button key={sub.id}
                onClick={() => router.push(`/crop-detail/${sub.id}`)}
                className="w-full bg-white border border-[#DDD0B8] rounded-2xl mx-4 mb-3 px-4 py-4 flex items-center justify-between active:scale-[0.98] transition-transform text-left relative"
                style={{ width: 'calc(100% - 2rem)' }}>
                {(attentionCount > 0 || urgency) && (
                  <span className="absolute top-2 right-3 flex items-center gap-1">
                    {urgency === 'RED' && (
                      <span className="inline-block w-2 h-2 bg-red-600 rounded-full" />
                    )}
                    {urgency === 'YELLOW' && (
                      <span className="inline-block w-2 h-2 bg-amber-400 rounded-full" />
                    )}
                    {attentionCount > 0 && (
                      <span className="text-base font-bold text-[#085041]">
                        {attentionCount}
                      </span>
                    )}
                  </span>
                )}
                <div className="min-w-0 flex-1 pr-2">
                  <p className="text-[#6B3F1F] font-semibold text-[15px]">{cropLabel}</p>
                  {sub.reference_number && (
                    <p className="text-[#7A8C7E] text-[11px] mt-0.5 font-mono">{sub.reference_number}</p>
                  )}
                  {detailSegments.length > 0 && (
                    <p className="text-[#7A8C7E] text-[11px] mt-1 leading-snug">
                      {detailSegments.join(' · ')}
                    </p>
                  )}
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                  hasStartDate
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                } ${attentionCount > 0 ? 'mt-4' : ''}`}>
                  {hasStartDate ? 'Active' : 'Set start date'}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
