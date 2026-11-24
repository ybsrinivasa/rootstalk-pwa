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
import {
  ResponseForm,
  ResponseReadOnly,
  type ContentType,
  type Question,
  type ResponseShape,
} from '@/components/messaging/ResponseForm'

interface MessageDetail {
  campaign: {
    id: string
    client_id: string
    title: string
    body: string
    campaign_type: ContentType
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
  response: ResponseShape | null
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
  // Back destination — once the detail payload lands with client_id,
  // back goes to that org's chat view (WhatsApp pattern). Pre-load
  // and error states fall back to the inbox since we don't know the
  // client yet.
  const backPath = data?.campaign?.client_id
    ? `${inboxPath}/org/${data.campaign.client_id}`
    : inboxPath

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
        <TopBar backPath={backPath} />
        <p className="px-4 py-6 text-sm" style={{ color: C.textSecond }}>Loading…</p>
        <BottomNav activeRole={activeRole} />
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="min-h-screen pb-20" style={{ background: C.background }}>
        <TopBar backPath={backPath} />
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
      <TopBar backPath={backPath} />

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
            submitUrl={`/pwa/messages/${campaign.id}/response`}
            contentType={campaign.campaign_type}
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
            contentType={campaign.campaign_type}
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

function TopBar({ backPath = '/messages' }: { backPath?: string }) {
  return (
    <header className="flex items-center gap-3 px-4 py-3" style={{ background: C.cardBg, borderBottom: `1px solid ${C.divider}` }}>
      <Link href={backPath} className="text-sm" style={{ color: C.primary }}>← Back</Link>
    </header>
  )
}
