'use client'
import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser, getActiveRoles, requestOtp, verifyOtp } from '@/lib/auth'
import { setLanguage, getLanguage } from '@/lib/language'
import api from '@/lib/api'
import InstallPrompt from '@/components/InstallPrompt'

type Stage = 'loading' | 'landing' | 'phone' | 'otp' | 'profile'
type Lang  = { language_code: string; language_name_native: string; status?: string }

const G   = '#1A5C2A'
const BG  = 'linear-gradient(160deg, #2d8040 0%, #1A5C2A 42%, #0e3c18 100%)'

// ── Shared mark ──────────────────────────────────────────────────────────────
function NodeMark({ size = 48, colour = 'white' }: { size?: number; colour?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="5"   fill={colour}/>
      <circle cx="8"  cy="12" r="3.5" fill={colour} opacity="0.7"/>
      <circle cx="40" cy="36" r="3.5" fill={colour} opacity="0.7"/>
      <circle cx="8"  cy="36" r="3.5" fill={colour} opacity="0.5"/>
      <circle cx="40" cy="12" r="3.5" fill={colour} opacity="0.5"/>
      <line x1="24" y1="24" x2="8"  y2="12" stroke={colour} strokeWidth="1.5" opacity="0.6"/>
      <line x1="24" y1="24" x2="40" y2="36" stroke={colour} strokeWidth="1.5" opacity="0.6"/>
      <line x1="24" y1="24" x2="8"  y2="36" stroke={colour} strokeWidth="1"   opacity="0.35"/>
      <line x1="24" y1="24" x2="40" y2="12" stroke={colour} strokeWidth="1"   opacity="0.35"/>
    </svg>
  )
}

// ── Decorative dew drops ──────────────────────────────────────────────────────
function DewDrops() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div className="absolute top-12  right-10  w-28 h-28 rounded-full bg-white" style={{ opacity: 0.04 }}/>
      <div className="absolute top-8   left-10   w-14 h-14 rounded-full bg-white" style={{ opacity: 0.06 }}/>
      <div className="absolute top-32  left-5    w-5  h-5  rounded-full bg-white" style={{ opacity: 0.08 }}/>
      <div className="absolute top-20  right-24  w-4  h-4  rounded-full bg-white" style={{ opacity: 0.09 }}/>
      <div className="absolute top-48  right-8   w-10 h-10 rounded-full bg-white" style={{ opacity: 0.05 }}/>
      <div className="absolute top-56  left-20   w-7  h-7  rounded-full bg-white" style={{ opacity: 0.06 }}/>
      <div className="absolute top-16  left-36   w-3  h-3  rounded-full bg-white" style={{ opacity: 0.10 }}/>
      <div className="absolute top-64  right-16  w-6  h-6  rounded-full bg-white" style={{ opacity: 0.04 }}/>
    </div>
  )
}

// ── Grass blades ──────────────────────────────────────────────────────────────
function GrassBlades() {
  return (
    <svg
      className="absolute bottom-0 left-0 w-full pointer-events-none"
      viewBox="0 0 390 130"
      preserveAspectRatio="xMidYMax meet"
      style={{ height: 130 }}
    >
      <path d="M22 130 C20 100 28 70 22 28 C28 65 36 96 38 130Z"          fill="white" opacity="0.07"/>
      <path d="M56 130 C54 114 48 94 52 75 C57 92 61 112 62 130Z"         fill="white" opacity="0.05"/>
      <path d="M96 130 C94 96 104 63 97 18 C104 58 112 92 114 130Z"       fill="white" opacity="0.08"/>
      <path d="M140 130 C143 110 137 88 141 70 C145 86 148 110 149 130Z"  fill="white" opacity="0.05"/>
      <path d="M180 130 C185 100 190 72 182 30 C188 68 196 100 200 130Z"  fill="white" opacity="0.07"/>
      <path d="M222 130 C220 112 214 90 218 68 C224 88 230 110 232 130Z"  fill="white" opacity="0.05"/>
      <path d="M264 130 C262 96 272 62 265 16 C272 56 280 90 282 130Z"    fill="white" opacity="0.08"/>
      <path d="M302 130 C305 114 299 96 302 80 C306 95 309 113 310 130Z"  fill="white" opacity="0.05"/>
      <path d="M338 130 C340 98 348 68 341 22 C348 62 354 96 356 130Z"    fill="white" opacity="0.07"/>
      <path d="M372 130 C370 116 366 102 370 88 C374 101 377 115 378 130Z" fill="white" opacity="0.05"/>
    </svg>
  )
}

// ── Mini identity strip ───────────────────────────────────────────────────────
function MiniMark() {
  return (
    <div className="flex items-center gap-2">
      <NodeMark size={16} colour="white" />
      <span className="text-white/45 text-xs font-light tracking-wide">rootsTALK.in</span>
    </div>
  )
}

// ── Back button ───────────────────────────────────────────────────────────────
function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 text-white/55 text-sm hover:text-white/90 transition-colors mt-4 mb-6">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
      </svg>
      Back
    </button>
  )
}

// ── Action button ─────────────────────────────────────────────────────────────
function Btn({ children, disabled, type = 'button', onClick }:
  { children: React.ReactNode; disabled?: boolean; type?: 'submit' | 'button'; onClick?: () => void }) {
  return (
    <button type={type} disabled={disabled} onClick={onClick}
      className="w-full py-4 rounded-2xl text-white font-medium text-base disabled:opacity-40 transition-all active:scale-[0.98]"
      style={{ background: G }}>
      {children}
    </button>
  )
}

// ── Input ─────────────────────────────────────────────────────────────────────
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props}
      className={`w-full border border-stone-200 rounded-xl px-4 py-3.5 text-stone-800 text-base bg-white
        focus:outline-none focus:ring-2 focus:ring-[#1A5C2A]/30 focus:border-[#1A5C2A] transition-all ${props.className || ''}`}
    />
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function RootPage() {
  const router = useRouter()
  const [stage,        setStage]       = useState<Stage>('loading')
  const [languages,    setLanguages]   = useState<Lang[]>([])
  const [selectedLang, setSelected]    = useState(getLanguage() || 'en')
  const [phone,        setPhone]       = useState('')
  const [otp,          setOtp]         = useState('')
  const [devOtp,       setDevOtp]      = useState('')
  const [name,         setName]        = useState('')
  const [error,        setError]       = useState('')
  const [busy,         setBusy]        = useState(false)
  const [resend,       setResend]      = useState(0)

  function roleHome(user = getUser()) {
    const roles = getActiveRoles(user)
    if      (roles.includes('DEALER'))      router.replace('/dealer/home')
    else if (roles.includes('FACILITATOR')) router.replace('/facilitator/home')
    else if (roles.includes('FARM_PUNDIT')) router.replace('/pundit/home')
    else                                     router.replace('/home')
  }

  useEffect(() => {
    if (getToken()) { roleHome(); return }
    api.get<(Lang & { status?: string })[]>('/platform/languages')
      .then(r => {
        const active = r.data.filter(l => !l.status || l.status === 'ACTIVE' || l.language_code === 'en')
        setLanguages(active.length ? active : [{ language_code: 'en', language_name_native: 'English' }])
      })
      .catch(() => setLanguages([{ language_code: 'en', language_name_native: 'English' }]))
    setStage('landing')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (resend <= 0) return
    const t = setTimeout(() => setResend(r => r - 1), 1000)
    return () => clearTimeout(t)
  }, [resend])

  async function sendOtp(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      const res = await requestOtp('+91' + phone)
      if (res.dev_otp) setDevOtp(res.dev_otp)
      setStage('otp'); setResend(30)
    } catch { setError('Could not send a code. Please check your number.') }
    finally { setBusy(false) }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      await verifyOtp('+91' + phone, otp.trim())
      const user = getUser()
      if (user && !user.name) setStage('profile')
      else roleHome(user ?? undefined)
    } catch { setError("That code didn't match. Please try again.") }
    finally { setBusy(false) }
  }

  async function saveName(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    try { await api.put('/me/profile', { name }) } catch { /* best-effort */ }
    roleHome()
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (stage === 'loading') return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: BG }}>
      <div className="w-8 h-8 border-2 border-white/25 border-t-white rounded-full animate-spin"/>
    </div>
  )

  // ── Landing ─────────────────────────────────────────────────────────────────
  if (stage === 'landing') return (
    <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: BG }}>
      <InstallPrompt/>
      <DewDrops/>
      <GrassBlades/>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm mx-auto px-6 relative z-10 pb-6">
        {/* Halo ring */}
        <div className="w-[90px] h-[90px] rounded-full flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)' }}>
          <NodeMark size={52} colour="white"/>
        </div>

        {/* Wordmark */}
        <div className="flex items-baseline gap-0 mt-8">
          <span className="text-white/80 font-light leading-none tracking-tight" style={{ fontSize: '2.6rem' }}>roots</span>
          <span className="text-white   font-black leading-none tracking-tight" style={{ fontSize: '2.6rem' }}>TALK</span>
          <span className="text-white/35 font-extralight leading-none"          style={{ fontSize: '2rem'   }}>.in</span>
        </div>

        {/* Tagline */}
        <p className="text-white/50 text-sm mt-4 font-light text-center leading-relaxed tracking-wide max-w-[220px]">
          Knowledge that grows<br/>with your crop
        </p>
      </div>

      {/* Frosted glass card */}
      <div className="relative z-10 w-full sm:max-w-sm sm:mx-auto sm:mb-10
                      rounded-t-[2rem] sm:rounded-[2rem] px-6 pt-6"
        style={{
          background:           'rgba(247, 245, 240, 0.92)',
          backdropFilter:       'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          border:               '1px solid rgba(255,255,255,0.55)',
          borderBottom:         'none',
          boxShadow:            '0 -8px 40px rgba(0,0,0,0.15)',
          paddingBottom:        'max(2.5rem, env(safe-area-inset-bottom))',
        }}>

        {languages.length > 1 && (
          <div className="mb-5">
            <p className="text-[11px] text-stone-400 uppercase tracking-widest font-medium mb-3">
              Choose your language
            </p>
            <div className="overflow-x-auto -mx-1 px-1">
              <div className="flex gap-2 pb-1 w-max">
                {languages.map(l => (
                  <button key={l.language_code}
                    onClick={() => { setSelected(l.language_code); setLanguage(l.language_code) }}
                    className="px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all"
                    style={selectedLang === l.language_code
                      ? { background: G, color: 'white' }
                      : { background: 'rgba(87,83,78,0.10)', color: '#57534e' }}>
                    {l.language_name_native}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {languages.length === 1 && <div className="mb-4"/>}

        <Btn onClick={() => setStage('phone')}>Get started →</Btn>

        <p className="text-stone-400 text-xs text-center mt-3 tracking-wide">
          For farmers · dealers · facilitators · experts
        </p>
        <p className="text-stone-300 text-[10px] text-center mt-5 font-light">
          Neytiri Eywafarm Agritech Pvt Ltd
        </p>
      </div>
    </div>
  )

  // ── Phone / OTP / Profile (shared structure) ─────────────────────────────────
  const heading = stage === 'phone'   ? 'Enter your mobile number'
                : stage === 'otp'     ? 'Enter the code we sent'
                :                       'Nice to meet you'

  const sub     = stage === 'phone'   ? "We'll send a one-time code — just to confirm it's you"
                : stage === 'otp'     ? `We sent a 6-digit code to +91 ${phone}`
                :                       'What shall we call you?'

  return (
    <div className="min-h-screen flex flex-col" style={{ background: BG }}>

      {/* Green header */}
      <div className="w-full max-w-sm mx-auto px-5 relative z-10">
        <div className="pt-safe-top"/>
        <BackBtn onClick={() => {
          setError('')
          setStage(stage === 'phone' ? 'landing' : stage === 'otp' ? 'phone' : 'landing')
        }}/>
        <MiniMark/>
        <h2 className="text-white font-semibold leading-snug mt-5" style={{ fontSize: '1.6rem' }}>{heading}</h2>
        <p className="text-white/50 text-sm mt-2 font-light leading-relaxed pb-7">{sub}</p>
      </div>

      {/* White card */}
      <div className="flex-1 flex flex-col w-full sm:max-w-sm sm:mx-auto rounded-t-[2rem] px-5 pt-7 relative z-10"
        style={{
          background:    '#FAFAF8',
          boxShadow:     '0 -4px 32px rgba(0,0,0,0.10)',
          paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
        }}>

        {stage === 'phone' && (
          <form onSubmit={sendOtp} className="flex flex-col gap-4">
            <div className="flex gap-2">
              <div className="flex items-center px-3.5 rounded-xl border border-stone-200 bg-stone-50
                              text-stone-500 text-sm font-medium select-none shrink-0">
                +91
              </div>
              <Input type="tel" inputMode="numeric" value={phone} maxLength={10} autoFocus required
                placeholder="98765 43210"
                onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}/>
            </div>
            {error && <p className="text-red-500 text-sm px-1">{error}</p>}
            {devOtp && <DevBadge code={devOtp}/>}
            <Btn type="submit" disabled={busy || phone.length < 10}>
              {busy ? 'Sending…' : 'Send code →'}
            </Btn>
            <p className="text-stone-400 text-xs text-center">Standard SMS charges may apply</p>
          </form>
        )}

        {stage === 'otp' && (
          <form onSubmit={verifyCode} className="flex flex-col gap-4">
            {devOtp && <DevBadge code={devOtp}/>}
            <input type="text" inputMode="numeric" maxLength={6}
              value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
              autoFocus required placeholder="· · · · · ·"
              className="border border-stone-200 rounded-2xl px-4 py-5 text-center bg-white
                         text-3xl font-mono tracking-[0.7em] text-stone-800 w-full
                         focus:outline-none focus:ring-2 focus:ring-[#1A5C2A]/30 focus:border-[#1A5C2A] transition-all"/>
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
            <Btn type="submit" disabled={busy || otp.length < 6}>
              {busy ? 'Checking…' : 'Verify →'}
            </Btn>
            <button type="button"
              onClick={() => requestOtp('+91' + phone).then(r => { if (r.dev_otp) setDevOtp(r.dev_otp); setResend(30) })}
              disabled={resend > 0}
              className="text-center text-sm py-2 transition-opacity disabled:opacity-40"
              style={{ color: G }}>
              {resend > 0 ? `Resend in ${resend}s` : 'Send a new code'}
            </button>
          </form>
        )}

        {stage === 'profile' && (
          <form onSubmit={saveName} className="flex flex-col gap-4">
            <Input value={name} onChange={e => setName(e.target.value)}
              autoFocus placeholder="e.g. Rajan"/>
            <Btn type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : 'Take me in →'}
            </Btn>
            <button type="button" onClick={() => roleHome()}
              className="text-stone-400 text-sm text-center py-2">
              Skip for now
            </button>
          </form>
        )}

      </div>
    </div>
  )
}

function DevBadge({ code }: { code: string }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
      <p className="text-amber-700 text-xs font-medium">Dev code: <strong>{code}</strong></p>
    </div>
  )
}
