'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

const COLOUR = '#085041'

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

type RemainingChip =
  | { kind: 'expiringSoon'; amber: true }
  | { kind: 'minLeft'; count: number; amber: true }
  | { kind: 'hoursLeft'; hours: string; amber: boolean }
  | { kind: 'daysLeft'; count: number; amber: false }

function remainingChip(h: number): RemainingChip {
  if (h <= 0) return { kind: 'expiringSoon', amber: true }
  if (h < 1) return { kind: 'minLeft', count: Math.ceil(h * 60), amber: true }
  if (h < 6) return { kind: 'hoursLeft', hours: h.toFixed(1), amber: true }
  if (h < 24) return { kind: 'hoursLeft', hours: String(Math.floor(h)), amber: false }
  return { kind: 'daysLeft', count: Math.floor(h / 24), amber: false }
}

export default function DealerPendingSentPage() {
  const router = useRouter()
  const t = useTranslations('dealer.pendingSent')
  const [rows, setRows] = useState<PendingAssignment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<PendingAssignment[]>('/promoter/me/pending-assignments')
      setRows(data)
      setError(null)
    } catch {
      setError(t('errorLoad'))
      setRows([])
    }
  }, [t])

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
    const name = farmerName || t('fallbackName')
    if (!window.confirm(t('confirmWithdraw', { name }))) return
    setCancellingId(assignmentId)
    try {
      await api.delete(`/promoter/assignments/${assignmentId}`)
      setRows(rs => (rs || []).filter(r => r.assignment_id !== assignmentId))
      refresh()
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { detail?: { message?: string; code?: string } | string } } }
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : detail?.message || t('errorWithdraw')
      window.alert(msg)
      refresh()
    } finally {
      setCancellingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/promoter-assign" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        <div className="mt-4">
          {error && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 mb-4">
              {error}
            </div>
          )}

          {rows === null && (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-[#DDD0B8] border-t-[#085041] rounded-full animate-spin" />
            </div>
          )}

          {rows !== null && rows.length === 0 && (
            <div className="mt-6 rounded-2xl border border-[#DDD0B8] bg-white p-6 text-center">
              <p className="text-sm font-semibold text-[#6B3F1F] mb-2">{t('emptyTitle')}</p>
              <p className="text-xs text-[#7A8C7E]">
                {t('emptyBody')}
              </p>
              <button
                onClick={() => router.push('/dealer/promoter-assign')}
                className="mt-5 w-full py-3 rounded-2xl text-white font-semibold"
                style={{ background: COLOUR }}>
                {t('assignCta')}
              </button>
            </div>
          )}

          {rows !== null && rows.length > 0 && (
            <>
              <p className="text-xs text-[#7A8C7E] mb-3">
                {t('countAndHint', { count: rows.length })}
              </p>
              <div className="space-y-3">
                {rows.map(r => {
                  const hr = remainingChip(r.hours_remaining)
                  const chipText
                    = hr.kind === 'expiringSoon' ? t('expiringSoon')
                    : hr.kind === 'minLeft' ? t('minLeft', { count: hr.count })
                    : hr.kind === 'hoursLeft' ? t('hoursLeft', { hours: hr.hours })
                    : t('daysLeft', { count: hr.count })
                  return (
                    <div key={r.assignment_id}
                      className="bg-white rounded-2xl border border-[#DDD0B8] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#6B3F1F] truncate">
                            {r.farmer_name || t('unnamedFarmer')}
                          </p>
                          {r.farmer_phone && (
                            <a href={`tel:${r.farmer_phone}`}
                              className="inline-block text-xs text-[#085041] underline underline-offset-2 mt-0.5">
                              📞 {r.farmer_phone}
                            </a>
                          )}
                        </div>
                        <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full ${
                          hr.amber
                            ? 'bg-amber-50 border border-amber-200 text-amber-900'
                            : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                        }`}>
                          {chipText}
                        </span>
                      </div>
                      <div className="mt-3 text-xs text-[#7A8C7E] space-y-0.5">
                        <p>
                          {t('cropLabel')}{' '}
                          <span className="text-[#6B3F1F] font-medium">
                            {cropDisplayName(r.crop_cosh_id)}
                          </span>
                        </p>
                        <p>
                          {t('packageLabel')}{' '}
                          <span className="text-[#6B3F1F] font-medium">{r.package_name}</span>
                        </p>
                      </div>
                      <button
                        onClick={() => cancel(r.assignment_id, r.farmer_name)}
                        disabled={cancellingId === r.assignment_id}
                        className="mt-3 w-full py-2.5 rounded-xl border border-[#D4682E] text-[#D4682E] text-sm font-semibold disabled:opacity-50">
                        {cancellingId === r.assignment_id ? t('withdrawing') : t('withdrawCta')}
                      </button>
                    </div>
                  )
                })}
              </div>

              <button
                onClick={() => router.push('/dealer/promoter-assign')}
                className="mt-6 w-full py-3 rounded-2xl border border-[#DDD0B8] bg-white text-sm font-semibold text-[#6B3F1F]">
                {t('backToAssign')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
