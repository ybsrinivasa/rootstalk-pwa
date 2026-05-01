'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

interface PlantPart { cosh_id: string; display_name: string }
interface Question {
  plant_part_cosh_id: string; symptom_cosh_id: string
  sub_part_cosh_id: string | null; sub_symptom_cosh_id: string | null
  question_type: string; display_text: string
}
interface ProblemInfo {
  cosh_id: string; name: string; type: string; parent_cosh_id?: string
  claude_description?: string    // 2-sentence farmer-friendly description from Claude
}
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

const COLOUR = '#1A5C2A'

export default function DiagnosisPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const router = useRouter()

  const [stage, setStage] = useState<'select_stage' | 'select_part' | 'questioning' | 'diagnosed' | 'know_problem' | 'aborted'>('select_stage')
  const [parts, setParts] = useState<PlantPart[]>([])
  const [problems, setProblems] = useState<ProblemInfo[]>([])
  const [selectedPart, setSelectedPart] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null)
  const [remainingCount, setRemainingCount] = useState(0)
  const [diagnosis, setDiagnosis] = useState<ProblemInfo | null>(null)
  const [cropCoshId, setCropCoshId] = useState<string | null>(null)
  const [answering, setAnswering] = useState(false)
  const [loading, setLoading] = useState(true)

  // Claude image analysis
  const [analyzingImage, setAnalyzingImage] = useState(false)
  const [imageAnalysis, setImageAnalysis] = useState<ImageAnalysis | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Question history for back navigation feel
  const [questionHistory, setQuestionHistory] = useState<Question[]>([])

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // Load subscription to get crop_cosh_id
    api.get<{ id: string; crop_cosh_id?: string }[]>('/farmer/my-subscriptions')
      .then(r => {
        const sub = r.data.find(s => s.id === subscriptionId)
        if (sub?.crop_cosh_id) {
          setCropCoshId(sub.crop_cosh_id)
          loadParts(sub.crop_cosh_id)
        } else {
          setLoading(false)
        }
      })
  }, [subscriptionId])

  async function loadParts(crop_cosh_id: string, stage_id?: string) {
    try {
      const params = new URLSearchParams({ crop_cosh_id })
      if (stage_id) params.append('crop_stage_cosh_id', stage_id)
      const { data } = await api.get<PlantPart[]>(`/diagnosis/plant-parts?${params}`)
      setParts(data)
    } finally { setLoading(false) }
    setStage('select_part')
  }

  async function startDiagnosis(part: PlantPart) {
    setSelectedPart(part.cosh_id)
    setLoading(true)
    try {
      const { data } = await api.post<DiagnosisStep>('/diagnosis/start', {
        subscription_id: subscriptionId,
        crop_cosh_id: cropCoshId,
        plant_part_cosh_id: part.cosh_id,
      })
      setSessionId(data.session_id || null)
      setRemainingCount(data.remaining_count)
      if (data.status === 'DIAGNOSED') {
        setDiagnosis(data.problem_info || null)
        setStage('diagnosed')
      } else if (data.status === 'NO_DATA') {
        router.push(`/ask-expert/${subscriptionId}`)
      } else {
        setCurrentQuestion(data.question)
        setStage('questioning')
      }
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
      setRemainingCount(data.remaining_count)
      if (data.status === 'DIAGNOSED') {
        setDiagnosis(data.problem_info || null)
        setStage('diagnosed')
      } else {
        setCurrentQuestion(data.question)
      }
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
    router.push(`/ask-expert/${subscriptionId}`)
  }

  async function knowProblem() {
    // Load problem list filtered to selected part
    try {
      const { data } = await api.get<ProblemInfo[]>(
        `/diagnosis/problems?crop_cosh_id=${cropCoshId}&plant_part_cosh_id=${selectedPart}`
      )
      setProblems(data)
      setStage('know_problem')
    } catch { router.push(`/ask-expert/${subscriptionId}`) }
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
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Diagnose Crop Problem" activeRole="FARMER" />
      <div className="pt-16 pb-20 px-4">

        {/* Select plant part */}
        {stage === 'select_part' && (
          <div className="mt-4 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Which part of the plant is affected?</h2>
              <p className="text-slate-400 text-sm mt-0.5">Select the part where you see the problem</p>
            </div>
            {parts.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center border border-slate-100">
                <p className="text-slate-500 text-sm">No diagnostic data available for this crop yet.</p>
                <button onClick={() => router.push(`/ask-expert/${subscriptionId}`)}
                  className="mt-4 text-white font-semibold px-5 py-2.5 rounded-xl text-sm"
                  style={{ background: COLOUR }}>
                  Ask an Expert Instead →
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {parts.map(part => (
                  <button key={part.cosh_id} onClick={() => startDiagnosis(part)}
                    className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm text-left active:scale-95 transition-transform">
                    <span className="text-3xl">{getPartEmoji(part.cosh_id)}</span>
                    <p className="font-medium text-slate-800 mt-2">{part.display_name}</p>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => router.back()}
              className="w-full py-3 border border-slate-200 text-slate-600 rounded-2xl text-sm">
              Cancel
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
              <span className="text-xs text-slate-400">{remainingCount} possible</span>
            </div>

            {/* Question card */}
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
              <div className="text-center mb-6">
                <span className="text-5xl">{getPartEmoji(currentQuestion.plant_part_cosh_id)}</span>
                <p className="text-xl font-bold text-slate-900 mt-4 leading-tight">
                  {currentQuestion.display_text}
                </p>
                <p className="text-slate-400 text-xs mt-2">
                  {currentQuestion.plant_part_cosh_id.replace(/_/g, ' ')} — {currentQuestion.symptom_cosh_id.replace(/_/g, ' ')}
                </p>
              </div>

              {/* YES / NO */}
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
            </div>

            {/* Camera: take photo for Claude analysis */}
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
              <p className="text-xs font-semibold text-slate-500 mb-2">📷 Or take a photo for AI identification</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleImageCapture}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={analyzingImage}
                className="w-full py-2.5 rounded-xl border border-slate-300 text-slate-700 text-sm font-medium disabled:opacity-50">
                {analyzingImage ? '🔄 Analysing with Claude AI…' : '📸 Take Photo of Problem'}
              </button>

              {/* Claude analysis result */}
              {imageAnalysis && (
                <div className={`mt-3 rounded-xl p-3 border ${imageAnalysis.confidence === 'HIGH' ? 'bg-green-50 border-green-200' : imageAnalysis.confidence === 'MEDIUM' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-800">{imageAnalysis.problem_name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{imageAnalysis.description}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block ${imageAnalysis.confidence === 'HIGH' ? 'bg-green-100 text-green-700' : imageAnalysis.confidence === 'MEDIUM' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                        {imageAnalysis.confidence} confidence
                      </span>
                    </div>
                  </div>
                  {imageAnalysis.problem_cosh_id && imageAnalysis.confidence !== 'LOW' && (
                    <button
                      onClick={useImageDiagnosis}
                      className="mt-2 w-full py-2 rounded-xl text-white text-xs font-semibold"
                      style={{ background: COLOUR }}>
                      ✓ Use this diagnosis
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Escape options */}
            <div className="flex gap-2">
              <button onClick={dontKnow}
                className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-500 text-sm">
                🤷 I Don't Know
              </button>
              <button onClick={knowProblem}
                className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-500 text-sm">
                🔍 I Know the Problem
              </button>
            </div>

            <p className="text-center text-xs text-slate-300">{questionHistory.length + 1} questions answered</p>
          </div>
        )}

        {/* Know the problem — manual selection */}
        {stage === 'know_problem' && (
          <div className="mt-4 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Select the Problem</h2>
              <p className="text-slate-400 text-sm mt-0.5">Choose the problem you have identified</p>
            </div>
            {problems.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">No problems found for this plant part</div>
            ) : (
              <div className="space-y-2">
                {problems.map(p => (
                  <button key={p.cosh_id} onClick={() => selectKnownProblem(p.cosh_id)}
                    className="w-full bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-left active:scale-98 transition-transform">
                    <p className="font-medium text-slate-800">{p.name}</p>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">{p.cosh_id}</p>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setStage('questioning')}
              className="w-full py-3 border border-slate-200 text-slate-600 rounded-2xl text-sm">
              ← Back to Questions
            </button>
          </div>
        )}

        {/* Diagnosis result */}
        {stage === 'diagnosed' && (
          <div className="mt-4 space-y-4">
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
              <div className="text-center">
                <span className="text-5xl">🔬</span>
                <h2 className="text-xl font-bold text-slate-900 mt-4">Problem Identified</h2>
                {diagnosis ? (
                  <>
                    <p className="text-2xl font-bold mt-3" style={{ color: COLOUR }}>
                      {diagnosis.name}
                    </p>
                    <p className="text-slate-400 text-xs mt-1 font-mono">{diagnosis.cosh_id}</p>
                  </>
                ) : (
                  <p className="text-slate-600 mt-3">Problem recorded</p>
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

              <div className="mt-4 bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3">
                <p className="text-sm font-semibold text-blue-800">Treatment Added to Advisory</p>
                <p className="text-xs text-blue-600 mt-1">
                  Treatment recommendations for this problem have been added to your advisory timeline.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <button onClick={() => router.push(`/advisory/${subscriptionId}`)}
                className="w-full py-4 rounded-2xl text-white font-semibold"
                style={{ background: COLOUR }}>
                View Treatment Recommendations →
              </button>
              <button onClick={() => router.push(`/ask-expert/${subscriptionId}`)}
                className="w-full py-3 rounded-2xl border border-slate-200 text-slate-600 text-sm">
                Also ask a FarmPundit expert
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function getPartEmoji(part: string): string {
  const emojis: Record<string, string> = {
    leaf: '🍃', stem: '🌿', root: '🪴', flower: '🌸', fruit: '🍅',
    nut: '🌰', tendril: '🌾', seed: '🌱', trunk: '🌳', branch: '🌲',
  }
  const lower = part.toLowerCase()
  for (const [key, emoji] of Object.entries(emojis)) {
    if (lower.includes(key)) return emoji
  }
  return '🌱'
}
