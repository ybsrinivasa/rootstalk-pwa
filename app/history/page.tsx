'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface Subscription {
  id: string; status: string; client_id: string
  crop_start_date: string | null; reference_number: string | null
}
interface Branding { display_name: string; primary_colour: string }

export default function HistoryPage() {
  const router = useRouter()
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [brandings, setBrandings] = useState<Record<string, Branding>>({})
  const [loading, setLoading] = useState(true)

  // QR share state
  const [qrSub, setQrSub] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [loadingQr, setLoadingQr] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<Subscription[]>('/farmer/my-subscriptions').then(async r => {
      setSubscriptions(r.data)
      const ids = [...new Set(r.data.map(s => s.client_id))]
      const results = await Promise.allSettled(ids.map(id =>
        api.get<Branding>(`/client/${id}/info`).then(res => ({ id, data: res.data }))
      ))
      const m: Record<string, Branding> = {}
      results.forEach(res => { if (res.status === 'fulfilled') m[res.value.id] = res.value.data })
      setBrandings(m)
    }).finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function shareQR(subId: string) {
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

  // A5 spec: ongoing = ACTIVE or WAITLISTED, completed = everything else
  const ongoing = subscriptions.filter(s => ['ACTIVE', 'WAITLISTED'].includes(s.status))
  const completed = subscriptions.filter(s => !['ACTIVE', 'WAITLISTED'].includes(s.status))

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Crop History" activeRole="FARMER" />
      <div className="pt-16 pb-20 px-4 max-w-lg mx-auto">
        {loading ? (
          <div className="mt-4 space-y-3">{[1, 2].map(i => <div key={i} className="h-20 bg-white rounded-2xl animate-pulse" />)}</div>
        ) : subscriptions.length === 0 ? (
          <div className="text-center py-20 mt-4">
            {/* SVG clipboard — replaces 📋 emoji */}
            <svg className="w-12 h-12 mx-auto text-[#DDD0B8]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
            </svg>
            <p className="text-[#7A8C7E] font-medium mt-3">No crop records yet</p>
          </div>
        ) : (
          <div className="mt-4">
            {/* Ongoing crops — shown FIRST per A5 spec */}
            {ongoing.length > 0 && (
              <section>
                <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3">Active Subscriptions</p>
                <div className="space-y-3">
                  {ongoing.map(sub => (
                    <SubCard
                      key={sub.id}
                      sub={sub}
                      branding={brandings[sub.client_id]}
                      router={router}
                      onShareQR={shareQR}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Completed seasons — shown BELOW per A5 spec */}
            {completed.length > 0 && (
              <section>
                <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-widest mb-3 mt-6">Past Seasons</p>
                <div className="space-y-3">
                  {completed.map(sub => (
                    <SubCard
                      key={sub.id}
                      sub={sub}
                      branding={brandings[sub.client_id]}
                      router={router}
                      onShareQR={shareQR}
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
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => { setQrSub(null); setQrUrl(null) }}>
          <div
            className="bg-white rounded-t-2xl w-full pb-10 pt-5"
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-5" />
            <p className="text-center font-semibold text-[#6B3F1F] mb-4">Crop Record QR</p>
            {loadingQr ? (
              <div className="flex justify-center py-8">
                <div className="w-8 h-8 border-2 border-[#3A7D44] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : qrUrl ? (
              <div className="flex flex-col items-center gap-4">
                <img src={qrUrl} alt="Crop QR" className="w-48 h-48 mx-auto" />
                <p className="text-[#7A8C7E] text-xs text-center max-w-xs px-4">
                  Anyone can scan this to see your crop record — no app needed.
                </p>
                <a
                  href={qrUrl}
                  download="crop-record-qr.png"
                  className="px-6 py-3 rounded-2xl text-white text-sm font-medium"
                  style={{ background: '#3A7D44' }}>
                  Save QR image
                </a>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function SubCard({
  sub, branding, router, onShareQR,
}: {
  sub: Subscription
  branding?: Branding
  router: ReturnType<typeof useRouter>
  onShareQR: (id: string) => void
}) {
  const colour = branding?.primary_colour || '#3A7D44'
  return (
    <div className="w-full bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden text-left">
      <button
        onClick={() => router.push(`/crop-detail/${sub.id}`)}
        className="w-full active:scale-98 transition-transform">
        <div className="px-4 py-2 flex items-center justify-between" style={{ background: colour + '18' }}>
          <p className="text-xs font-semibold" style={{ color: colour }}>{branding?.display_name || 'Company'}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sub.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : sub.status === 'WAITLISTED' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-[#7A8C7E]'}`}>
            {sub.status}
          </span>
        </div>
        <div className="px-4 pt-3 flex items-center justify-between">
          <div>
            {sub.reference_number && <p className="text-xs font-mono text-[#7A8C7E]">{sub.reference_number}</p>}
            <p className="text-xs text-[#7A8C7E] mt-0.5">
              {sub.crop_start_date
                ? `Started ${new Date(sub.crop_start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                : 'Start date not set'}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <button onClick={e => { e.stopPropagation(); router.push(`/missed-items/${sub.id}`) }}
              className="text-xs text-amber-600 border border-amber-200 rounded-lg px-2 py-1">
              Missed
            </button>
            <span className="text-[#DDD0B8] text-lg">›</span>
          </div>
        </div>
      </button>
      {/* Share crop record button */}
      <div className="px-4 pb-3">
        <button
          onClick={() => onShareQR(sub.id)}
          className="text-xs font-medium px-3 py-1.5 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] mt-3 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
          </svg>
          Share crop record
        </button>
      </div>
    </div>
  )
}
