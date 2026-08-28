'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken, refreshUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import RoleSwitcherDrawer from '@/components/RoleSwitcherDrawer'
import api from '@/lib/api'
import { digitsOnly } from '@/lib/input-normalization'

// What the dealer can sell. Each row carries a regulatory note for
// the dealer's benefit, but RootsTalk does not collect proof of
// licence — that's the responsibility of the company (client) the
// dealer is supplying to. Seeds vs Seedlings is a real regulatory
// split: seed dealers in India need a Seeds Control Order licence;
// nursery / seedling traders do not.
// Label + note resolved at render time via t() so they switch on
// locale change. Keep the static `id` for backend payload + state.
const SELL_CATEGORY_IDS = ['SEEDS', 'SEEDLINGS', 'PESTICIDES', 'FERTILISERS'] as const
type SellCategoryId = typeof SELL_CATEGORY_IDS[number]
const SELL_CATEGORY_KEYS: Record<SellCategoryId, { label: string; note: string }> = {
  SEEDS: { label: 'sellCategories.seedsLabel', note: 'sellCategories.seedsNote' },
  SEEDLINGS: { label: 'sellCategories.seedlingsLabel', note: 'sellCategories.seedlingsNote' },
  PESTICIDES: { label: 'sellCategories.pesticidesLabel', note: 'sellCategories.pesticidesNote' },
  FERTILISERS: { label: 'sellCategories.fertilisersLabel', note: 'sellCategories.fertilisersNote' },
}

type FormState = {
  shop_name: string
  shop_address: string
  sell_categories: string[]
  shop_gps_lat: number | null
  shop_gps_lng: number | null
  shop_registration_url: string
  shop_photo_url: string
  // 2026-08-21 — Payment UPI v1. When upi_vpa is set, the farmer's
  // approval / pickup / packing surfaces render a "Pay via UPI"
  // button that opens a `upi://pay?pa=<upi_vpa>&...` intent link.
  // upi_phone is optional (UPI-linked phone if different from login).
  // payment_display_name is what the farmer sees in their UPI app;
  // defaults to shop_name when blank.
  upi_vpa: string
  upi_phone: string
  payment_display_name: string
}

// Local-only — not persisted. Captured once per geolocation call
// so we can show the dealer how precise the reading was and warn
// them to step outside / retry if the device only managed a
// wifi-based fix.
const GPS_ACCURACY_GOOD_METRES = 30
const GPS_ACCURACY_POOR_METRES = 100

function isImageUrl(url: string): boolean {
  return /\.(jpe?g|png|gif|webp|avif|bmp)(\?|$)/i.test(url)
}

export default function DealerProfilePage() {
  const router = useRouter()
  const t = useTranslations('dealer.profile')
  const [, setProfile] = useState<unknown>(null)
  const [form, setForm] = useState<FormState>({
    shop_name: '',
    shop_address: '',
    sell_categories: [],
    shop_gps_lat: null,
    shop_gps_lng: null,
    shop_registration_url: '',
    shop_photo_url: '',
    upi_vpa: '',
    upi_phone: '',
    payment_display_name: '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null)
  const [gpsAutoSaved, setGpsAutoSaved] = useState(false)
  const [uploadingField, setUploadingField] = useState<string | null>(null)
  const [showRoleDrawer, setShowRoleDrawer] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Separate file inputs per surface — camera-capture vs library.
  const certRef = useRef<HTMLInputElement>(null)
  const photoCameraRef = useRef<HTMLInputElement>(null)
  const photoLibraryRef = useRef<HTMLInputElement>(null)

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
        shop_registration_url: r.data.shop_registration_url || '',
        shop_photo_url: r.data.shop_photo_url || '',
        upi_vpa: r.data.upi_vpa || '',
        upi_phone: r.data.upi_phone || '',
        payment_display_name: r.data.payment_display_name || '',
      })
    }).catch(() => {})
  }, [router])

  function toggleCategory(id: string) {
    setForm(f => ({
      ...f,
      sell_categories: f.sell_categories.includes(id)
        ? f.sell_categories.filter(c => c !== id)
        : [...f.sell_categories, id],
    }))
  }

  // Mirrors the missingFields check below — the auto-save on
  // recapture skips the PUT when any mandatory field is missing
  // (the backend would 422 and the dealer wouldn't see it).
  function isProfileCompleteFor(f: FormState): boolean {
    return !!(
      f.shop_name.trim() &&
      f.shop_address.trim() &&
      f.sell_categories.length > 0 &&
      f.shop_gps_lat != null && f.shop_gps_lng != null &&
      f.shop_registration_url.trim() &&
      f.shop_photo_url.trim()
    )
  }

  function captureShopGps() {
    if (!navigator.geolocation) return
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      async pos => {
        // Compose the new form inline so both the state update AND
        // the auto-save PUT see the fresh coords (setForm is async).
        const nextForm: FormState = {
          ...form,
          shop_gps_lat: pos.coords.latitude,
          shop_gps_lng: pos.coords.longitude,
        }
        setForm(nextForm)
        // coords.accuracy is the 68% confidence radius in metres
        // per W3C Geolocation. We surface it so the dealer can
        // judge whether to retry from outdoors. The reading isn't
        // persisted — accuracy is a per-capture quality signal,
        // not a stored attribute of the shop.
        setGpsAccuracy(typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null)
        setGpsLoading(false)
        // Auto-save if the rest of the profile is already complete.
        // Dealers were repeatedly recapturing GPS then forgetting to
        // tap Save at the bottom of the scroll — silent save fixes
        // it without changing behaviour when other fields are still
        // pending (in which case the Save button gates it as before).
        if (isProfileCompleteFor(nextForm)) {
          try {
            setSaving(true)
            await api.put('/dealer/profile', nextForm)
            setGpsAutoSaved(true)
            setTimeout(() => setGpsAutoSaved(false), 2500)
          } catch { /* swallow — user can retry via Save button */ }
          finally { setSaving(false) }
        }
      },
      () => setGpsLoading(false),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  async function uploadFile(file: File, folder: string, field: keyof FormState) {
    setUploadingField(field as string)
    setUploadError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', folder)
      const { data } = await api.post('/media/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setForm(f => ({ ...f, [field]: data.url || data.file_url || '' }))
    } catch (err: unknown) {
      // Surface the backend message (typically a 422 with a clear
      // hint about content type or size). Silent-fail used to leave
      // the user staring at an unchanged button with no idea why.
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message || t('uploadFailedFallback')
      setUploadError(msg)
    } finally {
      setUploadingField(null)
    }
  }

  async function save() {
    // Defence in depth — the button is disabled, but a fast tap
    // before the disabled prop applies shouldn't sneak through.
    if (
      !form.shop_name.trim() ||
      !form.shop_address.trim() ||
      form.sell_categories.length === 0 ||
      form.shop_gps_lat == null || form.shop_gps_lng == null ||
      !form.shop_registration_url.trim() ||
      !form.shop_photo_url.trim()
    ) return
    setSaving(true)
    try {
      await api.put('/dealer/profile', form)
      // Refresh cached /auth/me so the right drawer's
      // "Open my Shop / Set up →" flips to "Switch to my Shop"
      // immediately, without waiting for the next page load.
      await refreshUser()
      setSaved(true)
      // Land the dealer on their dashboard — they can now access
      // every dealer feature (dealerships, payment settings, etc.).
      // Actual transactions (incoming orders, payment requests)
      // still require a RootsTalk client to onboard this shop
      // separately; the dashboard surfaces empty lists until then.
      setTimeout(() => router.replace('/dealer/home'), 1200)
    } finally { setSaving(false) }
  }

  const mapHref = form.shop_gps_lat != null && form.shop_gps_lng != null
    ? `https://www.google.com/maps?q=${form.shop_gps_lat},${form.shop_gps_lng}`
    : null

  // Every shop field is mandatory (locked 2026-05-21). Licences
  // are excluded — RootsTalk does not collect those (the company
  // verifies). Missing-field list drives both the Save button
  // disabled state and the redirect-from-home banner.
  const missingFields: string[] = []
  if (!form.shop_photo_url.trim()) missingFields.push(t('missing.shopPhoto'))
  if (!form.shop_name.trim()) missingFields.push(t('missing.shopName'))
  if (!form.shop_address.trim()) missingFields.push(t('missing.shopAddress'))
  if (form.shop_gps_lat == null || form.shop_gps_lng == null) missingFields.push(t('missing.shopGps'))
  if (form.sell_categories.length === 0) missingFields.push(t('missing.whatYouSell'))
  if (!form.shop_registration_url.trim()) missingFields.push(t('missing.shopRegistration'))
  const profileIncomplete = missingFields.length > 0

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER"
        onRoleSwitch={() => setShowRoleDrawer(true)} back="/dealer/home" />
      <div className="pt-16 pb-24 px-4 space-y-5 max-w-lg mx-auto">

        {/* Missing-fields banner — visible whenever any required
            field is still empty. Doubles as the redirect target
            from /dealer/home; the home page won't let the user
            in until profileIncomplete is false. The "Not now"
            link is the explicit escape hatch for users who tapped
            "Open my Shop" out of curiosity — without it, the
            redirect would trap them. */}
        {profileIncomplete && (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="font-semibold text-amber-800 text-sm">{t('missing.title')}</p>
            <p className="text-xs text-amber-700 mt-1">
              {t('missing.body')}
            </p>
            <ul className="mt-2 text-xs text-amber-700 list-disc list-inside">
              {missingFields.map(f => <li key={f}>{f}</li>)}
            </ul>
            <button onClick={() => router.replace('/home')}
              className="mt-3 text-xs underline text-amber-800 font-medium">
              {t('missing.notNow')}
            </button>
          </div>
        )}

        {/* 1. Shop Photograph — moved to the top because the photo is
            what farmers and facilitators use to recognise the shop on
            the ground. They see it first in dealer lists; we ask the
            dealer to capture it first too. Either the camera or the
            gallery can be the source. */}
        <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-5 space-y-3">
          <div>
            <h2 className="font-semibold text-[#6B3F1F]">{t('photoCard.title')}</h2>
            <p className="text-xs text-[#7A8C7E] mt-0.5">
              {t('photoCard.hint')}
            </p>
          </div>
          <input ref={photoCameraRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) uploadFile(f, 'dealer-photos', 'shop_photo_url')
            }} />
          <input ref={photoLibraryRef} type="file" accept="image/*" className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) uploadFile(f, 'dealer-photos', 'shop_photo_url')
            }} />
          {form.shop_photo_url ? (
            <div className="flex items-center gap-3 bg-[#F5F0E8] rounded-xl p-3">
              <img src={form.shop_photo_url} alt={t('photoCard.uploadedAlt')}
                className="w-14 h-14 rounded-lg object-cover border border-[#DDD0B8] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#7D4196]">{t('photoCard.uploaded')}</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => photoCameraRef.current?.click()}
                  className="text-xs text-[#7A8C7E] border border-[#DDD0B8] rounded-lg px-2 py-1.5">📷</button>
                <button onClick={() => photoLibraryRef.current?.click()}
                  className="text-xs text-[#7A8C7E] border border-[#DDD0B8] rounded-lg px-2 py-1.5">📁</button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => photoCameraRef.current?.click()} disabled={uploadingField === 'shop_photo_url'}
                className="py-3 rounded-xl border-2 border-dashed border-[#DDD0B8] text-sm text-[#7A8C7E] font-medium">
                {t('photoCard.takePhoto')}
              </button>
              <button onClick={() => photoLibraryRef.current?.click()} disabled={uploadingField === 'shop_photo_url'}
                className="py-3 rounded-xl border-2 border-dashed border-[#DDD0B8] text-sm text-[#7A8C7E] font-medium">
                {t('photoCard.uploadPicture')}
              </button>
            </div>
          )}
          {uploadingField === 'shop_photo_url' && (
            <p className="text-xs text-[#7A8C7E]">{t('photoCard.uploading')}</p>
          )}
        </div>

        {/* 2. Shop Details — name + postal address. */}
        <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-[#6B3F1F]">{t('detailsCard.title')}</h2>
            <p className="text-xs text-[#7A8C7E] mt-0.5">
              {t('detailsCard.hint')}
            </p>
          </div>
          <div>
            <label className="block text-xs text-[#7A8C7E] mb-1">{t('detailsCard.shopName')}</label>
            <input value={form.shop_name}
              onChange={e => setForm(f => ({ ...f, shop_name: e.target.value }))}
              placeholder={t('detailsCard.shopNamePlaceholder')}
              className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#7D4196]/20" />
          </div>
          <div>
            <label className="block text-xs text-[#7A8C7E] mb-1">{t('detailsCard.shopAddress')}</label>
            <textarea value={form.shop_address}
              onChange={e => setForm(f => ({ ...f, shop_address: e.target.value }))}
              rows={2} placeholder={t('detailsCard.shopAddressPlaceholder')}
              className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#7D4196]/20 resize-none" />
          </div>
        </div>

        {/* 3. Shop Location (GPS) — accuracy matters because farmers
            and facilitators use this to navigate to the shop. Stand
            at the entrance for the best fix; if accuracy is poor
            (wifi-based indoor reading), prompt a retry from outside. */}
        <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 space-y-3">
          <div>
            <h2 className="font-semibold text-[#6B3F1F]">{t('gpsCard.title')}</h2>
            <p className="text-xs text-[#7A8C7E] mt-0.5">
              {t('gpsCard.hintPrefix')} <span className="font-semibold">{t('gpsCard.hintEmphasis')}</span> {t('gpsCard.hintSuffix')}
            </p>
          </div>
          {form.shop_gps_lat !== null && form.shop_gps_lng !== null ? (
            <>
              <div className="bg-[#F5F0E8] rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-[#7A8C7E] font-mono">
                    {form.shop_gps_lat.toFixed(6)}, {form.shop_gps_lng.toFixed(6)}
                  </p>
                  <p className="text-xs text-[#7D4196] mt-0.5">{t('gpsCard.captured')}</p>
                </div>
                <button onClick={captureShopGps} disabled={gpsLoading || saving}
                  className="text-xs text-[#7A8C7E] border border-[#DDD0B8] rounded-lg px-3 py-1.5">
                  {gpsLoading ? t('gpsCard.gettingShort') : t('gpsCard.recapture')}
                </button>
              </div>
              {gpsAutoSaved && (
                <p className="text-xs text-green-700 mt-1">{t('gpsCard.autoSaved')}</p>
              )}
              {gpsAccuracy != null && (() => {
                const m = Math.round(gpsAccuracy)
                const good = m <= GPS_ACCURACY_GOOD_METRES
                const poor = m > GPS_ACCURACY_POOR_METRES
                const tone = good
                  ? 'bg-green-50 border-green-200 text-green-800'
                  : poor
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-yellow-50 border-yellow-200 text-yellow-800'
                return (
                  <div className={`text-xs border rounded-xl px-3 py-2 ${tone}`}>
                    {good && t('gpsCard.accuracyGood', { metres: m })}
                    {!good && !poor && t('gpsCard.accuracyOk', { metres: m })}
                    {poor && t('gpsCard.accuracyPoor', { metres: m })}
                  </div>
                )
              })()}
              {mapHref && (
                <a href={mapHref} target="_blank" rel="noopener noreferrer"
                  className="block w-full text-center py-2.5 rounded-xl border border-[#DDD0B8] text-sm font-medium text-[#7D4196]">
                  {t('gpsCard.viewMap')}
                </a>
              )}
            </>
          ) : (
            <button onClick={captureShopGps} disabled={gpsLoading}
              className="w-full py-3.5 rounded-xl border-2 border-dashed border-[#DDD0B8] text-sm text-[#7A8C7E] font-medium flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/>
              </svg>
              {gpsLoading ? t('gpsCard.gettingFull') : t('gpsCard.capture')}
            </button>
          )}
        </div>

        {/* 4. What Do You Sell? */}
        <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 space-y-3">
          <div>
            <h2 className="font-semibold text-[#6B3F1F]">{t('sellCard.title')}</h2>
            <p className="text-xs text-[#7A8C7E] mt-0.5">
              {t('sellCard.hint')}
            </p>
          </div>
          {SELL_CATEGORY_IDS.map(catId => {
            const selected = form.sell_categories.includes(catId)
            const keys = SELL_CATEGORY_KEYS[catId]
            return (
              <button key={catId}
                onClick={() => toggleCategory(catId)}
                className={`w-full flex items-center justify-between p-4 rounded-xl border-2 text-left transition-all ${
                  selected ? 'border-[#7D4196] bg-[#7D4196]/5' : 'border-[#DDD0B8] bg-white'
                }`}>
                <div>
                  <p className={`text-sm font-semibold ${selected ? 'text-[#7D4196]' : 'text-[#6B3F1F]'}`}>
                    {t(keys.label)}
                  </p>
                  <p className="text-xs text-[#7A8C7E] mt-0.5">{t(keys.note)}</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  selected ? 'border-[#7D4196] bg-[#7D4196]' : 'border-[#DDD0B8]'
                }`}>
                  {selected && <span className="text-white text-xs font-bold">✓</span>}
                </div>
              </button>
            )
          })}
        </div>

        {/* 5. Shop Registration Certificate — separate card.
            Anti-fraud purpose: helps RootsTalk verify a shop is a
            real registered business before companies onboard it.
            We do not verify the document ourselves; it sits with
            the dealer's record for the company (client) to review
            during their own dealer-vetting process. */}
        <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 space-y-3">
          <div>
            <h2 className="font-semibold text-[#6B3F1F]">{t('certCard.title')}</h2>
            <p className="text-xs text-[#7A8C7E] mt-0.5">
              {t('certCard.hint')}
            </p>
          </div>
          <input ref={certRef} type="file" accept="image/*,.pdf" className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) uploadFile(f, 'dealer-docs', 'shop_registration_url')
            }} />
          {form.shop_registration_url ? (
            <div className="flex items-center gap-3 bg-[#F5F0E8] rounded-xl p-3">
              {isImageUrl(form.shop_registration_url) ? (
                <img src={form.shop_registration_url} alt={t('certCard.uploadedAlt')}
                  className="w-14 h-14 rounded-lg object-cover border border-[#DDD0B8] shrink-0" />
              ) : (
                <div className="w-14 h-14 rounded-lg border border-[#DDD0B8] bg-white flex items-center justify-center shrink-0">
                  <span className="text-2xl">📄</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#7D4196]">{t('certCard.uploaded')}</p>
                <a href={form.shop_registration_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-[#7A8C7E] underline truncate block">{t('certCard.viewDocument')}</a>
              </div>
              <button onClick={() => certRef.current?.click()}
                className="text-xs text-[#7A8C7E] border border-[#DDD0B8] rounded-lg px-3 py-1.5 shrink-0">
                {uploadingField === 'shop_registration_url' ? t('certCard.uploading') : t('certCard.change')}
              </button>
            </div>
          ) : (
            <button onClick={() => certRef.current?.click()} disabled={uploadingField === 'shop_registration_url'}
              className="w-full py-3.5 rounded-xl border-2 border-dashed border-[#DDD0B8] text-sm text-[#7A8C7E] font-medium">
              {uploadingField === 'shop_registration_url' ? t('certCard.uploading') : t('certCard.upload')}
            </button>
          )}
        </div>

        {uploadError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <p className="font-semibold">{t('uploadError.title')}</p>
            <p className="text-xs mt-1">{uploadError}</p>
          </div>
        )}

        {/* 2026-08-21 — Payment UPI v1 setup. Optional at profile
            completeness (dealer can skip if not offering UPI yet).
            When upi_vpa is set, farmers see "Pay via UPI" on their
            approval / pickup cards for this dealer's orders. */}
        <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 space-y-3">
          <div>
            <h2 className="font-semibold text-[#6B3F1F]">Payment (UPI)</h2>
            <p className="text-xs text-[#7A8C7E] mt-0.5">
              Enter your UPI address so farmers can pay you through their
              UPI app. Optional — leave blank if you don&apos;t use UPI yet.
            </p>
          </div>
          <div>
            <label className="block text-xs text-[#7A8C7E] mb-1 font-medium">
              UPI ID / VPA (e.g. name@bank)
            </label>
            <input value={form.upi_vpa}
              onChange={e => setForm(f => ({ ...f, upi_vpa: e.target.value }))}
              placeholder="yourname@upi"
              className="w-full text-sm border border-[#DDD0B8] rounded-xl px-3 py-2.5"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false} />
          </div>
          <div>
            <label className="block text-xs text-[#7A8C7E] mb-1 font-medium">
              UPI-linked phone (optional)
            </label>
            <input value={form.upi_phone}
              onChange={e => setForm(f => ({ ...f, upi_phone: digitsOnly(e.target.value, 10) }))}
              placeholder="Only if different from your login phone"
              inputMode="tel"
              className="w-full text-sm border border-[#DDD0B8] rounded-xl px-3 py-2.5" />
          </div>
          <div>
            <label className="block text-xs text-[#7A8C7E] mb-1 font-medium">
              Display name (optional)
            </label>
            <input value={form.payment_display_name}
              onChange={e => setForm(f => ({ ...f, payment_display_name: e.target.value }))}
              placeholder={form.shop_name || 'What the farmer sees in their UPI app'}
              className="w-full text-sm border border-[#DDD0B8] rounded-xl px-3 py-2.5" />
            <p className="text-[10px] text-[#7A8C7E] mt-1">
              Leave blank to use your shop name.
            </p>
          </div>
        </div>

        <button onClick={save} disabled={saving || profileIncomplete}
          className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-40 transition-opacity"
          style={{ background: 'linear-gradient(135deg, #054a3a, #7D4196)' }}>
          {saving ? t('save.saving') : saved ? t('save.saved') : profileIncomplete ? t('save.pending', { count: missingFields.length }) : t('save.ready')}
        </button>
      </div>

      <RoleSwitcherDrawer
        open={showRoleDrawer}
        onClose={() => setShowRoleDrawer(false)}
        onSwitch={() => setShowRoleDrawer(false)}
        activeRole="DEALER"
      />
    </div>
  )
}
