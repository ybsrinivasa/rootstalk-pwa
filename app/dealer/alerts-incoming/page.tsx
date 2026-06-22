'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

const COLOUR = '#085041'

type AlertType = 'START_DATE' | 'INPUT'

interface IncomingAlert {
  alert_id: string
  alert_type: AlertType
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

export default function DealerAlertsIncomingPage() {
  const router = useRouter()
  const t = useTranslations('dealer.alertsIncoming')
  const [rows, setRows] = useState<IncomingAlert[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<AlertType | null>(null)

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

  const { startDateCount, inputCount } = useMemo(() => {
    const list = rows ?? []
    return {
      startDateCount: list.filter(r => r.alert_type === 'START_DATE').length,
      inputCount: list.filter(r => r.alert_type === 'INPUT').length,
    }
  }, [rows])

  useEffect(() => {
    if (rows === null || tab !== null) return
    setTab(inputCount > startDateCount ? 'INPUT' : 'START_DATE')
  }, [rows, tab, startDateCount, inputCount])

  const visibleRows = useMemo(() => {
    if (rows === null || tab === null) return []
    return rows.filter(r => r.alert_type === tab)
  }, [rows, tab])

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/home" />
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
              <p className="text-xs text-[#7A8C7E] leading-relaxed">
                {t('emptyBody')}
              </p>
            </div>
          )}

          {rows !== null && rows.length > 0 && tab !== null && (
            <>
              <div className="flex gap-2 mb-3" role="tablist" aria-label={t('tabsAriaLabel')}>
                {(['START_DATE', 'INPUT'] as AlertType[]).map(kind => {
                  const isActive = tab === kind
                  const count = kind === 'START_DATE' ? startDateCount : inputCount
                  const label = kind === 'START_DATE' ? t('pillStartDate') : t('pillInput')
                  return (
                    <button key={kind} role="tab" aria-selected={isActive}
                      onClick={() => setTab(kind)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-sm font-semibold transition-colors"
                      style={{
                        background: isActive ? COLOUR : '#fff',
                        color: isActive ? '#fff' : COLOUR,
                        border: `1.5px solid ${isActive ? COLOUR : COLOUR + '66'}`,
                      }}>
                      <span>{label}</span>
                      <span
                        className="inline-flex items-center justify-center min-w-5 h-5 rounded-full text-[11px] font-bold px-1.5"
                        style={{
                          background: isActive ? '#ffffff33' : COLOUR + '14',
                          color: isActive ? '#fff' : COLOUR,
                        }}>
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>

              {visibleRows.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-[#DDD0B8] bg-white p-5 text-center">
                  <p className="text-xs text-[#7A8C7E] leading-relaxed">
                    {tab === 'START_DATE' ? t('emptyStartDate') : t('emptyInput')}
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-[#7A8C7E] mb-3">
                    {t('countAndHint', { count: visibleRows.length })}
                  </p>
                  <div className="space-y-3">
                    {visibleRows.map(r => (
                      <div
                        key={r.alert_id}
                        className="bg-white rounded-2xl border border-[#DDD0B8] p-4">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="font-semibold text-[#6B3F1F] truncate flex-1">
                            {r.farmer_name || t('unnamedFarmer')}
                          </p>
                          <span className="text-[11px] text-[#7A8C7E] shrink-0">{formatSentAt(r.sent_at)}</span>
                        </div>
                        <p className="text-xs text-[#7A8C7E]">
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
            </>
          )}
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
    </div>
  )
}
