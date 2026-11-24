'use client'

// Per-organization message thread (WhatsApp-style chat view).
// Oldest at top, newest at bottom. Scrolls to the bottom on open —
// tapping into the org takes you to the most recent message by
// default, same as WhatsApp.
//
// Each message is a "bubble" the recipient taps to open the full
// message + response form at /messages/[campaignId].
//
// Routes for Dealer / Facilitator re-export this page from
// role-prefixed paths; activeRole is derived from pathname.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import api from '@/lib/api'
import BottomNav from '@/components/layout/BottomNav'
import { C } from '@/lib/tokens'
import { getActiveRoleFromPath } from '@/lib/roles'

interface OrgMessage {
  source: 'campaign' | 'touchpoint'
  recipient_id: string
  // One of these two is set depending on source. Routing uses
  // detail_key (campaign_id for campaigns, recipient_id for
  // touchpoints — see backend org_messages shape).
  campaign_id?: string
  touchpoint_id?: string
  detail_key: string
  title: string
  preview: string
  content_type: 'ANNOUNCEMENT' | 'INTEREST_CAPTURE' | 'FEEDBACK' | 'SURVEY'
  sent_at: string | null
  expires_at: string | null
  is_unread: boolean
  expects_response: boolean
  pending_response: boolean
  is_test: boolean
  subscription_context: {
    crop_name: string
    crop_cosh_id: string | null
    timeline_name: string | null
    fire_at: 'BEGINNING' | 'END'
  } | null
}

interface OrgPayload {
  client_id: string
  client_name: string
  client_logo_url: string | null
  items: OrgMessage[]
}

function fmtDay(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayDiff = Math.round((today.getTime() - msgDay.getTime()) / (1000 * 60 * 60 * 24))
  if (dayDiff === 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'
  if (dayDiff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

const TYPE_HINT: Record<OrgMessage['content_type'], string> = {
  ANNOUNCEMENT: 'Announcement',
  INTEREST_CAPTURE: 'Tap to respond — Yes / No / Maybe',
  FEEDBACK: 'Tap to rate',
  SURVEY: 'Tap to fill the survey',
}

export default function OrgMessagesPage() {
  const params = useParams()
  const router = useRouter()
  const pathname = usePathname() || '/messages/org'
  const activeRole = getActiveRoleFromPath(pathname)
  const inboxPath = activeRole === 'DEALER' ? '/dealer/messages'
    : activeRole === 'FACILITATOR' ? '/facilitator/messages'
    : '/messages'
  const detailBase = inboxPath
  const clientId = params?.clientId as string | undefined

  const [data, setData] = useState<OrgPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!clientId) return
    api.get<OrgPayload>(`/pwa/messages/org/${clientId}`)
      .then(({ data }) => setData(data))
      .catch(() => setError('Could not load messages from this company.'))
      .finally(() => setLoading(false))
  }, [clientId])

  useEffect(() => {
    // Scroll to bottom on initial load — WhatsApp chat behaviour.
    if (!loading && data && bottomRef.current) {
      bottomRef.current.scrollIntoView({ block: 'end' })
    }
  }, [loading, data])

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
        <p className="px-4 py-6 text-sm text-red-600">{error || 'Not found.'}</p>
        <BottomNav activeRole={activeRole} />
      </div>
    )
  }

  // Group bubbles by day for "Today / Yesterday / Monday / 18 Nov" separators.
  const grouped: { label: string; items: OrgMessage[] }[] = []
  let currentLabel: string | null = null
  for (const item of data.items) {
    const label = fmtDay(item.sent_at)
    if (label !== currentLabel) {
      grouped.push({ label, items: [] })
      currentLabel = label
    }
    grouped[grouped.length - 1].items.push(item)
  }

  return (
    <div className="min-h-screen pb-20 flex flex-col" style={{ background: C.background }}>
      <OrgHeader
        inboxPath={inboxPath}
        name={data.client_name || 'Company'}
        logoUrl={data.client_logo_url}
      />

      <main className="flex-1 px-3 py-3 space-y-3">
        {data.items.length === 0 ? (
          <div className="rounded-xl p-8 text-center mt-6" style={{ background: C.cardBg }}>
            <p className="text-sm" style={{ color: C.textSecond }}>
              No active messages from this company.
            </p>
          </div>
        ) : (
          grouped.map(group => (
            <div key={group.label} className="space-y-2">
              <p className="text-center text-xs font-medium"
                style={{ color: C.textSecond }}>
                {group.label}
              </p>
              {group.items.map(item => {
                // Route by source: campaigns use existing
                // /{inboxPath}/{campaign_id}; touchpoints go to
                // the new /{inboxPath}/touchpoint/{recipient_id}.
                const href = item.source === 'touchpoint'
                  ? `${detailBase}/touchpoint/${item.detail_key}`
                  : `${detailBase}/${item.detail_key}`
                const ctx = item.subscription_context
                const contextLabel = ctx
                  ? `About your ${ctx.crop_name || 'crop'}${ctx.timeline_name ? ` · ${ctx.fire_at === 'BEGINNING' ? 'Beginning of' : 'End of'} ${ctx.timeline_name}` : ''}`
                  : null
                return (
                <button
                  key={`${item.source}:${item.recipient_id}`}
                  onClick={() => router.push(href)}
                  className="w-full text-left rounded-xl p-3"
                  style={{
                    background: C.cardBg,
                    borderLeft: item.is_unread ? `4px solid ${C.primary}` : `4px solid transparent`,
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`${item.is_unread ? 'font-bold' : 'font-semibold'} text-sm truncate`}
                       style={{ color: C.textPrimary }}>
                      {item.title}
                    </p>
                    <span className="text-xs shrink-0" style={{ color: C.textSecond }}>
                      {fmtTime(item.sent_at)}
                    </span>
                  </div>
                  {contextLabel && (
                    <p className="text-[10px] mt-0.5 uppercase tracking-wider font-semibold" style={{ color: C.primary }}>
                      {contextLabel}
                    </p>
                  )}
                  {item.preview && (
                    <p className="text-xs mt-1 line-clamp-2" style={{ color: C.textSecond }}>
                      {item.preview}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    {item.is_test && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-amber-100 text-amber-800">
                        TEST
                      </span>
                    )}
                    <span className="text-[10px] font-medium"
                      style={{ color: item.pending_response ? '#B45309' : C.textSecond }}>
                      {item.pending_response ? 'Response needed' : TYPE_HINT[item.content_type]}
                    </span>
                  </div>
                </button>
                )
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </main>

      <BottomNav activeRole={activeRole} />
    </div>
  )
}

function TopBar({ inboxPath }: { inboxPath: string }) {
  return (
    <header className="flex items-center gap-3 px-4 py-3" style={{ background: C.cardBg, borderBottom: `1px solid ${C.divider}` }}>
      <Link href={inboxPath} className="text-sm" style={{ color: C.primary }}>← Back</Link>
    </header>
  )
}

function OrgHeader({ inboxPath, name, logoUrl }: {
  inboxPath: string
  name: string
  logoUrl: string | null
}) {
  return (
    <header
      className="flex items-center gap-3 px-3 py-2 sticky top-0 z-10"
      style={{ background: C.cardBg, borderBottom: `1px solid ${C.divider}` }}
    >
      <Link href={inboxPath} className="text-sm px-2 py-1" style={{ color: C.primary }} aria-label="Back to inbox">
        ←
      </Link>
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
        style={{ background: C.primarySoft }}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm font-semibold" style={{ color: C.primary }}>
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      <p className="font-semibold text-sm truncate" style={{ color: C.textPrimary }}>
        {name}
      </p>
    </header>
  )
}
