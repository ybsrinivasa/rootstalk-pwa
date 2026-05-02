'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

export default function FacilitatorProfilePage() {
  const router = useRouter()
  const user = getUser()
  const [declared, setDeclared] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
  }, [])

  async function save() {
    if (!declared) {
      setError('Please accept the declaration to continue.')
      return
    }
    setError('')
    setSaving(true)
    try {
      // Save the declaration acknowledgement via profile update.
      // The backend currently accepts name/language_code fields on PUT /me/profile.
      // The facilitator_declaration field is noted as a future backend addition.
      await api.put('/auth/me/profile', { name: user?.name || '' })
      setSaved(true)
      setTimeout(() => router.replace('/facilitator/home'), 1200)
    } catch {
      setError('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#7D4E00' }}>
      <PWAHeader title="Facilitator Profile" activeRole="FACILITATOR" customColour="#7D4E00" />
      <div className="flex-1 flex flex-col rounded-t-[2rem] px-5 pt-7 pb-10 mt-14 bg-[#FAFAF8]">

        {/* Read-only info */}
        <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-4 mb-5">
          <h2 className="font-semibold text-stone-800">Your Details</h2>

          <div>
            <p className="text-xs text-stone-400 mb-1">Name</p>
            <p className="text-sm text-stone-800 font-medium">{user?.name || '—'}</p>
          </div>

          <div>
            <p className="text-xs text-stone-400 mb-1">Phone</p>
            <p className="text-sm text-stone-800 font-medium">{user?.phone || '—'}</p>
          </div>
        </div>

        {/* Declaration */}
        <div className="bg-white rounded-2xl border border-stone-100 p-5 mb-5">
          <h2 className="font-semibold text-stone-800 mb-3">Declaration</h2>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={declared}
              onChange={e => { setDeclared(e.target.checked); setError('') }}
              className="w-5 h-5 rounded mt-0.5 accent-[#7D4E00] flex-shrink-0"
            />
            <span className="text-sm text-stone-700 leading-relaxed">
              I am willing to promote the RootsTalk PWA and help farmers in procuring inputs.
            </span>
          </label>
          {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
        </div>

        <button
          onClick={save}
          disabled={saving || !declared}
          className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-40 transition-opacity"
          style={{ background: saving ? '#7D4E00aa' : '#7D4E00' }}>
          {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Confirm & Continue'}
        </button>

        <button onClick={() => router.back()}
          className="mt-3 w-full py-3.5 rounded-2xl text-stone-500 border border-stone-200 font-medium text-sm">
          Back
        </button>
      </div>
    </div>
  )
}
