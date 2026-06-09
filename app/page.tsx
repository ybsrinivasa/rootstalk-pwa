'use client'
import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser, getActiveRoles, requestOtp, verifyOtp, refreshUser } from '@/lib/auth'
import { setLanguage, getLanguage } from '@/lib/language'
import api from '@/lib/api'
import InstallPrompt from '@/components/InstallPrompt'
import AppMark from '@/components/AppMark'

type Stage = 'loading' | 'landing' | 'phone' | 'otp' | 'profile' | 'location' | 'gps' | 'welcome'
type Lang  = { language_code: string; language_name_native: string; status?: string }

// Cosh-driven location universe (mirrors the CA portal's
// `/cosh/locations/india` response shape). The PWA needs to write
// REAL cosh_ids to the user's profile so the strict-footprint
// cascade can match farmers to packages — typed text and synthetic
// "state_andhra_pradesh"-style ids will never match a
// PackageLocation row. Sub-district has no Cosh ids at this
// granularity (packages target down to district only); we keep it
// as an optional free-text village field for the farmer's own
// reference.
type CoshDistrict = { cosh_id: string; name: string | null }
type CoshState    = { cosh_id: string; name: string | null; districts: CoshDistrict[] }
type CoshLocations = { states: CoshState[] }

// Brand tokens for the landing surface. G mirrors C.primary (Crop
// Green). The hero gradient sits in the same green family: lifted
// top stop for that "first light on a field" feeling, the brand
// stop in the middle, and a deeper crop-into-soil tone at the
// bottom (kept warmer than the previous near-black green).
const G   = '#3A7D44'
const BG  = 'linear-gradient(160deg, #5A9F64 0%, #3A7D44 42%, #214E27 100%)'

// Shared mark — see components/AppMark.tsx. Kept as a thin
// alias here so the landing layout doesn't need to change shape.
const NodeMark = ({ size = 48, colour = 'white' }: { size?: number; colour?: string }) => (
  <AppMark size={size} tone="mono" colour={colour}/>
)

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
      className={`w-full border border-[#DDD0B8] rounded-xl px-4 py-3.5 text-[#6B3F1F] text-base bg-white
        focus:outline-none focus:ring-2 focus:ring-[#3A7D44]/30 focus:border-[#3A7D44] transition-all ${props.className || ''}`}
    />
  )
}

// ── Progress dots ─────────────────────────────────────────────────────────────
function ProgressDots({ filled }: { filled: number }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      {[1, 2, 3, 4].map(i => (
        <div key={i}
          className="h-2 rounded-full transition-all"
          style={{
            width: i === filled ? 24 : 8,
            background: i === filled ? G : '#DDD0B8',
          }}
        />
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function RootPage() {
  const router = useRouter()
  const [stage,        setStage]       = useState<Stage>('loading')
  const [languages,    setLanguages]   = useState<Lang[]>([])
  const [selectedLang, setSelected]    = useState<string>(getLanguage() || 'en')
  const [phone,        setPhone]       = useState('')
  const [otp,          setOtp]         = useState('')
  const [devOtp,       setDevOtp]      = useState('')
  const [name,         setName]        = useState('')
  const [error,        setError]       = useState('')
  const [busy,         setBusy]        = useState(false)
  const [resend,       setResend]      = useState(0)
  const [sessionEnded, setSessionEnded] = useState<'another_device' | 'expired' | null>(null)

  // location + gps states
  const [stateId,      setStateId]     = useState('')
  const [stateName,    setStateName]   = useState('')
  const [districtId,   setDistrictId]  = useState('')
  const [districtName, setDistrictName] = useState('')
  const [subDistrict,  setSubDistrict] = useState('')
  const [gpsLat,       setGpsLat]      = useState<number | null>(null)
  const [gpsLng,       setGpsLng]      = useState<number | null>(null)
  const [gpsStatus,    setGpsStatus]   = useState<'idle' | 'getting' | 'done' | 'denied'>('idle')
  const [stateSearch,  setStateSearch] = useState('')
  const [districtSearch, setDistrictSearch] = useState('')

  // Cosh location universe — loaded once on landing, reused across
  // the state + district pickers. `null` = still loading;
  // `{states: []}` = endpoint replied empty (Cosh hasn't synced
  // india_locations yet — picker shows a clear message).
  const [coshLocations, setCoshLocations] = useState<CoshLocations | null>(null)
  const [locationsError, setLocationsError] = useState(false)

  function roleHome(user = getUser()) {
    const roles = getActiveRoles(user)
    if (roles.includes('DEALER')) router.replace('/dealer/home')
    else if (roles.includes('FACILITATOR')) router.replace('/facilitator/home')
    else if (roles.includes('FARM_PUNDIT')) router.replace('/pundit/home')
    else router.replace('/home')
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const flag = sessionStorage.getItem('rt_pwa_session_ended')
      if (flag) {
        setSessionEnded(flag as 'another_device' | 'expired')
        sessionStorage.removeItem('rt_pwa_session_ended')
      }
    }
    if (getToken()) { roleHome(); return }
    api.get<(Lang & { status?: string })[]>('/platform/languages')
      .then(r => {
        const active = r.data.filter(l => !l.status || l.status === 'ACTIVE' || l.language_code === 'en')
        setLanguages(active.length ? active : [{ language_code: 'en', language_name_native: 'English' }])
      })
      .catch(() => setLanguages([{ language_code: 'en', language_name_native: 'English' }]))
    setStage('landing')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Preload the Cosh location universe the moment we have a token
  // (right after OTP verify) so by the time the farmer reaches the
  // location stage the picker is ready. `/cosh/locations/india`
  // requires auth — that's why this can't run on landing.
  async function loadCoshLocations() {
    if (coshLocations || locationsError) return
    try {
      const { data } = await api.get<CoshLocations>('/cosh/locations/india')
      setCoshLocations(data)
    } catch {
      setLocationsError(true)
    }
  }

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
      // Kick off the Cosh locations preload — needs the token we
      // just stored. Awaiting isn't necessary; the user will spend
      // a few seconds on the name screen before reaching location.
      void loadCoshLocations()
      if (user && !user.name) setStage('profile')
      else roleHome(user ?? undefined)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 401) setError("That code didn't match. Please try again.")
      else setError('Something went wrong. Please try again.')
    }
    finally { setBusy(false) }
  }

  async function saveName(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      // Correct route is /auth/me/profile (the auth router lives
      // under prefix="/auth"). Pre-fix the call hit /me/profile,
      // returned 404, was swallowed by an empty catch, and the
      // user proceeded with a phantom-saved name.
      await api.put('/auth/me/profile', { name })
      // Refresh the cached /auth/me so downstream screens (Welcome,
      // Profile, Home) read the fresh name instead of the empty
      // value captured at OTP-verify time.
      await refreshUser()
      setStage('location')
    } catch {
      setError("Couldn't save your name. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function saveLocation() {
    setError('')
    try {
      await api.put('/auth/me/profile', {
        // Real Cosh UUIDs now — match the PackageLocation rows the
        // strict-footprint cascade enforces on the backend.
        state_cosh_id: stateId,
        district_cosh_id: districtId,
        // Sub-district has no Cosh ids at this level (the india_
        // locations Connect is deduped to state+district). Keep
        // the typed-text village/sub-district as free text for the
        // farmer's own reference; PackageLocation never reads it.
        sub_district_cosh_id: subDistrict.trim() || undefined,
      })
      await refreshUser()
      setStage('gps')
    } catch {
      setError("Couldn't save your location. Please try again.")
    }
  }

  async function captureGps() {
    setGpsStatus('getting'); setError('')
    if (!navigator.geolocation) { setGpsStatus('denied'); return }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setGpsLat(pos.coords.latitude)
        setGpsLng(pos.coords.longitude)
        setGpsStatus('done')
        try {
          await api.put('/auth/me/profile', {
            gps_lat: pos.coords.latitude,
            gps_lng: pos.coords.longitude,
          })
          await refreshUser()
        } catch {
          // GPS captured locally; save failed. Surface so the user
          // can re-attempt from the profile page later.
          setError("Captured your location but couldn't save it. You can try again from your profile.")
        }
      },
      (err) => {
        // GeolocationPositionError.code:
        //   1 = PERMISSION_DENIED (user blocked it / browser blocked)
        //   2 = POSITION_UNAVAILABLE (no GPS / IP geo failed)
        //   3 = TIMEOUT (couldn't find a fix in time)
        setGpsStatus('denied')
        if (err.code === 1) {
          setError("You blocked location access. To retry, enable location for this site in your browser settings, then tap Try again.")
        } else if (err.code === 3) {
          setError("Took too long to find you. Tap Try again.")
        } else {
          setError("Your location isn't available right now. Tap Try again or skip for later.")
        }
      },
      { timeout: 10000 }
    )
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
      <div className="relative z-10 w-full sm:max-w-sm sm:mx-auto
                      rounded-t-[2rem] sm:rounded-[2rem] px-6 pt-6"
        style={{
          background:           'rgba(245, 240, 232, 0.94)',
          backdropFilter:       'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          border:               '1px solid rgba(255,255,255,0.55)',
          borderBottom:         'none',
          boxShadow:            '0 -8px 40px rgba(0,0,0,0.15)',
          paddingBottom:        'max(2.5rem, env(safe-area-inset-bottom))',
        }}>

        {languages.length > 1 && (
          <div className="mb-5">
            <p className="text-[11px] text-[#7A8C7E] uppercase tracking-widest font-medium mb-3">
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

        {sessionEnded && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
            <p className="text-amber-800 text-sm font-medium">
              {sessionEnded === 'another_device'
                ? 'You signed in on another device. Please sign in again.'
                : 'Your session expired. Please sign in again.'}
            </p>
          </div>
        )}

        <Btn onClick={() => setStage('phone')}>Get started →</Btn>

        <p className="text-[#7A8C7E] text-xs text-center mt-3 tracking-wide">
          For farmers · dealers · facilitators · experts
        </p>
        <div className="flex items-center justify-center gap-3 mt-5">
          <p className="text-[#DDD0B8] text-[10px] font-light">Neytiri Eywafarm Agritech Pvt Ltd</p>
          <span className="text-[#DDD0B8] text-[10px]">·</span>
          <button onClick={() => router.push('/privacy-policy')}
            className="text-[#7A8C7E] text-[10px] underline">
            Privacy Policy
          </button>
        </div>
      </div>
    </div>
  )

  // ── Welcome stage ──────────────────────────────────────────────────────────
  if (stage === 'welcome') {
    const user = getUser()
    return (
      <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: BG }}>
        <DewDrops/>
        <GrassBlades/>

        {/* Hero */}
        <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm mx-auto px-6 relative z-10 pb-4">
          <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center mb-6"
            style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.20)' }}>
            <NodeMark size={40} colour="white"/>
          </div>
          <h1 className="text-white font-bold text-center leading-tight" style={{ fontSize: '2rem' }}>
            Welcome, {user?.name || 'to rootsTALK'}!
          </h1>
          <p className="text-white/60 text-sm mt-2 font-light text-center">
            Your complete farming companion
          </p>
        </div>

        {/* Parchment card */}
        <div className="relative z-10 w-full sm:max-w-sm sm:mx-auto rounded-t-[2rem] px-5 pt-6"
          style={{
            background:           'rgba(245, 240, 232, 0.95)',
            backdropFilter:       'blur(32px)',
            WebkitBackdropFilter: 'blur(32px)',
            border:               '1px solid rgba(255,255,255,0.55)',
            borderBottom:         'none',
            boxShadow:            '0 -8px 40px rgba(0,0,0,0.15)',
            paddingBottom:        'max(2.5rem, env(safe-area-inset-bottom))',
          }}>

          {/* Feature grid */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {/* Advisories */}
            <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 shadow-sm">
              <svg className="w-7 h-7 mb-2" viewBox="0 0 28 28" fill="none">
                <rect x="4" y="3" width="14" height="18" rx="2" fill="#3A7D44" opacity="0.15"/>
                <rect x="4" y="3" width="14" height="18" rx="2" stroke="#3A7D44" strokeWidth="1.5"/>
                <path d="M8 8h6M8 11.5h6M8 15h4" stroke="#3A7D44" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="21" cy="19" r="5" fill="#3A7D44"/>
                <path d="M21 16.5v2.5l1.5 1.5" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              <p className="font-semibold text-[#6B3F1F] text-sm">Advisories</p>
              <p className="text-[#7A8C7E] text-xs mt-0.5 leading-snug">Expert-guided crop management, season by season</p>
            </div>

            {/* Purchase */}
            <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 shadow-sm">
              <svg className="w-7 h-7 mb-2" viewBox="0 0 28 28" fill="none">
                <path d="M5 4h2l2.5 11h10l2.5-8H9" stroke="#3A7D44" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="23" r="1.5" fill="#3A7D44"/>
                <circle cx="19" cy="23" r="1.5" fill="#3A7D44"/>
              </svg>
              <p className="font-semibold text-[#6B3F1F] text-sm">Purchase</p>
              <p className="text-[#7A8C7E] text-xs mt-0.5 leading-snug">Order recommended inputs through trusted dealers</p>
            </div>

            {/* Diagnose */}
            <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 shadow-sm">
              <svg className="w-7 h-7 mb-2" viewBox="0 0 28 28" fill="none">
                <circle cx="13" cy="13" r="7" stroke="#3A7D44" strokeWidth="1.5"/>
                <path d="M18.5 18.5L23 23" stroke="#3A7D44" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M10 13h6M13 10v6" stroke="#3A7D44" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <p className="font-semibold text-[#6B3F1F] text-sm">Diagnose</p>
              <p className="text-[#7A8C7E] text-xs mt-0.5 leading-snug">Identify crop problems with guided diagnosis</p>
            </div>

            {/* Ask Expert */}
            <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 shadow-sm">
              <svg className="w-7 h-7 mb-2" viewBox="0 0 28 28" fill="none">
                <path d="M5 6a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H9l-4 4V6z" stroke="#3A7D44" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M10 10h8M10 13.5h5" stroke="#3A7D44" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <p className="font-semibold text-[#6B3F1F] text-sm">Ask Expert</p>
              <p className="text-[#7A8C7E] text-xs mt-0.5 leading-snug">Get answers from certified agronomists</p>
            </div>
          </div>

          {/* CTA buttons */}
          <Btn onClick={() => roleHome()}>
            {`Let's get started →`}
          </Btn>
          <button
            onClick={() => roleHome()}
            className="w-full text-center text-[#7A8C7E] text-sm py-3 mt-2">
            {`I'm also a dealer / facilitator / expert`}
          </button>
        </div>
      </div>
    )
  }

  // ── GPS stage ──────────────────────────────────────────────────────────────
  if (stage === 'gps') return (
    <div className="flex flex-col overflow-hidden" style={{ background: BG, height: '100svh' }}>
      <div className="w-full max-w-sm mx-auto px-5 relative z-10">
        <div className="pt-safe-top"/>
        <BackBtn onClick={() => setStage('location')}/>
        <MiniMark/>
        <h2 className="text-white font-semibold leading-snug mt-5" style={{ fontSize: '1.6rem' }}>Your location on the map</h2>
        <p className="text-white/50 text-sm mt-2 font-light leading-relaxed pb-7">
          Helps us find the 5 nearest dealers and facilitators for you
        </p>
      </div>

      <div className="flex-1 sm:flex-none flex flex-col w-full sm:max-w-sm sm:mx-auto rounded-t-[2rem] px-5 pt-7 pb-10 relative z-10"
        style={{
          background:    '#FAFAF8',
          boxShadow:     '0 -4px 32px rgba(0,0,0,0.10)',
          paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
        }}>

        <ProgressDots filled={2}/>

        {/* GPS capture area */}
        <div className="flex-1 flex flex-col items-center justify-center gap-5">
          {gpsStatus === 'idle' && (
            <button onClick={captureGps}
              className="flex flex-col items-center gap-3 py-8 px-10 rounded-3xl border-2 border-dashed border-[#DDD0B8] active:scale-95 transition-transform w-full max-w-[240px]">
              <svg className="w-12 h-12" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="10" stroke={G} strokeWidth="2"/>
                <circle cx="24" cy="24" r="3" fill={G}/>
                <line x1="24" y1="4" x2="24" y2="12" stroke={G} strokeWidth="2" strokeLinecap="round"/>
                <line x1="24" y1="36" x2="24" y2="44" stroke={G} strokeWidth="2" strokeLinecap="round"/>
                <line x1="4" y1="24" x2="12" y2="24" stroke={G} strokeWidth="2" strokeLinecap="round"/>
                <line x1="36" y1="24" x2="44" y2="24" stroke={G} strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span className="text-[#6B3F1F] font-medium text-base">Get my location</span>
            </button>
          )}

          {gpsStatus === 'getting' && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-2 border-[#DDD0B8] border-t-[#3A7D44] rounded-full animate-spin"/>
              <p className="text-[#7A8C7E] text-sm">Finding you…</p>
            </div>
          )}

          {gpsStatus === 'done' && (
            <div className="w-full bg-green-50 border border-green-200 rounded-2xl px-4 py-4">
              <p className="text-green-700 font-semibold text-sm">Location captured</p>
              <p className="text-green-600/70 text-xs mt-1 font-mono">
                {gpsLat?.toFixed(5)}, {gpsLng?.toFixed(5)}
              </p>
            </div>
          )}

          {gpsStatus === 'denied' && (
            <div className="w-full bg-amber-50 border border-amber-200 rounded-2xl px-4 py-4">
              <p className="text-amber-700 font-semibold text-sm">
                {error ? 'Couldn’t get your location' : 'Location access was denied'}
              </p>
              <p className="text-amber-600/80 text-xs mt-1 leading-relaxed">
                {error || 'You can set this from your profile later.'}
              </p>
              <button onClick={captureGps}
                className="mt-3 text-sm font-medium text-amber-800 underline">
                Try again
              </button>
            </div>
          )}
        </div>

        {/* GPS is mandatory — user can only Continue once a fix
            is captured. Denied path keeps the Try again button
            inside the error card above; there is no skip. */}
        {gpsStatus === 'done' && (
          <Btn onClick={() => setStage('welcome')}>Continue →</Btn>
        )}
      </div>
    </div>
  )

  // ── Location stage ─────────────────────────────────────────────────────────
  if (stage === 'location') {
    const coshStates = coshLocations?.states ?? []
    const filteredStates = coshStates
      .filter(s => s.name)
      .filter(s => !stateSearch || (s.name || '').toLowerCase().includes(stateSearch.toLowerCase()))
    const selectedState = coshStates.find(s => s.cosh_id === stateId) || null
    const filteredDistricts = (selectedState?.districts ?? [])
      .filter(d => d.name)
      .filter(d => !districtSearch || (d.name || '').toLowerCase().includes(districtSearch.toLowerCase()))
    return (
      <div className="flex flex-col overflow-hidden" style={{ background: BG, height: '100svh' }}>
        <div className="w-full max-w-sm mx-auto px-5 relative z-10">
          <div className="pt-safe-top"/>
          <BackBtn onClick={() => setStage('profile')}/>
          <MiniMark/>
          <h2 className="text-white font-semibold leading-snug mt-5" style={{ fontSize: '1.6rem' }}>Where is your farm?</h2>
          <p className="text-white/50 text-sm mt-2 font-light leading-relaxed pb-7">
            This helps us find nearby dealers and advisories
          </p>
        </div>

        <div className="flex-1 sm:flex-none flex flex-col w-full sm:max-w-sm sm:mx-auto rounded-t-[2rem] px-5 pt-7 relative z-10 overflow-hidden"
          style={{
            background:    '#FAFAF8',
            boxShadow:     '0 -4px 32px rgba(0,0,0,0.10)',
            paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
          }}>

          <ProgressDots filled={1}/>

          <div className="flex flex-col gap-4 overflow-y-auto flex-1">
            {locationsError && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <p className="text-amber-800 text-sm font-medium">
                  Couldn&apos;t load the location list. Skip this for now and
                  add it from your profile when you&apos;re back online.
                </p>
              </div>
            )}

            {!locationsError && !coshLocations && (
              <div className="flex items-center gap-3 text-[#7A8C7E] text-sm">
                <div className="w-4 h-4 border-2 border-[#DDD0B8] border-t-[#3A7D44] rounded-full animate-spin"/>
                Loading states and districts…
              </div>
            )}

            {/* State selector */}
            {coshLocations && (
              <div>
                <p className="text-xs text-[#7A8C7E] font-medium mb-1.5">State</p>
                {stateId ? (
                  <div className="flex items-center gap-2">
                    <span className="bg-[#3A7D44]/10 text-[#3A7D44] text-sm font-medium px-3 py-1.5 rounded-full">
                      {stateName}
                    </span>
                    <button onClick={() => {
                        setStateId(''); setStateName(''); setStateSearch('')
                        setDistrictId(''); setDistrictName(''); setDistrictSearch('')
                      }}
                      className="text-[#7A8C7E] text-xs underline">
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <Input
                      placeholder="Search state…"
                      value={stateSearch}
                      onChange={e => setStateSearch(e.target.value)}
                    />
                    {stateSearch && (
                      <div className="mt-2 border border-[#DDD0B8] rounded-xl overflow-hidden max-h-40 overflow-y-auto bg-white">
                        {filteredStates.length === 0
                          ? <p className="text-[#7A8C7E] text-sm px-4 py-3">No states found</p>
                          : filteredStates.map(s => (
                            <button key={s.cosh_id}
                              onClick={() => {
                                setStateId(s.cosh_id); setStateName(s.name || '')
                                setStateSearch('')
                              }}
                              className="w-full text-left px-4 py-2.5 text-sm text-[#6B3F1F] hover:bg-[#F5F0E8] border-b border-[#DDD0B8] last:border-0">
                              {s.name}
                            </button>
                          ))
                        }
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* District selector — same typeahead pattern, bounded to
                the chosen state's districts so the farmer can't pick
                a (state, district) pair Cosh doesn't have. */}
            {coshLocations && stateId && (
              <div>
                <p className="text-xs text-[#7A8C7E] font-medium mb-1.5">District</p>
                {districtId ? (
                  <div className="flex items-center gap-2">
                    <span className="bg-[#3A7D44]/10 text-[#3A7D44] text-sm font-medium px-3 py-1.5 rounded-full">
                      {districtName}
                    </span>
                    <button onClick={() => {
                        setDistrictId(''); setDistrictName(''); setDistrictSearch('')
                      }}
                      className="text-[#7A8C7E] text-xs underline">
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <Input
                      placeholder="Search district…"
                      value={districtSearch}
                      onChange={e => setDistrictSearch(e.target.value)}
                    />
                    {(districtSearch || (selectedState?.districts.length || 0) <= 30) && (
                      <div className="mt-2 border border-[#DDD0B8] rounded-xl overflow-hidden max-h-40 overflow-y-auto bg-white">
                        {filteredDistricts.length === 0
                          ? <p className="text-[#7A8C7E] text-sm px-4 py-3">No districts found</p>
                          : filteredDistricts.map(d => (
                            <button key={d.cosh_id}
                              onClick={() => {
                                setDistrictId(d.cosh_id); setDistrictName(d.name || '')
                                setDistrictSearch('')
                              }}
                              className="w-full text-left px-4 py-2.5 text-sm text-[#6B3F1F] hover:bg-[#F5F0E8] border-b border-[#DDD0B8] last:border-0">
                              {d.name}
                            </button>
                          ))
                        }
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Sub-district / village — free text. Cosh has no IDs
                at this level (packages target down to district only)
                so we store the typed value as-is for the farmer's
                own reference. */}
            <div>
              <p className="text-xs text-[#7A8C7E] font-medium mb-1.5">Sub-district / Village <span className="text-[#DDD0B8]">(optional)</span></p>
              <Input
                placeholder="Village or sub-district — optional"
                value={subDistrict}
                onChange={e => setSubDistrict(e.target.value)}
              />
            </div>
          </div>

          <div className="pt-4">
            {error && <p className="text-red-500 text-sm px-1 pb-2">{error}</p>}
            <Btn disabled={!stateId || !districtId} onClick={saveLocation}>
              Continue →
            </Btn>
          </div>
        </div>
      </div>
    )
  }

  // ── Phone / OTP / Profile (shared structure) ─────────────────────────────────
  const heading = stage === 'phone'   ? 'Enter your mobile number'
                : stage === 'otp'     ? 'Enter the code we sent'
                :                       'Nice to meet you'

  const sub     = stage === 'phone'   ? "We'll send a one-time code — just to confirm it's you"
                : stage === 'otp'     ? `We sent a 6-digit code to +91 ${phone}`
                :                       'What shall we call you?'

  return (
    <div className="flex flex-col overflow-hidden" style={{ background: BG, height: '100svh' }}>

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
      <div className="flex-1 sm:flex-none flex flex-col w-full sm:max-w-sm sm:mx-auto rounded-t-[2rem] px-5 pt-7 pb-10 relative z-10"
        style={{
          background:    '#FAFAF8',
          boxShadow:     '0 -4px 32px rgba(0,0,0,0.10)',
          paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
        }}>

        {stage === 'phone' && (
          <form onSubmit={sendOtp} className="flex flex-col gap-4">
            <div className="flex gap-2">
              <div className="flex items-center px-3.5 rounded-xl border border-[#DDD0B8] bg-[#F5F0E8]
                              text-[#7A8C7E] text-sm font-medium select-none shrink-0">
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
            <p className="text-[#7A8C7E] text-xs text-center">Standard SMS charges may apply</p>
          </form>
        )}

        {stage === 'otp' && (
          <form onSubmit={verifyCode} className="flex flex-col gap-4">
            {devOtp && <DevBadge code={devOtp}/>}
            <input type="text" inputMode="numeric" maxLength={6}
              value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
              autoFocus required placeholder="· · · · · ·"
              className="border border-[#DDD0B8] rounded-2xl px-4 py-5 text-center bg-white
                         text-3xl font-mono tracking-[0.7em] text-[#6B3F1F] w-full
                         focus:outline-none focus:ring-2 focus:ring-[#3A7D44]/30 focus:border-[#3A7D44] transition-all"/>
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
            {error && <p className="text-red-500 text-sm px-1">{error}</p>}
            <Btn type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : 'Take me in →'}
            </Btn>
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
