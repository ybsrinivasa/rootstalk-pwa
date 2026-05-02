'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser, getActiveRoles, logout, ROLE_COLOURS, ROLE_LABELS } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface Subscription { id: string; status: string; package_id: string }

export default function ProfilePage() {
  const router = useRouter()
  const user = getUser()
  const roles = getActiveRoles(user)
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [alertPref, setAlertPref] = useState<Record<string, { send_to_self: boolean; promoter_user_id: string }>>({})
  const [savingAlert, setSavingAlert] = useState<string | null>(null)
  const [alertSuccess, setAlertSuccess] = useState<string | null>(null)

  // Inline edit state
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(user?.name || '')
  const [savingName, setSavingName] = useState(false)

  const [editingLocation, setEditingLocation] = useState(false)
  const [stateValue, setStateValue] = useState('')
  const [districtValue, setDistrictValue] = useState('')
  const [savingLocation, setSavingLocation] = useState(false)

  const [gpsLoading, setGpsLoading] = useState(false)
  const [gpsLat, setGpsLat] = useState<number | null>(null)
  const [gpsLng, setGpsLng] = useState<number | null>(null)

  const [showLangSheet, setShowLangSheet] = useState(false)
  const [languages, setLanguages] = useState<{ language_code: string; language_name_native: string }[]>([])
  const [currentLang, setCurrentLang] = useState(user?.language_code || 'en')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<Subscription[]>('/farmer/my-subscriptions')
      .then(r => setSubscriptions(r.data.filter(s => s.status === 'ACTIVE')))
      .catch(() => {})
    api.get('/platform/languages').then(r => setLanguages(r.data)).catch(() => {})
  }, [])

  async function saveName() {
    if (!nameValue.trim()) return
    setSavingName(true)
    try {
      await api.put('/auth/me/profile', { name: nameValue.trim() })
      setEditingName(false)
      // Update cached user
      const u = getUser()
      if (u) {
        u.name = nameValue.trim()
        localStorage.setItem('rt_pwa_user', JSON.stringify(u))
      }
    } finally { setSavingName(false) }
  }

  async function saveLocation() {
    setSavingLocation(true)
    try {
      const payload: Record<string, string> = {}
      if (stateValue) payload.state_cosh_id = stateValue
      if (districtValue) payload.district_cosh_id = districtValue
      await api.put('/auth/me/profile', payload)
      setEditingLocation(false)
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

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Profile" activeRole="FARMER" />
      <div className="pt-16 pb-20 px-4">

        {/* User card */}
        <div className="bg-white rounded-2xl p-5 mt-4 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold"
              style={{ background: 'linear-gradient(135deg, #065f46, #059669)' }}>
              {(user?.name || user?.phone || 'U')[0].toUpperCase()}
            </div>
            <div className="flex-1">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    value={nameValue}
                    onChange={e => setNameValue(e.target.value)}
                    autoFocus
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-200"
                  />
                  <button onClick={saveName} disabled={savingName}
                    className="text-xs text-white bg-[#1A5C2A] rounded-lg px-3 py-1.5 font-medium disabled:opacity-50">
                    {savingName ? '…' : 'Save'}
                  </button>
                  <button onClick={() => { setEditingName(false); setNameValue(user?.name || '') }}
                    className="text-xs text-slate-400 rounded-lg px-2 py-1.5">
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-900">{user?.name || 'No name set'}</p>
                  <button onClick={() => { setEditingName(true); setNameValue(user?.name || '') }}
                    className="text-xs text-slate-400 underline">
                    Edit
                  </button>
                </div>
              )}
              <p className="text-slate-400 text-sm mt-0.5">{user?.phone}</p>
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Location</p>
            {!editingLocation && (
              <button onClick={() => setEditingLocation(true)}
                className="text-xs text-slate-400 underline">
                Edit
              </button>
            )}
          </div>
          {editingLocation ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">State code</label>
                <input value={stateValue} onChange={e => setStateValue(e.target.value)}
                  placeholder="e.g. KA"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">District code</label>
                <input value={districtValue} onChange={e => setDistrictValue(e.target.value)}
                  placeholder="e.g. BLR"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none" />
              </div>
              <div className="flex gap-2">
                <button onClick={saveLocation} disabled={savingLocation}
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
          ) : (
            <div className="text-sm text-slate-600 space-y-1">
              <p>State: <span className="font-medium">{user && (user as any).state_cosh_id || '—'}</span></p>
              <p>District: <span className="font-medium">{user && (user as any).district_cosh_id || '—'}</span></p>
            </div>
          )}
        </div>

        {/* GPS */}
        <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">GPS Location</p>
          {gpsLat !== null && gpsLng !== null ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 font-mono">{gpsLat.toFixed(6)}, {gpsLng.toFixed(6)}</p>
                <p className="text-xs text-[#1A5C2A] mt-0.5">Captured</p>
              </div>
              <button onClick={captureGps} disabled={gpsLoading}
                className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5">
                {gpsLoading ? 'Getting…' : 'Recapture'}
              </button>
            </div>
          ) : (
            <button onClick={captureGps} disabled={gpsLoading}
              className="w-full py-3 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-500 font-medium flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/>
              </svg>
              {gpsLoading ? 'Getting location…' : 'Capture GPS Location'}
            </button>
          )}
        </div>

        {/* Language */}
        <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Language</p>
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

        {/* My Roles — tap to switch context */}
        <div className="mt-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 px-1">My Roles — tap to open</p>
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            {roles.length === 0 && (
              <div className="px-4 py-4 text-sm text-slate-400">Farmer (default)</div>
            )}
            {roles.map(role => {
              const destination = role === 'DEALER' ? '/dealer/orders'
                : role === 'FACILITATOR' ? '/facilitator/orders'
                : role === 'FARMER' ? '/home'
                : null
              return (
                <button key={role} onClick={() => destination && router.push(destination)}
                  className="w-full flex items-center gap-3 px-4 py-4 border-b border-slate-50 last:border-0 text-left active:bg-slate-50">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: (ROLE_COLOURS[role] || '#1A5C2A') + '20' }}>
                    <div className="w-3 h-3 rounded-full" style={{ background: ROLE_COLOURS[role] || '#1A5C2A' }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800">{ROLE_LABELS[role] || role}</p>
                    <p className="text-xs text-slate-400">Active · tap to open</p>
                  </div>
                  <span className="text-slate-300">›</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Alert Preferences (Farmer only) */}
        {subscriptions.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 px-1">Alert Preferences</p>
            <div className="space-y-3">
              {subscriptions.map(sub => (
                <div key={sub.id} className="bg-white rounded-2xl p-4 border border-slate-100">
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

        {/* My Subscriptions link */}
        <button onClick={() => router.push('/my-subscriptions')}
          className="w-full mt-5 py-3.5 bg-white border border-slate-100 text-slate-700 rounded-2xl text-sm font-medium flex items-center justify-between px-4 shadow-sm">
          <span>My Subscriptions</span>
          <span className="text-slate-300">›</span>
        </button>

        {/* Sign out */}
        <button onClick={logout}
          className="w-full mt-6 py-3.5 border border-red-100 text-red-500 rounded-2xl text-sm font-medium">
          Sign out
        </button>
      </div>

      <BottomNav color="#1A5C2A" />

      {/* Language sheet */}
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
    </div>
  )
}
