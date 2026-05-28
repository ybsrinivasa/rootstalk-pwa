'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import ClientCropChip from '@/components/ClientCropChip'
import api from '@/lib/api'

interface PlantPart { cosh_id: string; name: string }
interface CropStage { cosh_id: string; name: string }
interface ReferenceImage { cosh_id: string; url: string; caption?: string | null; media_type?: string }
interface Question {
  plant_part_cosh_id: string; symptom_cosh_id: string
  sub_part_cosh_id: string | null; sub_symptom_cosh_id: string | null
  plant_part_name: string | null; symptom_name: string | null
  sub_part_name: string | null; sub_symptom_name: string | null
  question_type: string; display_text: string
}
interface ProblemInfo {
  cosh_id: string; name: string; type: string; parent_cosh_id?: string
  claude_description?: string    // 2-sentence farmer-friendly description from Claude
}
interface CommitResult { committed_to_advisory: boolean; already_committed?: boolean }
interface DiagnosisStep {
  session_id?: string; status: string
  remaining_count: number; question: Question | null
  diagnosed_problem_cosh_id?: string; problem_info?: ProblemInfo
}
interface ImageAnalysis {
  problem_name: string; problem_cosh_id: string | null
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  description: string; symptoms_observed: string[]
}

const COLOUR = '#3A7D44'

export default function DiagnosisPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const router = useRouter()

  const [stage, setStage] = useState<'select_stage' | 'select_method' | 'ai_capture' | 'ai_needs_expert' | 'select_part' | 'questioning' | 'confirming' | 'diagnosed' | 'outside_list' | 'know_problem' | 'aborted'>('select_stage')
  const [stages, setStages] = useState<CropStage[]>([])
  const [selectedStage, setSelectedStage] = useState<CropStage | null>(null)
  const [parts, setParts] = useState<PlantPart[]>([])
  const [problems, setProblems] = useState<ProblemInfo[]>([])
  const [selectedPart, setSelectedPart] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null)
  const [remainingCount, setRemainingCount] = useState(0)
  const [diagnosis, setDiagnosis] = useState<ProblemInfo | null>(null)
  const [committedToAdvisory, setCommittedToAdvisory] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState('')

  // Direct-AI path: farmer skips Part + Q&A; uploads photos; Claude
  // picks from the crop+stage's known problem catalogue (or refers
  // to FarmPundit when nothing matches).
  const [aiImages, setAiImages] = useState<Array<{ base64: string; media_type: string; preview: string }>>([])
  const [aiSubmitting, setAiSubmitting] = useState(false)
  const [aiError, setAiError] = useState('')
  const aiFileInputRef = useRef<HTMLInputElement>(null)
  const [cropCoshId, setCropCoshId] = useState<string | null>(null)
  const [cropName, setCropName] = useState<string | null>(null)
  const [answering, setAnswering] = useState(false)
  const [loading, setLoading] = useState(true)

  // Claude image analysis
  const [analyzingImage, setAnalyzingImage] = useState(false)
  const [imageAnalysis, setImageAnalysis] = useState<ImageAnalysis | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Question history for back navigation feel
  const [questionHistory, setQuestionHistory] = useState<Question[]>([])

  // ⓘ symptom-explanation sheet
  const [explainOpen, setExplainOpen] = useState(false)
  const [explainText, setExplainText] = useState<string | null>(null)
  const [explainLoading, setExplainLoading] = useState(false)

  // Reference images for the current question — auto-loaded on every
  // new question. We render up to 2 inline as visual confirmation,
  // and the rest behind a "See N more" gallery sheet. Honest empty
  // state when Cosh hasn't curated images for this exact context.
  const [refImages, setRefImages] = useState<ReferenceImage[]>([])
  const [refImagesLoading, setRefImagesLoading] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [zoomedImage, setZoomedImage] = useState<ReferenceImage | null>(null)
  const [googleFallbackUrl, setGoogleFallbackUrl] = useState<string>('')
  // Read from /my-subscriptions on mount — drives the Ask Expert
  // gate on every IDK gateway / fallback button in this flow.
  const [hasPrimaryExpert, setHasPrimaryExpert] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // Load subscription to get crop_cosh_id + Ask-Expert eligibility.
    api.get<{
      id: string; crop_cosh_id?: string; crop_name?: string
      client_has_primary_expert?: boolean
    }[]>('/farmer/my-subscriptions')
      .then(r => {
        const sub = r.data.find(s => s.id === subscriptionId)
        setHasPrimaryExpert(sub?.client_has_primary_expert !== false)
        if (sub?.crop_cosh_id) {
          setCropCoshId(sub.crop_cosh_id)
          setCropName(sub.crop_name || null)
          loadCropStages(sub.crop_cosh_id)
        } else {
          setLoading(false)
        }
      })
  }, [subscriptionId])

  // Single guarded routing entry — every "Ask Expert" CTA on this
  // page funnels through here so the gate is enforced in one place.
  function goToAskExpert() {
    if (!hasPrimaryExpert) {
      alert("This company hasn't onboarded a Primary expert yet. Ask Expert will be available once they do.")
      return
    }
    goToAskExpert()
  }

  async function loadCropStages(crop_cosh_id: string) {
    try {
      const { data } = await api.get<CropStage[]>(
        `/diagnosis/crop-stages?crop_cosh_id=${encodeURIComponent(crop_cosh_id)}`,
      )
      setStages(data)
      // If Cosh has no stages for this crop, skip straight to parts —
      // the BL-08 algorithm handles a stage-less filter fine.
      if (data.length === 0) {
        loadParts(crop_cosh_id)
      } else {
        setStage('select_stage')
        setLoading(false)
      }
    } catch {
      setLoading(false)
    }
  }

  async function pickStage(st: CropStage) {
    setSelectedStage(st)
    setStage('select_method')
  }

  async function chooseSelfDiagnose() {
    if (!cropCoshId) return
    setLoading(true)
    await loadParts(cropCoshId, selectedStage?.cosh_id)
  }

  async function chooseAIDiagnose() {
    setAiImages([])
    setAiError('')
    setStage('ai_capture')
  }

  async function handleAiPhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    // 5-image soft cap — Claude vision handles more but base64
    // payload + farmer attention both fall off after that.
    const room = Math.max(0, 5 - aiImages.length)
    const toAdd = files.slice(0, room)
    const additions: Array<{ base64: string; media_type: string; preview: string }> = []
    for (const f of toAdd) {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(f)
      })
      additions.push({
        base64,
        media_type: f.type || 'image/jpeg',
        preview: URL.createObjectURL(f),
      })
    }
    setAiImages(prev => [...prev, ...additions])
    // Reset the input so picking the same file again still fires onChange.
    if (aiFileInputRef.current) aiFileInputRef.current.value = ''
  }

  function removeAiImage(idx: number) {
    setAiImages(prev => {
      const next = [...prev]
      const [removed] = next.splice(idx, 1)
      if (removed?.preview) URL.revokeObjectURL(removed.preview)
      return next
    })
  }

  async function submitAiDiagnosis() {
    if (!cropCoshId || aiImages.length === 0) return
    setAiSubmitting(true); setAiError('')
    try {
      const payload = {
        subscription_id: subscriptionId,
        crop_cosh_id: cropCoshId,
        crop_stage_cosh_id: selectedStage?.cosh_id || null,
        images: aiImages.map(i => ({ base64: i.base64, media_type: i.media_type })),
      }
      const { data } = await api.post<{
        needs_expert: boolean
        session_id?: string
        analysis: ImageAnalysis
        problem_info?: ProblemInfo
        committed_to_advisory?: boolean
      }>('/diagnosis/ai-direct-diagnose', payload)
      if (data.needs_expert) {
        setStage('ai_needs_expert')
        setImageAnalysis(data.analysis)
        return
      }
      // Confident match → reuse the diagnosed-screen path so the
      // farmer sees the same Commit-to-Advisory CTA + Claude
      // description + (eventually) reference images.
      setSessionId(data.session_id || null)
      setDiagnosis(data.problem_info || null)
      setImageAnalysis(data.analysis)
      setCommittedToAdvisory(!!data.committed_to_advisory)
      setStage('diagnosed')
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message
      setAiError(msg || 'AI diagnosis failed. Please try again or use the guided path.')
    } finally { setAiSubmitting(false) }
  }

  async function loadParts(crop_cosh_id: string, stage_id?: string) {
    try {
      const params = new URLSearchParams({ crop_cosh_id })
      // Backend reads `crop_stage` (not `crop_stage_cosh_id`); the
      // older name was silently dropped, which is why FRUIT showed
      // up under Seedling.
      if (stage_id) params.append('crop_stage', stage_id)
      const { data } = await api.get<PlantPart[]>(`/diagnosis/plant-parts?${params}`)
      setParts(data)
    } finally { setLoading(false) }
    setStage('select_part')
  }

  // Routes the response from /start or /answer into the correct PWA
  // stage. CONFIRMATION shows the new "Is this the problem?" card;
  // OUTSIDE_LIST shows the honest "not in our catalogue" screen.
  // Single function so /start and /answer can't drift apart.
  function applyStepStatus(data: DiagnosisStep) {
    setRemainingCount(data.remaining_count)
    if (data.status === 'CONFIRMATION') {
      setDiagnosis(data.problem_info || null)
      setStage('confirming')
    } else if (data.status === 'DIAGNOSED') {
      setDiagnosis(data.problem_info || null)
      setStage('diagnosed')
    } else if (data.status === 'OUTSIDE_LIST') {
      setStage('outside_list')
    } else if (data.status === 'NO_DATA') {
      goToAskExpert()
    } else {
      setCurrentQuestion(data.question)
      setStage('questioning')
    }
  }

  async function startDiagnosis(part: PlantPart) {
    setSelectedPart(part.cosh_id)
    setLoading(true)
    try {
      const { data } = await api.post<DiagnosisStep>('/diagnosis/start', {
        subscription_id: subscriptionId,
        crop_cosh_id: cropCoshId,
        crop_stage_cosh_id: selectedStage?.cosh_id || null,
        plant_part_cosh_id: part.cosh_id,
      })
      setSessionId(data.session_id || null)
      applyStepStatus(data)
    } finally { setLoading(false) }
  }

  async function answer(choice: 'YES' | 'NO') {
    if (!currentQuestion || !sessionId) return
    setAnswering(true)
    const prev = currentQuestion
    try {
      const { data } = await api.post<DiagnosisStep>(`/diagnosis/${sessionId}/answer`, {
        plant_part_cosh_id: currentQuestion.plant_part_cosh_id,
        symptom_cosh_id: currentQuestion.symptom_cosh_id,
        sub_part_cosh_id: currentQuestion.sub_part_cosh_id,
        sub_symptom_cosh_id: currentQuestion.sub_symptom_cosh_id,
        answer: choice,
      })
      setQuestionHistory(h => [...h, prev])
      setExplainText(null)  // each question gets a fresh explanation
      applyStepStatus(data)
    } finally { setAnswering(false) }
  }

  // BL-08 §8 amendment: when the algorithm narrows to one candidate,
  // the farmer is asked to confirm. YES locks in the diagnosis; NO
  // routes to the honest "outside our list" screen.
  async function confirmAnswer(choice: 'YES' | 'NO') {
    if (!sessionId) return
    setAnswering(true)
    try {
      const { data } = await api.post<DiagnosisStep>(`/diagnosis/${sessionId}/answer`, {
        plant_part_cosh_id: selectedPart || '',
        symptom_cosh_id: '',
        answer: choice,
        is_confirmation: true,
      })
      applyStepStatus(data)
    } finally { setAnswering(false) }
  }

  async function handleImageCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !cropCoshId || !selectedPart) return
    setAnalyzingImage(true)
    setImageAnalysis(null)
    try {
      // Convert to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const { data } = await api.post<{ analysis: ImageAnalysis; note: string }>('/diagnosis/image-analysis', {
        image_base64: base64,
        media_type: file.type || 'image/jpeg',
        crop_cosh_id: cropCoshId,
        crop_name: cropCoshId.replace(/_/g, ' '),
        plant_part_cosh_id: selectedPart,
        plant_part_name: selectedPart.replace(/_/g, ' '),
      })
      setImageAnalysis(data.analysis)
    } catch { setImageAnalysis(null) }
    finally { setAnalyzingImage(false) }
  }

  async function useImageDiagnosis() {
    if (!imageAnalysis?.problem_cosh_id || !sessionId) return
    await api.post(`/diagnosis/${sessionId}/abort`, {
      reason: 'KNOW_PROBLEM',
      problem_cosh_id: imageAnalysis.problem_cosh_id,
    })
    // Get problem info
    const { data } = await api.post<DiagnosisStep>(`/diagnosis/${sessionId}/abort`, {
      reason: 'KNOW_PROBLEM',
      problem_cosh_id: imageAnalysis.problem_cosh_id,
    })
    setDiagnosis(data.problem_info || null)
    setStage('diagnosed')
  }

  async function dontKnow() {
    if (!sessionId) return
    await api.post(`/diagnosis/${sessionId}/abort`, { reason: 'DONT_KNOW' })
    goToAskExpert()
  }

  async function openExplain() {
    if (!currentQuestion || !cropCoshId) return
    setExplainOpen(true)
    if (explainText) return  // Already loaded for this question
    setExplainLoading(true)
    try {
      const { data } = await api.post<{ explanation: string; language_code: string }>(
        '/diagnosis/explain-symptom',
        {
          crop_cosh_id: cropCoshId,
          plant_part_cosh_id: currentQuestion.plant_part_cosh_id,
          symptom_cosh_id: currentQuestion.symptom_cosh_id,
          sub_part_cosh_id: currentQuestion.sub_part_cosh_id,
          sub_symptom_cosh_id: currentQuestion.sub_symptom_cosh_id,
        }
      )
      setExplainText(data.explanation)
    } catch {
      setExplainText('Look carefully at the plant part shown. Tap Yes if you see the symptom, No if you do not.')
    } finally {
      setExplainLoading(false)
    }
  }

  async function commitToAdvisory() {
    if (!sessionId) return
    setCommitting(true); setCommitError('')
    try {
      const { data } = await api.post<CommitResult>(
        `/diagnosis/${sessionId}/commit-to-advisory`,
      )
      setCommittedToAdvisory(!!data.committed_to_advisory)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message
      setCommitError(msg || 'Could not add to advisory. Please try again.')
    } finally { setCommitting(false) }
  }

  // Auto-fetch curated reference images each time the question
  // changes. The endpoint already filters by the question's exact
  // (crop, part, symptom, sub_part, sub_symptom) context and returns
  // Cosh-curated S3 URLs + a Google fallback URL. Stale images from
  // a previous question must be wiped before the new fetch lands so
  // the farmer never compares against the wrong thing.
  useEffect(() => {
    if (!currentQuestion || !cropCoshId) return
    let cancelled = false
    setRefImages([])
    setGalleryOpen(false)
    setRefImagesLoading(true)
    api.post<{
      images: ReferenceImage[]; google_images_url: string;
    }>('/diagnosis/reference-images', {
      crop_cosh_id: cropCoshId,
      plant_part_cosh_id: currentQuestion.plant_part_cosh_id,
      symptom_cosh_id: currentQuestion.symptom_cosh_id,
      sub_part_cosh_id: currentQuestion.sub_part_cosh_id,
      sub_symptom_cosh_id: currentQuestion.sub_symptom_cosh_id,
    })
    .then(r => {
      if (cancelled) return
      setRefImages(r.data.images || [])
      setGoogleFallbackUrl(r.data.google_images_url || '')
    })
    .catch(() => { if (!cancelled) setRefImages([]) })
    .finally(() => { if (!cancelled) setRefImagesLoading(false) })
    return () => { cancelled = true }
  }, [currentQuestion?.plant_part_cosh_id, currentQuestion?.symptom_cosh_id,
      currentQuestion?.sub_part_cosh_id, currentQuestion?.sub_symptom_cosh_id,
      cropCoshId])

  async function knowProblem() {
    // Load problem list filtered to selected part
    try {
      const { data } = await api.get<ProblemInfo[]>(
        `/diagnosis/problems?crop_cosh_id=${cropCoshId}&plant_part_cosh_id=${selectedPart}`
      )
      setProblems(data)
      setStage('know_problem')
    } catch { goToAskExpert() }
  }

  async function selectKnownProblem(problemId: string) {
    if (!sessionId) return
    const { data } = await api.post<DiagnosisStep>(`/diagnosis/${sessionId}/abort`, {
      reason: 'KNOW_PROBLEM',
      problem_cosh_id: problemId,
    })
    setDiagnosis(data.problem_info || null)
    setStage('diagnosed')
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: COLOUR }} />
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Diagnose Crop Problem" activeRole="FARMER" back={`/advisory/${subscriptionId}`} />
      <div className="pt-16">
        <ClientCropChip subscriptionId={subscriptionId} />
      </div>
      <div className="pb-20 px-4">

        {/* Select crop stage */}
        {stage === 'select_stage' && (
          <div className="mt-4 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-[#6B3F1F]">What stage is your crop in?</h2>
              <p className="text-[#7A8C7E] text-sm mt-0.5">
                Picking the right stage narrows the diagnosis to problems that are typical at this point in the season.
              </p>
            </div>
            {stages.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center border border-[#DDD0B8]">
                <p className="text-[#7A8C7E] text-sm">Loading stages…</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {stages.map(st => (
                  <button key={st.cosh_id} onClick={() => pickStage(st)}
                    className="bg-white rounded-2xl p-5 border border-[#DDD0B8] shadow-sm text-left active:scale-95 transition-transform flex items-center gap-4">
                    <span className="text-3xl">{getStageEmoji(st.name)}</span>
                    <p className="font-medium text-[#6B3F1F] text-base">{st.name}</p>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => router.back()}
              className="w-full py-3 border border-[#DDD0B8] text-[#6B3F1F] rounded-2xl text-sm">
              Cancel
            </button>
          </div>
        )}

        {/* Diagnose Yourself vs Ask AI */}
        {stage === 'select_method' && (
          <div className="mt-4 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-[#6B3F1F]">How would you like to diagnose?</h2>
              <p className="text-[#7A8C7E] text-sm mt-0.5">
                {selectedStage ? `Crop stage: ${selectedStage.name}. ` : ''}
                You can answer simple Yes / No questions yourself, or let
                AI take a look at photos you upload.
              </p>
            </div>
            <button onClick={chooseSelfDiagnose}
              className="w-full bg-white rounded-2xl p-5 border-2 shadow-sm text-left active:scale-98 transition-transform"
              style={{ borderColor: COLOUR }}>
              <div className="flex items-start gap-3">
                <span className="text-3xl">🧑‍🌾</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-[#6B3F1F]">Diagnose yourself</p>
                    <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Recommended</span>
                  </div>
                  <p className="text-xs text-[#7A8C7E] mt-1">
                    Answer a few Yes / No questions with help from reference photos.
                    More accurate when the symptom is clear to you.
                  </p>
                </div>
              </div>
            </button>
            <button onClick={chooseAIDiagnose}
              className="w-full bg-white rounded-2xl p-5 border border-[#DDD0B8] shadow-sm text-left active:scale-98 transition-transform">
              <div className="flex items-start gap-3">
                <span className="text-3xl">🤖</span>
                <div className="flex-1">
                  <p className="font-semibold text-[#6B3F1F]">Ask AI to diagnose</p>
                  <p className="text-xs text-[#7A8C7E] mt-1">
                    Upload one or more photos and let AI suggest the most likely problem.
                    If AI is unsure, it will refer you to a FarmPundit expert.
                  </p>
                </div>
              </div>
            </button>
            <button onClick={() => { setSelectedStage(null); setStage('select_stage') }}
              className="w-full py-3 border border-[#DDD0B8] text-[#6B3F1F] rounded-2xl text-sm">
              ← Back to stage
            </button>
          </div>
        )}

        {/* AI direct diagnosis — multi-photo capture */}
        {stage === 'ai_capture' && (
          <div className="mt-4 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-[#6B3F1F]">Take or upload photos</h2>
              <p className="text-[#7A8C7E] text-sm mt-0.5">
                {selectedStage ? `Crop stage: ${selectedStage.name}. ` : ''}
                Add 1–5 clear photos showing the affected parts. Multiple angles help AI judge better.
              </p>
            </div>
            <input
              ref={aiFileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={handleAiPhotoCapture}
            />
            {aiImages.length === 0 ? (
              <button onClick={() => aiFileInputRef.current?.click()}
                className="w-full bg-white rounded-2xl py-12 border-2 border-dashed border-[#DDD0B8] text-[#6B3F1F]">
                <span className="text-4xl block">📸</span>
                <p className="mt-2 text-sm font-medium">Take or pick a photo</p>
                <p className="text-xs text-[#7A8C7E] mt-1">Tap to add</p>
              </button>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {aiImages.map((img, idx) => (
                    <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 border border-[#DDD0B8]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.preview} alt="Uploaded" className="w-full h-full object-cover" />
                      <button onClick={() => removeAiImage(idx)}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-xs"
                        aria-label="Remove photo">×</button>
                    </div>
                  ))}
                </div>
                {aiImages.length < 5 && (
                  <button onClick={() => aiFileInputRef.current?.click()}
                    className="w-full py-2.5 rounded-xl border border-dashed border-[#DDD0B8] text-[#6B3F1F] text-sm">
                    📸 Add another ({aiImages.length}/5)
                  </button>
                )}
                <button onClick={submitAiDiagnosis} disabled={aiSubmitting}
                  className="w-full py-4 rounded-2xl text-white font-semibold disabled:opacity-60"
                  style={{ background: COLOUR }}>
                  {aiSubmitting ? '🤖 AI is looking at your photos…' : '🤖 Diagnose with AI'}
                </button>
                {aiError && <p className="text-sm text-red-600 text-center">{aiError}</p>}
              </div>
            )}
            <button onClick={() => { setAiImages([]); setStage('select_method') }}
              disabled={aiSubmitting}
              className="w-full py-3 border border-[#DDD0B8] text-[#6B3F1F] rounded-2xl text-sm disabled:opacity-50">
              ← Back
            </button>
          </div>
        )}

        {/* AI couldn't match — route to FarmPundit */}
        {stage === 'ai_needs_expert' && (
          <div className="mt-4 space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
              <p className="text-base font-semibold text-amber-900">AI is not sure about this one</p>
              <p className="text-sm text-amber-800 mt-2">
                {imageAnalysis?.description
                  || "The photos didn't match a problem the AI is confident about for this crop and stage. A FarmPundit expert will give you a more reliable answer."}
              </p>
            </div>
            <button onClick={() => goToAskExpert()}
              className="w-full py-4 rounded-2xl text-white font-semibold"
              style={{ background: COLOUR }}>
              👨‍🌾 Ask FarmPundit Expert →
            </button>
            <button onClick={() => { setImageAnalysis(null); setStage('ai_capture') }}
              className="w-full py-3 rounded-2xl border border-[#DDD0B8] text-[#6B3F1F] text-sm">
              📸 Try different photos
            </button>
            <button onClick={() => { setImageAnalysis(null); setStage('select_method') }}
              className="w-full py-3 rounded-2xl border border-[#DDD0B8] text-[#6B3F1F] text-sm">
              🧑‍🌾 Switch to guided diagnosis
            </button>
          </div>
        )}

        {/* Select plant part */}
        {stage === 'select_part' && (
          <div className="mt-4 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-[#6B3F1F]">Which part of the plant is affected?</h2>
              <p className="text-[#7A8C7E] text-sm mt-0.5">
                {selectedStage
                  ? `Stage: ${selectedStage.name} — select the part where you see the problem`
                  : 'Select the part where you see the problem'}
              </p>
            </div>
            {parts.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center border border-[#DDD0B8]">
                <p className="text-[#7A8C7E] text-sm">No diagnostic data available for this crop yet.</p>
                <button onClick={() => goToAskExpert()}
                  className="mt-4 text-white font-semibold px-5 py-2.5 rounded-xl text-sm"
                  style={{ background: COLOUR }}>
                  Ask an Expert Instead →
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {parts.map(part => (
                  <button key={part.cosh_id} onClick={() => startDiagnosis(part)}
                    className="bg-white rounded-2xl p-5 border border-[#DDD0B8] shadow-sm text-left active:scale-95 transition-transform">
                    <span className="text-3xl">{getPartEmoji(part.name)}</span>
                    <p className="font-medium text-[#6B3F1F] mt-2">{part.name}</p>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => {
                if (stages.length > 0) {
                  setStage('select_method')
                } else {
                  router.back()
                }
              }}
              className="w-full py-3 border border-[#DDD0B8] text-[#6B3F1F] rounded-2xl text-sm">
              {stages.length > 0 ? '← Back' : 'Cancel'}
            </button>
          </div>
        )}

        {/* Symptom question */}
        {stage === 'questioning' && currentQuestion && (
          <div className="mt-4 space-y-4">
            {/* Progress */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ background: COLOUR, width: `${Math.max(10, 100 - remainingCount * 10)}%` }} />
              </div>
              <span className="text-xs text-[#7A8C7E]">{remainingCount} possible</span>
            </div>

            {/* Question card */}
            <div className="bg-white rounded-3xl p-6 border border-[#DDD0B8] shadow-sm">
              <div className="text-center mb-6">
                <span className="text-5xl">{getPartEmoji(currentQuestion.plant_part_name)}</span>
                <div className="flex items-center justify-center gap-2 mt-4">
                  <p className="text-xl font-bold text-[#6B3F1F] leading-tight">
                    {currentQuestion.display_text}
                  </p>
                  <button
                    type="button"
                    onClick={openExplain}
                    aria-label="Explain this question"
                    className="shrink-0 w-7 h-7 rounded-full border border-[#DDD0B8] text-[#7A8C7E] text-xs font-semibold active:scale-95 transition-transform">
                    ⓘ
                  </button>
                </div>
                <p className="text-[#7A8C7E] text-xs mt-2">
                  {[
                    currentQuestion.plant_part_name,
                    currentQuestion.sub_part_name,
                    currentQuestion.symptom_name,
                    currentQuestion.sub_symptom_name,
                  ].filter(Boolean).join(' — ')}
                </p>
              </div>

              {/* Reference images — curated by Cosh, scoped to the
                  exact (crop, part, symptom) context of THIS question.
                  Two thumbnails inline for at-a-glance comparison;
                  rest behind "See N more" → gallery sheet. */}
              {refImagesLoading ? (
                <div className="mb-4 grid grid-cols-2 gap-2">
                  <div className="aspect-square bg-slate-100 rounded-xl animate-pulse" />
                  <div className="aspect-square bg-slate-100 rounded-xl animate-pulse" />
                </div>
              ) : refImages.length > 0 ? (
                <div className="mb-4">
                  <p className="text-[11px] uppercase tracking-wide font-semibold text-[#7A8C7E] mb-2">
                    Compare with these examples
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {refImages.slice(0, 2).map(img => (
                      <button key={img.cosh_id} type="button"
                        onClick={() => setZoomedImage(img)}
                        className="text-left active:scale-95 transition-transform">
                        <div className="aspect-square overflow-hidden rounded-xl border border-[#DDD0B8] bg-slate-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url}
                            alt={img.caption || 'Reference image'}
                            loading="lazy"
                            className="w-full h-full object-cover" />
                        </div>
                        {img.caption && (
                          <p className="text-[10px] text-[#7A8C7E] mt-1 line-clamp-2">{img.caption}</p>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    {refImages.length > 2 ? (
                      <button type="button" onClick={() => setGalleryOpen(true)}
                        className="text-xs font-medium text-blue-600 underline underline-offset-2">
                        See {refImages.length - 2} more example{refImages.length - 2 === 1 ? '' : 's'}
                      </button>
                    ) : <span />}
                    <a href={googleFallbackUrl || `https://www.google.com/search?tbm=isch&q=${encodeURIComponent([cropName, currentQuestion.plant_part_name, currentQuestion.symptom_name].filter(Boolean).join(' '))}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-[11px] text-[#7A8C7E] underline underline-offset-2">
                      Search Google
                    </a>
                  </div>
                </div>
              ) : (
                <div className="mb-4 text-center">
                  <p className="text-xs text-[#7A8C7E]">
                    No curated examples for this exact symptom yet.
                  </p>
                  <a href={googleFallbackUrl || `https://www.google.com/search?tbm=isch&q=${encodeURIComponent([cropName, currentQuestion.plant_part_name, currentQuestion.symptom_name].filter(Boolean).join(' '))}`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1 text-xs text-blue-600 underline underline-offset-2">
                    🔍 Search Google Images
                  </a>
                </div>
              )}

              {/* YES / NO — the primary answers */}
              <div className="flex gap-3 mt-2">
                <button onClick={() => answer('NO')} disabled={answering}
                  className="flex-1 py-4 rounded-2xl border-2 border-red-200 bg-red-50 text-red-700 font-bold text-lg disabled:opacity-50 active:scale-95 transition-transform">
                  ✗ No
                </button>
                <button onClick={() => answer('YES')} disabled={answering}
                  className="flex-1 py-4 rounded-2xl border-2 text-white font-bold text-lg disabled:opacity-50 active:scale-95 transition-transform"
                  style={{ borderColor: COLOUR, background: COLOUR }}>
                  ✓ Yes
                </button>
              </div>

              {/* I Don't Know is not a button — it's the gateway to two
                  help paths. The conceptual third option, framed
                  honestly: ask Claude with a photo, or ask a human
                  expert. Hidden file input drives the camera path. */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleImageCapture}
              />
              <div className="mt-5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-px bg-[#DDD0B8]" />
                  <p className="text-[11px] uppercase tracking-wider text-[#7A8C7E] font-semibold">
                    Not sure?
                  </p>
                  <div className="flex-1 h-px bg-[#DDD0B8]" />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={analyzingImage}
                    className="flex-1 py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium disabled:opacity-50 active:scale-95 transition-transform">
                    {analyzingImage ? '🔄 Analysing…' : '📸 Ask AI'}
                  </button>
                  <button onClick={dontKnow}
                    disabled={!hasPrimaryExpert}
                    title={hasPrimaryExpert ? undefined : "No Primary expert at this company yet"}
                    className="flex-1 py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium active:scale-95 transition-transform disabled:opacity-50 disabled:active:scale-100">
                    👨‍🌾 Ask Expert
                    {!hasPrimaryExpert && (
                      <span className="block text-[10px] text-[#7A8C7E] mt-0.5">No expert yet</span>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Claude analysis result — appears under the card when
                a photo has been analysed. Stays out of the way until
                there is something to show. */}
            {imageAnalysis && (
              <div className={`rounded-2xl p-4 border ${imageAnalysis.confidence === 'HIGH' ? 'bg-green-50 border-green-200' : imageAnalysis.confidence === 'MEDIUM' ? 'bg-amber-50 border-amber-200' : 'bg-[#F5F0E8] border-[#DDD0B8]'}`}>
                <p className="text-[11px] uppercase tracking-wider text-[#7A8C7E] font-semibold mb-2">
                  📸 AI Analysis
                </p>
                <p className="text-sm font-semibold text-[#6B3F1F]">{imageAnalysis.problem_name}</p>
                <p className="text-xs text-[#7A8C7E] mt-0.5">{imageAnalysis.description}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-2 inline-block ${imageAnalysis.confidence === 'HIGH' ? 'bg-green-100 text-green-700' : imageAnalysis.confidence === 'MEDIUM' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-[#7A8C7E]'}`}>
                  {imageAnalysis.confidence} confidence
                </span>
                {imageAnalysis.problem_cosh_id && imageAnalysis.confidence !== 'LOW' && (
                  <button
                    onClick={useImageDiagnosis}
                    className="mt-3 w-full py-2.5 rounded-xl text-white text-sm font-semibold"
                    style={{ background: COLOUR }}>
                    ✓ Use this diagnosis
                  </button>
                )}
              </div>
            )}

            {/* I Know the Problem — the third top-level escape: skip
                the dichotomous questioning entirely and pick from the
                full problem list for this part. Sits on its own row
                so it reads as a complete choice. */}
            <button onClick={knowProblem}
              className="w-full py-3 rounded-2xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium">
              🔍 I Know the Problem
            </button>

            <p className="text-center text-xs text-[#DDD0B8]">{questionHistory.length + 1} questions answered</p>
          </div>
        )}

        {/* ⓘ Symptom explanation sheet */}
        {explainOpen && (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setExplainOpen(false)}
            className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
            <div
              onClick={e => e.stopPropagation()}
              className="bg-white w-full max-w-md rounded-t-3xl p-5 shadow-xl">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">🤖</span>
                <p className="text-sm font-semibold text-[#6B3F1F]">How to check this symptom</p>
              </div>
              {explainLoading ? (
                <div className="py-4 flex justify-center">
                  <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: COLOUR }} />
                </div>
              ) : (
                <p className="text-sm text-[#6B3F1F] leading-relaxed">{explainText}</p>
              )}
              <button
                onClick={() => setExplainOpen(false)}
                className="mt-4 w-full py-2.5 rounded-xl text-white text-sm font-semibold"
                style={{ background: COLOUR }}>
                Got it
              </button>
            </div>
          </div>
        )}

        {/* Know the problem — manual selection */}
        {stage === 'know_problem' && (
          <div className="mt-4 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-[#6B3F1F]">Select the Problem</h2>
              <p className="text-[#7A8C7E] text-sm mt-0.5">Choose the problem you have identified</p>
            </div>
            {problems.length === 0 ? (
              <div className="text-center py-8 text-[#7A8C7E] text-sm">No problems found for this plant part</div>
            ) : (
              <div className="space-y-2">
                {problems.map(p => (
                  <div key={p.cosh_id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
                    <button onClick={() => selectKnownProblem(p.cosh_id)}
                      className="w-full p-4 text-left active:scale-98 transition-transform">
                      <p className="font-medium text-[#6B3F1F]">{p.name}</p>
                      <p className="text-xs text-[#7A8C7E] font-mono mt-0.5">{p.cosh_id}</p>
                    </button>
                    <a
                      href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(
                        [cropCoshId?.replace(/_/g, ' '), p.name].filter(Boolean).join(' ')
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-4 pb-3 text-xs text-blue-600 underline underline-offset-2">
                      🔍 See images
                    </a>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setStage('questioning')}
              className="w-full py-3 border border-[#DDD0B8] text-[#6B3F1F] rounded-2xl text-sm">
              ← Back to Questions
            </button>
          </div>
        )}

        {/* Confirmation — BL-08 §8 amendment (2026-05-28). The algorithm
            has narrowed the pool to a single candidate. Don't auto-commit;
            ask the farmer to confirm. YES → diagnosed. NO → outside-list.
            This catches earlier mis-taps gracefully and means the system
            never pretends confidence it doesn't have. */}
        {stage === 'confirming' && (
          <div className="mt-4 space-y-4">
            <div className="bg-white rounded-3xl p-6 border border-[#DDD0B8] shadow-sm">
              <div className="text-center">
                <span className="text-5xl">🤔</span>
                <h2 className="text-xl font-bold text-[#6B3F1F] mt-4">Looks like the problem is…</h2>
                {diagnosis ? (
                  <p className="text-2xl font-bold mt-3" style={{ color: COLOUR }}>
                    {diagnosis.name}
                  </p>
                ) : (
                  <p className="text-[#6B3F1F] mt-3">a problem we can identify</p>
                )}
                <p className="text-[#7A8C7E] text-sm mt-3">
                  Does this match what you&apos;re seeing on the crop?
                </p>
              </div>

              {/* Claude description if available — helps the farmer decide */}
              {diagnosis?.claude_description && (
                <div className="mt-5 bg-green-50 border border-green-200 rounded-2xl px-4 py-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">🤖</span>
                    <p className="text-xs font-semibold text-green-800">What this means for your crop</p>
                  </div>
                  <p className="text-sm text-green-900 leading-relaxed">{diagnosis.claude_description}</p>
                </div>
              )}

              {/* Google Images for quick visual check */}
              {diagnosis && (
                <a
                  href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(
                    [cropCoshId?.replace(/_/g, ' '), diagnosis.name].filter(Boolean).join(' ')
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center mt-4 text-sm text-blue-600 underline underline-offset-2">
                  🔍 See images of {diagnosis.name}
                </a>
              )}

              <div className="flex gap-3 mt-5">
                <button onClick={() => confirmAnswer('NO')} disabled={answering}
                  className="flex-1 py-4 rounded-2xl border-2 border-red-200 bg-red-50 text-red-700 font-bold text-lg disabled:opacity-50 active:scale-95 transition-transform">
                  ✗ Not this
                </button>
                <button onClick={() => confirmAnswer('YES')} disabled={answering}
                  className="flex-1 py-4 rounded-2xl border-2 text-white font-bold text-lg disabled:opacity-50 active:scale-95 transition-transform"
                  style={{ borderColor: COLOUR, background: COLOUR }}>
                  ✓ Yes, this matches
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Outside our list — farmer rejected the confirmation candidate,
            OR the pool emptied entirely (rare; a NO that eliminated the
            last 2+ candidates at once). Honest exit — the system can't
            help further with the structured path; route to an expert. */}
        {stage === 'outside_list' && (
          <div className="mt-4 space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
              <span className="text-5xl">🤷</span>
              <h2 className="text-xl font-bold text-amber-900 mt-4">Not in our list</h2>
              <p className="text-sm text-amber-800 mt-3 leading-relaxed">
                The problem you&apos;re facing doesn&apos;t seem to be in the RootsTalk catalogue
                for this crop and stage. A FarmPundit expert can look at it directly.
              </p>
            </div>
            <button onClick={() => goToAskExpert()}
              disabled={!hasPrimaryExpert}
              title={hasPrimaryExpert ? undefined : "No Primary expert at this company yet"}
              className="w-full py-4 rounded-2xl text-white font-semibold disabled:opacity-50"
              style={{ background: COLOUR }}>
              👨‍🌾 Ask FarmPundit Expert →
            </button>
            <button onClick={() => {
                setSelectedPart(null); setDiagnosis(null); setCurrentQuestion(null)
                setQuestionHistory([])
                if (stages.length > 0) setStage('select_method')
                else setStage('select_part')
              }}
              className="w-full py-3 rounded-2xl border border-[#DDD0B8] text-[#6B3F1F] text-sm">
              ← Try a different part or stage
            </button>
          </div>
        )}

        {/* Diagnosis result */}
        {stage === 'diagnosed' && (
          <div className="mt-4 space-y-4">
            <div className="bg-white rounded-3xl p-6 border border-[#DDD0B8] shadow-sm">
              <div className="text-center">
                <span className="text-5xl">🔬</span>
                <h2 className="text-xl font-bold text-[#6B3F1F] mt-4">Problem Identified</h2>
                {diagnosis ? (
                  <>
                    <p className="text-2xl font-bold mt-3" style={{ color: COLOUR }}>
                      {diagnosis.name}
                    </p>
                    <p className="text-[#7A8C7E] text-xs mt-1 font-mono">{diagnosis.cosh_id}</p>
                    {/* Google Images link — pre-formed search [Crop] [Problem name] */}
                    <a
                      href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(
                        [cropCoshId?.replace(/_/g, ' '), diagnosis.name].filter(Boolean).join(' ')
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-xs text-blue-600 underline underline-offset-2">
                      🔍 See images of {diagnosis.name}
                    </a>
                  </>
                ) : (
                  <p className="text-[#6B3F1F] mt-3">Problem recorded</p>
                )}
              </div>

              {/* Claude's 2-sentence description — the key feature */}
              {diagnosis?.claude_description && (
                <div className="mt-5 bg-green-50 border border-green-200 rounded-2xl px-4 py-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">🤖</span>
                    <p className="text-xs font-semibold text-green-800">What this means for your crop</p>
                  </div>
                  <p className="text-sm text-green-900 leading-relaxed">{diagnosis.claude_description}</p>
                </div>
              )}

              {committedToAdvisory && (
                <div className="mt-4 bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3">
                  <p className="text-sm font-semibold text-blue-800">Added to your advisory ✓</p>
                  <p className="text-xs text-blue-600 mt-1">
                    Treatment recommendations for this problem are now part of your advisory timeline.
                  </p>
                </div>
              )}
            </div>

            {!committedToAdvisory ? (
              <div className="space-y-2">
                <button onClick={commitToAdvisory} disabled={committing}
                  className="w-full py-4 rounded-2xl text-white font-semibold disabled:opacity-60"
                  style={{ background: COLOUR }}>
                  {committing ? 'Adding…' : '➕ Add Treatment Recommendations to the Advisory'}
                </button>
                {commitError && (
                  <p className="text-xs text-red-600 text-center">{commitError}</p>
                )}
                <button onClick={() => goToAskExpert()}
                  className="w-full py-3 rounded-2xl border border-[#DDD0B8] text-[#6B3F1F] text-sm">
                  Also ask a FarmPundit expert
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button onClick={() => router.push(`/advisory/${subscriptionId}`)}
                  className="w-full py-4 rounded-2xl text-white font-semibold"
                  style={{ background: COLOUR }}>
                  Go to Advisory →
                </button>
                <button onClick={() => router.push(`/crop-detail/${subscriptionId}`)}
                  className="w-full py-3 rounded-2xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium">
                  Go to Crop Dashboard
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Gallery sheet — opens from "See N more examples". Lists every
          curated image with caption; tap to zoom in for a clearer look. */}
      {galleryOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center"
          onClick={() => setGalleryOpen(false)}>
          <div className="bg-[#F5F0E8] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[85vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#DDD0B8] flex items-center justify-between">
              <div>
                <h3 className="font-bold text-[#6B3F1F]">Reference images</h3>
                <p className="text-xs text-[#7A8C7E] mt-0.5">
                  {[currentQuestion?.plant_part_name, currentQuestion?.symptom_name]
                    .filter(Boolean).join(' — ')}
                </p>
              </div>
              <button onClick={() => setGalleryOpen(false)}
                className="text-[#7A8C7E] text-xl w-8 h-8 rounded-full hover:bg-[#DDD0B8]/40">
                ×
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-3">
              {refImages.map(img => (
                <button key={img.cosh_id} type="button"
                  onClick={() => setZoomedImage(img)}
                  className="block w-full text-left active:scale-98 transition-transform">
                  <div className="aspect-video overflow-hidden rounded-2xl border border-[#DDD0B8] bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url}
                      alt={img.caption || 'Reference image'}
                      loading="lazy"
                      className="w-full h-full object-cover" />
                  </div>
                  {img.caption && (
                    <p className="text-xs text-[#6B3F1F] mt-1.5">{img.caption}</p>
                  )}
                </button>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-[#DDD0B8] text-center">
              <a href={googleFallbackUrl}
                target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-600 underline underline-offset-2">
                Search Google for more →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen image zoom — tap a thumbnail or a gallery row. */}
      {zoomedImage && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setZoomedImage(null)}>
          <div className="relative max-w-full max-h-full flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={zoomedImage.url}
              alt={zoomedImage.caption || 'Reference image'}
              className="max-w-full max-h-[85vh] object-contain rounded-xl" />
            {zoomedImage.caption && (
              <p className="text-white text-sm text-center px-4">{zoomedImage.caption}</p>
            )}
            <button onClick={() => setZoomedImage(null)}
              className="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/60 text-white text-xl">
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function getStageEmoji(stageName: string | null | undefined): string {
  if (!stageName) return '🌱'
  const lower = stageName.toLowerCase()
  if (lower.includes('seedling')) return '🌱'
  if (lower.includes('veget')) return '🌿'
  if (lower.includes('reproduct') || lower.includes('flower')) return '🌸'
  if (lower.includes('fruit')) return '🍅'
  if (lower.includes('harvest') || lower.includes('mature')) return '🌾'
  return '🌱'
}


function getPartEmoji(partName: string | null | undefined): string {
  if (!partName) return '🌱'
  const emojis: Record<string, string> = {
    leaf: '🍃', stem: '🌿', root: '🪴', flower: '🌸', fruit: '🍅',
    nut: '🌰', tendril: '🌾', seed: '🌱', trunk: '🌳', branch: '🌲',
    canopy: '🌳', 'whole plant': '🌿', shoot: '🌱', tuber: '🥔',
  }
  const lower = partName.toLowerCase()
  for (const [key, emoji] of Object.entries(emojis)) {
    if (lower.includes(key)) return emoji
  }
  return '🌱'
}
