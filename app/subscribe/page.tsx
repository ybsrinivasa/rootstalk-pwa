'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Script from 'next/script'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open(): void }
  }
}

interface Package {
  id: string; name: string; crop_cosh_id: string
  package_type: string; duration_days: number; description: string | null
}
interface Subscription {
  id: string; status: string; reference_number: string | null
}

export default function SubscribePage() {
  const router = useRouter()
  const params = useSearchParams()
  const clientId = params.get('client_id')
  const preselectedPkg = params.get('package_id')

  const user = getUser()
  const [packages, setPackages] = useState<Package[]>([])
  const [selectedPkg, setSelectedPkg] = useState<string>(preselectedPkg || '')
  const [loading, setLoading] = useState(true)
  const [subscribing, setSubscribing] = useState(false)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [step, setStep] = useState<'select' | 'pay' | 'delegate' | 'done'>('select')
  const [error, setError] = useState('')
  const [delegateTo, setDelegateTo] = useState('')
  const [delegating, setDelegating] = useState(false)
  const [delegateSuccess, setDelegateSuccess] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    if (clientId) {
      api.get<Package[]>(`/farmer/packages?client_id=${clientId}`)
        .then(r => setPackages(r.data))
        .catch(() => setPackages([]))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [clientId, router])

  async function createSubscription() {
    if (!selectedPkg || !clientId) return
    setSubscribing(true); setError('')
    try {
      const { data } = await api.post<Subscription & { message: string }>('/farmer/subscriptions', {
        package_id: selectedPkg,
        client_id: clientId,
        subscription_type: 'SELF',
      })
      setSubscription(data)
      if (data.status === 'ACTIVE') {
        setStep('done')
      } else {
        // WAITLISTED — needs payment
        setStep('pay')
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Failed to create subscription.')
    } finally { setSubscribing(false) }
  }

  const openRazorpay = useCallback(async () => {
    if (!subscription) return
    setError('')
    try {
      const { data: order } = await api.post(`/farmer/subscriptions/${subscription.id}/payment/create-order`)

      const options = {
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: 'RootsTalk',
        description: 'Crop Advisory Subscription',
        order_id: order.razorpay_order_id,
        prefill: {
          name: user?.name || '',
          contact: user?.phone || '',
        },
        theme: { color: '#1A5C2A' },
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          try {
            await api.post(`/farmer/subscriptions/${subscription.id}/payment/verify`, {
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature,
            })
            setStep('done')
          } catch {
            setError('Payment verification failed. Contact support.')
          }
        },
      }
      new window.Razorpay(options).open()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Could not initiate payment.')
    }
  }, [subscription, user])

  async function delegatePayment() {
    if (!subscription || !delegateTo) return
    setDelegating(true); setError('')
    try {
      await api.post(`/farmer/subscriptions/${subscription.id}/delegate-payment`, {
        requested_from_user_id: delegateTo,
      })
      setDelegateSuccess(true)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Failed to send delegation request.')
    } finally { setDelegating(false) }
  }

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <div className="min-h-screen bg-slate-50">
        <PWAHeader title="Subscribe" activeRole="FARMER" />
        <div className="pt-16 pb-20 px-4">

          {/* Step: Select Package */}
          {step === 'select' && (
            <div className="mt-4 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Choose Advisory Package</h2>
                <p className="text-slate-400 text-sm mt-0.5">Select the Package of Practices for your crop</p>
              </div>

              {loading ? (
                <div className="h-20 bg-white rounded-2xl animate-pulse" />
              ) : packages.length === 0 ? (
                <div className="bg-white rounded-2xl p-6 text-center border border-slate-100">
                  <p className="text-slate-400 text-sm">No packages available for this company yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {packages.map(pkg => (
                    <button key={pkg.id} onClick={() => setSelectedPkg(pkg.id)}
                      className={`w-full text-left rounded-2xl p-4 border-2 transition-all ${selectedPkg === pkg.id ? 'border-green-600 bg-green-50' : 'border-slate-100 bg-white'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selectedPkg === pkg.id ? 'border-green-600' : 'border-slate-300'}`}>
                          {selectedPkg === pkg.id && <div className="w-2.5 h-2.5 rounded-full bg-green-600" />}
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">{pkg.name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{pkg.package_type.toLowerCase()} · {pkg.duration_days} days · {pkg.crop_cosh_id}</p>
                          {pkg.description && <p className="text-xs text-slate-500 mt-1">{pkg.description}</p>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button onClick={createSubscription} disabled={!selectedPkg || subscribing}
                className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #065f46, #1A5C2A)' }}>
                {subscribing ? 'Setting up…' : 'Subscribe →'}
              </button>
            </div>
          )}

          {/* Step: Pay Rs. 199 */}
          {step === 'pay' && subscription && (
            <div className="mt-4 space-y-4">
              <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                <div className="text-center mb-5">
                  <span className="text-4xl">🌱</span>
                  <p className="font-bold text-slate-900 mt-3">Almost there!</p>
                  <p className="text-slate-500 text-sm mt-1">Complete payment to activate your advisory</p>
                </div>
                <div className="bg-green-50 rounded-xl p-4 mb-4 text-center">
                  <p className="text-3xl font-bold text-green-800">₹199</p>
                  <p className="text-green-600 text-sm mt-0.5">One-time annual subscription</p>
                </div>
                <ul className="text-sm text-slate-600 space-y-2 mb-5">
                  {['Daily crop advisory tailored to your location', 'Input recommendations — what to apply and when', 'Direct ordering from your dealer', 'Crop health diagnosis support'].map(f => (
                    <li key={f} className="flex items-center gap-2">
                      <span className="text-green-600 shrink-0">✓</span>{f}
                    </li>
                  ))}
                </ul>
                {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
                <button onClick={openRazorpay}
                  className="w-full py-4 rounded-2xl text-white font-bold text-base"
                  style={{ background: 'linear-gradient(135deg, #065f46, #1A5C2A)' }}>
                  Pay ₹199 with RazorPay
                </button>
              </div>

              <div className="bg-white rounded-2xl p-4 border border-slate-100">
                <p className="font-medium text-slate-700 text-sm mb-3">Can't pay now?</p>
                <button onClick={() => setStep('delegate')}
                  className="w-full py-3 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50">
                  Ask my dealer or facilitator to pay →
                </button>
              </div>
            </div>
          )}

          {/* Step: Delegate payment */}
          {step === 'delegate' && subscription && (
            <div className="mt-4 space-y-4">
              <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                <h2 className="font-bold text-slate-900 mb-1">Ask someone to pay</h2>
                <p className="text-slate-400 text-sm mb-4">
                  Enter the phone number of your dealer or facilitator. They will receive a payment request and can pay Rs. 199 on your behalf.
                </p>
                {delegateSuccess ? (
                  <div className="text-center py-4">
                    <span className="text-3xl">✅</span>
                    <p className="font-medium text-slate-800 mt-3">Payment request sent</p>
                    <p className="text-slate-400 text-sm mt-1">Your dealer/facilitator will be notified and can pay via their app.</p>
                  </div>
                ) : (
                  <>
                    <input value={delegateTo} onChange={e => setDelegateTo(e.target.value)}
                      placeholder="Dealer/Facilitator User ID or phone"
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-3 font-mono" />
                    {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
                    <button onClick={delegatePayment} disabled={!delegateTo || delegating}
                      className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
                      style={{ background: '#1A5C2A' }}>
                      {delegating ? 'Sending…' : 'Send Payment Request'}
                    </button>
                    <button onClick={() => setStep('pay')}
                      className="w-full mt-2 py-3 rounded-xl text-slate-500 text-sm">
                      ← Back to pay myself
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Step: Done */}
          {step === 'done' && (
            <div className="mt-12 text-center px-4">
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
                style={{ background: '#dcfce7' }}>
                <span className="text-4xl">🌾</span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900">You're subscribed!</h2>
              <p className="text-slate-500 mt-2">Your advisory is now active. Set your sowing date to start receiving daily recommendations.</p>
              <button onClick={() => router.replace('/home')}
                className="mt-8 w-full py-4 rounded-2xl text-white font-semibold"
                style={{ background: 'linear-gradient(135deg, #065f46, #1A5C2A)' }}>
                Go to Home →
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
