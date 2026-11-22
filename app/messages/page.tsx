'use client'

// Messages inbox — WhatsApp-style, grouped by organization. Each
// client the recipient has received messages from becomes one card.
// Cards shuffle so the org with the most recent activity sits on top.
// Tap a card → navigate to the per-org page (`/messages/org/{cid}`
// or the role-prefixed equivalent for Dealer / Facilitator).
//
// Expired campaigns are hidden by the backend — orgs whose messages
// have all expired disappear from the inbox.

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import api from '@/lib/api'
import BottomNav from '@/components/layout/BottomNav'
import { C } from '@/lib/tokens'
import { getActiveRoleFromPath } from '@/lib/roles'

interface Organization {
  client_id: string
  client_name: string
  client_logo_url: string | null
  unread_count: number
  message_count: number
  pending_response_count: number
  most_recent_at: string | null
  most_recent_title: string | null
  most_recent_is_unread: boolean
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
    return m <= 1 ? 'now' : `${m}m`
  }
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

export default function MessagesInboxPage() {
  const router = useRouter()
  const pathname = usePathname() || '/messages'
  const activeRole = getActiveRoleFromPath(pathname)
  const orgBase = activeRole === 'DEALER' ? '/dealer/messages/org'
    : activeRole === 'FACILITATOR' ? '/facilitator/messages/org'
    : '/messages/org'
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get<{ organizations: Organization[]; unread_count: number }>('/pwa/messages/inbox')
      .then(({ data }) => setOrgs(data.organizations))
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

      <div className="px-3 py-2 space-y-1.5">
        {loading && <p className="text-sm px-2" style={{ color: C.textSecond }}>Loading…</p>}
        {error && <p className="text-sm px-2 text-red-600">{error}</p>}
        {!loading && !error && orgs.length === 0 && (
          <div className="rounded-xl p-8 text-center mt-4" style={{ background: C.cardBg }}>
            <p className="text-sm" style={{ color: C.textSecond }}>No messages yet.</p>
            <p className="text-xs mt-2" style={{ color: C.textSecond }}>
              When a company sends you an announcement or survey, you&apos;ll see it here.
            </p>
          </div>
        )}
        {orgs.map(org => (
          <button
            key={org.client_id}
            onClick={() => router.push(`${orgBase}/${org.client_id}`)}
            className="w-full text-left rounded-xl px-3 py-3 flex items-center gap-3"
            style={{ background: C.cardBg }}
          >
            {/* Avatar */}
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
              style={{ background: C.primarySoft }}
            >
              {org.client_logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={org.client_logo_url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-lg font-semibold" style={{ color: C.primary }}>
                  {(org.client_name || '?').slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>

            {/* Middle — name + preview */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className={`truncate ${org.unread_count > 0 ? 'font-bold' : 'font-semibold'}`}
                   style={{ color: C.textPrimary, fontSize: 15 }}>
                  {org.client_name || 'Company'}
                </p>
                <span className="text-xs shrink-0" style={{ color: org.unread_count > 0 ? C.primary : C.textSecond }}>
                  {fmtRelative(org.most_recent_at)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <p className={`truncate text-xs ${org.most_recent_is_unread ? 'font-medium' : ''}`}
                   style={{ color: org.most_recent_is_unread ? C.textPrimary : C.textSecond }}>
                  {org.most_recent_title || '—'}
                </p>
                {org.unread_count > 0 && (
                  <span
                    className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center"
                    style={{ background: C.primary, color: '#fff' }}
                  >
                    {org.unread_count > 99 ? '99+' : org.unread_count}
                  </span>
                )}
              </div>
              {org.pending_response_count > 0 && (
                <p className="text-[10px] mt-1 font-semibold uppercase tracking-wider" style={{ color: '#B45309' }}>
                  {org.pending_response_count} response{org.pending_response_count === 1 ? '' : 's'} needed
                </p>
              )}
            </div>
          </button>
        ))}
      </div>

      <BottomNav activeRole={activeRole} />
    </div>
  )
}
