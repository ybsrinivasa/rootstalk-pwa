'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import AvatarLightbox from '@/components/AvatarLightbox'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

interface PromotedFarmer {
  subscription_id: string
  farmer_user_id: string
  farmer_name: string | null
  farmer_phone: string | null
  farmer_photo_url: string | null
  client_id: string
  package_id: string
  status: string
  reference_number: string | null
  crop_start_date: string | null
  crop_cosh_id: string | null
  crop_name: string | null
  farm_area_acres: number | null
  area_unit: string | null
  number_of_plants: number | null
  planting_year: number | null
  // 2026-11-15 — Training Sandbox marker. Rows where this is true
  // get a TRAINING chip + a Remove button (soft-deletes via
  // DELETE /promoter/training-subscriptions/{id}). Non-training
  // rows stay clean to avoid accidental removal of real farmer data.
  is_training: boolean
}

const COLOUR = '#7D4196'

function fmtStartDate(iso: string | null, locale: string): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString(locale, {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch { return null }
}

export default function DealerPromotedFarmersPage() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('dealer.promotedFarmers')
  const [farmers, setFarmers] = useState<PromotedFarmer[]>([])
  const [loading, setLoading] = useState(true)
  // 2026-11-15 — Training per-sub remove confirm + mutation state.
  const [confirmRemove, setConfirmRemove] = useState<PromotedFarmer | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeErr, setRemoveErr] = useState<string | null>(null)

  async function loadFarmers() {
    const r = await api.get<PromotedFarmer[]>('/dealer/promoted-farmers')
    setFarmers(r.data)
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    loadFarmers().finally(() => setLoading(false))
  }, [router])

  async function doRemoveTraining(sub: PromotedFarmer) {
    setRemoveBusy(true); setRemoveErr(null)
    try {
      await api.delete(`/promoter/training-subscriptions/${sub.subscription_id}`)
      setConfirmRemove(null)
      await loadFarmers()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string | { message?: string } } } }
      const detail = e?.response?.data?.detail
      const msg = typeof detail === 'object' ? detail?.message : (detail as string)
      setRemoveErr(msg || t('removeError'))
    } finally {
      setRemoveBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/home" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        <div className="mt-4 mb-3 flex justify-end">
          <button onClick={() => router.push('/dealer/promoter-assign')}
            className="text-sm font-semibold px-4 py-2.5 rounded-xl text-white"
            style={{ background: COLOUR }}>
            {t('assignCta')}
          </button>
        </div>
        {loading ? (
          <div className="mt-4 space-y-3">
            {[1, 2].map(i => <div key={i} className="h-24 bg-white rounded-2xl animate-pulse" />)}
          </div>
        ) : farmers.length === 0 ? (
          <div className="mt-8 text-center py-16">
            <span className="text-4xl">👨‍🌾</span>
            <p className="text-[#7A8C7E] font-medium mt-3">{t('emptyTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mt-1">{t('emptyHint')}</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {farmers.map(f => {
              const crop = cropDisplayName(f.crop_cosh_id, f.crop_name)
              const scaleLabel = f.number_of_plants
                ? t('plantsLabel', { count: f.number_of_plants })
                : (f.farm_area_acres != null
                    ? t('acresLabel', { count: f.farm_area_acres })
                    : null)
              const timeAnchor = f.number_of_plants
                ? (f.planting_year ? t('plantedLabel', { year: f.planting_year }) : null)
                : (f.crop_start_date
                    ? t('startedLabel', { date: fmtStartDate(f.crop_start_date, locale) || '' })
                    : null)
              const detail = [crop, scaleLabel, timeAnchor].filter(Boolean).join(' · ')
              const farmerName = f.farmer_name || t('unknownFarmer')
              return (
                <div
                  key={f.subscription_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/dealer/promoted-farmers/${f.subscription_id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      router.push(`/dealer/promoted-farmers/${f.subscription_id}`)
                    }
                  }}
                  className="block w-full text-left bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm hover:border-[#7D4196] transition-colors cursor-pointer">
                  <div className="flex items-start gap-3">
                    <div onClick={(e) => e.stopPropagation()}>
                      <AvatarLightbox
                        photoUrl={f.farmer_photo_url}
                        name={farmerName}
                        size={48}
                        bgColor={COLOUR + '1A'}
                        textColor={COLOUR}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-[#6B3F1F] truncate flex-1">{farmerName}</p>
                        {f.is_training && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0 uppercase font-bold tracking-wide">
                            {t('trainingChip')}
                          </span>
                        )}
                        {f.status !== 'ACTIVE' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-[#7A8C7E] shrink-0 uppercase font-medium tracking-wide">
                            {f.status}
                          </span>
                        )}
                      </div>
                      {detail && (
                        <p className="text-xs text-[#7A8C7E] mt-1 leading-snug">{detail}</p>
                      )}
                      {f.reference_number && (
                        <p className="text-[11px] font-mono text-[#7A8C7E] mt-1">{f.reference_number}</p>
                      )}
                      {/* Remove-training affordance — only on training rows,
                          scoped to promoter-ownership by the backend. */}
                      {f.is_training && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmRemove(f); setRemoveErr(null) }}
                          className="mt-2 text-[11px] font-semibold px-2.5 py-1 rounded-md border border-red-200 text-[#D4682E] bg-red-50 active:bg-red-100">
                          {t('removeTrainingBtn')}
                        </button>
                      )}
                    </div>
                    {f.farmer_phone && (
                      <a
                        href={`tel:${f.farmer_phone}`}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={t('callBtnAria', { name: farmerName })}
                        className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
                        style={{ background: COLOUR + '14', color: COLOUR, border: `1px solid ${COLOUR}33` }}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/>
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />

      {/* 2026-11-15 — Remove-training confirm modal. */}
      {confirmRemove && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl">
            <p className="text-base font-bold text-[#6B3F1F] mb-2">
              {t('removeConfirmTitle')}
            </p>
            <p className="text-sm text-[#7A8C7E] mb-4">
              {t('removeConfirmBody', { name: confirmRemove.farmer_name || t('unknownFarmer') })}
            </p>
            {removeErr && (
              <p className="text-xs text-[#D4682E] mb-3">{removeErr}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setConfirmRemove(null); setRemoveErr(null) }}
                disabled={removeBusy}
                className="px-3 py-2 text-sm font-medium text-[#7A8C7E] disabled:opacity-50">
                {t('cancelBtn')}
              </button>
              <button
                onClick={() => doRemoveTraining(confirmRemove)}
                disabled={removeBusy}
                className="px-4 py-2 text-sm font-semibold text-white rounded-lg bg-[#D4682E] active:bg-[#B5551E] disabled:opacity-50">
                {removeBusy ? t('removingBtn') : t('removeConfirmBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
