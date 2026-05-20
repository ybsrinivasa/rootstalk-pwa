'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

interface PromotedFarmer {
  subscription_id: string; farmer_name: string | null; farmer_phone: string | null
  client_id: string; status: string; reference_number: string | null
  client_name?: string | null; client_colour?: string | null
}

interface CompanySummary {
  client_id: string
  client_name: string
  client_colour: string
  farmer_count: number
}

const COLOUR = '#7D4E00'

export default function FacilitatorProfilePage() {
  const router = useRouter()
  const user = getUser()
  const [declared, setDeclared] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // My Companies
  const [companies, setCompanies] = useState<CompanySummary[]>([])
  const [loadingData, setLoadingData] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }

    api.get<PromotedFarmer[]>('/facilitator/promoted-farmers')
      .then(res => {
        const farmers = res.data
        const map: Record<string, CompanySummary> = {}
        farmers.forEach(f => {
          if (!f.client_id) return
          if (!map[f.client_id]) {
            map[f.client_id] = {
              client_id: f.client_id,
              client_name: f.client_name || 'Company',
              client_colour: f.client_colour || COLOUR,
              farmer_count: 0,
            }
          }
          map[f.client_id].farmer_count += 1
        })
        setCompanies(Object.values(map))
      })
      .catch(() => {})
      .finally(() => setLoadingData(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!declared) {
      setError('Please accept the declaration to continue.')
      return
    }
    setError('')
    setSaving(true)
    try {
      // Save the declaration acknowledgement via profile update.
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
    <div className="min-h-screen flex flex-col" style={{ background: COLOUR }}>
      <PWAHeader title="Service Profile" activeRole="FACILITATOR" customColour={COLOUR} />
      <div className="flex-1 flex flex-col rounded-t-[2rem] px-5 pt-7 pb-10 mt-14 bg-[#FAFAF8]">

        {/* Read-only info */}
        <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 space-y-4 mb-5">
          <h2 className="font-semibold text-[#6B3F1F]">Your Details</h2>

          <div>
            <p className="text-xs text-[#7A8C7E] mb-1">Name</p>
            <p className="text-sm text-[#6B3F1F] font-medium">{user?.name || '—'}</p>
          </div>

          <div>
            <p className="text-xs text-[#7A8C7E] mb-1">Phone</p>
            <p className="text-sm text-[#6B3F1F] font-medium">{user?.phone || '—'}</p>
          </div>
        </div>

        {/* My Companies — A3b */}
        {!loadingData && companies.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 mb-5">
            <h2 className="font-semibold text-[#6B3F1F] mb-3">My Companies</h2>
            <div className="space-y-3">
              {companies.map(c => (
                <div key={c.client_id} className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.client_colour }} />
                  <div>
                    <p className="text-sm font-semibold text-[#6B3F1F]">{c.client_name}</p>
                    <p className="text-xs text-[#7A8C7E]">{c.farmer_count} promoted {c.farmer_count === 1 ? 'farmer' : 'farmers'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Declaration */}
        <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 mb-5">
          <h2 className="font-semibold text-[#6B3F1F] mb-3">Declaration</h2>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={declared}
              onChange={e => { setDeclared(e.target.checked); setError('') }}
              className="w-5 h-5 rounded mt-0.5 accent-[#7D4E00] flex-shrink-0"
            />
            <span className="text-sm text-[#6B3F1F] leading-relaxed">
              I am willing to promote the RootsTalk PWA and help farmers in procuring inputs.
            </span>
          </label>
          {error && <p className="text-[#D4682E] text-xs mt-2">{error}</p>}
        </div>

        <button
          onClick={save}
          disabled={saving || !declared}
          className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-40 transition-opacity"
          style={{ background: saving ? `${COLOUR}aa` : COLOUR }}>
          {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Confirm & Continue'}
        </button>

        <button onClick={() => router.back()}
          className="mt-3 w-full py-3.5 rounded-2xl text-[#7A8C7E] border border-[#DDD0B8] font-medium text-sm">
          Back
        </button>
      </div>
    </div>
  )
}
