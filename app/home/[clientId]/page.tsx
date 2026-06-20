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
}

type ClientInfo = {
  id: string; display_name: string; primary_colour: string
  tagline: string | null; logo_url: string | null
  support_phone: string | null; office_phone: string | null
  website: string | null; social_links: Record<string, string>
}

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
          <button onClick={() => router.back()}
            className="text-white opacity-70 mr-3">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
            </svg>
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
        {(branding?.support_phone || branding?.office_phone || branding?.website) && (
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
                <div className="min-w-0">
                  <p className="text-[#6B3F1F] font-semibold text-[15px]">{cropLabel}</p>
                  {sub.reference_number && (
                    <p className="text-[#7A8C7E] text-[11px] mt-0.5 font-mono">{sub.reference_number}</p>
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
