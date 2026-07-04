'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface BrandForm {
  id: string
  brand_name_reported: string
  manufacturer_name: string | null
  l1_type: string | null
  l2_practice: string | null
  additional_info: string | null
  photos: string[]
  status: 'PENDING' | 'REVIEWED' | 'APPROVED' | 'REJECTED' | string
  cm_notes: string | null
  reviewed_at: string | null
  created_at: string
  dealer_seen_status_at: string | null
}

const COLOUR = '#7D4196'

function humaniseType(v: string | null): string {
  if (!v) return ''
  return v.toLowerCase().split('_').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ')
}

export default function DealerBrandFormsPage() {
  const router = useRouter()
  const t = useTranslations('dealer.brandForms')
  const [forms, setForms] = useState<BrandForm[] | null>(null)
  const [busy, setBusy] = useState<string>('')

  const load = useCallback(() => {
    api.get<BrandForm[]>('/dealer/brand-forms')
      .then(r => setForms(r.data))
      .catch(() => setForms([]))
  }, [])

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [router, load])

  async function markSeen(f: BrandForm) {
    // Only stamp if there's an unseen SA response.
    if (!f.reviewed_at) return
    if (f.dealer_seen_status_at && new Date(f.dealer_seen_status_at) >= new Date(f.reviewed_at)) return
    try { await api.put(`/dealer/brand-forms/${f.id}/mark-seen`) } catch {}
  }

  async function hide(f: BrandForm) {
    if (!confirm(t('confirmHide'))) return
    setBusy(f.id)
    try {
      await api.put(`/dealer/brand-forms/${f.id}/hide`)
      load()
    } finally { setBusy('') }
  }

  const canHide = (f: BrandForm) => f.status === 'APPROVED' || f.status === 'REJECTED'

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('title')} activeRole="DEALER" back="/dealer/home" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        <div className="mt-4 mb-4 flex justify-end">
          <button onClick={() => router.push('/dealer/brand-forms/new')}
            className="text-sm font-semibold text-white px-4 py-2.5 rounded-xl shadow-sm"
            style={{ background: COLOUR }}>
            {t('newCta')}
          </button>
        </div>
        {forms === null && (
          <p className="text-center text-[#7A8C7E] text-sm mt-8">{t('loading')}</p>
        )}
        {forms !== null && forms.length === 0 && (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] p-6 text-center">
            <p className="text-3xl mb-2">🏷️</p>
            <p className="text-sm font-semibold text-[#6B3F1F]">{t('emptyTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mt-1">{t('emptyBody')}</p>
          </div>
        )}
        <div className="space-y-3">
          {forms?.map(f => {
            const unseen = f.reviewed_at && (!f.dealer_seen_status_at
              || new Date(f.dealer_seen_status_at) < new Date(f.reviewed_at))
            const statusLabel = f.status === 'APPROVED' ? t('statusIncluded')
              : f.status === 'REJECTED' ? t('statusRejected')
              : t('statusSubmitted')
            const statusColour = f.status === 'APPROVED' ? 'bg-green-100 text-green-700'
              : f.status === 'REJECTED' ? 'bg-red-100 text-red-600'
              : 'bg-amber-100 text-amber-700'
            return (
              <div key={f.id}
                onClick={() => { if (unseen) markSeen(f) }}
                className="bg-white rounded-2xl border border-[#DDD0B8] p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#6B3F1F]">{f.brand_name_reported}</p>
                    {f.manufacturer_name && (
                      <p className="text-xs text-[#7A8C7E]">{f.manufacturer_name}</p>
                    )}
                    <p className="text-[11px] text-[#7A8C7E] mt-0.5">
                      {humaniseType(f.l1_type)}{f.l1_type && f.l2_practice ? ' · ' : ''}{humaniseType(f.l2_practice)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusColour}`}>
                      {statusLabel}
                    </span>
                    {unseen && <span className="w-2 h-2 rounded-full bg-red-500"/>}
                  </div>
                </div>
                {f.photos.length > 0 && (
                  <div className="flex gap-1.5 overflow-x-auto mb-2">
                    {f.photos.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="h-16 w-16 object-cover rounded-lg border border-[#DDD0B8]" />
                      </a>
                    ))}
                  </div>
                )}
                {f.cm_notes && f.status === 'REJECTED' && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-1">
                    <b>{t('reasonLabel')}: </b>{f.cm_notes}
                  </p>
                )}
                {canHide(f) && (
                  <div className="flex justify-end mt-2">
                    <button onClick={() => hide(f)} disabled={busy === f.id}
                      className="text-xs text-[#7A8C7E] underline disabled:opacity-50">
                      {t('hideCta')}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
    </div>
  )
}
