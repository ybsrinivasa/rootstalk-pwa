'use client'
import { useState, useEffect, useRef, FormEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken, getUser, getActiveRoles, requestOtp, verifyOtp, refreshUser } from '@/lib/auth'
import { getLanguage, changeLanguage } from '@/lib/language'
import { digitsOnly, hasNonAscii, isAsciiName } from '@/lib/input-normalization'
import api from '@/lib/api'
import AppMark from '@/components/AppMark'

type Stage = 'loading' | 'landing' | 'install-required' | 'phone' | 'otp' | 'profile' | 'location' | 'gps' | 'welcome'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
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
  const t = useTranslations('common')
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 text-white/55 text-sm hover:text-white/90 transition-colors mt-4 mb-6">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
      </svg>
      {t('back')}
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

// 2026-08-28 — Removed InstallAppLink footer link and InstallPrompt
// soft popup from the landing screen. The mandatory install gate on
// Get-started tap (Android non-standalone) is the single install
// affordance now, per user direction: no redundant prompts on the
// landing page.

// ── Main ──────────────────────────────────────────────────────────────────────
export default function RootPage() {
  const router = useRouter()
  const tCommon = useTranslations('common')
  const tLanding = useTranslations('landing')
  const tLanguage = useTranslations('language')
  const tWelcome = useTranslations('welcome')
  const tAuth = useTranslations('auth')
  const tLocation = useTranslations('location')
  const tAbout = useTranslations('about')
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

  // Install-gate state — Android users must install the PWA to their
  // home screen before they can enter their phone number. The gate
  // check runs when the user taps Get Started; iOS + desktop are
  // exempt (iOS has no programmatic install; desktop is a
  // facilitator/dealer surface we don't want to friction).
  const [deferredInstall, setDeferredInstall] = useState<BeforeInstallPromptEvent | null>(null)
  const [installOutcome, setInstallOutcome] = useState<'idle' | 'installing' | 'accepted'>('idle')

  // OTP auto-read state. `waitingForSms` powers the small "reading OTP
  // from SMS…" hint under the input; auto-cleared when the farmer
  // types anything or after 30s so the hint doesn't linger. The
  // `autoSubmittedRef` gate stops the auto-submit effect from
  // re-firing on the same 6-digit value if verification failed
  // (farmer must edit the OTP to retry). WebOTP wiring happens in a
  // separate effect below.
  const [waitingForSms, setWaitingForSms] = useState(false)
  const autoSubmittedRef = useRef(false)
  const otpFormRef = useRef<HTMLFormElement | null>(null)

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

  // Capture Chrome's install-readiness signal so the Android install
  // gate can offer the native install dialog. Attached in a dedicated
  // effect so cleanup is straightforward; safe alongside InstallPrompt's
  // own listener since beforeinstallprompt fires once and every
  // listener receives the same event.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredInstall(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

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

  // WebOTP API — Chrome on Android extracts the code from an SMS
  // whose last line matches `@<origin> #<otp>` and offers a "Verify
  // with 123456?" chip; on farmer's tap the OTP auto-fills here. No
  // SMS format change needed today for this to be harmless — the
  // Credentials request just sits waiting until it aborts. It'll
  // start actually firing the day the DLT-approved SMS template
  // includes the bound-origin line (backend Phase 2, not yet done).
  useEffect(() => {
    if (stage !== 'otp') return
    if (typeof window === 'undefined') return
    if (!('OTPCredential' in window)) return
    const ac = new AbortController()
    navigator.credentials.get({
      // TS DOM lib doesn't yet know about the `otp` option, hence the cast.
      otp: { transport: ['sms'] },
      signal: ac.signal,
    } as unknown as CredentialRequestOptions).then((cred) => {
      const otpCode = (cred as unknown as { code?: string })?.code
      if (otpCode) setOtp(digitsOnly(otpCode, 6))
    }).catch(() => {
      // AbortError on stage change / component unmount is normal;
      // swallow silently so we don't churn an error toast at the
      // farmer for what's essentially a background wait.
    })
    return () => ac.abort()
  }, [stage])

  // "Reading OTP from SMS…" hint — shown for 30s after landing on
  // the OTP stage or until the farmer types anything (whichever
  // comes first). Signals that we're doing something helpful in the
  // background so waiting doesn't feel dead.
  useEffect(() => {
    if (stage !== 'otp') { setWaitingForSms(false); return }
    setWaitingForSms(true)
    const t = setTimeout(() => setWaitingForSms(false), 30000)
    return () => clearTimeout(t)
  }, [stage])
  useEffect(() => {
    if (otp.length > 0) setWaitingForSms(false)
  }, [otp])

  // Auto-submit gate — reset the "already auto-submitted" flag
  // whenever the OTP shrinks below 6 (farmer edited / cleared it),
  // so a fresh 6-digit entry retries automatically.
  useEffect(() => {
    if (otp.length < 6) autoSubmittedRef.current = false
  }, [otp])

  // Auto-submit — once the OTP reaches 6 digits (from WebOTP,
  // iOS keyboard-suggestion autofill, or manual typing), fire the
  // form's submit so the farmer doesn't have to tap Verify. Uses
  // requestSubmit to keep verifyCode as the single entry point and
  // avoid closure-in-deps churn.
  useEffect(() => {
    if (stage !== 'otp') return
    if (otp.length !== 6) return
    if (busy) return
    if (autoSubmittedRef.current) return
    autoSubmittedRef.current = true
    otpFormRef.current?.requestSubmit()
  }, [otp, busy, stage])

  async function sendOtp(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      const res = await requestOtp('+91' + phone)
      if (res.dev_otp) setDevOtp(res.dev_otp)
      setStage('otp'); setResend(30)
    } catch { setError(tAuth('errors.phoneSendFailed')) }
    finally { setBusy(false) }
  }

  async function verifyCode(e?: FormEvent) {
    e?.preventDefault(); setError(''); setBusy(true)
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
      if (status === 401) setError(tAuth('errors.otpMismatch'))
      else setError(tCommon('errors.generic'))
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
      setError(tAuth('errors.nameSaveFailed'))
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
      setError(tLocation('errors.saveFailed'))
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
          setError(tLocation('errors.gpsSaveFailed'))
        }
      },
      (err) => {
        // GeolocationPositionError.code:
        //   1 = PERMISSION_DENIED (user blocked it / browser blocked)
        //   2 = POSITION_UNAVAILABLE (no GPS / IP geo failed)
        //   3 = TIMEOUT (couldn't find a fix in time)
        setGpsStatus('denied')
        if (err.code === 1) {
          setError(tLocation('errors.gpsBlocked'))
        } else if (err.code === 3) {
          setError(tLocation('errors.gpsTimeout'))
        } else {
          setError(tLocation('errors.gpsUnavailable'))
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
          {tLanding('heroTaglineLine1')}<br/>{tLanding('heroTaglineLine2')}
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
              {tLanguage('selectorTitle')}
            </p>
            <div className="overflow-x-auto -mx-1 px-1">
              <div className="flex gap-2 pb-1 w-max">
                {languages.map(l => (
                  <button key={l.language_code}
                    // 2026-06-28 — Onboarding language picker now
                    // routes through `changeLanguage` so the choice
                    // is durably written to the user's
                    // `language_code` on the backend. Earlier code
                    // called `setLanguage` (local only), so a
                    // user who picked, say, Hindi here ended up
                    // with UI strings in Hindi but Cosh content in
                    // whatever the backend default was — and any
                    // later switch via PWAHeader could leave the
                    // two sides desynced.
                    onClick={() => { setSelected(l.language_code); void changeLanguage(l.language_code) }}
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
                ? tLanding('sessionEndedAnotherDevice')
                : tLanding('sessionEndedExpired')}
            </p>
          </div>
        )}

        <Btn onClick={() => {
          // Android hard-gate: farmer must install-to-home-screen
          // before entering their phone. iOS + desktop are exempt.
          if (typeof window !== 'undefined') {
            const isAndroid = /android/i.test(navigator.userAgent)
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches
            if (isAndroid && !isStandalone) {
              setStage('install-required')
              return
            }
          }
          setStage('phone')
        }}>{tLanding('getStarted')}</Btn>

        <p className="text-[#7A8C7E] text-xs text-center mt-3 tracking-wide">
          {tLanding('audience')}
        </p>
        <div className="flex items-center justify-center gap-3 mt-5 flex-wrap">
          <p className="text-[#7A8C7E] text-[10px] font-light">{tAbout('companyFull')}</p>
          <span className="text-[#7A8C7E]/60 text-[10px]">·</span>
          <a href="https://eywa.farm" target="_blank" rel="noopener noreferrer"
            className="text-[#7A8C7E] text-[10px] underline">
            {tLanding('companyWebsite')}
          </a>
          <span className="text-[#7A8C7E]/60 text-[10px]">·</span>
          <button onClick={() => router.push('/privacy-policy')}
            className="text-[#7A8C7E] text-[10px] underline">
            {tLanding('privacyPolicy')}
          </button>
        </div>
      </div>
    </div>
  )

  // ── Install-required stage (Android hard-gate) ────────────────────────────
  // Blocks phone-number entry until the farmer installs the PWA to
  // their home screen. Native install button when Chrome has fired
  // beforeinstallprompt; manual "menu → Install app" instructions
  // when it hasn't. Back button escapes to landing so the farmer
  // can change language / read the privacy policy / not proceed.
  if (stage === 'install-required') {
    async function triggerInstall() {
      if (!deferredInstall) return
      setInstallOutcome('installing')
      try {
        await deferredInstall.prompt()
        const { outcome } = await deferredInstall.userChoice
        if (outcome === 'accepted') {
          setInstallOutcome('accepted')
        } else {
          setInstallOutcome('idle')
        }
      } catch {
        setInstallOutcome('idle')
      } finally {
        // The event is single-use — Chrome won't fire it again for
        // this session even if user cancelled. Clear it so the UI
        // falls back to the manual-instructions path.
        setDeferredInstall(null)
      }
    }
    return (
      <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: BG }}>
        <DewDrops/>
        <GrassBlades/>

        <div className="w-full max-w-sm mx-auto px-5 relative z-10">
          <div className="pt-safe-top"/>
          <BackBtn onClick={() => { setInstallOutcome('idle'); setStage('landing') }}/>
          <MiniMark/>
          <h2 className="text-white font-semibold leading-snug mt-5" style={{ fontSize: '1.6rem' }}>
            {tAuth('installRequired.title')}
          </h2>
          <p className="text-white/60 text-sm mt-2 font-light leading-relaxed pb-7">
            {tAuth('installRequired.subtitle')}
          </p>
        </div>

        <div className="flex-1 sm:flex-none flex flex-col w-full sm:max-w-sm sm:mx-auto rounded-t-[2rem] px-5 pt-7 pb-10 relative z-10"
          style={{
            background:    '#FAFAF8',
            boxShadow:     '0 -4px 32px rgba(0,0,0,0.10)',
            paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
          }}>

          {/* Benefits row — mirrors the InstallPrompt sheet so the
              farmer sees consistent messaging. */}
          <div className="flex gap-3 mb-5">
            {[
              { icon: '⚡', text: tAuth('installRequired.benefitFast') },
              { icon: '📵', text: tAuth('installRequired.benefitOffline') },
              { icon: '🔔', text: tAuth('installRequired.benefitAlerts') },
            ].map(b => (
              <div key={b.text} className="flex-1 bg-[#F5F0E8] rounded-xl p-3 text-center border border-[#DDD0B8]">
                <p className="text-xl mb-1">{b.icon}</p>
                <p className="text-[#6B3F1F] text-xs font-medium leading-tight">{b.text}</p>
              </div>
            ))}
          </div>

          {installOutcome === 'accepted' ? (
            /* Post-install — 2026-08-28 (per user's team feedback):
               farmers/facilitators find "close browser, open the app
               icon" confusing and often don't read instructions.
               Instead we let them continue registering in the current
               browser tab. The token lands in localStorage, which
               the standalone PWA shares, so when they next open from
               the home-screen icon they're already logged in and
               skip the landing flow entirely. */
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <p className="text-green-800 font-semibold text-sm">
                  {tAuth('installRequired.installedTitle')}
                </p>
              </div>
              <button onClick={() => setStage('phone')}
                className="w-full py-4 rounded-2xl text-white font-semibold text-base transition-all active:scale-[0.98]"
                style={{ background: G }}>
                {tCommon('continue')}
              </button>
            </div>
          ) : deferredInstall ? (
            /* Chrome captured beforeinstallprompt — native install
               button available. */
            <button onClick={triggerInstall}
              disabled={installOutcome === 'installing'}
              className="w-full py-4 rounded-2xl text-white font-semibold text-base disabled:opacity-60 transition-opacity"
              style={{ background: G }}>
              {installOutcome === 'installing'
                ? tAuth('installRequired.installing')
                : tAuth('installRequired.installCta')}
            </button>
          ) : (
            /* Manual instructions — Chrome hasn't fired the event
               (engagement heuristic not yet satisfied, or event
               already consumed by dismissal). */
            <div className="bg-[#F5F0E8] rounded-xl p-4 border border-[#DDD0B8]">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: G }}>1</div>
                <p className="text-[#6B3F1F] text-sm leading-relaxed">
                  {tAuth('installRequired.manualStep1')}
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: G }}>2</div>
                <p className="text-[#6B3F1F] text-sm leading-relaxed">
                  {tAuth('installRequired.manualStep2')}
                </p>
              </div>
              <p className="text-[#7A8C7E] text-[11px] mt-3 italic leading-relaxed">
                {tAuth('installRequired.manualNote')}
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Welcome stage ──────────────────────────────────────────────────────────
  if (stage === 'welcome') {
    const user = getUser()
    // 2026-06-23 — Role-choice intro. Per user direction: instead of
    // always landing on the farmer dashboard and forcing dealers /
    // facilitators / pundits to find their setup through the right
    // drawer, the intro screen asks "where would you like to start?"
    // and routes to the matching setup or dashboard. Farmer is
    // pre-emphasised (emerald accent) since it's the majority path
    // and remains the implicit role for every user. Choice is a
    // starting point, not a commitment — the drawer still surfaces
    // every role afterwards.
    type RoleChoice = 'FARMER' | 'DEALER' | 'FACILITATOR' | 'FARM_PUNDIT'
    const goRole = (r: RoleChoice) => {
      if (r === 'FARMER')           router.replace('/home')
      else if (r === 'DEALER')      router.replace('/become-dealer')
      else if (r === 'FACILITATOR') router.replace('/become-facilitator')
      else                          router.replace('/pundit/register')
    }
    // Role tile palette — same hexes the rest of the PWA uses
    // (lib/auth.ts::ROLE_COLOURS) so the user starts seeing the
    // role's visual identity from the very first tap.
    const tilesPalette: Record<RoleChoice, { fg: string; tint: string }> = {
      FARMER:      { fg: '#3A7D44', tint: '#3A7D4414' },
      DEALER:      { fg: '#7D4196', tint: '#7D419614' },
      FACILITATOR: { fg: '#7D4E00', tint: '#7D4E0014' },
      FARM_PUNDIT: { fg: '#3C3489', tint: '#3C348914' },
    }

    const RoleTile = ({
      role, title, body, defaultChoice, svg,
    }: {
      role: RoleChoice
      title: string
      body: string
      defaultChoice?: boolean
      svg: ReactNode
    }) => {
      const c = tilesPalette[role]
      return (
        <button
          onClick={() => goRole(role)}
          className="text-left bg-white rounded-2xl p-4 shadow-sm transition-transform active:scale-[0.98]"
          style={{
            border: defaultChoice ? `2px solid ${c.fg}` : '1px solid #DDD0B8',
            background: defaultChoice ? c.tint : '#FFFFFF',
          }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2"
            style={{ background: c.tint }}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke={c.fg} strokeWidth={1.7}
              strokeLinecap="round" strokeLinejoin="round">
              {svg}
            </svg>
          </div>
          <p className="font-semibold text-[#6B3F1F] text-sm leading-tight">{title}</p>
          <p className="text-[#7A8C7E] text-xs mt-1 leading-snug">{body}</p>
        </button>
      )
    }

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
            {tWelcome('greeting', { name: user?.name || tWelcome('fallbackName') })}
          </h1>
          <p className="text-white/60 text-sm mt-2 font-light text-center">
            {tWelcome('subline')}
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

          <p className="text-[#6B3F1F] font-semibold text-sm mb-3 text-center">
            {tWelcome('choicePrompt')}
          </p>

          {/* Role choice grid */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <RoleTile
              role="FARMER"
              defaultChoice
              title={tWelcome('role.farmer.title')}
              body={tWelcome('role.farmer.body')}
              svg={<path d="M12 21V10m0 0c2.5-2.5 5-2 5-5 0 3-2.5 2.5-5 5zm0 0c-2.5-2.5-5-2-5-5 0 3 2.5 2.5 5 5z"/>}
            />
            <RoleTile
              role="DEALER"
              title={tWelcome('role.dealer.title')}
              body={tWelcome('role.dealer.body')}
              svg={<path d="M3 6h18l-2 13H5L3 6zm4 0V4a2 2 0 012-2h6a2 2 0 012 2v2"/>}
            />
            <RoleTile
              role="FACILITATOR"
              title={tWelcome('role.facilitator.title')}
              body={tWelcome('role.facilitator.body')}
              svg={<path d="M5 17a2 2 0 104 0 2 2 0 00-4 0zm10 0a2 2 0 104 0 2 2 0 00-4 0zm-9-3V8h7v6m0 0h6.5l-2-5H13"/>}
            />
            <RoleTile
              role="FARM_PUNDIT"
              title={tWelcome('role.pundit.title')}
              body={tWelcome('role.pundit.body')}
              svg={<path d="M12 6a3 3 0 110 6 3 3 0 010-6zm0 8c-3 0-7 1.5-7 4.5V20h14v-1.5c0-3-4-4.5-7-4.5zm5-9l2 2-2 2m-12-2l2 2-2 2"/>}
            />
          </div>

          <p className="text-[#7A8C7E] text-[11px] text-center leading-relaxed mb-3">
            {tWelcome('choiceFooterHint')}
          </p>
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
        <h2 className="text-white font-semibold leading-snug mt-5" style={{ fontSize: '1.6rem' }}>{tLocation('gpsTitle')}</h2>
        <p className="text-white/50 text-sm mt-2 font-light leading-relaxed pb-7">
          {tLocation('gpsSubtitle')}
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
              <span className="text-[#6B3F1F] font-medium text-base">{tLocation('gpsCta')}</span>
            </button>
          )}

          {gpsStatus === 'getting' && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-2 border-[#DDD0B8] border-t-[#3A7D44] rounded-full animate-spin"/>
              <p className="text-[#7A8C7E] text-sm">{tLocation('gpsFinding')}</p>
            </div>
          )}

          {gpsStatus === 'done' && (
            <div className="w-full bg-green-50 border border-green-200 rounded-2xl px-4 py-4">
              <p className="text-green-700 font-semibold text-sm">{tLocation('gpsCaptured')}</p>
              <p className="text-green-600/70 text-xs mt-1 font-mono">
                {gpsLat?.toFixed(5)}, {gpsLng?.toFixed(5)}
              </p>
            </div>
          )}

          {gpsStatus === 'denied' && (
            <div className="w-full bg-amber-50 border border-amber-200 rounded-2xl px-4 py-4">
              <p className="text-amber-700 font-semibold text-sm">
                {error ? tLocation('gpsCouldntGet') : tLocation('gpsDenied')}
              </p>
              <p className="text-amber-600/80 text-xs mt-1 leading-relaxed">
                {error || tLocation('gpsLater')}
              </p>
              <button onClick={captureGps}
                className="mt-3 text-sm font-medium text-amber-800 underline">
                {tLocation('gpsTryAgain')}
              </button>
            </div>
          )}
        </div>

        {/* GPS is mandatory — user can only Continue once a fix
            is captured. Denied path keeps the Try again button
            inside the error card above; there is no skip. */}
        {gpsStatus === 'done' && (
          <Btn onClick={() => setStage('welcome')}>{tCommon('continue')}</Btn>
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
          <h2 className="text-white font-semibold leading-snug mt-5" style={{ fontSize: '1.6rem' }}>{tLocation('title')}</h2>
          <p className="text-white/50 text-sm mt-2 font-light leading-relaxed pb-7">
            {tLocation('subtitle')}
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
                  {tLocation('loadError')}
                </p>
              </div>
            )}

            {!locationsError && !coshLocations && (
              <div className="flex items-center gap-3 text-[#7A8C7E] text-sm">
                <div className="w-4 h-4 border-2 border-[#DDD0B8] border-t-[#3A7D44] rounded-full animate-spin"/>
                {tLocation('loading')}
              </div>
            )}

            {/* State selector */}
            {coshLocations && (
              <div>
                <p className="text-xs text-[#7A8C7E] font-medium mb-1.5">{tLocation('stateLabel')}</p>
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
                      {tCommon('change')}
                    </button>
                  </div>
                ) : (
                  <>
                    <Input
                      placeholder={tLocation('searchState')}
                      value={stateSearch}
                      onChange={e => setStateSearch(e.target.value)}
                    />
                    {stateSearch && (
                      <div className="mt-2 border border-[#DDD0B8] rounded-xl overflow-hidden max-h-40 overflow-y-auto bg-white">
                        {filteredStates.length === 0
                          ? <p className="text-[#7A8C7E] text-sm px-4 py-3">{tLocation('noStates')}</p>
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
                <p className="text-xs text-[#7A8C7E] font-medium mb-1.5">{tLocation('districtLabel')}</p>
                {districtId ? (
                  <div className="flex items-center gap-2">
                    <span className="bg-[#3A7D44]/10 text-[#3A7D44] text-sm font-medium px-3 py-1.5 rounded-full">
                      {districtName}
                    </span>
                    <button onClick={() => {
                        setDistrictId(''); setDistrictName(''); setDistrictSearch('')
                      }}
                      className="text-[#7A8C7E] text-xs underline">
                      {tCommon('change')}
                    </button>
                  </div>
                ) : (
                  <>
                    <Input
                      placeholder={tLocation('searchDistrict')}
                      value={districtSearch}
                      onChange={e => setDistrictSearch(e.target.value)}
                    />
                    {(districtSearch || (selectedState?.districts.length || 0) <= 30) && (
                      <div className="mt-2 border border-[#DDD0B8] rounded-xl overflow-hidden max-h-40 overflow-y-auto bg-white">
                        {filteredDistricts.length === 0
                          ? <p className="text-[#7A8C7E] text-sm px-4 py-3">{tLocation('noDistricts')}</p>
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
              <p className="text-xs text-[#7A8C7E] font-medium mb-1.5">{tLocation('subDistrictLabel')} <span className="text-[#DDD0B8]">{tCommon('optional')}</span></p>
              <Input
                placeholder={tLocation('subDistrictPlaceholder')}
                value={subDistrict}
                onChange={e => setSubDistrict(e.target.value)}
              />
            </div>
          </div>

          <div className="pt-4">
            {error && <p className="text-red-500 text-sm px-1 pb-2">{error}</p>}
            <Btn disabled={!stateId || !districtId} onClick={saveLocation}>
              {tCommon('continue')}
            </Btn>
          </div>
        </div>
      </div>
    )
  }

  // ── Phone / OTP / Profile (shared structure) ─────────────────────────────────
  const heading = stage === 'phone'   ? tAuth('phoneTitle')
                : stage === 'otp'     ? tAuth('otpTitle')
                :                       tAuth('nameTitle')

  const sub     = stage === 'phone'   ? tAuth('phoneSubtitle')
                : stage === 'otp'     ? tAuth('otpSubtitle', { phone })
                :                       tAuth('nameSubtitle')

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
                placeholder={tAuth('phonePlaceholder')}
                onChange={e => setPhone(digitsOnly(e.target.value, 10))}/>
            </div>
            {error && <p className="text-red-500 text-sm px-1">{error}</p>}
            {devOtp && <DevBadge code={devOtp}/>}
            <Btn type="submit" disabled={busy || phone.length < 10}>
              {busy ? tAuth('sending') : tAuth('sendCode')}
            </Btn>
            <p className="text-[#7A8C7E] text-xs text-center">{tAuth('smsNotice')}</p>
          </form>
        )}

        {stage === 'otp' && (
          <form ref={otpFormRef} onSubmit={verifyCode} className="flex flex-col gap-4">
            {devOtp && <DevBadge code={devOtp}/>}
            <input type="text" inputMode="numeric" maxLength={6}
              value={otp} onChange={e => setOtp(digitsOnly(e.target.value, 6))}
              autoFocus required placeholder="· · · · · ·"
              autoComplete="one-time-code"
              className="border border-[#DDD0B8] rounded-2xl px-4 py-5 text-center bg-white
                         text-3xl font-mono tracking-[0.7em] text-[#6B3F1F] w-full
                         focus:outline-none focus:ring-2 focus:ring-[#3A7D44]/30 focus:border-[#3A7D44] transition-all"/>
            {waitingForSms && !error && (
              <div className="flex items-center justify-center gap-2 text-xs text-[#7A8C7E] animate-pulse">
                <div className="w-3 h-3 border-2 border-[#DDD0B8] border-t-[#3A7D44] rounded-full animate-spin" />
                <span>{tAuth('readingSms')}</span>
              </div>
            )}
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
            <Btn type="submit" disabled={busy || otp.length < 6}>
              {busy ? tAuth('checking') : tAuth('verify')}
            </Btn>
            <button type="button"
              onClick={() => requestOtp('+91' + phone).then(r => { if (r.dev_otp) setDevOtp(r.dev_otp); setResend(30) })}
              disabled={resend > 0}
              className="text-center text-sm py-2 transition-opacity disabled:opacity-40"
              style={{ color: G }}>
              {resend > 0 ? tAuth('resendIn', { seconds: resend }) : tAuth('resendNow')}
            </button>
          </form>
        )}

        {stage === 'profile' && (
          <form onSubmit={saveName} className="flex flex-col gap-4">
            <Input value={name} onChange={e => setName(e.target.value)}
              autoFocus placeholder={tAuth('namePlaceholder')}/>
            {hasNonAscii(name) && (
              <p className="text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
                {tAuth('nameEnglishOnlyHint')}
              </p>
            )}
            {error && <p className="text-red-500 text-sm px-1">{error}</p>}
            <Btn type="submit" disabled={busy || !isAsciiName(name)}>
              {busy ? tCommon('saving') : tAuth('takeMeIn')}
            </Btn>
          </form>
        )}

      </div>
    </div>
  )
}

function DevBadge({ code }: { code: string }) {
  const t = useTranslations('auth')
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
      <p className="text-amber-700 text-xs font-medium">{t('devCode')} <strong>{code}</strong></p>
    </div>
  )
}
