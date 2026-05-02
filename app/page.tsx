'use client'
import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser, getActiveRoles, requestOtp, verifyOtp } from '@/lib/auth'
import { setLanguage, getLanguage } from '@/lib/language'
import api from '@/lib/api'
import InstallPrompt from '@/components/InstallPrompt'

type Stage = 'landing' | 'phone' | 'otp' | 'profile'
type Lang = { language_code: string; language_name_en: string; language_name_native: string; script_direction: string; status?: string }

const NodeMark = ({ size = 48, className = '' }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
    <circle cx="24" cy="24" r="5" fill="white"/>
    <circle cx="8" cy="12" r="3.5" fill="white" opacity="0.7"/>
    <circle cx="40" cy="36" r="3.5" fill="white" opacity="0.7"/>
    <circle cx="8" cy="36" r="3.5" fill="white" opacity="0.5"/>
    <circle cx="40" cy="12" r="3.5" fill="white" opacity="0.5"/>
    <line x1="24" y1="24" x2="8" y2="12" stroke="white" strokeWidth="1.5" opacity="0.6"/>
    <line x1="24" y1="24" x2="40" y2="36" stroke="white" strokeWidth="1.5" opacity="0.6"/>
    <line x1="24" y1="24" x2="8" y2="36" stroke="white" strokeWidth="1" opacity="0.35"/>
    <line x1="24" y1="24" x2="40" y2="12" stroke="white" strokeWidth="1" opacity="0.35"/>
  </svg>
)

export default function RootPage() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage | 'loading'>('loading')
  const [languages, setLanguages] = useState<Lang[]>([])
  const [selectedLang, setSelectedLang] = useState(getLanguage() || 'en')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [devOtp, setDevOtp] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendTimer, setResendTimer] = useState(0)

  // Check auth on mount
  useEffect(() => {
    const token = getToken()
    if (token) {
      const user = getUser()
      const roles = getActiveRoles(user)
      if (roles.includes('DEALER')) router.replace('/dealer/home')
      else if (roles.includes('FACILITATOR')) router.replace('/facilitator/home')
      else if (roles.includes('FARM_PUNDIT')) router.replace('/pundit/home')
      else router.replace('/home')
      return
    }
    // Load languages
    api.get<Lang[]>('/platform/languages').then(r => {
      const active = r.data.filter(l => !l.status || l.status === 'ACTIVE' || l.language_code === 'en')
      setLanguages(active.length ? active : [{ language_code: 'en', language_name_en: 'English', language_name_native: 'English', script_direction: 'LTR' }])
    }).catch(() => {
      setLanguages([{ language_code: 'en', language_name_en: 'English', language_name_native: 'English', script_direction: 'LTR' }])
    })
    setStage('landing')
  }, [router])

  // Resend countdown
  useEffect(() => {
    if (resendTimer <= 0) return
    const t = setTimeout(() => setResendTimer(r => r - 1), 1000)
    return () => clearTimeout(t)
  }, [resendTimer])

  function redirectToRoleHome() {
    const user = getUser()
    const roles = getActiveRoles(user)
    if (roles.includes('DEALER')) router.replace('/dealer/home')
    else if (roles.includes('FACILITATOR')) router.replace('/facilitator/home')
    else if (roles.includes('FARM_PUNDIT')) router.replace('/pundit/home')
    else router.replace('/home')
  }

  async function handleSendOtp(e: FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const res = await requestOtp('+91' + phone)
      if (res.dev_otp) setDevOtp(res.dev_otp)
      setStage('otp'); setResendTimer(30)
    } catch {
      setError('Could not send OTP. Check your number and try again.')
    } finally { setLoading(false) }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await verifyOtp('+91' + phone, otp.trim())
      const user = getUser()
      if (user && !user.name) {
        setStage('profile')
      } else {
        redirectToRoleHome()
      }
    } catch {
      setError('Invalid or expired code.')
    } finally { setLoading(false) }
  }

  async function handleProfile(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await api.put('/me/profile', { name })
    } catch { /* best-effort */ }
    redirectToRoleHome()
  }

  // Loading state
  if (stage === 'loading') return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F5F0]">
      <div className="w-8 h-8 border-2 border-green-700 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  // ── LANDING ──────────────────────────────────────────────────────────────────
  if (stage === 'landing') return (
    <div className="min-h-screen flex flex-col bg-[#F7F5F0]">
      {/* Top green section — ~55% height */}
      <div className="flex flex-col justify-between p-8 pt-safe-top"
        style={{ background: '#1A5C2A', minHeight: '55vh' }}>
        <div className="flex-1 flex flex-col items-center justify-center">
          <NodeMark size={48} />
          <h1 className="text-white text-3xl font-bold mt-6 leading-tight text-center">
            <span className="font-normal">roots</span>
            <span className="font-semibold">TALK</span>
            <span className="text-white/60 text-2xl">.in</span>
          </h1>
          <p className="text-white/70 text-sm mt-2 tracking-wide text-center">
            Your agricultural advisory network
          </p>
        </div>
      </div>

      {/* Bottom parchment section */}
      <div className="flex flex-col p-8 flex-1">
        {/* Language chips */}
        {languages.length > 0 && (
          <div className="overflow-x-auto -mx-2 px-2 mb-2">
            <div className="flex gap-2 w-max">
              {languages.map(l => (
                <button
                  key={l.language_code}
                  onClick={() => { setSelectedLang(l.language_code); setLanguage(l.language_code) }}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                    selectedLang === l.language_code
                      ? 'bg-[#1A5C2A] text-white'
                      : 'bg-stone-200 text-stone-700'
                  }`}
                >
                  {l.language_name_native}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* CTA button */}
        <button
          onClick={() => setStage('phone')}
          className="bg-[#1A5C2A] text-white rounded-xl py-4 w-full font-semibold text-base mt-6"
        >
          Get Started →
        </button>

        <p className="text-stone-400 text-xs text-center mt-3">
          For farmers, dealers, facilitators &amp; experts
        </p>

        <p className="text-stone-300 text-[10px] text-center mt-auto pt-6">
          Neytiri Eywafarm Agritech Pvt Ltd
        </p>
      </div>
    </div>
  )

  // ── PHONE ────────────────────────────────────────────────────────────────────
  if (stage === 'phone') return (
    <div className="min-h-screen bg-[#F7F5F0] flex flex-col">
      <div className="px-5 pt-12 pb-4">
        <button onClick={() => setStage('landing')} className="text-stone-500 text-sm mb-6">← Back</button>
        {/* Small header */}
        <div className="flex items-center gap-2 mb-2">
          <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="5" fill="#1A5C2A"/>
            <circle cx="8" cy="12" r="3.5" fill="#1A5C2A" opacity="0.7"/>
            <circle cx="40" cy="36" r="3.5" fill="#1A5C2A" opacity="0.7"/>
            <circle cx="8" cy="36" r="3.5" fill="#1A5C2A" opacity="0.5"/>
            <circle cx="40" cy="12" r="3.5" fill="#1A5C2A" opacity="0.5"/>
            <line x1="24" y1="24" x2="8" y2="12" stroke="#1A5C2A" strokeWidth="1.5" opacity="0.6"/>
            <line x1="24" y1="24" x2="40" y2="36" stroke="#1A5C2A" strokeWidth="1.5" opacity="0.6"/>
            <line x1="24" y1="24" x2="8" y2="36" stroke="#1A5C2A" strokeWidth="1" opacity="0.35"/>
            <line x1="24" y1="24" x2="40" y2="12" stroke="#1A5C2A" strokeWidth="1" opacity="0.35"/>
          </svg>
          <span className="text-stone-600 text-sm">rootsTALK.in</span>
        </div>
        <h2 className="text-stone-900 text-xl font-bold mt-8">Enter your mobile number</h2>
        <p className="text-stone-500 text-sm mt-1">We&apos;ll send you a verification code</p>
      </div>
      <form onSubmit={handleSendOtp} className="flex-1 flex flex-col px-5 pt-4">
        <div className="flex gap-2 mb-2">
          <span className="border border-stone-200 rounded-xl px-3 py-3.5 text-stone-600 text-sm bg-stone-100 font-medium">+91</span>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
            required
            maxLength={10}
            placeholder="9876543210"
            className="flex-1 border border-stone-200 rounded-xl px-4 py-3.5 text-stone-800 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A5C2A] bg-white"
            autoFocus
            inputMode="numeric"
          />
        </div>
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        <button
          type="submit"
          disabled={loading || phone.length < 10}
          className="w-full bg-[#1A5C2A] text-white font-semibold py-4 rounded-xl text-sm mt-4 disabled:opacity-50"
        >
          {loading ? 'Sending…' : 'Send OTP'}
        </button>
        {devOtp && (
          <p className="text-xs text-amber-700 mt-3 text-center">Dev OTP: <strong>{devOtp}</strong></p>
        )}
      </form>
    </div>
  )

  // ── OTP ──────────────────────────────────────────────────────────────────────
  if (stage === 'otp') return (
    <div className="min-h-screen bg-[#F7F5F0] flex flex-col">
      <div className="px-5 pt-12 pb-4">
        <button onClick={() => setStage('phone')} className="text-stone-500 text-sm mb-6">← Back</button>
        <div className="flex items-center gap-2 mb-2">
          <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="5" fill="#1A5C2A"/>
            <circle cx="8" cy="12" r="3.5" fill="#1A5C2A" opacity="0.7"/>
            <circle cx="40" cy="36" r="3.5" fill="#1A5C2A" opacity="0.7"/>
            <circle cx="8" cy="36" r="3.5" fill="#1A5C2A" opacity="0.5"/>
            <circle cx="40" cy="12" r="3.5" fill="#1A5C2A" opacity="0.5"/>
            <line x1="24" y1="24" x2="8" y2="12" stroke="#1A5C2A" strokeWidth="1.5" opacity="0.6"/>
            <line x1="24" y1="24" x2="40" y2="36" stroke="#1A5C2A" strokeWidth="1.5" opacity="0.6"/>
            <line x1="24" y1="24" x2="8" y2="36" stroke="#1A5C2A" strokeWidth="1" opacity="0.35"/>
            <line x1="24" y1="24" x2="40" y2="12" stroke="#1A5C2A" strokeWidth="1" opacity="0.35"/>
          </svg>
          <span className="text-stone-600 text-sm">rootsTALK.in</span>
        </div>
        <h2 className="text-stone-900 text-xl font-bold mt-8">Enter verification code</h2>
        <p className="text-sm mt-1" style={{ color: '#1A5C2A' }}>Sent to +91{phone}</p>
      </div>
      <form onSubmit={handleVerifyOtp} className="flex-1 flex flex-col px-5 pt-4">
        {devOtp && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
            <p className="text-xs text-amber-700 font-medium">Dev OTP: <strong>{devOtp}</strong></p>
          </div>
        )}
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
          autoFocus
          required
          placeholder="123456"
          className="border border-stone-200 rounded-xl px-4 py-4 text-center text-2xl font-mono tracking-widest text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#1A5C2A] bg-white mb-1"
        />
        {error && <p className="text-red-500 text-sm mb-3 mt-2">{error}</p>}
        <button
          type="submit"
          disabled={loading || otp.length < 6}
          className="w-full bg-[#1A5C2A] text-white font-semibold py-4 rounded-xl text-sm mt-4 disabled:opacity-50"
        >
          {loading ? 'Verifying…' : 'Verify'}
        </button>
        <button
          type="button"
          onClick={() => {
            requestOtp('+91' + phone).then(r => {
              if (r.dev_otp) setDevOtp(r.dev_otp)
              setResendTimer(30)
            })
          }}
          disabled={resendTimer > 0}
          className="text-center text-sm text-stone-400 mt-4 disabled:opacity-50"
        >
          {resendTimer > 0 ? `Resend in ${resendTimer}s` : "Didn't receive a code? Resend"}
        </button>
      </form>
    </div>
  )

  // ── PROFILE ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F7F5F0] flex flex-col">
      <InstallPrompt />
      <div className="px-5 pt-12 pb-4">
        <div className="flex items-center gap-2 mb-2">
          <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="5" fill="#1A5C2A"/>
            <circle cx="8" cy="12" r="3.5" fill="#1A5C2A" opacity="0.7"/>
            <circle cx="40" cy="36" r="3.5" fill="#1A5C2A" opacity="0.7"/>
            <circle cx="8" cy="36" r="3.5" fill="#1A5C2A" opacity="0.5"/>
            <circle cx="40" cy="12" r="3.5" fill="#1A5C2A" opacity="0.5"/>
            <line x1="24" y1="24" x2="8" y2="12" stroke="#1A5C2A" strokeWidth="1.5" opacity="0.6"/>
            <line x1="24" y1="24" x2="40" y2="36" stroke="#1A5C2A" strokeWidth="1.5" opacity="0.6"/>
            <line x1="24" y1="24" x2="8" y2="36" stroke="#1A5C2A" strokeWidth="1" opacity="0.35"/>
            <line x1="24" y1="24" x2="40" y2="12" stroke="#1A5C2A" strokeWidth="1" opacity="0.35"/>
          </svg>
          <span className="text-stone-600 text-sm">rootsTALK.in</span>
        </div>
        <h2 className="text-stone-900 text-xl font-bold mt-8">One last thing</h2>
        <p className="text-stone-500 text-sm mt-1">What should we call you?</p>
      </div>
      <form onSubmit={handleProfile} className="flex-1 flex flex-col px-5 pt-4">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          placeholder="Your first name"
          className="border border-stone-200 rounded-xl px-4 py-3.5 text-stone-800 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A5C2A] bg-white mb-6"
        />
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="w-full bg-[#1A5C2A] text-white font-semibold py-4 rounded-xl text-sm disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Get started →'}
        </button>
        <button
          type="button"
          onClick={redirectToRoleHome}
          className="text-center text-sm text-stone-400 mt-4"
        >
          Skip for now
        </button>
      </form>
    </div>
  )
}
