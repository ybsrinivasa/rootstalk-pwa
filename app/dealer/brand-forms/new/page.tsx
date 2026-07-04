'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

interface L2 { id: string; label: string }
interface L1 { id: string; label: string; l2: L2[] }
interface L0 { id: string; label: string; l1: L1[] }

const COLOUR = '#7D4196'

export default function DealerBrandFormNewPage() {
  const router = useRouter()
  const t = useTranslations('dealer.brandForms.new')
  const [taxonomy, setTaxonomy] = useState<L0[] | null>(null)
  const [l1Type, setL1Type] = useState('')
  const [l2Type, setL2Type] = useState('')
  const [brandName, setBrandName] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<L0[]>('/practice-taxonomy')
      .then(r => setTaxonomy(r.data))
      .catch(() => setTaxonomy([]))
  }, [router])

  // Only INPUT L0 is meaningful for dealers stocking products.
  const inputL0 = (taxonomy || []).find(x => x.id === 'INPUT')
  const l1Options = inputL0?.l1 || []
  const l2Options = l1Options.find(x => x.id === l1Type)?.l2 || []

  async function uploadPhoto(file: File) {
    if (photos.length >= 4) return
    setError('')
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('folder', 'brand-forms')
      const { data } = await api.post<{ url: string }>('/media/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setPhotos(p => [...p, data.url])
    } catch {
      setError(t('photoUploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const canSubmit =
    !!brandName.trim() &&
    !!manufacturer.trim() &&
    !!l1Type &&
    !!l2Type &&
    photos.length >= 2 &&
    photos.length <= 4 &&
    !uploading &&
    !submitting

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true); setError('')
    try {
      await api.post('/dealer/brand-forms', {
        brand_name_reported: brandName.trim(),
        manufacturer_name: manufacturer.trim(),
        l1_type: l1Type,
        l2_practice: l2Type,
        additional_info: notes.trim() || undefined,
        photos,
      })
      router.replace('/dealer/brand-forms')
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail
        : (detail as { message?: string })?.message
      setError(msg || t('submitFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('title')} activeRole="DEALER" back="/dealer/brand-forms" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-5 space-y-4">
          <p className="text-xs text-[#7A8C7E] leading-relaxed">
            {t('intro')}
          </p>

          <div>
            <label className="block text-xs font-semibold text-[#6B3F1F] mb-1">
              {t('l1Label')} <span className="text-[#D4682E]">*</span>
            </label>
            <select value={l1Type}
              onChange={e => { setL1Type(e.target.value); setL2Type('') }}
              className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none">
              <option value="">{t('l1Placeholder')}</option>
              {l1Options.map(l1 => (
                <option key={l1.id} value={l1.id}>{l1.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#6B3F1F] mb-1">
              {t('l2Label')} <span className="text-[#D4682E]">*</span>
            </label>
            <select value={l2Type} onChange={e => setL2Type(e.target.value)}
              disabled={!l1Type}
              className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none disabled:opacity-50">
              <option value="">{t('l2Placeholder')}</option>
              {l2Options.map(l2 => (
                <option key={l2.id} value={l2.id}>{l2.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#6B3F1F] mb-1">
              {t('brandLabel')} <span className="text-[#D4682E]">*</span>
            </label>
            <input value={brandName} onChange={e => setBrandName(e.target.value)}
              placeholder={t('brandPlaceholder')}
              className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2.5 text-sm focus:outline-none" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#6B3F1F] mb-1">
              {t('manufacturerLabel')} <span className="text-[#D4682E]">*</span>
            </label>
            <input value={manufacturer} onChange={e => setManufacturer(e.target.value)}
              placeholder={t('manufacturerPlaceholder')}
              className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2.5 text-sm focus:outline-none" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#6B3F1F] mb-1">
              {t('photosLabel')} <span className="text-[#D4682E]">*</span>
              <span className="text-[11px] text-[#7A8C7E] font-normal ml-1">
                {t('photosHint', { count: photos.length })}
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {photos.map((url, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-28 object-cover rounded-xl border border-[#DDD0B8]" />
                  <button type="button"
                    onClick={() => setPhotos(p => p.filter((_, j) => j !== i))}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs leading-none">×</button>
                </div>
              ))}
              {photos.length < 4 && (
                <label className="h-28 border-2 border-dashed border-[#DDD0B8] rounded-xl flex items-center justify-center cursor-pointer text-xs text-[#7A8C7E] hover:bg-[#F5F0E8]">
                  {uploading ? t('uploading') : t('addPhoto')}
                  <input type="file" accept="image/*" className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) uploadPhoto(f)
                      e.target.value = ''
                    }} />
                </label>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#6B3F1F] mb-1">
              {t('notesLabel')}
            </label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={3} placeholder={t('notesPlaceholder')}
              className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none resize-none" />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button onClick={submit} disabled={!canSubmit}
            className="w-full py-3.5 rounded-2xl text-white font-semibold disabled:opacity-50"
            style={{ background: COLOUR }}>
            {submitting ? t('submitting') : t('submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
