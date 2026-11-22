'use client'

// Message detail view — read full message + mark opened on mount.
// For Announcement campaigns this is the whole story. Response forms
// for Interest Capture / Feedback / Survey ship in a later milestone;
// for now those campaigns show a placeholder "coming soon" note
// alongside the content.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import BottomNav from '@/components/layout/BottomNav'
import { C } from '@/lib/tokens'

interface MessageDetail {
  campaign: {
    id: string
    title: string
    body: string
    campaign_type: 'ANNOUNCEMENT' | 'INTEREST_CAPTURE' | 'FEEDBACK' | 'SURVEY'
    rating_scale_type: string | null
    sent_at: string | null
    expires_at: string | null
    client_name: string
    client_logo_url: string | null
    expired: boolean
  }
  questions: unknown[]
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
  response: unknown | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function MessageDetailPage() {
  const params = useParams()
  const campaignId = params?.campaignId as string | undefined
  const [data, setData] = useState<MessageDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!campaignId) return
    api.get<MessageDetail>(`/pwa/messages/${campaignId}`)
      .then(({ data }) => setData(data))
      .catch(() => setError('Could not load this message. It may have expired.'))
      .finally(() => setLoading(false))

    // Stamp opened_at (idempotent; fire-and-forget).
    api.post(`/pwa/messages/${campaignId}/opened`).catch(() => { /* silent */ })
  }, [campaignId])

  if (loading) {
    return (
      <div className="min-h-screen pb-20" style={{ background: C.background }}>
        <TopBar />
        <p className="px-4 py-6 text-sm" style={{ color: C.textSecond }}>Loading…</p>
        <BottomNav activeRole="FARMER" />
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="min-h-screen pb-20" style={{ background: C.background }}>
        <TopBar />
        <p className="px-4 py-6 text-sm text-red-600">{error || 'Message not found.'}</p>
        <BottomNav activeRole="FARMER" />
      </div>
    )
  }

  const { campaign, attachments } = data
  const canRespond = !campaign.expired
    && campaign.campaign_type !== 'ANNOUNCEMENT'
    && data.recipient.responded_at === null

  return (
    <div className="min-h-screen pb-20" style={{ background: C.background }}>
      <TopBar />

      <main className="px-4 py-4 space-y-4">
        {/* Company header */}
        <div className="flex items-center gap-3">
          {campaign.client_logo_url && (
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

        {/* Attachments stub — signed URLs coming in Phase 2D. */}
        {attachments.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: C.cardBg }}>
            <p className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: C.textSecond }}>
              Attached
            </p>
            <ul className="text-sm space-y-1" style={{ color: C.textSecond }}>
              {attachments.map(a => (
                <li key={a.id}>
                  📎 {a.original_filename}{' '}
                  <span className="text-xs">({Math.round(a.size_bytes / 1024)} KB)</span>
                </li>
              ))}
            </ul>
            <p className="text-xs italic mt-2" style={{ color: C.textSecond }}>
              Attachments will be downloadable in an upcoming update.
            </p>
          </div>
        )}

        {/* Response placeholder — for Interest Capture / Feedback /
             Survey; Announcement has no form. */}
        {canRespond && (
          <div className="rounded-xl p-4 border" style={{ background: '#FEF3C7', borderColor: '#F59E0B' }}>
            <p className="text-sm font-semibold" style={{ color: '#92400E' }}>Response needed</p>
            <p className="text-xs mt-1" style={{ color: '#92400E' }}>
              This is a {campaign.campaign_type.toLowerCase().replace('_', ' ')} — the response form will be enabled in an upcoming update.
            </p>
          </div>
        )}

        {data.recipient.responded_at && (
          <div className="rounded-xl p-4 border" style={{ background: '#DCFCE7', borderColor: '#16A34A' }}>
            <p className="text-sm font-semibold" style={{ color: '#166534' }}>You responded</p>
            <p className="text-xs mt-1" style={{ color: '#166534' }}>
              Submitted {fmtDate(data.recipient.responded_at)}. Responses are final.
            </p>
          </div>
        )}

        {campaign.expired && (
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

function TopBar() {
  return (
    <header className="flex items-center gap-3 px-4 py-3" style={{ background: C.cardBg, borderBottom: `1px solid ${C.divider}` }}>
      <Link href="/messages" className="text-sm" style={{ color: C.primary }}>← Back</Link>
    </header>
  )
}
