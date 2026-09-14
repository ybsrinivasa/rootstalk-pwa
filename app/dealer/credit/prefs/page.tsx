'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'


const COLOUR = '#7D4196'

interface ReminderPref {
  daily_summary_enabled: boolean
  weekly_summary_enabled: boolean
  new_entry_push_enabled: boolean
  quiet_hours_start: string | null
  quiet_hours_end: string | null
}


export default function DealerCreditPrefsPage() {
  const router = useRouter()
  const t = useTranslations('credit.prefs')
  const [pref, setPref] = useState<ReminderPref | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get<ReminderPref>('/credit/prefs')
      setPref(data)
    } finally { setLoading(false) }
  }

  async function toggle(field: keyof ReminderPref, value: boolean) {
    if (!pref) return
    setSaving(field)
    const optimistic = { ...pref, [field]: value }
    setPref(optimistic)
    try {
      await api.patch('/credit/prefs', { [field]: value })
    } catch { setPref(pref) }
    finally { setSaving(null) }
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/credit" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        {loading || !pref ? (
          <div className="mt-4 space-y-3">
            <div className="h-16 bg-white rounded-2xl animate-pulse" />
            <div className="h-16 bg-white rounded-2xl animate-pulse" />
            <div className="h-16 bg-white rounded-2xl animate-pulse" />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <ToggleRow
              title={t('newEntryTitle')}
              hint={t('newEntryHintDealer')}
              value={pref.new_entry_push_enabled}
              busy={saving === 'new_entry_push_enabled'}
              onChange={v => toggle('new_entry_push_enabled', v)} />
            <ToggleRow
              title={t('dailyTitle')}
              hint={t('dailyHintDealer')}
              value={pref.daily_summary_enabled}
              busy={saving === 'daily_summary_enabled'}
              onChange={v => toggle('daily_summary_enabled', v)} />
            <ToggleRow
              title={t('weeklyTitle')}
              hint={t('weeklyHintDealer')}
              value={pref.weekly_summary_enabled}
              busy={saving === 'weekly_summary_enabled'}
              onChange={v => toggle('weekly_summary_enabled', v)} />
          </div>
        )}
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
    </div>
  )
}


function ToggleRow({
  title, hint, value, busy, onChange,
}: {
  title: string
  hint: string
  value: boolean
  busy: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#EEE4D2] p-4 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[#6B3F1F] text-sm">{title}</p>
        <p className="text-xs text-[#7A8C7E] mt-1 leading-snug">{hint}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        disabled={busy}
        aria-pressed={value}
        className={`flex-shrink-0 w-11 h-6 rounded-full relative transition-colors disabled:opacity-50 ${
          value ? 'bg-[#7D4196]' : 'bg-stone-300'
        }`}>
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
          style={{ left: value ? '22px' : '2px' }} />
      </button>
    </div>
  )
}
