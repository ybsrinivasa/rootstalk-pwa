'use client'

// Messages inbox — list of active campaigns delivered to this recipient.
// Expired / cancelled / archived campaigns are hidden by backend filter.
//
// Phase 2C-M1 (2026-11-22) — Announcement-only in this ship; later
// milestones add response-form handling for Interest / Feedback /
// Survey.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import BottomNav from '@/components/layout/BottomNav'
import { C } from '@/lib/tokens'

interface InboxItem {
  recipient_id: string
  campaign_id: string
  client_id: string
  client_name: string
  title: string
  preview: string
  campaign_type: 'ANNOUNCEMENT' | 'INTEREST_CAPTURE' | 'FEEDBACK' | 'SURVEY'
  sent_at: string | null
  expires_at: string | null
  is_unread: boolean
  expects_response: boolean
  pending_response: boolean
  is_test: boolean
}

function fmtRelative(iso: string | null): string {
  if (!iso) return ''
  const now = Date.now()
  const then = new Date(iso).getTime()
  if (isNaN(then)) return ''
  const diff = Math.max(0, now - then)
  const h = Math.floor(diff / (3600 * 1000))
  if (h < 1) {
    const m = Math.floor(diff / (60 * 1000))
    return `${m}m ago`
  }
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function MessagesInboxPage() {
  const router = useRouter()
  const [items, setItems] = useState<InboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get<{ items: InboxItem[]; unread_count: number }>('/pwa/messages/inbox')
      .then(({ data }) => setItems(data.items))
      .catch(() => setError('Could not load your messages. Please try again in a moment.'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen pb-20" style={{ background: C.background }}>
      <header className="px-4 py-4" style={{ background: C.cardBg, borderBottom: `1px solid ${C.divider}` }}>
        <h1 className="text-lg font-bold" style={{ color: C.textPrimary }}>Messages</h1>
        <p className="text-xs mt-0.5" style={{ color: C.textSecond }}>
          Announcements and surveys from your companies.
        </p>
      </header>

      <div className="px-4 py-3 space-y-2">
        {loading && <p className="text-sm" style={{ color: C.textSecond }}>Loading…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <div className="rounded-xl p-8 text-center" style={{ background: C.cardBg }}>
            <p className="text-sm" style={{ color: C.textSecond }}>No messages right now.</p>
            <p className="text-xs mt-2" style={{ color: C.textSecond }}>
              When a company sends you an announcement or survey, you&apos;ll see it here.
            </p>
          </div>
        )}
        {items.map(item => (
          <button
            key={item.recipient_id}
            onClick={() => router.push(`/messages/${item.campaign_id}`)}
            className="w-full text-left rounded-xl p-4 relative"
            style={{
              background: C.cardBg,
              borderLeft: item.is_unread ? `4px solid ${C.primary}` : `4px solid transparent`,
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-sm truncate ${item.is_unread ? 'font-bold' : 'font-medium'}`} style={{ color: C.textPrimary }}>
                    {item.title}
                  </p>
                  {item.is_test && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-amber-100 text-amber-800">
                      TEST
                    </span>
                  )}
                </div>
                <p className="text-xs mt-1" style={{ color: C.textSecond }}>
                  From {item.client_name || 'your company'} · {fmtRelative(item.sent_at)}
                </p>
                {item.preview && (
                  <p className="text-xs mt-2 line-clamp-2" style={{ color: C.textSecond }}>
                    {item.preview}
                  </p>
                )}
                {item.pending_response && (
                  <p className="text-[10px] mt-2 font-semibold uppercase tracking-wider" style={{ color: '#B45309' }}>
                    Response needed
                  </p>
                )}
              </div>
              {item.is_unread && (
                <div className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background: C.primary }} />
              )}
            </div>
          </button>
        ))}
      </div>

      <BottomNav activeRole="FARMER" />
    </div>
  )
}
