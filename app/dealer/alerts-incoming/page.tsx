'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

const COLOUR = '#085041'

interface AlertSubRow {
  subscription_id: string
  client_id: string
  package_id: string
  package_name: string
  crop_cosh_id: string
  farmer_user_id: string
  farmer_name: string | null
  farmer_phone: string | null
  reference_number: string | null
  source: 'override' | 'auto_promoter'
}

export default function DealerAlertsIncomingPage() {
  const router = useRouter()
  const [rows, setRows] = useState<AlertSubRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<AlertSubRow[]>('/promoter/me/alert-subscriptions')
      setRows(data)
      setError(null)
    } catch {
      setError('Could not load. Pull to retry.')
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

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Alerts I receive" activeRole="DEALER" back="/dealer/home" />
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
              <p className="text-sm font-semibold text-[#6B3F1F] mb-2">No incoming alerts</p>
              <p className="text-xs text-[#7A8C7E] leading-relaxed">
                You aren&apos;t set as the alert recipient on any active subscription. Farmers who add your number to
                their crop&apos;s alert sheet — or whose package you have assigned — will show up here.
              </p>
            </div>
          )}

          {rows !== null && rows.length > 0 && (
            <>
              <p className="text-xs text-[#7A8C7E] mb-3">
                {rows.length} active subscription{rows.length === 1 ? '' : 's'} send alerts to your number.
                Tap a row to view the read-only advisory.
              </p>
              <div className="space-y-3">
                {rows.map(r => (
                  <button
                    key={r.subscription_id}
                    onClick={() => router.push(`/dealer/promoted-farmers/${r.subscription_id}`)}
                    className="w-full text-left bg-white rounded-2xl border border-[#DDD0B8] p-4 hover:border-[#085041] transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-[#6B3F1F] truncate">
                          {r.farmer_name || 'Unnamed farmer'}
                        </p>
                        {r.farmer_phone && (
                          <p className="text-xs text-[#7A8C7E] mt-0.5">📞 {r.farmer_phone}</p>
                        )}
                        <p className="text-xs text-[#7A8C7E] mt-1.5">
                          Crop:{' '}
                          <span className="text-[#6B3F1F] font-medium">{cropDisplayName(r.crop_cosh_id)}</span>
                        </p>
                        <p className="text-xs text-[#7A8C7E]">
                          Package:{' '}
                          <span className="text-[#6B3F1F] font-medium">{r.package_name}</span>
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          r.source === 'override'
                            ? 'bg-[#085041]/10 text-[#085041] border border-[#085041]/30'
                            : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        }`}>
                          {r.source === 'override' ? 'Farmer-added' : 'You promoted'}
                        </span>
                        <span className="text-[#7A8C7E] text-sm" aria-hidden>›</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
    </div>
  )
}
