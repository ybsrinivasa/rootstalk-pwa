'use client'
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'


interface BrandRow {
  name: string
  manufacturer: string | null
}

interface BrandsResponse {
  is_locked: boolean
  locked_brand_name: string | null
  brands: BrandRow[]
  client_name: string
}


/**
 * Advisory-Only Mode — Brands screen for a specific recommended input.
 *
 * Reached from a Brands button on any PracticeCard in the advisory
 * screen (fertilisers/pesticides only). Purely informational — no
 * action buttons. Positioned as "some brands available in the market"
 * with an explicit no-endorsement disclaimer.
 *
 * Data source is the Cosh brand catalog via the dealer-side query;
 * see backend get_practice_brands_farmer. No new plumbing.
 */
export default function AdvisoryBrandsPage() {
  const router = useRouter()
  const params = useParams()
  const subscriptionId = params.subscriptionId as string
  const practiceId = params.practiceId as string
  const t = useTranslations('advisoryOnly.brands')

  const [data, setData] = useState<BrandsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    (async () => {
      try {
        const r = await api.get<BrandsResponse>(
          `/farmer/subscriptions/${subscriptionId}/practices/${practiceId}/brands`,
        )
        setData(r.data)
      } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: { message?: string } | string } } }
        const detail = err?.response?.data?.detail
        const msg = typeof detail === 'object' ? detail?.message : (detail as string)
        setError(msg || t('loadError'))
      } finally {
        setLoading(false)
      }
    })()
  }, [subscriptionId, practiceId, router, t])

  const isLocked = data?.is_locked

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader
        title={isLocked ? t('lockedTitle') : t('title')}
        activeRole="FARMER"
        back={`/advisory/${subscriptionId}`}
      />
      <div className="pt-16 pb-32 px-4 max-w-lg mx-auto">
        {loading ? (
          <div className="mt-4 space-y-3">
            <div className="h-14 bg-white rounded-2xl animate-pulse" />
            <div className="h-14 bg-white rounded-2xl animate-pulse" />
            <div className="h-14 bg-white rounded-2xl animate-pulse" />
          </div>
        ) : error ? (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
            {error}
          </div>
        ) : !data || data.brands.length === 0 ? (
          <div className="mt-8 text-center py-8">
            <p className="text-[#7A8C7E] text-sm">{t('empty')}</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium mt-4">
              {isLocked ? t('lockedHeader') : t('header')}
            </p>
            <div className="mt-2 bg-white rounded-2xl border border-[#DDD0B8] overflow-hidden">
              {data.brands.map((b, idx) => (
                <div key={`${b.name}-${idx}`}
                  className={`px-4 py-3 ${idx > 0 ? 'border-t border-[#EEE4D2]' : ''}`}>
                  <p className="font-semibold text-[#6B3F1F]">{b.name}</p>
                  {b.manufacturer && (
                    <p className="text-xs text-[#7A8C7E] mt-0.5">{b.manufacturer}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[#7A8C7E] leading-relaxed mt-4">
              {t('disclaimer', { client: data.client_name || '' })}
            </p>
          </>
        )}
      </div>
      <BottomNav color="#3A7D44" />
    </div>
  )
}
