'use client'
import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { requestOtp, verifyOtp, getToken } from '@/lib/auth'
import { setLanguage } from '@/lib/language'
import api from '@/lib/api'

type Step = 'language' | 'phone' | 'otp' | 'profile'
type Lang = { language_code: string; language_name_en: string; language_name_native: string; script_direction: string }

export default function RegisterPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('language')
  const [languages, setLanguages] = useState<Lang[]>([])
  const [selectedLang, setSelectedLang] = useState('')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [devOtp, setDevOtp] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendTimer, setResendTimer] = useState(0)

  useEffect(() => {
    if (getToken()) { router.replace('/home'); return }
    api.get<Lang[]>('/platform/languages').then(r => {
      setLanguages(r.data.filter(l => l.status === 'ACTIVE' || l.language_code === 'en'))
    }).catch(() => setLanguages([{ language_code: 'en', language_name_en: 'English', language_name_native: 'English', script_direction: 'LTR' }]))
  }, [router])

  useEffect(() => {
    if (resendTimer <= 0) return
    const t = setTimeout(() => setResendTimer(r => r - 1), 1000)
    return () => clearTimeout(t)
  }, [resendTimer])

  async function handleSendOtp(e: FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const res = await requestOtp(phone)
      if (res.dev_otp) setDevOtp(res.dev_otp)
      setStep('otp'); setResendTimer(30)
    } catch { setError('Could not send OTP. Check your number and try again.') }
    finally { setLoading(false) }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await verifyOtp(phone, otp.trim())
      setStep('profile')
    } catch { setError('Invalid or expired code.') }
    finally { setLoading(false) }
  }

  async function handleProfile(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await api.put('/auth/me/profile', { name, language_code: selectedLang || 'en' })
    } catch { /* profile update best-effort */ }
    router.replace('/home')
  }

  // ── Step 1: Language ─────────────────────────────────────────────────────────
  if (step === 'language') return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="px-5 pt-12 pb-6" style={{ background: 'linear-gradient(135deg, #071e12, #0d3320)' }}>
        <h1 className="text-2xl font-bold text-white">RootsTalk</h1>
        <p className="text-green-300 text-sm mt-1">Select your language</p>
        <p className="text-green-400 text-xs mt-0.5 opacity-70">ಭಾಷೆ ಆಯ್ಕೆ ಮಾಡಿ • भाषा चुनें • மொழியை தேர்வு செய்யவும்</p>
      </div>
      <div className="flex-1 overflow-auto">
        {languages.map(l => (
          <button key={l.language_code}
            onClick={() => { setLanguage(l.language_code); setSelectedLang(l.language_code); setStep('phone') }}
            className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-100 hover:bg-green-50 transition-colors text-left"
            dir={l.script_direction === 'RTL' ? 'rtl' : 'ltr'}>
            <div>
              <p className="text-lg font-medium text-slate-800">{l.language_name_native}</p>
              <p className="text-xs text-slate-400">{l.language_name_en}</p>
            </div>
            <span className="text-green-600 text-xl">→</span>
          </button>
        ))}
      </div>
    </div>
  )

  // ── Step 2: Phone ────────────────────────────────────────────────────────────
  if (step === 'phone') return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="px-5 pt-12 pb-6" style={{ background: 'linear-gradient(135deg, #071e12, #0d3320)' }}>
        <button onClick={() => setStep('language')} className="text-green-300 text-sm mb-3">← Back</button>
        <h1 className="text-2xl font-bold text-white">Enter your mobile number</h1>
        <p className="text-green-300 text-sm mt-1">We'll send you a verification code</p>
      </div>
      <form onSubmit={handleSendOtp} className="flex-1 flex flex-col px-5 pt-8">
        <label className="text-sm font-medium text-slate-700 mb-2">Mobile number</label>
        <div className="flex gap-2 mb-2">
          <span className="border border-slate-200 rounded-xl px-3 py-3.5 text-slate-600 text-sm bg-slate-50">+91</span>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
            required maxLength={10} placeholder="9876543210"
            className="flex-1 border border-slate-200 rounded-xl px-4 py-3.5 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            autoFocus inputMode="numeric" />
        </div>
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        <button type="submit" disabled={loading || phone.length < 10}
          className="w-full text-white font-semibold py-4 rounded-xl text-sm mt-4 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #065f46, #059669)' }}>
          {loading ? 'Sending…' : 'Send verification code'}
        </button>
      </form>
    </div>
  )

  // ── Step 3: OTP ──────────────────────────────────────────────────────────────
  if (step === 'otp') return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="px-5 pt-12 pb-6" style={{ background: 'linear-gradient(135deg, #071e12, #0d3320)' }}>
        <button onClick={() => setStep('phone')} className="text-green-300 text-sm mb-3">← Back</button>
        <h1 className="text-2xl font-bold text-white">Enter the code</h1>
        <p className="text-green-300 text-sm mt-1">Sent to +91 {phone}</p>
      </div>
      <form onSubmit={handleVerifyOtp} className="flex-1 flex flex-col px-5 pt-8">
        {devOtp && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
            <p className="text-xs text-amber-700 font-medium">Development mode — OTP: <strong>{devOtp}</strong></p>
          </div>
        )}
        <label className="text-sm font-medium text-slate-700 mb-2">6-digit code</label>
        <input type="text" inputMode="numeric" maxLength={6} value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
          autoFocus required placeholder="123456"
          className="border border-slate-200 rounded-xl px-4 py-3.5 text-center text-2xl font-mono tracking-widest text-slate-800 focus:outline-none focus:ring-2 focus:ring-green-500 mb-1" />
        <p className="text-xs text-slate-400 mb-4">Code expires in 10 minutes</p>
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        <button type="submit" disabled={loading || otp.length < 6}
          className="w-full text-white font-semibold py-4 rounded-xl text-sm disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #065f46, #059669)' }}>
          {loading ? 'Verifying…' : 'Verify'}
        </button>
        <button type="button" onClick={() => { requestOtp(phone).then(r => { if (r.dev_otp) setDevOtp(r.dev_otp); setResendTimer(30) }); }}
          disabled={resendTimer > 0}
          className="text-center text-sm text-slate-400 mt-4 disabled:opacity-50">
          {resendTimer > 0 ? `Resend in ${resendTimer}s` : "Didn't receive a code? Resend"}
        </button>
      </form>
    </div>
  )

  // ── Step 4: Profile ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="px-5 pt-12 pb-6" style={{ background: 'linear-gradient(135deg, #071e12, #0d3320)' }}>
        <h1 className="text-2xl font-bold text-white">Your name</h1>
        <p className="text-green-300 text-sm mt-1">Almost done</p>
      </div>
      <form onSubmit={handleProfile} className="flex-1 flex flex-col px-5 pt-8">
        <label className="text-sm font-medium text-slate-700 mb-2">Full name</label>
        <input value={name} onChange={e => setName(e.target.value)}
          autoFocus placeholder="Your name"
          className="border border-slate-200 rounded-xl px-4 py-3.5 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-6" />
        <button type="submit" disabled={loading}
          className="w-full text-white font-semibold py-4 rounded-xl text-sm disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #065f46, #059669)' }}>
          {loading ? 'Saving…' : 'Get started →'}
        </button>
      </form>
    </div>
  )
}
