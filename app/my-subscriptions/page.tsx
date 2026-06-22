'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

// 2026-06-22 — Merged former /history into this page. The right-drawer
// link "My Subscriptions" and the bottom-nav "History" tab both land
// here now. Three sections: Active / Unsubscribed / Completed. Other
// statuses (WAITLISTED, CANCELLED-by-promoter, SUSPENDED) live on
// other surfaces (Home pending-payment card, alerts) — they don't
// belong on a lifecycle-history page.
//
// The "Advisories in your area" discovery section was removed per user
// direction (privacy: revealing companies serving your district can
// out you to nearby competitors).

interface Subscription {
  id: string
  status: string
  client_id: string
  crop_start_date: string | null
  reference_number: string | null
  package_name: string | null
  crop_name: string | null
  client_display_name: string | null
  client_logo_url: string | null
  client_primary_colour: string | null
  subscription_type: 'SELF' | 'ASSIGNED' | string
  lapsed_at: string | null
  updated_at: string | null
}

export default function MySubscriptionsPage() {
  const router = useRouter()
  const t = useTranslations('mySubscriptions')
  const tCommon = useTranslations('common')
  const locale = useLocale()
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function openQR(subId: string) {
    setQrSub(subId)
    setLoadingQr(true)
    try {
      const token = localStorage.getItem('rt_pwa_token')
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'
      const res = await fetch(`${API_URL}/farmer/subscriptions/${subId}/crop-qr`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const blob = await res.blob()
      setQrUrl(URL.createObjectURL(blob))
    } catch { setQrSub(null) }
    finally { setLoadingQr(false) }
  }

  async function shareQR() {
    if (!qrUrl) return
    const navAny = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>
      canShare?: (data: ShareData) => boolean
    }
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

  const active = subscriptions.filter(s => s.status === 'ACTIVE')
  const unsubscribed = subscriptions.filter(s => s.status === 'UNSUBSCRIBED')
  const completed = subscriptions.filter(s => s.status === 'LAPSED')

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FARMER" back="/home" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        {loading ? (
          <div className="mt-4 space-y-3">
            {[1, 2].map(i => <div key={i} className="h-24 bg-white rounded-2xl animate-pulse" />)}
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="text-center py-20 mt-4">
            <span className="text-4xl">🌾</span>
            <p className="text-[#7A8C7E] font-medium mt-3">{t('emptyTitle')}</p>
            <button onClick={() => router.push('/subscribe')}
              className="mt-4 px-6 py-3 rounded-2xl text-white text-sm font-semibold bg-green-700">
              {t('emptyCta')}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-6">
            {active.length > 0 && (
              <SectionList title={t('active', { count: active.length })}
                subs={active} kind="active"
                router={router} locale={locale} t={t}
                onShareQR={openQR}
                onUnsubscribe={s => setConfirmUnsub(s)} />
            )}
            {unsubscribed.length > 0 && (
              <SectionList title={t('unsubscribed', { count: unsubscribed.length })}
                subs={unsubscribed} kind="unsubscribed"
                router={router} locale={locale} t={t}
                onShareQR={openQR}
                onUnsubscribe={s => setConfirmUnsub(s)} />
            )}
            {completed.length > 0 && (
              <SectionList title={t('completed', { count: completed.length })}
                subs={completed} kind="completed"
                router={router} locale={locale} t={t}
                onShareQR={openQR}
                onUnsubscribe={s => setConfirmUnsub(s)} />
            )}
          </div>
        )}
      </div>
      <BottomNav color="#3A7D44" />

      {/* QR bottom sheet */}
      {qrSub && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/40"
          onClick={() => { setQrSub(null); setQrUrl(null) }}>
          <div className="bg-white rounded-t-2xl w-full pt-5"
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
                <p className="text-[#7A8C7E] text-xs text-center max-w-xs px-4">{t('qr.hint')}</p>
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
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end"
          onClick={() => !unsubBusy && setConfirmUnsub(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">{t('confirmUnsub.title')}</p>
            <p className="text-xs text-[#7A8C7E] mt-2 leading-relaxed">
              {t('confirmUnsub.bodyPrefix')}{' '}
              <strong className="text-[#6B3F1F]">{confirmUnsub.crop_name || t('thisCropFallback')}</strong>{' '}
              {t('confirmUnsub.bodyMiddle')}{' '}
              <strong className="text-[#6B3F1F]">{confirmUnsub.client_display_name}</strong>
              {t('confirmUnsub.bodySuffix')}
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

function SectionList({
  title, subs, kind, router, locale, t, onShareQR, onUnsubscribe,
}: {
  title: string
  subs: Subscription[]
  kind: 'active' | 'unsubscribed' | 'completed'
  router: ReturnType<typeof useRouter>
  locale: string
  t: ReturnType<typeof useTranslations>
  onShareQR: (id: string) => void
  onUnsubscribe: (s: Subscription) => void
}) {
  return (
    <section>
      <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3">{title}</p>
      <div className="space-y-3">
        {subs.map(sub => (
          <SubCard key={sub.id} sub={sub} kind={kind}
            router={router} locale={locale} t={t}
            onShareQR={onShareQR} onUnsubscribe={onUnsubscribe} />
        ))}
      </div>
    </section>
  )
}

function SubCard({
  sub, kind, router, locale, t, onShareQR, onUnsubscribe,
}: {
  sub: Subscription
  kind: 'active' | 'unsubscribed' | 'completed'
  router: ReturnType<typeof useRouter>
  locale: string
  t: ReturnType<typeof useTranslations>
  onShareQR: (id: string) => void
  onUnsubscribe: (s: Subscription) => void
}) {
  const colour = sub.client_primary_colour || '#3A7D44'
  // Voluntary unsubscribe is only offered for SELF subscriptions that
  // are still ACTIVE. Promoter-assigned subs must go through the
  // company channel (same rule the backend enforces at PUT
  // /unsubscribe via is_self_unsubscribable).
  const canUnsubscribe = kind === 'active' && sub.subscription_type === 'SELF'
  const start = sub.crop_start_date
    ? new Date(sub.crop_start_date).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
    : null
  // End-date: for completed → lapsed_at; for unsubscribed → updated_at
  // (the status flip is the row's last touch on UNSUBSCRIBED rows).
  const endIso = kind === 'completed' ? sub.lapsed_at : kind === 'unsubscribed' ? sub.updated_at : null
  const end = endIso
    ? new Date(endIso).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
    : null

  return (
    <div className="w-full bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2.5" style={{ background: colour + '18' }}>
        {sub.client_logo_url ? (
          <img src={sub.client_logo_url} alt="" className="w-7 h-7 rounded object-cover bg-white" />
        ) : (
          <div className="w-7 h-7 rounded bg-white border border-[#DDD0B8] flex items-center justify-center text-[10px] font-bold"
            style={{ color: colour }}>
            {(sub.client_display_name || '?').slice(0, 2).toUpperCase()}
          </div>
        )}
        <p className="text-sm font-bold flex-1 truncate" style={{ color: colour }}>
          {sub.client_display_name || t('companyFallback')}
        </p>
        <StatusBadge kind={kind} t={t} />
      </div>
      <div className="px-4 pt-3">
        <p className="text-base font-bold text-[#6B3F1F]">
          {sub.crop_name || t('cropFallback')}
        </p>
        {sub.reference_number && (
          <p className="text-[11px] font-mono text-[#7A8C7E] mt-0.5">{sub.reference_number}</p>
        )}
        <p className="text-[11px] text-[#7A8C7E] mt-1">
          {sub.subscription_type === 'ASSIGNED'
            ? t('assignedBy', { company: sub.client_display_name || t('companyFallback') })
            : t('subscribedBySelf')}
        </p>
        {(start || end) && (
          <p className="text-[11px] text-[#7A8C7E] mt-0.5">
            {start && end
              ? t('startToEnd', { start, end })
              : start
                ? t('startedOn', { date: start })
                : t('endedOn', { date: end as string })}
          </p>
        )}
      </div>
      <div className="px-4 pt-3 pb-3 flex gap-2 flex-wrap">
        {kind === 'active' && (
          <button onClick={() => router.push(`/crop-detail/${sub.id}`)}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg text-white"
            style={{ background: colour }}>
            {t('openAdvisory')}
          </button>
        )}
        <button onClick={() => onShareQR(sub.id)}
          className="text-[11px] font-medium px-3 py-1.5 rounded-lg border border-[#DDD0B8] text-[#6B3F1F] flex items-center gap-1.5">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
          </svg>
          {t('shareCropQR')}
        </button>
        {canUnsubscribe && (
          <button onClick={() => onUnsubscribe(sub)}
            className="text-[11px] font-medium px-3 py-1.5 rounded-lg border border-red-200 text-[#D4682E] bg-red-50 ml-auto">
            {t('unsubscribeBtn')}
          </button>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ kind, t }: {
  kind: 'active' | 'unsubscribed' | 'completed'
  t: ReturnType<typeof useTranslations>
}) {
  const cls = kind === 'active'
    ? 'bg-green-100 text-green-700'
    : kind === 'unsubscribed'
      ? 'bg-rose-100 text-rose-700'
      : 'bg-slate-100 text-[#7A8C7E]'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {t(`statusBadge.${kind}`)}
    </span>
  )
}
