'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

const COLOUR = '#7D4E00'

interface IncomingAlert {
  alert_id: string
  alert_type: 'START_DATE' | 'INPUT'
  sent_at: string
  subscription_id: string
  client_id: string
  farmer_user_id: string
  farmer_name: string | null
  farmer_phone: string | null
  crop_cosh_id: string | null
  crop_name: string | null
}

function formatSentAt(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

export default function FacilitatorAlertsIncomingPage() {
  const router = useRouter()
  const t = useTranslations('facilitator.alertsIncoming')
  const [rows, setRows] = useState<IncomingAlert[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<IncomingAlert[]>('/promoter/me/incoming-alerts')
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

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FACILITATOR" back="/facilitator/home" />
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
              <p className="text-sm font-semibold text-[#6B3F1F] mb-2">{t('emptyTitle')}</p>
              <p className="text-xs text-[#7A8C7E] leading-relaxed">
                {t('emptyBody')}
              </p>
            </div>
          )}

          {rows !== null && rows.length > 0 && (
            <>
              <p className="text-xs text-[#7A8C7E] mb-3">
                {t('countAndHint', { count: rows.length })}
              </p>
              <div className="space-y-3">
                {rows.map(r => (
                  <div
                    key={r.alert_id}
                    className="bg-white rounded-2xl border border-[#DDD0B8] p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        r.alert_type === 'START_DATE'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-[#7D4E00]/10 text-[#7D4E00] border border-[#7D4E00]/30'
                      }`}>
                        {t('alertTypeBadge', { type: r.alert_type === 'START_DATE' ? t('typeStartDate') : t('typeInput') })}
                      </span>
                      <span className="text-[11px] text-[#7A8C7E]">{formatSentAt(r.sent_at)}</span>
                    </div>
                    <p className="font-semibold text-[#6B3F1F] truncate">
                      {r.farmer_name || t('unnamedFarmer')}
                    </p>
                    <p className="text-xs text-[#7A8C7E] mt-0.5">
                      {t('cropLabel')}{' '}
                      <span className="text-[#6B3F1F] font-medium">
                        {r.crop_name || cropDisplayName(r.crop_cosh_id || '')}
                      </span>
                    </p>
                    {r.farmer_phone && (
                      <a href={`tel:${r.farmer_phone}`}
                        className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full"
                        style={{ background: '#fff', color: COLOUR, border: `1.5px solid ${COLOUR}66` }}>
                        {t('callBtn', { phone: r.farmer_phone })}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="FACILITATOR" />
    </div>
  )
}
