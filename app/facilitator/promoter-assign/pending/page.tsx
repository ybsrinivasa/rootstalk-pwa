'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

const COLOUR = '#7D4E00'

interface PendingAssignment {
  assignment_id: string
  subscription_id: string
  client_id: string
  package_id: string
  package_name: string
  crop_cosh_id: string
  farmer_user_id: string
  farmer_name: string | null
  farmer_phone: string | null
  assigned_at: string
  hours_remaining: number
}

function formatHoursRemaining(h: number): { text: string; amber: boolean } {
  if (h <= 0) return { text: 'Expiring soon', amber: true }
  if (h < 1) return { text: `${Math.ceil(h * 60)} min left`, amber: true }
  if (h < 6) return { text: `${h.toFixed(1)} h left`, amber: true }
  if (h < 24) return { text: `${Math.floor(h)} h left`, amber: false }
  return { text: `${Math.floor(h / 24)} d left`, amber: false }
}

export default function PendingSentPage() {
  const router = useRouter()
  const [rows, setRows] = useState<PendingAssignment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<PendingAssignment[]>('/promoter/me/pending-assignments')
      setRows(data)
      setError(null)
    } catch {
      setError('Could not load pending assignments. Pull to retry.')
      setRows([])
    }
  }, [])

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    refresh()
  }, [refresh, router])

  useEffect(() => {
    function onVisibility() { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [refresh])

  async function cancel(assignmentId: string, farmerName: string | null) {
    const name = farmerName || 'this farmer'
    if (!window.confirm(
      `Withdraw the advisory offer to ${name}? The subscription unit will go back to your kitty.`
    )) return
    setCancellingId(assignmentId)
    try {
      await api.delete(`/promoter/assignments/${assignmentId}`)
      // Local optimistic update — drop the row immediately, then
      // refresh from server to catch any concurrent state shifts.
      setRows(rs => (rs || []).filter(r => r.assignment_id !== assignmentId))
      refresh()
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { detail?: { message?: string; code?: string } | string } } }
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : detail?.message || 'Could not withdraw. The farmer may have already responded.'
      window.alert(msg)
      refresh()
    } finally {
      setCancellingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Pending sent" activeRole="FACILITATOR" back="/facilitator/promoter-assign" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        <div className="mt-4">
          {error && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 mb-4">
              {error}
            </div>
          )}

          {rows === null && (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-[#DDD0B8] border-t-[#7D4E00] rounded-full animate-spin" />
            </div>
          )}

          {rows !== null && rows.length === 0 && (
            <div className="mt-6 rounded-2xl border border-[#DDD0B8] bg-white p-6 text-center">
              <p className="text-sm font-semibold text-[#6B3F1F] mb-2">No pending offers</p>
              <p className="text-xs text-[#7A8C7E]">
                Everything you sent has been responded to. New offers will show up here while they&apos;re waiting on
                the farmer&apos;s approval.
              </p>
              <button
                onClick={() => router.push('/facilitator/promoter-assign')}
                className="mt-5 w-full py-3 rounded-2xl text-white font-semibold"
                style={{ background: COLOUR }}>
                Assign a new advisory →
              </button>
            </div>
          )}

          {rows !== null && rows.length > 0 && (
            <>
              <p className="text-xs text-[#7A8C7E] mb-3">
                {rows.length} offer{rows.length === 1 ? '' : 's'} awaiting farmer approval. They auto-expire 72h after
                you sent them.
              </p>
              <div className="space-y-3">
                {rows.map(r => {
                  const hr = formatHoursRemaining(r.hours_remaining)
                  return (
                    <div key={r.assignment_id}
                      className="bg-white rounded-2xl border border-[#DDD0B8] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#6B3F1F] truncate">
                            {r.farmer_name || 'Unnamed farmer'}
                          </p>
                          {r.farmer_phone && (
                            <a href={`tel:${r.farmer_phone}`}
                              className="inline-block text-xs text-[#7D4E00] underline underline-offset-2 mt-0.5">
                              📞 {r.farmer_phone}
                            </a>
                          )}
                        </div>
                        <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full ${
                          hr.amber
                            ? 'bg-amber-50 border border-amber-200 text-amber-900'
                            : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                        }`}>
                          {hr.text}
                        </span>
                      </div>
                      <div className="mt-3 text-xs text-[#7A8C7E] space-y-0.5">
                        <p>
                          Crop:{' '}
                          <span className="text-[#6B3F1F] font-medium">
                            {cropDisplayName(r.crop_cosh_id)}
                          </span>
                        </p>
                        <p>
                          Package:{' '}
                          <span className="text-[#6B3F1F] font-medium">{r.package_name}</span>
                        </p>
                      </div>
                      <button
                        onClick={() => cancel(r.assignment_id, r.farmer_name)}
                        disabled={cancellingId === r.assignment_id}
                        className="mt-3 w-full py-2.5 rounded-xl border border-[#D4682E] text-[#D4682E] text-sm font-semibold disabled:opacity-50">
                        {cancellingId === r.assignment_id ? 'Withdrawing…' : 'Withdraw offer'}
                      </button>
                    </div>
                  )
                })}
              </div>

              <button
                onClick={() => router.push('/facilitator/promoter-assign')}
                className="mt-6 w-full py-3 rounded-2xl border border-[#DDD0B8] bg-white text-sm font-semibold text-[#6B3F1F]">
                ← Back to assign advisory
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
