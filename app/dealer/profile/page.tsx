'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

const SELL_CATEGORIES = [
  { id: 'SEEDS', label: 'Seeds / Seedlings', licence: false, note: 'No licence required' },
  { id: 'PESTICIDES', label: 'Pesticides', licence: true, note: 'Pesticide licence required' },
  { id: 'FERTILISERS', label: 'Fertilisers', licence: true, note: 'Fertiliser licence required' },
]

type FormState = {
  shop_name: string
  shop_address: string
  sell_categories: string[]
  shop_gps_lat: number | null
  shop_gps_lng: number | null
  shop_certificate_url: string
  shop_photo_url: string
  pesticide_licence_url: string
  fertiliser_licence_url: string
}

export default function DealerProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<any>(null)
  const [form, setForm] = useState<FormState>({
    shop_name: '',
    shop_address: '',
    sell_categories: [],
    shop_gps_lat: null,
    shop_gps_lng: null,
    shop_certificate_url: '',
    shop_photo_url: '',
    pesticide_licence_url: '',
    fertiliser_licence_url: '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [uploadingField, setUploadingField] = useState<string | null>(null)

  // File input refs
  const certRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const pesticideLicRef = useRef<HTMLInputElement>(null)
  const fertiliserLicRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get('/dealer/profile').then(r => {
      setProfile(r.data)
      setForm({
        shop_name: r.data.shop_name || '',
        shop_address: r.data.shop_address || '',
        sell_categories: r.data.sell_categories || [],
        shop_gps_lat: r.data.shop_gps_lat ?? null,
        shop_gps_lng: r.data.shop_gps_lng ?? null,
        shop_certificate_url: r.data.shop_certificate_url || '',
        shop_photo_url: r.data.shop_photo_url || '',
        pesticide_licence_url: r.data.pesticide_licence_url || '',
        fertiliser_licence_url: r.data.fertiliser_licence_url || '',
      })
    }).catch(() => {})
  }, [])

  function toggleCategory(id: string) {
    setForm(f => ({
      ...f,
      sell_categories: f.sell_categories.includes(id)
        ? f.sell_categories.filter(c => c !== id)
        : [...f.sell_categories, id],
    }))
  }

  function captureShopGps() {
    if (!navigator.geolocation) return
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setForm(f => ({
          ...f,
          shop_gps_lat: pos.coords.latitude,
          shop_gps_lng: pos.coords.longitude,
        }))
        setGpsLoading(false)
      },
      () => setGpsLoading(false),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  async function uploadFile(file: File, folder: string, field: keyof FormState) {
    setUploadingField(field)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', folder)
      const { data } = await api.post('/media/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setForm(f => ({ ...f, [field]: data.url || data.file_url || '' }))
    } catch {
      // silently fail; user can retry
    } finally {
      setUploadingField(null)
    }
  }

  async function save() {
    if (!form.shop_name.trim()) return
    if (form.sell_categories.length === 0) return
    setSaving(true)
    try {
      await api.put('/dealer/profile', form)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  const needsPesticideLic = form.sell_categories.includes('PESTICIDES')
  const needsFertiliserLic = form.sell_categories.includes('FERTILISERS')

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Dealer Profile" activeRole="DEALER" />
      <div className="pt-16 pb-24 px-4 space-y-5 max-w-lg mx-auto">

        {/* Shop Details */}
        <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Shop Details</h2>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Shop Name *</label>
            <input value={form.shop_name}
              onChange={e => setForm(f => ({ ...f, shop_name: e.target.value }))}
              placeholder="Your shop name"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#085041]/20" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Shop Address</label>
            <textarea value={form.shop_address}
              onChange={e => setForm(f => ({ ...f, shop_address: e.target.value }))}
              rows={2} placeholder="Full address"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#085041]/20 resize-none" />
          </div>
        </div>

        {/* Shop Location (GPS) */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
          <h2 className="font-semibold text-slate-800">Shop Location</h2>
          <p className="text-xs text-slate-400">Capture the GPS coordinates of your shop for order routing.</p>
          {form.shop_gps_lat !== null && form.shop_gps_lng !== null ? (
            <div className="bg-slate-50 rounded-xl px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 font-mono">
                  {form.shop_gps_lat.toFixed(6)}, {form.shop_gps_lng.toFixed(6)}
                </p>
                <p className="text-xs text-[#085041] mt-0.5">Location captured</p>
              </div>
              <button onClick={captureShopGps} disabled={gpsLoading}
                className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5">
                {gpsLoading ? 'Getting…' : 'Recapture'}
              </button>
            </div>
          ) : (
            <button onClick={captureShopGps} disabled={gpsLoading}
              className="w-full py-3.5 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-500 font-medium flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/>
              </svg>
              {gpsLoading ? 'Getting location…' : 'Capture Shop GPS'}
            </button>
          )}
        </div>

        {/* What Do You Sell */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
          <div>
            <h2 className="font-semibold text-slate-800">What Do You Sell? *</h2>
            <p className="text-xs text-slate-400 mt-0.5">Select all that apply. Orders are routed based on your selection.</p>
          </div>
          {SELL_CATEGORIES.map(cat => {
            const selected = form.sell_categories.includes(cat.id)
            return (
              <button key={cat.id}
                onClick={() => toggleCategory(cat.id)}
                className={`w-full flex items-center justify-between p-4 rounded-xl border-2 text-left transition-all ${
                  selected ? 'border-[#085041] bg-[#085041]/5' : 'border-slate-200 bg-white'
                }`}>
                <div>
                  <p className={`text-sm font-semibold ${selected ? 'text-[#085041]' : 'text-slate-700'}`}>
                    {cat.label}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{cat.note}</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  selected ? 'border-[#085041] bg-[#085041]' : 'border-slate-300'
                }`}>
                  {selected && <span className="text-white text-xs font-bold">✓</span>}
                </div>
              </button>
            )
          })}
        </div>

        {/* Licences (conditional) */}
        {(needsPesticideLic || needsFertiliserLic) && (
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
            <h2 className="font-semibold text-slate-800">Licences</h2>
            <p className="text-xs text-slate-400">Upload copies of your relevant licences.</p>

            {needsPesticideLic && (
              <div>
                <label className="block text-xs text-slate-500 mb-2">Pesticide Licence</label>
                <input ref={pesticideLicRef} type="file" accept="image/*,.pdf" className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) uploadFile(f, 'dealer-licences', 'pesticide_licence_url')
                  }} />
                {form.pesticide_licence_url ? (
                  <div className="flex items-center gap-3">
                    <img src={form.pesticide_licence_url} alt="Pesticide licence"
                      className="w-16 h-16 rounded-xl object-cover border border-slate-200" />
                    <button onClick={() => pesticideLicRef.current?.click()}
                      className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5">
                      {uploadingField === 'pesticide_licence_url' ? 'Uploading…' : 'Change'}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => pesticideLicRef.current?.click()} disabled={uploadingField === 'pesticide_licence_url'}
                    className="w-full py-3.5 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-500 font-medium">
                    {uploadingField === 'pesticide_licence_url' ? 'Uploading…' : 'Upload Pesticide Licence'}
                  </button>
                )}
              </div>
            )}

            {needsFertiliserLic && (
              <div>
                <label className="block text-xs text-slate-500 mb-2">Fertiliser Licence</label>
                <input ref={fertiliserLicRef} type="file" accept="image/*,.pdf" className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) uploadFile(f, 'dealer-licences', 'fertiliser_licence_url')
                  }} />
                {form.fertiliser_licence_url ? (
                  <div className="flex items-center gap-3">
                    <img src={form.fertiliser_licence_url} alt="Fertiliser licence"
                      className="w-16 h-16 rounded-xl object-cover border border-slate-200" />
                    <button onClick={() => fertiliserLicRef.current?.click()}
                      className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5">
                      {uploadingField === 'fertiliser_licence_url' ? 'Uploading…' : 'Change'}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => fertiliserLicRef.current?.click()} disabled={uploadingField === 'fertiliser_licence_url'}
                    className="w-full py-3.5 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-500 font-medium">
                    {uploadingField === 'fertiliser_licence_url' ? 'Uploading…' : 'Upload Fertiliser Licence'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Shop Documents */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Shop Documents</h2>

          {/* Registration Certificate */}
          <div>
            <label className="block text-xs text-slate-500 mb-2">Shop Registration Certificate</label>
            <input ref={certRef} type="file" accept="image/*,.pdf" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) uploadFile(f, 'dealer-docs', 'shop_certificate_url')
              }} />
            {form.shop_certificate_url ? (
              <div className="flex items-center gap-3">
                <img src={form.shop_certificate_url} alt="Certificate"
                  className="w-16 h-16 rounded-xl object-cover border border-slate-200" />
                <button onClick={() => certRef.current?.click()}
                  className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5">
                  {uploadingField === 'shop_certificate_url' ? 'Uploading…' : 'Change'}
                </button>
              </div>
            ) : (
              <button onClick={() => certRef.current?.click()} disabled={uploadingField === 'shop_certificate_url'}
                className="w-full py-3.5 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-500 font-medium">
                {uploadingField === 'shop_certificate_url' ? 'Uploading…' : 'Upload Certificate'}
              </button>
            )}
          </div>

          {/* Shop Photograph */}
          <div>
            <label className="block text-xs text-slate-500 mb-2">Shop Photograph</label>
            <input ref={photoRef} type="file" accept="image/*" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) uploadFile(f, 'dealer-photos', 'shop_photo_url')
              }} />
            {form.shop_photo_url ? (
              <div className="flex items-center gap-3">
                <img src={form.shop_photo_url} alt="Shop photo"
                  className="w-16 h-16 rounded-xl object-cover border border-slate-200" />
                <button onClick={() => photoRef.current?.click()}
                  className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5">
                  {uploadingField === 'shop_photo_url' ? 'Uploading…' : 'Change'}
                </button>
              </div>
            ) : (
              <button onClick={() => photoRef.current?.click()} disabled={uploadingField === 'shop_photo_url'}
                className="w-full py-3.5 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-500 font-medium">
                {uploadingField === 'shop_photo_url' ? 'Uploading…' : 'Upload Shop Photo'}
              </button>
            )}
          </div>
        </div>

        <button onClick={save} disabled={saving || !form.shop_name.trim() || form.sell_categories.length === 0}
          className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-40 transition-opacity"
          style={{ background: 'linear-gradient(135deg, #054a3a, #085041)' }}>
          {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Profile'}
        </button>
      </div>
    </div>
  )
}
