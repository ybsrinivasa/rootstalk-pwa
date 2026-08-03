'use client'
import { useState } from 'react'

// Location-source toggle shown above the recipient list. Default is
// "profile" (backend uses user.gps_lat/lng). Tap "Current" to request
// the browser's geolocation — opt-in, no auto-prompt on mount. If the
// browser or the user rejects, we silently fall back to profile.
//
// Parent owns the source-of-truth state so it can re-fetch with lat/lng
// when the toggle flips; this component is a controlled input.

export type LocationSource = 'profile' | 'current'

export default function LocationSourceToggle({
  source,
  currentCoords,
  onChange,
  labels,
  busy = false,
}: {
  source: LocationSource
  currentCoords: { lat: number; lng: number } | null
  onChange: (s: LocationSource, coords?: { lat: number; lng: number }) => void
  labels: {
    profile: string
    current: string
    requesting: string
    denied: string
  }
  busy?: boolean
}) {
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function tapCurrent() {
    if (source === 'current' && currentCoords) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError(labels.denied)
      return
    }
    setRequesting(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setRequesting(false)
        onChange('current', { lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      () => {
        setRequesting(false)
        setError(labels.denied)
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    )
  }

  const busyOrRequesting = busy || requesting

  return (
    <div className="text-xs">
      <div className="inline-flex items-center bg-white rounded-full border border-[#DDD0B8] p-0.5">
        <button
          onClick={() => onChange('profile')}
          disabled={busyOrRequesting}
          className={`px-3 py-1.5 rounded-full transition-colors ${
            source === 'profile'
              ? 'bg-[#3A7D44] text-white font-semibold'
              : 'text-[#6B3F1F]'
          }`}>
          {labels.profile}
        </button>
        <button
          onClick={tapCurrent}
          disabled={busyOrRequesting}
          className={`px-3 py-1.5 rounded-full transition-colors ${
            source === 'current' && currentCoords
              ? 'bg-[#3A7D44] text-white font-semibold'
              : 'text-[#6B3F1F]'
          }`}>
          {requesting ? labels.requesting : labels.current}
        </button>
      </div>
      {error && <p className="text-[11px] text-amber-700 mt-1">{error}</p>}
    </div>
  )
}
