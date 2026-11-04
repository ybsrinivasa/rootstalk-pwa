'use client'
// 2026-11-04 — My Portfolio: certified coaching students build up two
// profiles here.
//
//   Testimonial tab (marketing): photo + short video + written
//   testimonial, each with its own consent flag. RootsTalk may use
//   consented assets on the website / social.
//
//   Hiring tab: employment status (employed-but-looking is allowed —
//   both flags can be true), CV versions (PDF only, 10 MB cap; latest
//   is the one the SA forwards), and a single "share my CV with
//   partner companies" consent flag.
//
// Gating: server-side `_require_certified_student` returns 403 if the
// caller isn't certified. The Profile page probes
// /coaching/me/portfolio-eligible before rendering the entry tile so
// non-students don't see one.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'


interface CV {
  id: string
  file_url: string
  filename: string
  is_latest: boolean
  uploaded_at: string
}
interface Portfolio {
  user_id: string
  photo_url: string | null
  video_url: string | null
  testimonial_text: string | null
  marketing_consent_photo: boolean
  marketing_consent_video: boolean
  marketing_consent_testimonial: boolean
  is_employed: boolean
  employer_name: string | null
  employed_since: string | null   // YYYY-MM-DD
  is_open_to_offers: boolean
  open_to_offers_notes: string | null
  hiring_consent_share_cv: boolean
  cvs: CV[]
  updated_at: string
}


export default function PortfolioPage() {
  const router = useRouter()
  const [tab, setTab] = useState<'testimonial' | 'hiring'>('testimonial')
  const [loading, setLoading] = useState(true)
  const [gatedOut, setGatedOut] = useState(false)
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Local edit buffers. Keep them separate from `portfolio` so a
  // half-typed testimonial survives a background refetch (we don't
  // refetch mid-edit, but defensive).
  const [testimonialText, setTestimonialText] = useState('')
  const [employerName, setEmployerName] = useState('')
  const [employedSince, setEmployedSince] = useState('')
  const [offersNotes, setOffersNotes] = useState('')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true); setError(null)
    try {
      const { data } = await api.get<Portfolio>('/coaching/me/portfolio')
      setPortfolio(data)
      setTestimonialText(data.testimonial_text || '')
      setEmployerName(data.employer_name || '')
      setEmployedSince(data.employed_since || '')
      setOffersNotes(data.open_to_offers_notes || '')
    } catch (e: unknown) {
      const err = e as { response?: { status?: number } }
      if (err?.response?.status === 403) {
        setGatedOut(true)
      } else {
        setError('Could not load your portfolio. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  function flash() {
    setSavedAt(Date.now())
    setTimeout(() => setSavedAt(prev => (prev && Date.now() - prev >= 2500 ? null : prev)), 3000)
  }

  async function saveMarketing(patch: Partial<Portfolio>) {
    if (!portfolio) return
    setSaving(true); setError(null)
    try {
      const { data } = await api.put<Portfolio>(
        '/coaching/me/portfolio/marketing', patch,
      )
      setPortfolio(data)
      flash()
    } catch {
      setError('Save failed. Please check your connection and try again.')
    } finally { setSaving(false) }
  }

  async function saveEmployment(patch: Partial<Portfolio>) {
    if (!portfolio) return
    setSaving(true); setError(null)
    try {
      const { data } = await api.put<Portfolio>(
        '/coaching/me/portfolio/employment', patch,
      )
      setPortfolio(data)
      flash()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail || 'Save failed. Please try again.')
    } finally { setSaving(false) }
  }

  async function uploadAsset(file: File, kind: 'photo' | 'video') {
    setSaving(true); setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post<{ url: string }>(
        `/coaching/me/portfolio/upload?asset_type=${kind}`, form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      await saveMarketing(
        kind === 'photo' ? { photo_url: data.url } : { video_url: data.url },
      )
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail || `Could not upload your ${kind}.`)
      setSaving(false)
    }
  }

  async function uploadCV(file: File) {
    setSaving(true); setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      await api.post('/coaching/me/portfolio/cv', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      await load()
      flash()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail || 'Could not upload your CV.')
    } finally { setSaving(false) }
  }

  async function deleteCV(id: string) {
    if (!confirm('Delete this CV version?')) return
    setSaving(true); setError(null)
    try {
      await api.delete(`/coaching/me/portfolio/cv/${id}`)
      await load()
    } catch {
      setError('Could not delete that CV.')
    } finally { setSaving(false) }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDF6E3] pb-24">
        <PWAHeader back={true} title="My Portfolio" />
        <p className="px-5 pt-5 text-sm text-[#7A8C7E]">Loading…</p>
        <BottomNav />
      </div>
    )
  }
  if (gatedOut) {
    return (
      <div className="min-h-screen bg-[#FDF6E3] pb-24">
        <PWAHeader back={true} title="My Portfolio" />
        <div className="px-5 pt-8 max-w-md mx-auto text-center">
          <h1 className="text-xl font-bold text-[#6B3F1F] mb-2">
            Available after certification
          </h1>
          <p className="text-sm text-[#7A8C7E]">
            The portfolio is a space to share your coaching testimonial and CV with
            RootsTalk and partner companies. It opens up once you complete your
            coaching session and your coach certifies you.
          </p>
        </div>
        <BottomNav />
      </div>
    )
  }
  if (!portfolio) {
    return (
      <div className="min-h-screen bg-[#FDF6E3] pb-24">
        <PWAHeader back={true} title="My Portfolio" />
        <p className="px-5 pt-5 text-sm text-red-600">{error}</p>
        <BottomNav />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FDF6E3] pb-24">
      <PWAHeader back={true} title="My Portfolio" />
      <div className="px-4 pt-3">
        <p className="text-xs text-[#7A8C7E] mb-3 leading-relaxed">
          Share a testimonial RootsTalk can use on our website, and upload your CV
          for us to forward to partner companies.
        </p>
        {/* Tabs */}
        <div className="flex gap-2 bg-white border border-[#DDD0B8] rounded-xl p-1">
          <button onClick={() => setTab('testimonial')}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg ${
              tab === 'testimonial'
                ? 'bg-emerald-600 text-white'
                : 'text-[#6B3F1F]'
            }`}>
            Testimonial
          </button>
          <button onClick={() => setTab('hiring')}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg ${
              tab === 'hiring'
                ? 'bg-emerald-600 text-white'
                : 'text-[#6B3F1F]'
            }`}>
            CV &amp; Hiring
          </button>
        </div>

        {error && (
          <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        {savedAt && !error && (
          <div className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            Saved.
          </div>
        )}

        {tab === 'testimonial' ? (
          <TestimonialTab
            portfolio={portfolio}
            testimonialText={testimonialText}
            setTestimonialText={setTestimonialText}
            uploadAsset={uploadAsset}
            saveMarketing={saveMarketing}
            saving={saving}
          />
        ) : (
          <HiringTab
            portfolio={portfolio}
            employerName={employerName} setEmployerName={setEmployerName}
            employedSince={employedSince} setEmployedSince={setEmployedSince}
            offersNotes={offersNotes} setOffersNotes={setOffersNotes}
            uploadCV={uploadCV} deleteCV={deleteCV}
            saveEmployment={saveEmployment}
            saving={saving}
          />
        )}
      </div>
      <BottomNav />
    </div>
  )
}


function TestimonialTab({
  portfolio, testimonialText, setTestimonialText,
  uploadAsset, saveMarketing, saving,
}: {
  portfolio: Portfolio
  testimonialText: string
  setTestimonialText: (v: string) => void
  uploadAsset: (file: File, kind: 'photo' | 'video') => Promise<void>
  saveMarketing: (patch: Partial<Portfolio>) => Promise<void>
  saving: boolean
}) {
  const photoInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const dirty = (testimonialText || '') !== (portfolio.testimonial_text || '')
  return (
    <div className="mt-4 space-y-4">
      {/* Photo */}
      <section className="bg-white border border-[#DDD0B8] rounded-xl p-4">
        <h3 className="text-sm font-semibold text-[#6B3F1F] mb-2">Photo</h3>
        {portfolio.photo_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={portfolio.photo_url} alt=""
            className="w-32 h-32 object-cover rounded-lg mb-2 border border-[#DDD0B8]" />
        ) : (
          <div className="w-32 h-32 bg-[#F5F0E8] rounded-lg mb-2 flex items-center justify-center text-[#7A8C7E] text-xs">
            No photo yet
          </div>
        )}
        <input ref={photoInput} type="file" accept="image/*" className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (f) uploadAsset(f, 'photo')
          }} />
        <button onClick={() => photoInput.current?.click()} disabled={saving}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50">
          {portfolio.photo_url ? 'Replace photo' : 'Upload photo'}
        </button>
        <label className="flex items-start gap-2 mt-3 text-xs text-[#6B3F1F]">
          <input type="checkbox" checked={portfolio.marketing_consent_photo}
            onChange={e => saveMarketing({ marketing_consent_photo: e.target.checked })}
            className="mt-0.5" />
          <span>RootsTalk may use my photo on the website and social media.</span>
        </label>
      </section>

      {/* Video */}
      <section className="bg-white border border-[#DDD0B8] rounded-xl p-4">
        <h3 className="text-sm font-semibold text-[#6B3F1F] mb-2">Short video</h3>
        {portfolio.video_url ? (
          <video src={portfolio.video_url} controls
            className="w-full max-w-sm rounded-lg mb-2 border border-[#DDD0B8]" />
        ) : (
          <div className="w-full max-w-sm aspect-video bg-[#F5F0E8] rounded-lg mb-2 flex items-center justify-center text-[#7A8C7E] text-xs">
            No video yet
          </div>
        )}
        <input ref={videoInput} type="file" accept="video/*" className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (f) uploadAsset(f, 'video')
          }} />
        <button onClick={() => videoInput.current?.click()} disabled={saving}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50">
          {portfolio.video_url ? 'Replace video' : 'Upload video'}
        </button>
        <p className="text-[11px] text-[#7A8C7E] mt-1">Up to 100 MB. Keep it under 90 seconds.</p>
        <label className="flex items-start gap-2 mt-3 text-xs text-[#6B3F1F]">
          <input type="checkbox" checked={portfolio.marketing_consent_video}
            onChange={e => saveMarketing({ marketing_consent_video: e.target.checked })}
            className="mt-0.5" />
          <span>RootsTalk may use my video on the website and social media.</span>
        </label>
      </section>

      {/* Testimonial text */}
      <section className="bg-white border border-[#DDD0B8] rounded-xl p-4">
        <h3 className="text-sm font-semibold text-[#6B3F1F] mb-2">Testimonial</h3>
        <textarea rows={6} value={testimonialText}
          onChange={e => setTestimonialText(e.target.value)}
          placeholder="Share what RootsTalk meant to you. A few sentences is plenty."
          className="w-full border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm" />
        <button
          onClick={() => saveMarketing({ testimonial_text: testimonialText })}
          disabled={!dirty || saving}
          className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50">
          Save testimonial
        </button>
        <label className="flex items-start gap-2 mt-3 text-xs text-[#6B3F1F]">
          <input type="checkbox" checked={portfolio.marketing_consent_testimonial}
            onChange={e => saveMarketing({ marketing_consent_testimonial: e.target.checked })}
            className="mt-0.5" />
          <span>RootsTalk may publish my testimonial on the website and social media.</span>
        </label>
      </section>
    </div>
  )
}


function HiringTab({
  portfolio,
  employerName, setEmployerName,
  employedSince, setEmployedSince,
  offersNotes, setOffersNotes,
  uploadCV, deleteCV,
  saveEmployment, saving,
}: {
  portfolio: Portfolio
  employerName: string
  setEmployerName: (v: string) => void
  employedSince: string
  setEmployedSince: (v: string) => void
  offersNotes: string
  setOffersNotes: (v: string) => void
  uploadCV: (file: File) => Promise<void>
  deleteCV: (id: string) => Promise<void>
  saveEmployment: (patch: Partial<Portfolio>) => Promise<void>
  saving: boolean
}) {
  const cvInput = useRef<HTMLInputElement>(null)
  const employmentDirty =
    (employerName || '') !== (portfolio.employer_name || '')
    || (employedSince || '') !== (portfolio.employed_since || '')
  const offersDirty = (offersNotes || '') !== (portfolio.open_to_offers_notes || '')
  return (
    <div className="mt-4 space-y-4">
      {/* Employment status */}
      <section className="bg-white border border-[#DDD0B8] rounded-xl p-4">
        <h3 className="text-sm font-semibold text-[#6B3F1F] mb-2">Employment status</h3>
        <label className="flex items-start gap-2 text-sm text-[#6B3F1F]">
          <input type="checkbox" checked={portfolio.is_employed}
            onChange={e => saveEmployment({ is_employed: e.target.checked })}
            className="mt-0.5" />
          <span>I am currently employed</span>
        </label>
        {portfolio.is_employed && (
          <div className="mt-3 space-y-2">
            <div>
              <label className="text-xs text-[#7A8C7E] block mb-1">Employer</label>
              <input type="text" value={employerName}
                onChange={e => setEmployerName(e.target.value)}
                placeholder="Company name"
                className="w-full border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-[#7A8C7E] block mb-1">Since</label>
              <input type="date" value={employedSince}
                onChange={e => setEmployedSince(e.target.value)}
                className="w-full border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm" />
            </div>
            <button
              onClick={() => saveEmployment({
                employer_name: employerName.trim() || null,
                employed_since: employedSince || null,
              })}
              disabled={!employmentDirty || saving}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50">
              Save
            </button>
          </div>
        )}
        <div className="mt-4 pt-3 border-t border-[#F0E6D4]">
          <label className="flex items-start gap-2 text-sm text-[#6B3F1F]">
            <input type="checkbox" checked={portfolio.is_open_to_offers}
              onChange={e => saveEmployment({ is_open_to_offers: e.target.checked })}
              className="mt-0.5" />
            <span>I am open to new opportunities {portfolio.is_employed ? '(in addition to my current role)' : ''}</span>
          </label>
          {portfolio.is_open_to_offers && (
            <div className="mt-2">
              <textarea rows={3} value={offersNotes}
                onChange={e => setOffersNotes(e.target.value)}
                placeholder="Optional — e.g., prefer remote, Karnataka region, agricultural research only…"
                className="w-full border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm" />
              <button
                onClick={() => saveEmployment({ open_to_offers_notes: offersNotes || null })}
                disabled={!offersDirty || saving}
                className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50">
                Save notes
              </button>
            </div>
          )}
        </div>
      </section>

      {/* CV */}
      <section className="bg-white border border-[#DDD0B8] rounded-xl p-4">
        <h3 className="text-sm font-semibold text-[#6B3F1F] mb-2">CV</h3>
        {portfolio.cvs.length === 0 ? (
          <p className="text-xs text-[#7A8C7E] mb-3">No CV uploaded yet.</p>
        ) : (
          <ul className="mb-3 space-y-1.5">
            {portfolio.cvs.map(cv => (
              <li key={cv.id} className="flex items-center gap-2 text-xs">
                <a href={cv.file_url} target="_blank" rel="noopener noreferrer"
                  className="flex-1 min-w-0 truncate text-emerald-800 underline">
                  {cv.filename}
                </a>
                {cv.is_latest && (
                  <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                    LATEST
                  </span>
                )}
                <span className="text-[10px] text-[#7A8C7E]">
                  {new Date(cv.uploaded_at).toLocaleDateString()}
                </span>
                <button onClick={() => deleteCV(cv.id)} disabled={saving}
                  className="text-[11px] text-red-600 hover:underline disabled:opacity-50">
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <input ref={cvInput} type="file" accept="application/pdf" className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (f) uploadCV(f)
          }} />
        <button onClick={() => cvInput.current?.click()} disabled={saving}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50">
          {portfolio.cvs.length ? 'Upload a new version' : 'Upload CV (PDF)'}
        </button>
        <p className="text-[11px] text-[#7A8C7E] mt-1">PDF only, up to 10 MB. Export from Word via "Save as PDF".</p>
        <label className="flex items-start gap-2 mt-3 text-xs text-[#6B3F1F]">
          <input type="checkbox" checked={portfolio.hiring_consent_share_cv}
            onChange={e => saveEmployment({ hiring_consent_share_cv: e.target.checked })}
            className="mt-0.5" />
          <span>RootsTalk may share my CV with partner companies.</span>
        </label>
      </section>
    </div>
  )
}
