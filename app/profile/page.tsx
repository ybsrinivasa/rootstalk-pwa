'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser, getActiveRoles, logout, refreshUser, type PWAUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface Subscription { id: string; status: string; package_id: string; client_id?: string; client_name?: string }

// Cosh-driven location universe — same shape as the onboarding
// picker. Used here only to resolve the cached state_cosh_id +
// district_cosh_id into friendly names like "Karnataka · Tumakuru".
type CoshLocations = {
  states: { cosh_id: string; name: string | null;
            districts: { cosh_id: string; name: string | null }[] }[]
}

export default function ProfilePage() {
  const router = useRouter()
  // User comes from localStorage initially (no flash of empty state)
  // and is refreshed on mount. After every save we re-fetch /auth/me
  // so the page reflects what's in the DB, not what was cached at
  // OTP-verify time.
  const [user, setUser] = useState<PWAUser | null>(getUser())
  const roles = getActiveRoles(user)
  const pwaRoles = user?.pwa_roles || []

  // Resolved state + district names from the Cosh universe so we
  // can render "Karnataka · Tumakuru" instead of raw UUIDs.
  const [locationLabel, setLocationLabel] = useState<string>('')

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [alertPref, setAlertPref] = useState<Record<string, { send_to_self: boolean; promoter_user_id: string }>>({})
  const [savingAlert, setSavingAlert] = useState<string | null>(null)
  const [alertSuccess, setAlertSuccess] = useState<string | null>(null)

  // Inline edit state
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(user?.name || '')
  const [savingName, setSavingName] = useState(false)

  const [editingLocation, setEditingLocation] = useState(false)
  // Picker state. stateId / districtId hold cosh_ids (what we PUT
  // back to /auth/me/profile); the *Name companions drive the
  // already-picked chip. subDistrictValue is free text.
  const [stateId, setStateId] = useState('')
  const [stateName, setStateName] = useState('')
  const [districtId, setDistrictId] = useState('')
  const [districtName, setDistrictName] = useState('')
  const [subDistrictValue, setSubDistrictValue] = useState('')
  const [stateSearch, setStateSearch] = useState('')
  const [districtSearch, setDistrictSearch] = useState('')
  const [savingLocation, setSavingLocation] = useState(false)

  const [gpsLoading, setGpsLoading] = useState(false)
  const [gpsLat, setGpsLat] = useState<number | null>(null)
  const [gpsLng, setGpsLng] = useState<number | null>(null)

  const [showLangSheet, setShowLangSheet] = useState(false)
  const [languages, setLanguages] = useState<{ language_code: string; language_name_native: string }[]>([])
  const [currentLang, setCurrentLang] = useState(user?.language_code || 'en')

  // Delete account flow
  const [deleteStep, setDeleteStep] = useState<'idle' | 'confirm' | 'otp'>('idle')
  const [deleteOtp, setDeleteOtp] = useState('')
  const [deleteDevOtp, setDeleteDevOtp] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    // Refresh /auth/me on mount — the localStorage cache is set at
    // OTP-verify time and goes stale after every profile save in
    // the onboarding flow. Without this, a farmer who just
    // onboarded sees "No name set" and "Location not set" even
    // though the DB has everything.
    refreshUser().then(fresh => {
      if (fresh) {
        setUser(fresh)
        setNameValue(fresh.name || '')
        setCurrentLang(fresh.language_code || 'en')
      }
    })
    api.get<Subscription[]>('/farmer/my-subscriptions')
      .then(r => setSubscriptions(r.data.filter(s => s.status === 'ACTIVE')))
      .catch(() => {})
    api.get('/platform/languages').then(r => setLanguages(r.data)).catch(() => {})
    // Load the Cosh location universe so we can resolve the
    // farmer's stored cosh_ids to display names. One small payload,
    // cached by the browser anyway.
    api.get<CoshLocations>('/cosh/locations/india')
      .then(r => setCoshLocations(r.data))
      .catch(() => { /* leave locationLabel empty — page still renders */ })
  }, [router])

  const [coshLocations, setCoshLocations] = useState<CoshLocations | null>(null)
  // Recompute the location label whenever user or universe changes.
  useEffect(() => {
    if (!user || !coshLocations) return
    const sid = user.state_cosh_id || null
    const did = user.district_cosh_id || null
    if (!sid && !did) { setLocationLabel(''); return }
    const state = coshLocations.states.find(s => s.cosh_id === sid)
    const district = state?.districts.find(d => d.cosh_id === did)
    const parts = [
      district?.name,
      state?.name,
      user.sub_district_cosh_id || null,
    ].filter(Boolean) as string[]
    setLocationLabel(parts.join(' · '))
  }, [user, coshLocations])

  async function saveName() {
    if (!nameValue.trim()) return
    setSavingName(true)
    try {
      await api.put('/auth/me/profile', { name: nameValue.trim() })
      setEditingName(false)
      // refreshUser writes the canonical /auth/me back to
      // localStorage and returns the fresh PWAUser. Drop the old
      // hand-merge pattern that only patched .name.
      const fresh = await refreshUser()
      if (fresh) setUser(fresh)
    } finally { setSavingName(false) }
  }

  function openEditLocation() {
    // Pre-populate with the user's current values so the form is
    // edit-from-existing, not enter-from-scratch. State + district
    // names come from the loaded Cosh universe; sub-district is
    // free text stored as-is.
    const sid = user?.state_cosh_id || ''
    const did = user?.district_cosh_id || ''
    const state = coshLocations?.states.find(s => s.cosh_id === sid)
    const district = state?.districts.find(d => d.cosh_id === did)
    setStateId(sid)
    setStateName(state?.name || '')
    setDistrictId(did)
    setDistrictName(district?.name || '')
    setSubDistrictValue(user?.sub_district_cosh_id || '')
    setStateSearch('')
    setDistrictSearch('')
    setEditingLocation(true)
  }

  async function saveLocation() {
    if (!stateId || !districtId) return
    setSavingLocation(true)
    try {
      await api.put('/auth/me/profile', {
        state_cosh_id: stateId,
        district_cosh_id: districtId,
        // Send empty string (not null) when the user clears
        // sub-district — the backend's PUT skips null fields, so
        // null would silently preserve the previous value.
        sub_district_cosh_id: subDistrictValue.trim(),
      })
      setEditingLocation(false)
      const fresh = await refreshUser()
      if (fresh) setUser(fresh)
    } finally { setSavingLocation(false) }
  }

  function captureGps() {
    if (!navigator.geolocation) return
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setGpsLat(lat)
        setGpsLng(lng)
        setGpsLoading(false)
        try {
          await api.put('/auth/me/profile', { gps_lat: lat, gps_lng: lng })
          const fresh = await refreshUser()
          if (fresh) setUser(fresh)
        } catch { /* will save next profile save */ }
      },
      () => setGpsLoading(false),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  async function switchLang(code: string) {
    setCurrentLang(code)
    setShowLangSheet(false)
    try {
      await api.put('/auth/me/profile', { language_code: code })
      const u = getUser()
      if (u) {
        u.language_code = code
        localStorage.setItem('rt_pwa_user', JSON.stringify(u))
      }
    } catch { /* best effort */ }
    window.location.reload()
  }

  async function saveAlertPref(subId: string) {
    setSavingAlert(subId)
    try {
      await api.post(`/farmer/subscriptions/${subId}/alert-preferences`, alertPref[subId] || { send_to_self: true })
      setAlertSuccess(subId)
      setTimeout(() => setAlertSuccess(null), 2000)
    } finally { setSavingAlert(null) }
  }

  async function requestDeleteOtp() {
    setDeleteBusy(true)
    setDeleteError('')
    try {
      const res = await api.post('/auth/me/request-delete-otp', {})
      if (res.data?.dev_otp) setDeleteDevOtp(res.data.dev_otp)
      setDeleteStep('otp')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setDeleteError(msg || 'Could not send OTP. Please try again.')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleteOtp.trim()) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await api.post('/auth/me/confirm-delete', { otp_code: deleteOtp.trim() })
      logout()
      router.replace('/')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setDeleteError(msg || 'Invalid or expired OTP.')
      setDeleteBusy(false)
    }
  }

  // Profile photo upload (Batch 2, 2026-05-20). Uses the authed
  // /media/upload endpoint (S3-backed) which returns {url, key};
  // we persist the URL on user.photo_url via /auth/me/profile.
  // The actual <input type=file> is hidden behind a <label> that
  // wraps the avatar — single-tap upload, no ref dance needed.
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState('')

  async function handlePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoError('')
    setUploadingPhoto(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post<{ url: string }>(
        '/media/upload?folder=profile-photos', form,
      )
      await api.put('/auth/me/profile', { photo_url: data.url })
      const fresh = await refreshUser()
      if (fresh) setUser(fresh)
    } catch {
      setPhotoError("Couldn't upload that photo. Try a different one.")
    } finally {
      setUploadingPhoto(false)
      // reset so the same file can be re-selected
      if (e.target) e.target.value = ''
    }
  }

  const isDealer = pwaRoles.includes('DEALER') || roles.includes('DEALER')
  const isFacilitator = pwaRoles.includes('FACILITATOR') || roles.includes('FACILITATOR')
  const isFarmPundit = pwaRoles.includes('FARM_PUNDIT') || roles.includes('FARM_PUNDIT')

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="My Profile" activeRole="FARMER" />
      <div className="pt-16 pb-20 px-4">

        {/* ── Hero user card ── */}
        <div className="bg-white rounded-2xl p-5 mt-4 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            {/* Avatar — tap to upload/replace photo. Optional;
                falls back to first-initial chip when no photo set. */}
            <label className="relative shrink-0 cursor-pointer">
              {user?.photo_url ? (
                <img src={user.photo_url} alt={user.name || 'Profile'}
                  className="w-14 h-14 rounded-full object-cover border border-slate-200" />
              ) : (
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold"
                  style={{ background: 'linear-gradient(135deg, #065f46, #059669)' }}>
                  {(user?.name || user?.phone || 'U')[0].toUpperCase()}
                </div>
              )}
              {/* Camera badge overlay */}
              <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center">
                {uploadingPhoto ? (
                  <span className="w-2.5 h-2.5 border border-slate-300 border-t-[#1A5C2A] rounded-full animate-spin"/>
                ) : (
                  <svg className="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.66-.9l.82-1.2A2 2 0 0110.07 4h3.86a2 2 0 011.66.9l.82 1.2a2 2 0 001.66.9H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                )}
              </span>
              <input type="file" accept="image/*" capture="environment"
                onChange={handlePhotoFile}
                disabled={uploadingPhoto}
                className="sr-only" />
            </label>
            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    value={nameValue}
                    onChange={e => setNameValue(e.target.value)}
                    autoFocus
                    className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-200"
                  />
                  <button onClick={saveName} disabled={savingName}
                    className="text-xs text-white bg-[#1A5C2A] rounded-lg px-3 py-1.5 font-medium disabled:opacity-50 shrink-0">
                    {savingName ? '…' : 'Save'}
                  </button>
                  <button onClick={() => { setEditingName(false); setNameValue(user?.name || '') }}
                    className="text-xs text-slate-400 rounded-lg px-2 py-1.5 shrink-0">
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-900 truncate">{user?.name || 'No name set'}</p>
                  <button onClick={() => { setEditingName(true); setNameValue(user?.name || '') }}
                    className="text-xs text-slate-400 underline shrink-0">
                    Edit
                  </button>
                </div>
              )}
              <p className="text-slate-400 text-sm mt-0.5">{user?.phone}</p>
              <p className="text-slate-400 text-xs mt-0.5">
                {locationLabel || 'Location not set'}
              </p>
            </div>
          </div>

          {photoError && (
            <p className="text-red-500 text-xs mb-2">{photoError}</p>
          )}

          {/* Edit profile section */}
          <div className="border-t border-slate-50 pt-3 space-y-3">
            {/* Location — pre-populated typeahead pickers driven by
                the Cosh universe. State + district are mandatory
                (PUT is disabled until both have cosh_ids selected);
                sub-district is optional free text. */}
            {(() => {
              const coshStates = coshLocations?.states ?? []
              const filteredStates = coshStates
                .filter(s => s.name)
                .filter(s => !stateSearch || (s.name || '').toLowerCase().includes(stateSearch.toLowerCase()))
              const selectedState = coshStates.find(s => s.cosh_id === stateId) || null
              const filteredDistricts = (selectedState?.districts ?? [])
                .filter(d => d.name)
                .filter(d => !districtSearch || (d.name || '').toLowerCase().includes(districtSearch.toLowerCase()))
              return (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Location</p>
                    {!editingLocation && (
                      <button onClick={openEditLocation}
                        className="text-xs text-slate-400 underline">
                        Edit
                      </button>
                    )}
                  </div>
                  {editingLocation && (
                    <div className="space-y-3">
                      {/* State */}
                      <div>
                        <p className="text-[11px] text-slate-400 mb-1">State</p>
                        {stateId ? (
                          <div className="flex items-center gap-2">
                            <span className="bg-[#1A5C2A]/10 text-[#1A5C2A] text-xs font-medium px-2.5 py-1 rounded-full">
                              {stateName || '(unnamed)'}
                            </span>
                            <button onClick={() => {
                                setStateId(''); setStateName(''); setStateSearch('')
                                setDistrictId(''); setDistrictName(''); setDistrictSearch('')
                              }}
                              className="text-[11px] text-slate-400 underline">
                              Change
                            </button>
                          </div>
                        ) : (
                          <>
                            <input value={stateSearch} onChange={e => setStateSearch(e.target.value)}
                              placeholder="Search state…"
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-100" />
                            {stateSearch && (
                              <div className="mt-1 border border-slate-200 rounded-xl overflow-hidden max-h-36 overflow-y-auto bg-white">
                                {filteredStates.length === 0
                                  ? <p className="text-slate-400 text-xs px-3 py-2">No states found</p>
                                  : filteredStates.map(s => (
                                    <button key={s.cosh_id}
                                      onClick={() => {
                                        setStateId(s.cosh_id); setStateName(s.name || '')
                                        setStateSearch('')
                                      }}
                                      className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-50 last:border-0">
                                      {s.name}
                                    </button>
                                  ))
                                }
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* District — only meaningful after state is picked */}
                      {stateId && (
                        <div>
                          <p className="text-[11px] text-slate-400 mb-1">District</p>
                          {districtId ? (
                            <div className="flex items-center gap-2">
                              <span className="bg-[#1A5C2A]/10 text-[#1A5C2A] text-xs font-medium px-2.5 py-1 rounded-full">
                                {districtName || '(unnamed)'}
                              </span>
                              <button onClick={() => {
                                  setDistrictId(''); setDistrictName(''); setDistrictSearch('')
                                }}
                                className="text-[11px] text-slate-400 underline">
                                Change
                              </button>
                            </div>
                          ) : (
                            <>
                              <input value={districtSearch} onChange={e => setDistrictSearch(e.target.value)}
                                placeholder="Search district…"
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-100" />
                              {(districtSearch || (selectedState?.districts.length || 0) <= 30) && (
                                <div className="mt-1 border border-slate-200 rounded-xl overflow-hidden max-h-36 overflow-y-auto bg-white">
                                  {filteredDistricts.length === 0
                                    ? <p className="text-slate-400 text-xs px-3 py-2">No districts found</p>
                                    : filteredDistricts.map(d => (
                                      <button key={d.cosh_id}
                                        onClick={() => {
                                          setDistrictId(d.cosh_id); setDistrictName(d.name || '')
                                          setDistrictSearch('')
                                        }}
                                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-50 last:border-0">
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

                      {/* Sub-district / village — free text */}
                      <div>
                        <p className="text-[11px] text-slate-400 mb-1">Sub-district / Village <span className="text-slate-300">(optional)</span></p>
                        <input value={subDistrictValue} onChange={e => setSubDistrictValue(e.target.value)}
                          placeholder="e.g. Gubbi taluk"
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-100" />
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button onClick={saveLocation} disabled={savingLocation || !stateId || !districtId}
                          className="flex-1 py-2 text-white text-xs font-medium rounded-xl disabled:opacity-50"
                          style={{ background: '#1A5C2A' }}>
                          {savingLocation ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingLocation(false)}
                          className="px-4 py-2 text-xs text-slate-400 border border-slate-200 rounded-xl">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* GPS — prefer the just-captured session value for
                instant feedback after a recapture; fall back to the
                cached user (refreshed on mount + after every save)
                so a saved value persists across reloads. Without
                this dual-source check, the panel always rendered
                "Capture" after refresh because the local state
                reset to null. */}
            {(() => {
              const displayLat = gpsLat ?? user?.gps_lat ?? null
              const displayLng = gpsLng ?? user?.gps_lng ?? null
              const hasGps = displayLat !== null && displayLng !== null
              return (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">GPS Location</p>
                  {hasGps ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-slate-500 font-mono">{displayLat!.toFixed(6)}, {displayLng!.toFixed(6)}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-[#1A5C2A]">Captured</span>
                          <a
                            href={`https://www.google.com/maps?q=${displayLat},${displayLng}`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-xs text-[#1A5C2A] underline">
                            View on Map ↗
                          </a>
                        </div>
                      </div>
                      <button onClick={captureGps} disabled={gpsLoading}
                        className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5 shrink-0">
                        {gpsLoading ? 'Getting…' : 'Recapture'}
                      </button>
                    </div>
                  ) : (
                    <button onClick={captureGps} disabled={gpsLoading}
                      className="w-full py-2.5 rounded-xl border-2 border-dashed border-slate-200 text-xs text-slate-500 font-medium flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/>
                      </svg>
                      {gpsLoading ? 'Getting location…' : 'Capture GPS Location'}
                    </button>
                  )}
                </div>
              )
            })()}
          </div>
        </div>

        {/* ── ROLES — discovery + set-up CTAs ──
            Per LoYaRo's profile pattern (the "Become a helper →"
            card): the profile surfaces ROLE SETUP, not role
            management. Already-set-up roles live in the right
            drawer's Switch list and don't appear here. List shrinks
            as the farmer claims more roles, hides entirely when
            all three are set up. */}
        {(() => {
          const setupCtas: { key: string; label: string; href: string; tagline: string }[] = []
          if (!isDealer) setupCtas.push({
            key: 'DEALER', label: 'Open my Shop',
            href: '/become-dealer',
            tagline: 'Sell inputs to nearby farmers through RootsTalk.',
          })
          if (!isFacilitator) setupCtas.push({
            key: 'FACILITATOR', label: 'Help as Facilitator',
            href: '/become-facilitator',
            tagline: 'Earn by promoting subscriptions in your village.',
          })
          if (!isFarmPundit) setupCtas.push({
            key: 'FARM_PUNDIT', label: 'Become an Expert',
            href: '/pundit/register',
            tagline: 'Answer farmer questions in your area of expertise.',
          })
          if (!setupCtas.length) return null
          return (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-wide mb-3 px-1"
                style={{ color: '#7A8C7E' }}>Take on a new role</p>
              <div className="space-y-3">
                {setupCtas.map(c => (
                  <button key={c.key} onClick={() => router.push(c.href)}
                    className="w-full text-left rounded-2xl p-4 border bg-white flex items-center justify-between gap-3 active:scale-[0.99] transition-transform"
                    style={{ borderColor: '#DDD0B8' }}>
                    <div className="min-w-0">
                      <p className="font-semibold text-[15px]" style={{ color: '#6B3F1F' }}>{c.label} →</p>
                      <p className="text-[13px] mt-0.5" style={{ color: '#7A8C7E' }}>{c.tagline}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        })()}

        {/* ── PREFERENCES ── */}
        <div className="mt-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 px-1">Preferences</p>
          <div className="space-y-3">

            {/* Language */}
            <div className="bg-white rounded-2xl border border-slate-100 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Language</p>
                  <p className="text-sm text-slate-700 font-medium">
                    {languages.find(l => l.language_code === currentLang)?.language_name_native || currentLang.toUpperCase()}
                  </p>
                </div>
                <button onClick={() => setShowLangSheet(true)}
                  className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5">
                  Change
                </button>
              </div>
            </div>

            {/* Alert Preferences (Farmer only, when subscriptions exist) */}
            {subscriptions.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">Alert Preferences</p>
                <div className="space-y-3">
                  {subscriptions.map(sub => (
                    <div key={sub.id} className="border-t border-slate-50 first:border-0 pt-3 first:pt-0">
                      <p className="text-xs text-slate-500 font-mono mb-3">{sub.id.slice(0, 12)}…</p>
                      <label className="flex items-center gap-3 cursor-pointer mb-3">
                        <input type="checkbox"
                          checked={alertPref[sub.id]?.send_to_self !== false}
                          onChange={e => setAlertPref(p => ({
                            ...p,
                            [sub.id]: { ...(p[sub.id] || {}), send_to_self: e.target.checked, promoter_user_id: p[sub.id]?.promoter_user_id || '' }
                          }))}
                          className="w-4 h-4 rounded" />
                        <span className="text-sm text-slate-700">Send alerts to my phone</span>
                      </label>
                      <div className="mb-3">
                        <label className="block text-xs text-slate-500 mb-1">Also alert my promoter (user ID, optional)</label>
                        <input
                          value={alertPref[sub.id]?.promoter_user_id || ''}
                          onChange={e => setAlertPref(p => ({
                            ...p,
                            [sub.id]: { ...(p[sub.id] || { send_to_self: true }), promoter_user_id: e.target.value }
                          }))}
                          placeholder="Dealer or facilitator user ID"
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none" />
                      </div>
                      <button onClick={() => saveAlertPref(sub.id)} disabled={savingAlert === sub.id}
                        className="w-full py-2.5 rounded-xl text-white text-xs font-semibold disabled:opacity-50"
                        style={{ background: '#1A5C2A' }}>
                        {alertSuccess === sub.id ? '✓ Saved' : savingAlert === sub.id ? 'Saving…' : 'Save Preferences'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* My Subscriptions link moved to the right drawer 2026-05-20
                so the profile stays focused on personal data + role
                setup. */}
          </div>
        </div>

        {/* ── Delete Account — muted, last-resort link, not a
            prominent CTA. The confirm sheet still uses red for
            the actual destructive action. ── */}
        <div className="mt-16 pt-6 border-t border-stone-100">
          <button onClick={() => { setDeleteStep('confirm'); setDeleteError('') }}
            className="w-full text-center text-xs text-slate-400 hover:text-slate-500 py-2">
            Delete my account
          </button>
        </div>
      </div>

      <BottomNav color="#1A5C2A" />

      {/* ── Language sheet ── */}
      {showLangSheet && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setShowLangSheet(false)}>
          <div className="bg-white rounded-t-2xl w-full max-h-80 overflow-auto pb-6" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="font-medium text-slate-800 text-sm">Select language</p>
              <button onClick={() => setShowLangSheet(false)} className="text-slate-400 text-xl">×</button>
            </div>
            {languages.map(l => (
              <button key={l.language_code} onClick={() => switchLang(l.language_code)}
                className={`w-full text-left px-4 py-3 border-b border-slate-50 flex items-center justify-between ${
                  currentLang === l.language_code ? 'bg-green-50' : ''
                }`}>
                <span className="text-slate-800">{l.language_name_native}</span>
                {currentLang === l.language_code && <span className="text-[#1A5C2A]">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Delete Account: Confirm sheet ── */}
      {deleteStep === 'confirm' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setDeleteStep('idle')}>
          <div className="bg-white rounded-t-3xl w-full pb-10 px-5 pt-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-slate-900 text-base">Delete your account?</h3>
              <button onClick={() => setDeleteStep('idle')} className="text-slate-400 text-xl">×</button>
            </div>
            <div className="space-y-2 mb-6">
              {[
                'Your active advisories will be cancelled',
                'Your data will be anonymised within 30 days',
                'This cannot be undone',
              ].map(item => (
                <div key={item} className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">•</span>
                  <p className="text-sm text-slate-600">{item}</p>
                </div>
              ))}
            </div>
            {deleteError && <p className="text-red-500 text-sm mb-3">{deleteError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setDeleteStep('idle')}
                className="flex-1 py-3 border border-slate-200 rounded-2xl text-sm text-slate-600 font-medium">
                Cancel
              </button>
              <button onClick={requestDeleteOtp} disabled={deleteBusy}
                className="flex-1 py-3 rounded-2xl text-sm text-white font-medium disabled:opacity-50"
                style={{ background: '#dc2626' }}>
                {deleteBusy ? 'Sending…' : 'Send verification code'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Account: OTP entry sheet ── */}
      {deleteStep === 'otp' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setDeleteStep('idle')}>
          <div className="bg-white rounded-t-3xl w-full pb-10 px-5 pt-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-slate-900 text-base">Confirm deletion</h3>
              <button onClick={() => setDeleteStep('idle')} className="text-slate-400 text-xl">×</button>
            </div>
            <p className="text-sm text-slate-500 mb-4">Enter the 6-digit code sent to your phone to confirm account deletion.</p>
            {deleteDevOtp && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4">
                <p className="text-amber-700 text-xs font-medium">Dev code: <strong>{deleteDevOtp}</strong></p>
              </div>
            )}
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={deleteOtp}
              onChange={e => setDeleteOtp(e.target.value.replace(/\D/g, ''))}
              placeholder="· · · · · ·"
              autoFocus
              className="w-full border border-slate-200 rounded-2xl px-4 py-5 text-center text-3xl font-mono tracking-[0.7em] text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400 mb-4"
            />
            {deleteError && <p className="text-red-500 text-sm mb-3">{deleteError}</p>}
            <button onClick={confirmDelete} disabled={deleteBusy || deleteOtp.length < 6}
              className="w-full py-3.5 rounded-2xl text-white text-sm font-medium disabled:opacity-40"
              style={{ background: '#dc2626' }}>
              {deleteBusy ? 'Deleting…' : 'Confirm deletion →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
