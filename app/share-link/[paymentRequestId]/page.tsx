'use client'
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import QRCode from 'qrcode'

interface PaymentRequest {
  id: string
  subscription_id: string
  method: 'DELEGATE' | 'SHARE_LINK'
  status: 'PENDING' | 'PAID' | 'CANCELLED' | 'DECLINED'
  amount: number
  short_url: string | null
  expires_at: string
  hours_remaining: number
  package_name: string | null
  crop_name: string | null
  paid_by_vpa: string | null
}

const COLOUR = '#3A7D44'

export default function ShareLinkPage() {
  const router = useRouter()
  const { paymentRequestId } = useParams<{ paymentRequestId: string }>()

  const [req, setReq] = useState<PaymentRequest | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Fetch the payment request + render the QR each time the short_url
  // resolves. QR generation is local (qrcode npm package) so it works
  // offline once the page is in cache.
  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
    api.get<PaymentRequest>(`/farmer/payment-requests/${paymentRequestId}`)
      .then(r => {
        setReq(r.data)
        if (r.data.short_url) {
          QRCode.toDataURL(r.data.short_url, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 320,
            color: { dark: '#1F2937', light: '#FFFFFF' },
          }).then(setQrDataUrl).catch(() => setQrDataUrl(''))
        }
      })
      .catch(err => {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        setError(detail || 'Could not load payment link.')
      })
      .finally(() => setLoading(false))
  }, [paymentRequestId, router])

  async function copyLink() {
    if (!req?.short_url) return
    try {
      await navigator.clipboard.writeText(req.short_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Older browsers / non-secure contexts: fall back to a synthetic
      // textarea selection. Best-effort; nothing fancy.
      const ta = document.createElement('textarea')
      ta.value = req.short_url
      document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ }
      document.body.removeChild(ta)
    }
  }

  function shareWhatsApp() {
    if (!req?.short_url) return
    const text = `Please pay ₹${Number(req.amount).toFixed(0)} for my crop advisory subscription on RootsTalk. Pay here: ${req.short_url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  }

  function shareSMS() {
    if (!req?.short_url) return
    const text = `Please pay ₹${Number(req.amount).toFixed(0)} for my RootsTalk subscription: ${req.short_url}`
    window.location.href = `sms:?body=${encodeURIComponent(text)}`
  }

  async function shareNative() {
    if (!req?.short_url) return
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Pay for my RootsTalk subscription',
          text: `Please pay ₹${Number(req.amount).toFixed(0)} for my crop advisory.`,
          url: req.short_url,
        })
      } catch { /* user cancelled */ }
    } else {
      // No native share API — fall back to copy.
      copyLink()
    }
  }

  async function cancelLink() {
    if (!req) return
    if (!confirm('Cancel this payment link? The QR will stop working immediately. You can generate a new one or pay yourself.')) return
    setCancelling(true)
    try {
      await api.delete(`/farmer/subscriptions/${req.subscription_id}/delegate-payment`)
      router.replace('/home')
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      alert(detail || 'Could not cancel.')
      setCancelling(false)
    }
  }

  const hoursLow = req && req.hours_remaining <= 6
  const titleContext = [req?.crop_name, req?.package_name].filter(Boolean).join(' · ')

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Share payment link" activeRole="FARMER" back="/home" />
      <div className="pt-16 pb-20 px-4 max-w-md mx-auto">
        {loading ? (
          <div className="h-72 bg-white rounded-2xl animate-pulse mt-4" />
        ) : error ? (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] p-6 mt-6 text-center">
            <p className="text-sm text-[#D4682E]">{error}</p>
            <button onClick={() => router.replace('/home')}
              className="mt-4 w-full py-3 rounded-2xl text-white font-semibold text-sm"
              style={{ background: COLOUR }}>
              Back to Home
            </button>
          </div>
        ) : req?.status === 'PAID' ? (
          // Came back after someone paid.
          <div className="bg-white rounded-2xl border border-[#DDD0B8] p-6 mt-6 text-center">
            <span className="text-5xl">✅</span>
            <h2 className="font-bold text-xl mt-3" style={{ color: COLOUR }}>Payment received</h2>
            <p className="text-sm text-[#7A8C7E] mt-2">
              {req.paid_by_vpa
                ? <>Paid by <span className="font-mono">{req.paid_by_vpa}</span></>
                : 'Your subscription is now active.'}
            </p>
            <button onClick={() => router.replace('/home')}
              className="mt-5 w-full py-3.5 rounded-2xl text-white font-semibold text-sm"
              style={{ background: COLOUR }}>
              Open my advisory →
            </button>
          </div>
        ) : req?.status !== 'PENDING' ? (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] p-6 mt-6 text-center">
            <span className="text-4xl">🚫</span>
            <h2 className="font-bold text-lg text-[#6B3F1F] mt-3">Link no longer active</h2>
            <p className="text-xs text-[#7A8C7E] mt-2">
              This payment link is {req?.status?.toLowerCase()}. You can generate a new one or pay yourself.
            </p>
            <button onClick={() => router.replace('/home')}
              className="mt-5 w-full py-3 rounded-2xl text-white font-semibold text-sm"
              style={{ background: COLOUR }}>
              Back to Home
            </button>
          </div>
        ) : (
          <>
            {/* Heading + context */}
            <div className="mt-4 text-center">
              <h2 className="font-bold text-xl text-[#6B3F1F]">Share this with anyone</h2>
              {titleContext && (
                <p className="text-xs text-[#7A8C7E] mt-1">{titleContext}</p>
              )}
              <p className={`text-xs font-medium mt-2 ${hoursLow ? 'text-[#B85C00]' : 'text-[#7A8C7E]'}`}>
                {req!.hours_remaining === 0
                  ? 'Expiring soon'
                  : `Link active for ${req!.hours_remaining} more hour${req!.hours_remaining === 1 ? '' : 's'}`}
              </p>
            </div>

            {/* QR */}
            <div className="bg-white rounded-3xl border border-[#DDD0B8] shadow-sm p-6 mt-4 flex flex-col items-center">
              {qrDataUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={qrDataUrl} alt="Payment QR" width={280} height={280}
                  className="rounded-xl"
                  style={{ imageRendering: 'pixelated' }} />
              ) : (
                <div className="w-[280px] h-[280px] bg-slate-100 rounded-xl flex items-center justify-center text-[#7A8C7E] text-xs">
                  Generating QR…
                </div>
              )}
              <p className="text-2xl font-bold text-[#6B3F1F] mt-4">₹{Number(req!.amount).toFixed(0)}</p>
              <p className="text-xs text-[#7A8C7E] mt-1">
                Any UPI app — PhonePe, Google Pay, Paytm, BHIM, banks
              </p>
            </div>

            {/* Short URL + copy */}
            <div className="bg-white rounded-2xl border border-[#DDD0B8] p-3 mt-3 flex items-center gap-2">
              <p className="flex-1 text-xs font-mono text-[#6B3F1F] truncate">{req!.short_url}</p>
              <button onClick={copyLink}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
                style={{ background: copied ? '#D4F4DD' : '#F5F0E8', color: COLOUR }}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>

            {/* Share buttons */}
            <div className="grid grid-cols-3 gap-2 mt-3">
              <button onClick={shareWhatsApp}
                className="py-3 rounded-2xl bg-white border border-[#DDD0B8] text-xs font-medium text-[#6B3F1F] flex flex-col items-center gap-1">
                <span className="text-xl">💬</span>WhatsApp
              </button>
              <button onClick={shareSMS}
                className="py-3 rounded-2xl bg-white border border-[#DDD0B8] text-xs font-medium text-[#6B3F1F] flex flex-col items-center gap-1">
                <span className="text-xl">✉️</span>SMS
              </button>
              <button onClick={shareNative}
                className="py-3 rounded-2xl bg-white border border-[#DDD0B8] text-xs font-medium text-[#6B3F1F] flex flex-col items-center gap-1">
                <span className="text-xl">↗</span>More
              </button>
            </div>

            {/* How it works */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mt-4">
              <p className="text-xs font-semibold text-emerald-900 mb-2">How this works</p>
              <ol className="text-xs text-emerald-900 space-y-1 list-decimal list-inside">
                <li>Share the QR or link with anyone — a relative in the city, a friend, anyone.</li>
                <li>They scan and pay ₹{Number(req!.amount).toFixed(0)} via any UPI app.</li>
                <li>Your subscription activates within seconds. You&apos;ll be notified.</li>
              </ol>
            </div>

            <button onClick={cancelLink} disabled={cancelling}
              className="w-full mt-4 py-3 rounded-2xl text-[#7A8C7E] text-sm border border-[#DDD0B8] disabled:opacity-50">
              {cancelling ? 'Cancelling…' : 'Cancel this link'}
            </button>
            <button onClick={() => router.replace('/home')}
              className="w-full mt-2 py-3 rounded-2xl text-[#7A8C7E] text-sm">
              Back to Home
            </button>
          </>
        )}
      </div>
    </div>
  )
}
