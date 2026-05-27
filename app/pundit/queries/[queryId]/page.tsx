'use client'
import { useState, useEffect, useRef, FormEvent } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

interface StandardResponse {
  id: string
  client_id: string
  crop_cosh_id: string | null
  question_text: string
  created_at: string
}

interface ComputedCropAge {
  value: number
  unit: 'days' | 'years'
  source: 'START_DATE' | 'PLANTING_YEAR'
}

interface FarmerBlock {
  name: string | null
  phone: string | null
  address: {
    town: string | null
    district: string | null
    state: string | null
  } | null
}

interface QueryDetail {
  id: string; title: string
  query_type_cosh_id: string | null
  query_type_name: string | null
  description: string | null; severity: string
  client_id: string
  crop_cosh_id: string | null
  crop_name: string | null
  crop_measure: 'AREA_WISE' | 'PLANT_WISE'
  // Free-text "45 DAS" from the farmer (legacy); display only if present.
  crop_age: string | null
  // Server-computed envelope — days from start_date OR years from planting_year.
  computed_crop_age: ComputedCropAge | null
  farmer: FarmerBlock | null
  status: string; created_at: string; expires_at: string; days_remaining: number
  is_holding: boolean
  media: { media_type: string; url: string }[]
  remarks: { action: string; pundit_id: string | null; remark: string | null; created_at: string }[]
  response: {
    problem_cosh_id: string | null
    standard_response_id: string | null
    standard_response_question: string | null
    text: string | null
    media: unknown[]
    created_at: string
  } | null
}

const COLOUR = '#3C3489'

const SEVERITY_COLOUR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700 border-red-200',
  HIGH:     'bg-orange-100 text-orange-700 border-orange-200',
  MODERATE: 'bg-amber-100 text-amber-700 border-amber-200',
  LOW:      'bg-slate-100 text-[#7A8C7E] border-slate-200',
}

export default function PunditQueryDetailPage() {
  const { queryId } = useParams<{ queryId: string }>()
  const router = useRouter()
  const [query, setQuery] = useState<QueryDetail | null>(null)
  const [loading, setLoading] = useState(true)

  // Respond modal
  const [showRespond, setShowRespond] = useState(false)
  const [responding, setResponding] = useState(false)
  // The response carries up to one structured trigger (problem_cosh_id
  // OR standard_response_id) plus optional free-form text/media. The
  // backend's respond_to_query branches on these in order — see UCAT
  // memory for the three-pipe model.
  const [respondForm, setRespondForm] = useState({
    text: '',
    problem_cosh_id: '',
    standard_response_id: '',
    standard_response_question: '',  // display-only, for the picked-pill
  })
  const [respondError, setRespondError] = useState('')

  // Forward modal
  const [showForward, setShowForward] = useState(false)
  const [forwarding, setForwarding] = useState(false)
  const [forwardForm, setForwardForm] = useState({ to_pundit_id: '', remarks: '' })
  const [forwardError, setForwardError] = useState('')

  // Return modal
  const [showReturn, setShowReturn] = useState(false)
  const [returning, setReturning] = useState(false)
  const [returnRemarks, setReturnRemarks] = useState('')
  const [returnError, setReturnError] = useState('')

  // Reject modal
  const [showReject, setShowReject] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectRemarks, setRejectRemarks] = useState('')
  const [rejectError, setRejectError] = useState('')

  // Full-screen photo viewer (tap a thumbnail to zoom)
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null)

  // Standard responses
  const [showStdPicker, setShowStdPicker] = useState(false)
  const [stdSearch, setStdSearch] = useState('')
  const [stdResults, setStdResults] = useState<StandardResponse[]>([])
  const [stdLoading, setStdLoading] = useState(false)
  const stdSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openStdPicker() {
    setShowStdPicker(true)
    setStdSearch('')
    // Load the full library immediately so the Pundit can browse
    // even before typing — search narrows progressively.
    onStdSearchChange('')
  }

  function onStdSearchChange(value: string) {
    setStdSearch(value)
    if (stdSearchTimeout.current) clearTimeout(stdSearchTimeout.current)
    stdSearchTimeout.current = setTimeout(async () => {
      if (!query?.client_id) return
      setStdLoading(true)
      try {
        // Search the company's curated library — endpoint is
        // client-scoped per spec §14.9. The Pundit may hold queries
        // from multiple companies; each company has its own library.
        const params = new URLSearchParams({ client_id: query.client_id })
        if (value) params.append('search', value)
        const { data } = await api.get<StandardResponse[]>(
          `/pundit/standard-responses?${params}`,
        )
        setStdResults(data)
      } finally { setStdLoading(false) }
    }, 300)
  }

  function pickStdResponse(sr: StandardResponse) {
    // Picking a standard answer sets the structured trigger. The
    // Pundit doesn't have to read the answer body — the SE has
    // already curated the Timeline, and on submit the QA pipe
    // delivers it into the farmer's advisory automatically. Per
    // spec §14.9: "FarmPundit cannot modify the standard answer —
    // sends as-is".
    setRespondForm(f => ({
      ...f,
      standard_response_id: sr.id,
      standard_response_question: sr.question_text,
      // Picking a standard answer is mutually exclusive with
      // identifying a CHA problem — both would race on submit.
      problem_cosh_id: '',
    }))
    setShowStdPicker(false)
    setStdSearch('')
    setStdResults([])
  }

  function clearStdPick() {
    setRespondForm(f => ({
      ...f,
      standard_response_id: '',
      standard_response_question: '',
    }))
  }

  const load = async () => {
    try {
      const { data } = await api.get<QueryDetail>(`/pundit/queries/${queryId}`)
      setQuery(data)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [queryId])

  async function handleRespond(e: FormEvent) {
    e.preventDefault()
    const hasStructured = !!respondForm.problem_cosh_id || !!respondForm.standard_response_id
    if (!respondForm.text && !hasStructured) {
      setRespondError(
        'Pick a Crop Health problem, a standard answer, or write a free-form text response. The structured options merge into the farmer\'s advisory; free-form text is a fallback only.',
      )
      return
    }
    setResponding(true); setRespondError('')
    try {
      // Send only the keys the backend cares about. The display-
      // only `standard_response_question` doesn't leave the client.
      const payload: Record<string, string> = {}
      if (respondForm.text) payload.text = respondForm.text
      if (respondForm.problem_cosh_id) payload.problem_cosh_id = respondForm.problem_cosh_id
      if (respondForm.standard_response_id) payload.standard_response_id = respondForm.standard_response_id
      await api.put(`/pundit/queries/${queryId}/respond`, payload)
      setShowRespond(false)
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setRespondError(msg || 'Failed to submit response.')
    } finally { setResponding(false) }
  }

  async function handleForward(e: FormEvent) {
    e.preventDefault()
    setForwarding(true); setForwardError('')
    try {
      await api.put(`/pundit/queries/${queryId}/forward`, forwardForm)
      setShowForward(false)
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setForwardError(msg || 'Failed to forward query.')
    } finally { setForwarding(false) }
  }

  async function handleReturn(e: FormEvent) {
    e.preventDefault()
    setReturning(true); setReturnError('')
    try {
      await api.put(`/pundit/queries/${queryId}/return`, { remarks: returnRemarks })
      setShowReturn(false)
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setReturnError(msg || 'Failed to return query.')
    } finally { setReturning(false) }
  }

  async function handleReject(e: FormEvent) {
    e.preventDefault()
    setRejecting(true); setRejectError('')
    try {
      await api.put(`/pundit/queries/${queryId}/reject`, { remarks: rejectRemarks })
      setShowReject(false)
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setRejectError(msg || 'Failed to reject query.')
    } finally { setRejecting(false) }
  }

  if (loading || !query) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: COLOUR }} />
    </div>
  )

  const isActive = ['NEW', 'FORWARDED', 'RETURNED'].includes(query.status)

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Query" activeRole="FARM_PUNDIT" back="/pundit/queries" />
      <div className="pt-16 pb-28 px-4 space-y-4">
        {/* Farmer card — name + tap-to-call phone + address.
            Pundit's first action is often a call; the phone is a
            `tel:` link so a single tap dials. */}
        {query.farmer && (
          <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] mt-4">
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide mb-1.5">Farmer</p>
            <p className="font-semibold text-[#6B3F1F]">{query.farmer.name || '—'}</p>
            {query.farmer.phone && (
              <a href={`tel:${query.farmer.phone}`}
                className="inline-flex items-center gap-1.5 mt-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                📞 {query.farmer.phone}
              </a>
            )}
            {query.farmer.address && (
              query.farmer.address.town
              || query.farmer.address.district
              || query.farmer.address.state
            ) && (
              <p className="text-xs text-[#7A8C7E] mt-2">
                {[
                  query.farmer.address.town,
                  query.farmer.address.district,
                  query.farmer.address.state,
                ].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        )}

        {/* Crop card — resolved name + computed age. */}
        <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8]">
          <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide mb-1.5">Crop</p>
          <p className="font-semibold text-[#6B3F1F]">
            {cropDisplayName(query.crop_cosh_id, query.crop_name)}
          </p>
          {query.computed_crop_age && (
            <p className="text-sm text-[#6B3F1F] mt-1">
              <span className="text-xs text-[#7A8C7E]">Age · </span>
              {query.computed_crop_age.value} {query.computed_crop_age.unit}
              <span className="text-xs text-[#7A8C7E] ml-1">
                {query.computed_crop_age.source === 'PLANTING_YEAR'
                  ? 'from planting year'
                  : 'from start date'}
              </span>
            </p>
          )}
          {query.crop_age && (
            <p className="text-xs text-[#7A8C7E] mt-1">Farmer noted: {query.crop_age}</p>
          )}
        </div>

        {/* Nature of Query + Severity card */}
        <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide mb-0.5">Nature of Query</p>
              <p className="font-semibold text-[#6B3F1F] leading-snug">
                {query.query_type_name || query.title}
              </p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${query.status === 'RESPONDED' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                  {query.status}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${SEVERITY_COLOUR[query.severity] || 'bg-slate-100 text-[#7A8C7E] border-slate-200'}`}>
                  {query.severity}
                </span>
              </div>
            </div>
            {/* Days remaining — re-tuned for the 2-day window:
                  0 days left  → red    (responds today or expires)
                  1 day left   → amber  (one more day after today)
                  ≥2 days left → slate  (fresh) */}
            {isActive && (
              <div className={`text-xs font-semibold px-2 py-1 rounded-xl ${query.days_remaining <= 0 ? 'bg-red-100 text-red-700' : query.days_remaining <= 1 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-[#7A8C7E]'}`}>
                {query.days_remaining}d left
              </div>
            )}
          </div>
        </div>

        {/* Description card — only when the farmer wrote one. */}
        {query.description && (
          <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8]">
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide mb-1.5">Description</p>
            <p className="text-sm text-[#6B3F1F] leading-relaxed">{query.description}</p>
          </div>
        )}

        {/* Photographs & voice note from the farmer. Photos render as
            a 2-up grid; tap a thumbnail to view full-screen. Audio
            uses the browser's native <audio> controls. */}
        {query.media.length > 0 && (
          <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] space-y-3">
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide">Attachments</p>
            {(() => {
              const photos = query.media.filter(m => m.media_type === 'IMAGE')
              const audios = query.media.filter(m => m.media_type === 'AUDIO')
              const videos = query.media.filter(m => m.media_type === 'VIDEO')
              return (
                <>
                  {photos.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {photos.map((p, i) => (
                        <button key={i} type="button" onClick={() => setZoomedPhoto(p.url)}
                          className="block">
                          <img src={p.url} alt={`Photo ${i + 1}`}
                            className="w-full h-32 object-cover rounded-xl border border-[#DDD0B8]" />
                        </button>
                      ))}
                    </div>
                  )}
                  {audios.length > 0 && audios.map((a, i) => (
                    <div key={i} className="bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl px-3 py-2">
                      <p className="text-xs text-[#7A8C7E] mb-1">🎙 Voice note from farmer</p>
                      <audio src={a.url} controls className="w-full" />
                    </div>
                  ))}
                  {videos.length > 0 && videos.map((v, i) => (
                    <div key={i} className="bg-black rounded-xl overflow-hidden">
                      <video src={v.url} controls className="w-full" />
                    </div>
                  ))}
                </>
              )
            })()}
          </div>
        )}

        {/* Remarks chain */}
        {query.remarks.length > 0 && (
          <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8]">
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wide mb-3">Query History</p>
            <div className="space-y-3">
              {query.remarks.map((r, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-2 h-2 rounded-full bg-slate-300 mt-2 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-[#6B3F1F] capitalize">{r.action.toLowerCase()}</p>
                    {r.remark && <p className="text-xs text-[#7A8C7E] mt-0.5">{r.remark}</p>}
                    <p className="text-xs text-[#DDD0B8] mt-0.5">{new Date(r.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Response */}
        {query.response && (
          <div className="bg-green-50 rounded-2xl p-4 border border-green-200">
            <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Response</p>
            {query.response.problem_cosh_id && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 mb-3">
                <p className="text-xs text-blue-700">
                  🔬 Crop health problem identified: <strong>{query.response.problem_cosh_id}</strong>
                  <br />CHA recommendations have been added to the farmer&apos;s advisory.
                </p>
              </div>
            )}
            {query.response.standard_response_id && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2 mb-3">
                <p className="text-xs text-indigo-700">
                  🌾 Standard answer picked
                  {query.response.standard_response_question && (
                    <>: <strong>{query.response.standard_response_question}</strong></>
                  )}
                  <br />The curated Q&amp;A advisory has merged into the farmer&apos;s plan.
                </p>
              </div>
            )}
            {query.response.text && <p className="text-sm text-[#6B3F1F] leading-relaxed">{query.response.text}</p>}
          </div>
        )}
      </div>

      {/* Action bar (only when holding and query is active) */}
      {query.is_holding && isActive && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#DDD0B8] px-4 py-3 space-y-2">
          <button onClick={() => setShowRespond(true)}
            className="w-full py-3 rounded-2xl text-white font-semibold text-sm"
            style={{ background: `linear-gradient(135deg, #2d2570, ${COLOUR})` }}>
            ✓ Respond to Query
          </button>
          <div className="flex gap-2">
            <button onClick={() => setShowForward(true)}
              className="flex-1 py-2.5 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium">
              → Forward
            </button>
            {query.status !== 'NEW' && (
              <button onClick={() => setShowReturn(true)}
                className="flex-1 py-2.5 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium">
                ← Return
              </button>
            )}
            <button onClick={() => setShowReject(true)}
              className="flex-1 py-2.5 rounded-xl border border-red-100 text-[#D4682E] text-sm font-medium">
              ✗ Reject
            </button>
          </div>
        </div>
      )}

      {/* Respond Modal */}
      {showRespond && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white rounded-t-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-[#DDD0B8]">
              <h2 className="font-bold text-[#6B3F1F]">Respond to Query</h2>
              <p className="text-[#7A8C7E] text-xs mt-0.5">2-day window closes on response. Farmer is notified immediately.</p>
            </div>
            <form onSubmit={handleRespond} className="p-5 space-y-4 pb-8">
              {/* Three structured response paths per the UCAT model.
                  Pundit picks one of (Crop Health problem) or (Standard
                  answer) for purchase-bearing advisory; free-form text
                  is the fallback shown to the farmer on a separate
                  page (no purchases, no tracking). */}

              {/* Path 1: Identify a Crop Health problem (CHA pipe) */}
              <div>
                <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">
                  Crop Health Problem
                  {respondForm.standard_response_id && (
                    <span className="ml-2 text-xs text-[#7A8C7E] font-normal">(disabled — standard answer picked)</span>
                  )}
                </label>
                <input value={respondForm.problem_cosh_id}
                  onChange={e => setRespondForm(f => ({ ...f, problem_cosh_id: e.target.value }))}
                  disabled={!!respondForm.standard_response_id}
                  placeholder="e.g. sp_blast_rice or pg_aphids (Cosh ID)"
                  className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none font-mono disabled:bg-[#F5F0E8] disabled:text-[#7A8C7E]" />
                <p className="text-xs text-[#7A8C7E] mt-1">
                  Enter the Cosh problem ID to deliver CHA recommendations to the farmer.
                </p>
              </div>

              {/* Path 2: Pick a Standard Q&A answer (Q&A pipe) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-[#6B3F1F]">Standard Answer</label>
                  {!respondForm.standard_response_id && !respondForm.problem_cosh_id && (
                    <button type="button" onClick={openStdPicker}
                      className="text-xs font-medium px-2.5 py-1 rounded-lg text-white"
                      style={{ background: COLOUR }}>
                      Pick from library
                    </button>
                  )}
                </div>
                {respondForm.standard_response_id ? (
                  <div className="flex items-start gap-2 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2">
                    <span className="text-indigo-700 text-sm">🌾</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">Q&amp;A picked</p>
                      <p className="text-sm text-[#6B3F1F] leading-snug">{respondForm.standard_response_question}</p>
                      <p className="text-xs text-[#7A8C7E] mt-0.5">
                        On send, the curated advisory merges into the farmer&apos;s plan automatically.
                      </p>
                    </div>
                    <button type="button" onClick={clearStdPick}
                      className="text-[#7A8C7E] hover:text-[#6B3F1F] text-lg leading-none px-1">×</button>
                  </div>
                ) : (
                  <p className="text-xs text-[#7A8C7E]">
                    {respondForm.problem_cosh_id
                      ? 'Disabled — Crop Health problem entered above.'
                      : 'Search the company\'s curated Q&A library and pick the closest matching question.'}
                  </p>
                )}
              </div>

              {/* Path 3: Free-form text — fallback or supplementary */}
              <div>
                <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">
                  {respondForm.problem_cosh_id || respondForm.standard_response_id
                    ? 'Additional guidance (optional)'
                    : 'Free-form response'}
                </label>
                <textarea value={respondForm.text}
                  onChange={e => setRespondForm(f => ({ ...f, text: e.target.value }))}
                  rows={5}
                  placeholder={
                    respondForm.problem_cosh_id || respondForm.standard_response_id
                      ? 'Optional notes the farmer sees on the Query Response page.'
                      : 'Use this only if no problem or standard answer applies. Free-form text reaches the farmer but does not merge into the advisory or drive purchases.'
                  }
                  className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none resize-none" />
              </div>

              {respondError && <p className="text-sm text-[#D4682E]">{respondError}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => { setShowRespond(false); setRespondError('') }}
                  className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] font-medium py-3 rounded-2xl text-sm">Cancel</button>
                <button type="submit" disabled={responding}
                  className="flex-1 text-white font-semibold py-3 rounded-2xl text-sm disabled:opacity-50"
                  style={{ background: COLOUR }}>
                  {responding ? 'Sending…' : 'Send Response'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Forward Modal */}
      {showForward && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white rounded-t-3xl w-full">
            <div className="p-5 border-b border-[#DDD0B8]">
              <h2 className="font-bold text-[#6B3F1F]">Forward Query</h2>
              <p className="text-[#7A8C7E] text-xs mt-0.5">2-day clock does not reset. Mandatory comments required.</p>
            </div>
            <form onSubmit={handleForward} className="p-5 space-y-4 pb-8">
              <div>
                <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">Recipient's Pundit ID</label>
                <input value={forwardForm.to_pundit_id}
                  onChange={e => setForwardForm(f => ({ ...f, to_pundit_id: e.target.value }))}
                  required placeholder="FarmPundit profile ID"
                  className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">Remarks (mandatory)</label>
                <textarea value={forwardForm.remarks}
                  onChange={e => setForwardForm(f => ({ ...f, remarks: e.target.value }))}
                  required rows={3} placeholder="Why are you forwarding? What context should the recipient know?"
                  className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none resize-none" />
              </div>
              {forwardError && <p className="text-sm text-[#D4682E]">{forwardError}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => { setShowForward(false); setForwardError('') }}
                  className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] font-medium py-3 rounded-2xl text-sm">Cancel</button>
                <button type="submit" disabled={forwarding}
                  className="flex-1 text-white font-semibold py-3 rounded-2xl text-sm disabled:opacity-50"
                  style={{ background: COLOUR }}>
                  {forwarding ? 'Forwarding…' : 'Forward'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Return Modal */}
      {showReturn && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white rounded-t-3xl w-full">
            <div className="p-5 border-b border-[#DDD0B8]">
              <h2 className="font-bold text-[#6B3F1F]">Return Query</h2>
            </div>
            <form onSubmit={handleReturn} className="p-5 space-y-4 pb-8">
              <div>
                <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">Remarks (mandatory)</label>
                <textarea value={returnRemarks} onChange={e => setReturnRemarks(e.target.value)}
                  required rows={3} placeholder="Why are you returning? What do you need?"
                  className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none resize-none" />
              </div>
              {returnError && <p className="text-sm text-[#D4682E]">{returnError}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => { setShowReturn(false); setReturnError('') }}
                  className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] font-medium py-3 rounded-2xl text-sm">Cancel</button>
                <button type="submit" disabled={returning}
                  className="flex-1 text-white font-semibold py-3 rounded-2xl text-sm disabled:opacity-50"
                  style={{ background: '#b45309' }}>
                  {returning ? 'Returning…' : 'Return Query'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showReject && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white rounded-t-3xl w-full">
            <div className="p-5 border-b border-[#DDD0B8]">
              <h2 className="font-bold text-[#6B3F1F]">Reject Query</h2>
              <p className="text-[#7A8C7E] text-xs mt-0.5">This is a terminal action. The query cannot be reopened.</p>
            </div>
            <form onSubmit={handleReject} className="p-5 space-y-4 pb-8">
              <div>
                <label className="block text-sm font-medium text-[#6B3F1F] mb-1.5">Reason (mandatory)</label>
                <textarea value={rejectRemarks} onChange={e => setRejectRemarks(e.target.value)}
                  required rows={3} placeholder="Why are you rejecting this query?"
                  className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none resize-none" />
              </div>
              {rejectError && <p className="text-sm text-[#D4682E]">{rejectError}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => { setShowReject(false); setRejectError('') }}
                  className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] font-medium py-3 rounded-2xl text-sm">Cancel</button>
                <button type="submit" disabled={rejecting}
                  className="flex-1 text-white font-semibold py-3 rounded-2xl text-sm disabled:opacity-50"
                  style={{ background: '#dc2626' }}>
                  {rejecting ? 'Rejecting…' : 'Reject Query'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full-screen photo viewer */}
      {zoomedPhoto && (
        <div className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setZoomedPhoto(null)}>
          <button onClick={() => setZoomedPhoto(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 text-white text-2xl flex items-center justify-center"
            aria-label="Close photo">×</button>
          <img src={zoomedPhoto} alt="Photograph"
            className="max-w-full max-h-full object-contain"
            onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* Standard Responses Picker */}
      {showStdPicker && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40">
          <div className="bg-white rounded-t-3xl w-full max-h-[80vh] flex flex-col">
            <div className="p-5 border-b border-[#DDD0B8] flex items-center justify-between">
              <h2 className="font-bold text-[#6B3F1F]">Standard Responses</h2>
              <button onClick={() => { setShowStdPicker(false); setStdSearch(''); setStdResults([]) }}
                className="w-7 h-7 flex items-center justify-center text-[#7A8C7E] text-xl">×</button>
            </div>
            <div className="px-5 pt-4 pb-2">
              <input
                value={stdSearch}
                onChange={e => onStdSearchChange(e.target.value)}
                placeholder="Search responses…"
                autoFocus
                className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#3C3489]"
              />
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-8">
              {stdLoading ? (
                <div className="h-12 bg-[#F5F0E8] rounded-xl animate-pulse mt-3" />
              ) : stdResults.length === 0 && stdSearch.length > 0 ? (
                <p className="text-[#7A8C7E] text-sm text-center py-8">No results for &ldquo;{stdSearch}&rdquo;</p>
              ) : stdResults.length === 0 ? (
                <p className="text-[#7A8C7E] text-sm text-center py-8">
                  Type to search the curated Q&amp;A library, or browse all entries.
                </p>
              ) : (
                <div className="space-y-2 mt-3">
                  <p className="text-xs text-[#7A8C7E]">{stdResults.length} result{stdResults.length === 1 ? '' : 's'}</p>
                  {stdResults.map(r => (
                    <button key={r.id} onClick={() => pickStdResponse(r)}
                      className="w-full bg-white border border-[#DDD0B8] rounded-xl p-4 text-left hover:border-[#3C3489] transition-colors active:scale-[0.99]">
                      <p className="text-sm font-medium text-[#6B3F1F] mb-1">{r.question_text}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {r.crop_cosh_id ? (
                          <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                            {cropDisplayName(r.crop_cosh_id)}
                          </span>
                        ) : (
                          <span className="text-xs bg-slate-100 text-[#7A8C7E] px-2 py-0.5 rounded-full">
                            Crop-agnostic
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
