'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface Subscription {
  id: string
  status: string
  client_id: string
  crop_start_date: string | null
  reference_number: string | null
  package_name: string | null
  crop_name: string | null
  client_display_name: string | null
  client_primary_colour: string | null
  subscription_type: 'SELF' | 'ASSIGNED' | string
  farmer_district_name: string | null
}

export default function HistoryPage() {
  const router = useRouter()
  const t = useTranslations('farmerHistory')
  const tCommon = useTranslations('common')
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)

  // QR + unsubscribe state
  const [qrSub, setQrSub] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [loadingQr, setLoadingQr] = useState(false)
  const [confirmUnsub, setConfirmUnsub] = useState<Subscription | null>(null)
  const [unsubBusy, setUnsubBusy] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get<Subscription[]>('/farmer/my-subscriptions')
      setSubscriptions(data)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function openQR(subId: string) {
    setQrSub(subId)
    setLoadingQr(true)
    try {
      const token = localStorage.getItem('rt_pwa_token')
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'
      const res = await fetch(`${API_URL}/farmer/subscriptions/${subId}/crop-qr`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const blob = await res.blob()
      setQrUrl(URL.createObjectURL(blob))
    } catch { setQrSub(null) }
    finally { setLoadingQr(false) }
  }

  // 2026-06-06 — Web Share for the QR. Falls back to save (download)
  // when navigator.share isn't available on the device.
  async function shareQR() {
    if (!qrUrl) return
    const navAny = navigator as Navigator & { share?: (data: ShareData) => Promise<void>, canShare?: (data: ShareData) => boolean }
    try {
      const blob = await (await fetch(qrUrl)).blob()
      const file = new File([blob], 'crop-record-qr.png', { type: 'image/png' })
      const shareData: ShareData = {
        title: t('qr.shareTitle'),
        text: t('qr.shareText'),
        files: [file],
      } as ShareData
      if (navAny.share && (!navAny.canShare || navAny.canShare(shareData))) {
        await navAny.share(shareData)
        return
      }
    } catch { /* user cancelled or unsupported */ }
    // Fallback: open the download.
    const a = document.createElement('a')
    a.href = qrUrl
    a.download = 'crop-record-qr.png'
    a.click()
  }

  async function unsubscribe(sub: Subscription) {
    setUnsubBusy(true)
    try {
      await api.put(`/farmer/subscriptions/${sub.id}/unsubscribe`, {})
      setConfirmUnsub(null)
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      alert(e?.response?.data?.detail || t('errorUnsubscribe'))
    } finally { setUnsubBusy(false) }
  }

  const ongoing = subscriptions.filter(s => ['ACTIVE', 'WAITLISTED'].includes(s.status))
  const completed = subscriptions.filter(s => !['ACTIVE', 'WAITLISTED'].includes(s.status))
  const district = subscriptions[0]?.farmer_district_name

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FARMER" back="/home" />
      <div className="pt-16 pb-20 px-4 max-w-lg mx-auto">
        {loading ? (
          <div className="mt-4 space-y-3">{[1, 2].map(i => <div key={i} className="h-24 bg-white rounded-2xl animate-pulse" />)}</div>
        ) : subscriptions.length === 0 ? (
          <div className="text-center py-20 mt-4">
            <svg className="w-12 h-12 mx-auto text-[#DDD0B8]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
            </svg>
            <p className="text-[#7A8C7E] font-medium mt-3">{t('empty')}</p>
          </div>
        ) : (
          <div className="mt-4">
            {district && (
              <p className="text-[11px] text-[#7A8C7E] mb-3">
                {t('showingFromPrefix')} <strong className="text-[#6B3F1F]">{district}</strong>
              </p>
            )}
            {ongoing.length > 0 && (
              <section>
                <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3">{t('active')}</p>
                <div className="space-y-3">
                  {ongoing.map(sub => (
                    <SubCard
                      key={sub.id}
                      sub={sub}
                      router={router}
                      onShareQR={openQR}
                      onUnsubscribe={() => setConfirmUnsub(sub)}
                    />
                  ))}
                </div>
              </section>
            )}

            {completed.length > 0 && (
              <section>
                <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3 mt-6">{t('past')}</p>
                <div className="space-y-3">
                  {completed.map(sub => (
                    <SubCard
                      key={sub.id}
                      sub={sub}
                      router={router}
                      onShareQR={openQR}
                      onUnsubscribe={() => setConfirmUnsub(sub)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
      <BottomNav color="#3A7D44" />

      {/* QR bottom sheet */}
      {qrSub && (
        <div
          className="fixed inset-0 z-[60] flex items-end bg-black/40"
          onClick={() => { setQrSub(null); setQrUrl(null) }}>
          <div
            className="bg-white rounded-t-2xl w-full pt-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-5" />
            <p className="text-center font-semibold text-[#6B3F1F] mb-4">{t('qr.title')}</p>
            {loadingQr ? (
              <div className="flex justify-center py-8">
                <div className="w-8 h-8 border-2 border-[#3A7D44] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : qrUrl ? (
              <div className="flex flex-col items-center gap-4">
                <img src={qrUrl} alt={t('qr.alt')} className="w-48 h-48 mx-auto" />
                <p className="text-[#7A8C7E] text-xs text-center max-w-xs px-4">
                  {t('qr.hint')}
                </p>
                <div className="flex gap-2 px-4 w-full max-w-sm">
                  <button onClick={shareQR}
                    className="flex-1 py-3 rounded-2xl text-white text-sm font-medium"
                    style={{ background: '#3A7D44' }}>
                    {t('qr.share')}
                  </button>
                  <a href={qrUrl} download="crop-record-qr.png"
                    className="flex-1 py-3 rounded-2xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium text-center">
                    {t('qr.save')}
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Unsubscribe confirm */}
      {confirmUnsub && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={() => !unsubBusy && setConfirmUnsub(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">{t('confirmUnsub.title')}</p>
            <p className="text-xs text-[#7A8C7E] mt-2 leading-relaxed">
              {t('confirmUnsub.bodyPrefix')}{' '}
              <strong className="text-[#6B3F1F]">{confirmUnsub.crop_name || confirmUnsub.package_name || t('thisCropFallback')}</strong>{' '}
              {t('confirmUnsub.bodyMiddle')} <strong className="text-[#6B3F1F]">{confirmUnsub.client_display_name}</strong>{t('confirmUnsub.bodySuffix')}
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmUnsub(null)} disabled={unsubBusy}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                {tCommon('cancel')}
              </button>
              <button onClick={() => unsubscribe(confirmUnsub)} disabled={unsubBusy}
                className="flex-1 bg-red-100 text-[#D4682E] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {unsubBusy ? '…' : t('confirmUnsub.yes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SubCard({
  sub, router, onShareQR, onUnsubscribe,
}: {
  sub: Subscription
  router: ReturnType<typeof useRouter>
  onShareQR: (id: string) => void
  onUnsubscribe: () => void
}) {
  const t = useTranslations('farmerHistory')
  const colour = sub.client_primary_colour || '#3A7D44'
  // 2026-06-06 — Only SELF-subscribed packages can be self-unsubscribed.
  // Promoter-assigned ones must be cancelled by the company.
  const canUnsubscribe = sub.subscription_type === 'SELF' &&
    ['ACTIVE', 'WAITLISTED'].includes(sub.status)
  return (
    <div className="w-full bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
      <div className="px-4 py-2 flex items-center justify-between" style={{ background: colour + '18' }}>
        <p className="text-xs font-semibold" style={{ color: colour }}>{sub.client_display_name || t('company')}</p>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sub.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : sub.status === 'WAITLISTED' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-[#7A8C7E]'}`}>
          {sub.status}
        </span>
      </div>
      <div className="px-4 pt-3">
        <p className="text-base font-bold text-[#6B3F1F]">
          {sub.crop_name || sub.package_name || t('crop')}
        </p>
        {sub.reference_number && (
          <p className="text-[11px] font-mono text-[#7A8C7E] mt-0.5">{sub.reference_number}</p>
        )}
        <p className="text-[11px] text-[#7A8C7E] mt-0.5">
          {sub.crop_start_date
            ? t('startedOn', { date: new Date(sub.crop_start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) })
            : t('startNotSet')}
        </p>
      </div>
      <div className="px-4 pt-3 pb-3 flex gap-2 flex-wrap">
        <button onClick={() => onShareQR(sub.id)}
          className="text-[11px] font-medium px-3 py-1.5 rounded-lg border border-[#DDD0B8] text-[#6B3F1F] flex items-center gap-1.5">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
          </svg>
          {t('shareCropQR')}
        </button>
        {/* 2026-06-06 — "Missed" pill rephrased so the farmer reads
            what it does (advisory days they didn't act on). */}
        <button onClick={() => router.push(`/missed-items/${sub.id}`)}
          className="text-[11px] font-medium px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 bg-amber-50">
          {t('missedAdvisories')}
        </button>
        {canUnsubscribe && (
          <button onClick={onUnsubscribe}
            className="text-[11px] font-medium px-3 py-1.5 rounded-lg border border-red-200 text-[#D4682E] bg-red-50 ml-auto">
            {t('unsubscribeBtn')}
          </button>
        )}
      </div>
    </div>
  )
}
