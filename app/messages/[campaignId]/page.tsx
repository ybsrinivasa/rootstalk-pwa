'use client'

// Message detail view — read full message, mark opened on mount, and
// render the per-type response form:
//   ANNOUNCEMENT      — no form, read-only
//   INTEREST_CAPTURE  — Yes / No / Maybe buttons (single tap)
//   FEEDBACK          — 5-star rating + optional follow-up questions
//   SURVEY            — full form with 9 question types
//
// Responses are final once submitted; the view flips to read-only.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import api from '@/lib/api'
import BottomNav from '@/components/layout/BottomNav'
import { C } from '@/lib/tokens'
import { getActiveRoleFromPath } from '@/lib/roles'

type CampaignType = 'ANNOUNCEMENT' | 'INTEREST_CAPTURE' | 'FEEDBACK' | 'SURVEY'
type QuestionType =
  | 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'YES_NO' | 'RATING_SCALE'
  | 'NUMBER' | 'SHORT_TEXT' | 'PARAGRAPH_TEXT' | 'DATE' | 'PHOTO_UPLOAD'

interface Question {
  id: string
  sort_order: number
  question_type: QuestionType
  label: string
  help_text: string | null
  is_mandatory: boolean
  choice_options: string[] | null
  number_unit: string | null
  rating_scale_type: string | null
}

interface MessageDetail {
  campaign: {
    id: string
    title: string
    body: string
    campaign_type: CampaignType
    rating_scale_type: string | null
    sent_at: string | null
    expires_at: string | null
    client_name: string
    client_logo_url: string | null
    expired: boolean
  }
  questions: Question[]
  attachments: {
    id: string
    kind: 'IMAGE' | 'VIDEO' | 'PDF'
    original_filename: string
    mime_type: string
    size_bytes: number
    url: string | null
  }[]
  recipient: {
    id: string
    opened_at: string | null
    responded_at: string | null
    is_test: boolean
  }
  response: {
    interest_answer: string | null
    rating: number | null
    answers: {
      question_id: string
      value_text: string | null
      value_number: number | null
      value_choice: string | null
      value_boolean: boolean | null
      value_date: string | null
      value_media_path: string | null
    }[]
  } | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function MessageDetailPage() {
  const params = useParams()
  const pathname = usePathname() || '/messages'
  const activeRole = getActiveRoleFromPath(pathname)
  const inboxPath = activeRole === 'DEALER' ? '/dealer/messages'
    : activeRole === 'FACILITATOR' ? '/facilitator/messages'
    : '/messages'
  const campaignId = params?.campaignId as string | undefined
  const [data, setData] = useState<MessageDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    if (!campaignId) return
    try {
      const { data } = await api.get<MessageDetail>(`/pwa/messages/${campaignId}`)
      setData(data)
    } catch {
      setError('Could not load this message. It may have expired.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    if (!campaignId) return
    // Stamp opened_at (idempotent; fire-and-forget).
    api.post(`/pwa/messages/${campaignId}/opened`).catch(() => { /* silent */ })
  }, [campaignId])

  if (loading) {
    return (
      <div className="min-h-screen pb-20" style={{ background: C.background }}>
        <TopBar inboxPath={inboxPath} />
        <p className="px-4 py-6 text-sm" style={{ color: C.textSecond }}>Loading…</p>
        <BottomNav activeRole={activeRole} />
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="min-h-screen pb-20" style={{ background: C.background }}>
        <TopBar inboxPath={inboxPath} />
        <p className="px-4 py-6 text-sm text-red-600">{error || 'Message not found.'}</p>
        <BottomNav activeRole={activeRole} />
      </div>
    )
  }

  const { campaign, attachments } = data
  const canRespond = !campaign.expired
    && campaign.campaign_type !== 'ANNOUNCEMENT'
    && data.recipient.responded_at === null

  return (
    <div className="min-h-screen pb-20" style={{ background: C.background }}>
      <TopBar inboxPath={inboxPath} />

      <main className="px-4 py-4 space-y-4">
        {/* Company header */}
        <div className="flex items-center gap-3">
          {campaign.client_logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={campaign.client_logo_url} alt="" className="w-8 h-8 rounded object-contain" />
          )}
          <div>
            <p className="text-xs" style={{ color: C.textSecond }}>From</p>
            <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{campaign.client_name || '—'}</p>
          </div>
          {data.recipient.is_test && (
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded font-semibold bg-amber-100 text-amber-800">
              TEST
            </span>
          )}
        </div>

        {/* Title + body */}
        <div className="rounded-xl p-4" style={{ background: C.cardBg }}>
          <h1 className="text-lg font-bold" style={{ color: C.textPrimary }}>{campaign.title}</h1>
          <p className="text-xs mt-1" style={{ color: C.textSecond }}>
            {fmtDate(campaign.sent_at)}
            {campaign.expires_at && ` · Expires ${fmtDate(campaign.expires_at)}`}
          </p>
          <p className="text-sm mt-3 whitespace-pre-wrap" style={{ color: C.textPrimary }}>
            {campaign.body}
          </p>
        </div>

        {/* Attachments — per-kind rendering. Images inline, videos as
             <video controls>, PDFs as a download link. */}
        {attachments.length > 0 && (
          <div className="rounded-xl p-4 space-y-3" style={{ background: C.cardBg }}>
            <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: C.textSecond }}>
              Attached
            </p>
            {attachments.map(a => (
              <div key={a.id}>
                {a.url && a.kind === 'IMAGE' && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.original_filename}
                    className="w-full rounded-lg max-h-96 object-contain bg-slate-50" />
                )}
                {a.url && a.kind === 'VIDEO' && (
                  <video src={a.url} controls className="w-full rounded-lg" />
                )}
                {a.url && a.kind === 'PDF' && (
                  <a href={a.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 border rounded-lg p-3"
                    style={{ borderColor: C.divider, color: C.primary }}>
                    <span className="text-2xl" aria-hidden>📄</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{a.original_filename}</p>
                      <p className="text-xs" style={{ color: C.textSecond }}>
                        PDF · {Math.round(a.size_bytes / 1024)} KB · Tap to open
                      </p>
                    </div>
                  </a>
                )}
                {!a.url && (
                  <p className="text-xs" style={{ color: C.textSecond }}>
                    📎 {a.original_filename} — attachment unavailable
                  </p>
                )}
                {a.url && a.kind !== 'PDF' && (
                  <p className="text-xs mt-1" style={{ color: C.textSecond }}>
                    {a.original_filename} · {Math.round(a.size_bytes / 1024)} KB
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Response form */}
        {canRespond && (
          <ResponseForm
            campaignId={campaign.id}
            campaignType={campaign.campaign_type}
            ratingScaleType={campaign.rating_scale_type}
            questions={data.questions}
            onSubmitted={load}
          />
        )}

        {/* Already-responded read-only summary */}
        {data.recipient.responded_at && data.response && (
          <ResponseReadOnly
            response={data.response}
            questions={data.questions}
            campaignType={campaign.campaign_type}
            submittedAt={data.recipient.responded_at}
          />
        )}

        {campaign.expired && !data.recipient.responded_at && (
          <div className="rounded-xl p-4 border" style={{ background: '#F1F5F9', borderColor: '#CBD5E1' }}>
            <p className="text-sm" style={{ color: C.textSecond }}>
              This campaign has expired. You can read it here until it rolls out of your inbox.
            </p>
          </div>
        )}
      </main>

      <BottomNav activeRole="FARMER" />
    </div>
  )
}

function TopBar({ inboxPath = '/messages' }: { inboxPath?: string }) {
  return (
    <header className="flex items-center gap-3 px-4 py-3" style={{ background: C.cardBg, borderBottom: `1px solid ${C.divider}` }}>
      <Link href={inboxPath} className="text-sm" style={{ color: C.primary }}>← Back</Link>
    </header>
  )
}

// ── Response form ─────────────────────────────────────────────────

interface ResponseFormProps {
  campaignId: string
  campaignType: CampaignType
  ratingScaleType: string | null
  questions: Question[]
  onSubmitted: () => void
}

function ResponseForm({ campaignId, campaignType, ratingScaleType, questions, onSubmitted }: ResponseFormProps) {
  const [interestAnswer, setInterestAnswer] = useState<'YES' | 'NO' | 'MAYBE' | null>(null)
  const [rating, setRating] = useState<number | null>(null)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const maxRating = ratingScaleType === 'NPS_10' ? 10 : 5

  function setAnswer(qid: string, value: unknown) {
    setAnswers(a => ({ ...a, [qid]: value }))
  }

  function canSubmit(): boolean {
    if (campaignType === 'INTEREST_CAPTURE') return interestAnswer !== null
    if (campaignType === 'FEEDBACK' && rating === null) return false
    for (const q of questions) {
      if (!q.is_mandatory) continue
      const v = answers[q.id]
      if (v === undefined || v === null || v === '') return false
      if (Array.isArray(v) && v.length === 0) return false
    }
    return true
  }

  async function handleSubmit() {
    setSubmitting(true); setError('')
    try {
      const payload: Record<string, unknown> = {}
      if (campaignType === 'INTEREST_CAPTURE') {
        payload.interest_answer = interestAnswer
      }
      if (campaignType === 'FEEDBACK') {
        payload.rating = rating
      }
      if (questions.length > 0) {
        payload.answers = questions.map(q => {
          const v = answers[q.id]
          const out: Record<string, unknown> = { question_id: q.id }
          switch (q.question_type) {
            case 'SHORT_TEXT':
            case 'PARAGRAPH_TEXT':
              out.value_text = (v as string) || null
              break
            case 'NUMBER':
            case 'RATING_SCALE':
              out.value_number = typeof v === 'number' ? v : (v ? Number(v) : null)
              break
            case 'SINGLE_CHOICE':
              out.value_choice = (v as string) || null
              break
            case 'MULTIPLE_CHOICE':
              out.value_choice = Array.isArray(v) ? v : (v ? [v] : [])
              break
            case 'YES_NO':
              out.value_boolean = typeof v === 'boolean' ? v : null
              break
            case 'DATE':
              out.value_date = (v as string) || null
              break
            case 'PHOTO_UPLOAD':
              out.value_media_path = (v as string) || null
              break
          }
          return out
        }).filter(a =>
          a.value_text !== undefined ||
          a.value_number !== undefined ||
          a.value_choice !== undefined ||
          a.value_boolean !== undefined ||
          a.value_date !== undefined ||
          a.value_media_path !== undefined
        )
      }
      await api.post(`/pwa/messages/${campaignId}/response`, payload)
      onSubmitted()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })
        ?.response?.data?.detail
      const code = (detail as { code?: string })?.code
      setError(
        code === 'answer_required' ? 'Please answer every required question.' :
        code === 'invalid_rating' ? 'Please tap a star rating.' :
        code === 'invalid_interest_answer' ? 'Please pick Yes, No, or Maybe.' :
        code === 'campaign_expired' ? 'This campaign has expired.' :
        'Could not submit. Please try again.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-xl p-4 space-y-4" style={{ background: C.cardBg }}>
      <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: C.textSecond }}>
        Your response
      </p>

      {/* Interest Capture */}
      {campaignType === 'INTEREST_CAPTURE' && (
        <div className="grid grid-cols-3 gap-2">
          {(['YES', 'NO', 'MAYBE'] as const).map(a => {
            const selected = interestAnswer === a
            return (
              <button
                key={a} type="button"
                onClick={() => setInterestAnswer(a)}
                className="rounded-xl py-4 text-sm font-semibold transition-colors"
                style={{
                  background: selected ? C.primary : '#fff',
                  color: selected ? '#fff' : C.textPrimary,
                  border: `2px solid ${selected ? C.primary : C.divider}`,
                }}
              >
                {a === 'YES' ? 'Yes' : a === 'NO' ? 'No' : 'Maybe'}
              </button>
            )
          })}
        </div>
      )}

      {/* Feedback — star rating */}
      {campaignType === 'FEEDBACK' && (
        <div>
          <p className="text-sm mb-3" style={{ color: C.textPrimary }}>How would you rate this?</p>
          <div className="flex gap-1">
            {Array.from({ length: maxRating }, (_, i) => i + 1).map(n => {
              const active = rating !== null && rating >= n
              return (
                <button
                  key={n} type="button"
                  onClick={() => setRating(n)}
                  className="text-4xl transition-colors"
                  style={{ color: active ? C.accent : '#CBD5E1' }}
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                >★</button>
              )
            })}
          </div>
          {rating !== null && (
            <p className="text-xs mt-2" style={{ color: C.textSecond }}>
              You rated {rating} out of {maxRating}
            </p>
          )}
        </div>
      )}

      {/* Survey questions / Feedback follow-ups */}
      {questions.length > 0 && questions.map((q, i) => (
        <QuestionWidget
          key={q.id}
          index={i}
          question={q}
          value={answers[q.id]}
          onChange={v => setAnswer(q.id, v)}
          showHeading={campaignType === 'SURVEY' || questions.length > 0}
        />
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit() || submitting}
        className="w-full py-3 rounded-xl text-sm font-semibold"
        style={{
          background: canSubmit() ? C.primary : '#CBD5E1',
          color: '#fff',
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? 'Submitting…' : 'Submit response'}
      </button>
      <p className="text-xs text-center" style={{ color: C.textSecond }}>
        Responses are final — you can&apos;t edit after submitting.
      </p>
    </div>
  )
}

function QuestionWidget({ question, value, onChange, index, showHeading }: {
  question: Question
  value: unknown
  onChange: (v: unknown) => void
  index: number
  showHeading: boolean
}) {
  const q = question
  return (
    <div className="border-t pt-4" style={{ borderColor: C.divider }}>
      {showHeading && (
        <p className="text-sm font-medium" style={{ color: C.textPrimary }}>
          {index + 1}. {q.label} {q.is_mandatory && <span className="text-rose-500 text-xs">*</span>}
        </p>
      )}
      {q.help_text && <p className="text-xs mt-1" style={{ color: C.textSecond }}>{q.help_text}</p>}

      <div className="mt-2">
        {q.question_type === 'SHORT_TEXT' && (
          <input
            type="text" value={(value as string) || ''}
            onChange={e => onChange(e.target.value)}
            maxLength={150}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: C.divider }}
          />
        )}
        {q.question_type === 'PARAGRAPH_TEXT' && (
          <textarea
            value={(value as string) || ''}
            onChange={e => onChange(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
            style={{ borderColor: C.divider }}
          />
        )}
        {q.question_type === 'NUMBER' && (
          <div className="flex items-center gap-2">
            <input
              type="number" value={(value as number) ?? ''}
              onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: C.divider }}
            />
            {q.number_unit && (
              <span className="text-sm" style={{ color: C.textSecond }}>{q.number_unit}</span>
            )}
          </div>
        )}
        {q.question_type === 'YES_NO' && (
          <div className="flex gap-2">
            {[true, false].map(b => {
              const selected = value === b
              return (
                <button
                  key={String(b)} type="button"
                  onClick={() => onChange(b)}
                  className="flex-1 rounded-lg py-2.5 text-sm font-medium"
                  style={{
                    background: selected ? C.primary : '#fff',
                    color: selected ? '#fff' : C.textPrimary,
                    border: `2px solid ${selected ? C.primary : C.divider}`,
                  }}
                >{b ? 'Yes' : 'No'}</button>
              )
            })}
          </div>
        )}
        {q.question_type === 'SINGLE_CHOICE' && q.choice_options && (
          <div className="space-y-1.5">
            {q.choice_options.map(opt => {
              const selected = value === opt
              return (
                <button
                  key={opt} type="button"
                  onClick={() => onChange(opt)}
                  className="w-full text-left rounded-lg py-2.5 px-3 text-sm"
                  style={{
                    background: selected ? C.primarySoft : '#fff',
                    color: C.textPrimary,
                    border: `2px solid ${selected ? C.primary : C.divider}`,
                  }}
                >
                  <span className="inline-block w-4 h-4 rounded-full mr-2 border-2 align-middle"
                    style={{ borderColor: selected ? C.primary : C.divider, background: selected ? C.primary : '#fff' }}
                  />
                  {opt}
                </button>
              )
            })}
          </div>
        )}
        {q.question_type === 'MULTIPLE_CHOICE' && q.choice_options && (
          <div className="space-y-1.5">
            {q.choice_options.map(opt => {
              const arr = Array.isArray(value) ? (value as string[]) : []
              const selected = arr.includes(opt)
              return (
                <button
                  key={opt} type="button"
                  onClick={() => {
                    const next = selected ? arr.filter(x => x !== opt) : [...arr, opt]
                    onChange(next)
                  }}
                  className="w-full text-left rounded-lg py-2.5 px-3 text-sm"
                  style={{
                    background: selected ? C.primarySoft : '#fff',
                    color: C.textPrimary,
                    border: `2px solid ${selected ? C.primary : C.divider}`,
                  }}
                >
                  <span className="inline-block w-4 h-4 rounded mr-2 border-2 align-middle"
                    style={{ borderColor: selected ? C.primary : C.divider, background: selected ? C.primary : '#fff' }}
                  />
                  {opt}
                </button>
              )
            })}
          </div>
        )}
        {q.question_type === 'RATING_SCALE' && (
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(n => {
              const v = (value as number) || 0
              const active = v >= n
              return (
                <button
                  key={n} type="button"
                  onClick={() => onChange(n)}
                  className="text-3xl"
                  style={{ color: active ? C.accent : '#CBD5E1' }}
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                >★</button>
              )
            })}
          </div>
        )}
        {q.question_type === 'DATE' && (
          <input
            type="date" value={(value as string) || ''}
            onChange={e => onChange(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: C.divider }}
          />
        )}
        {q.question_type === 'PHOTO_UPLOAD' && (
          <p className="text-xs italic" style={{ color: C.textSecond }}>
            Photo upload will be enabled in an upcoming update.
          </p>
        )}
      </div>
    </div>
  )
}

function ResponseReadOnly({ response, questions, campaignType, submittedAt }: {
  response: NonNullable<MessageDetail['response']>
  questions: Question[]
  campaignType: CampaignType
  submittedAt: string
}) {
  const byId = new Map(questions.map(q => [q.id, q]))
  return (
    <div className="rounded-xl p-4 border space-y-3" style={{ background: '#DCFCE7', borderColor: '#16A34A' }}>
      <div>
        <p className="text-sm font-semibold" style={{ color: '#166534' }}>You responded</p>
        <p className="text-xs mt-1" style={{ color: '#166534' }}>
          Submitted {fmtDate(submittedAt)}. Responses are final.
        </p>
      </div>
      {campaignType === 'INTEREST_CAPTURE' && response.interest_answer && (
        <p className="text-sm" style={{ color: '#166534' }}>
          Your answer: <strong>{response.interest_answer === 'YES' ? 'Yes' : response.interest_answer === 'NO' ? 'No' : 'Maybe'}</strong>
        </p>
      )}
      {campaignType === 'FEEDBACK' && response.rating !== null && (
        <p className="text-sm" style={{ color: '#166534' }}>
          Your rating: <strong>{response.rating} stars</strong>
        </p>
      )}
      {response.answers.length > 0 && (
        <ul className="space-y-1 text-xs" style={{ color: '#166534' }}>
          {response.answers.map(a => {
            const q = byId.get(a.question_id)
            if (!q) return null
            const val =
              a.value_text ?? a.value_choice ??
              (a.value_boolean !== null ? (a.value_boolean ? 'Yes' : 'No') : null) ??
              (a.value_number !== null ? String(a.value_number) : null) ??
              a.value_date ?? '—'
            return (
              <li key={a.question_id}>
                <strong>{q.label}:</strong> {val}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
