/*
 * Purchase-brand picker sheet (v2 Checkbox 3 follow-up 2026-09-22).
 *
 * Opens when a farmer taps "I've purchased this" on an INPUT
 * practice card in Advisory-Only Mode (pure + hybrid). Captures the
 * brand + optional photo of what they actually bought, preventing
 * the silent mis-attribution when the SE authored a recommended
 * (non-locked) brand and the farmer bought a different one.
 *
 * Design choices per 2026-09-22 discussion:
 *   - No pre-selection. Every brand row has equal weight so the app
 *     doesn't visually bias the farmer toward the recommended one.
 *   - Photo is optional but nudged (prominent affordance).
 *   - Free-text "Other" path also submits a MissingBrandReport
 *     (backend, source=FARMER) so SA can close the catalog gap.
 *   - Cancel closes without acking — the "I've purchased this" tick
 *     doesn't happen until Confirm.
 */
'use client'
import { useEffect, useState, useMemo, useRef } from 'react'
import { useTranslations } from 'next-intl'
import api from '@/lib/api'

interface BrandRow {
  cosh_id: string
  name: string
  manufacturer: string | null
}
interface BrandsResponse {
  is_locked: boolean
  locked_brand_name: string | null
  brands: BrandRow[]
  client_name: string
}

interface Props {
  open: boolean
  subscriptionId: string
  practiceId: string
  onCancel: () => void
  onConfirm: (payload: {
    purchased_brand_cosh_id: string | null
    purchased_brand_text: string | null
    purchased_photo_url: string | null
  }) => void
}

export default function PurchaseBrandPickerSheet({
  open, subscriptionId, practiceId, onCancel, onConfirm,
}: Props) {
  const t = useTranslations('purchaseBrandPicker')
  const [loading, setLoading] = useState(true)
  const [brands, setBrands] = useState<BrandRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedCoshId, setSelectedCoshId] = useState<string | null>(null)
  const [otherText, setOtherText] = useState('')
  const [otherMode, setOtherMode] = useState(false)
  const [search, setSearch] = useState('')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    setSelectedCoshId(null)
    setOtherText('')
    setOtherMode(false)
    setPhotoUrl(null)
    setSearch('')
    let cancelled = false
    ;(async () => {
      try {
        const r = await api.get<BrandsResponse>(
          `/farmer/subscriptions/${subscriptionId}/practices/${practiceId}/brands`,
        )
        if (cancelled) return
        setBrands(r.data.brands || [])
      } catch {
        if (!cancelled) setError(t('loadError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, subscriptionId, practiceId, t])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return brands
    return brands.filter(b => {
      const n = (b.name || '').toLowerCase()
      const m = (b.manufacturer || '').toLowerCase()
      return n.includes(q) || m.includes(q)
    })
  }, [brands, search])

  const canConfirm =
    (otherMode && otherText.trim().length > 0)
    || (!otherMode && !!selectedCoshId)

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post<{ url: string }>(
        '/media/upload?folder=purchase-photos', form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      setPhotoUrl(data.url)
    } catch {
      /* silent — user can retry */
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleConfirm() {
    if (submitting || !canConfirm) return
    setSubmitting(true)
    if (otherMode) {
      onConfirm({
        purchased_brand_cosh_id: null,
        purchased_brand_text: otherText.trim(),
        purchased_photo_url: photoUrl,
      })
    } else {
      onConfirm({
        purchased_brand_cosh_id: selectedCoshId,
        purchased_brand_text: null,
        purchased_photo_url: photoUrl,
      })
    }
    // Parent handles closing after its ack POST resolves.
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-bold text-[#6B3F1F]">{t('title')}</h2>
          <button
            onClick={onCancel}
            className="text-slate-500 text-sm px-2 py-1"
            aria-label={t('cancel')}>
            ✕
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="p-4 text-sm text-amber-700">{error}</div>
          ) : (
            <>
              {/* Search bar (hidden in Other mode) */}
              {!otherMode && (
                <div className="p-3 border-b border-slate-100 sticky top-0 bg-white">
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={t('searchPlaceholder')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
                </div>
              )}

              {/* Brand list */}
              {!otherMode && (
                <ul>
                  {filtered.length === 0 && (
                    <li className="px-4 py-6 text-center text-sm text-slate-500">
                      {t('noResults')}
                    </li>
                  )}
                  {filtered.map(b => {
                    const active = selectedCoshId === b.cosh_id
                    return (
                      <li key={b.cosh_id}>
                        <button
                          onClick={() => setSelectedCoshId(active ? null : b.cosh_id)}
                          className="w-full px-4 py-3 flex items-start gap-3 text-left border-b border-slate-100 active:bg-[#F5F0E8]">
                          <span
                            className={`inline-flex items-center justify-center w-6 h-6 rounded-full border shrink-0 mt-0.5 ${
                              active
                                ? 'bg-emerald-600 border-emerald-700 text-white'
                                : 'bg-white border-slate-300 text-transparent'
                            }`}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                            </svg>
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-[#6B3F1F]">{b.name}</p>
                            {b.manufacturer && (
                              <p className="text-xs text-[#7A8C7E] mt-0.5">{b.manufacturer}</p>
                            )}
                          </div>
                        </button>
                      </li>
                    )
                  })}

                  {/* Other affordance at the bottom */}
                  <li>
                    <button
                      onClick={() => { setOtherMode(true); setSelectedCoshId(null) }}
                      className="w-full px-4 py-3 text-left border-b border-slate-100 active:bg-[#F5F0E8]">
                      <p className="text-sm font-medium text-purple-700">
                        + {t('otherLabel')}
                      </p>
                    </button>
                  </li>
                </ul>
              )}

              {/* Other typing mode */}
              {otherMode && (
                <div className="p-4">
                  <button
                    onClick={() => setOtherMode(false)}
                    className="text-xs text-slate-500 mb-3">
                    ← {t('backToList')}
                  </button>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t('otherTypeLabel')}
                  </label>
                  <input
                    type="text"
                    value={otherText}
                    onChange={e => setOtherText(e.target.value)}
                    placeholder={t('otherTypePlaceholder')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
                  <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                    {t('otherHint')}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Photo affordance + Actions */}
        <div className="border-t border-slate-200 p-3 space-y-2 bg-slate-50">
          {/* Photo affordance — nudged but optional */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPickPhoto}
              className="hidden" />
            {photoUrl ? (
              <div className="flex items-center gap-2 text-xs text-emerald-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="" className="w-10 h-10 object-cover rounded" />
                <span className="flex-1">{t('photoAttached')}</span>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] text-slate-600 underline">
                  {t('photoRetake')}
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-700 active:bg-slate-100 disabled:opacity-60">
                <span>📷</span>
                <span>{uploading ? t('photoUploading') : t('addPhoto')}</span>
              </button>
            )}
          </div>

          {/* Confirm */}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || submitting || uploading}
            className="w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
            style={{ background: '#3A7D44' }}>
            {submitting ? t('submitting') : t('confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
