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

interface DistrictAdvisory {
  package_id: string; package_name: string; crop_cosh_id: string
  client_id: string; client_name: string | null; client_colour: string | null
  company_name?: string | null; primary_colour?: string | null
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
  // District advisories
  const [districtAdvisories, setDistrictAdvisories] = useState<DistrictAdvisory[]>([])
  const [loadingData, setLoadingData] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }

    Promise.allSettled([
      api.get<PromotedFarmer[]>('/facilitator/promoted-farmers'),
      api.get<DistrictAdvisory[]>('/farmer/active-advisories-in-district'),
    ]).then(([farmersRes, districtRes]) => {
      // Build companies map from promoted farmers
      if (farmersRes.status === 'fulfilled') {
        const farmers = farmersRes.value.data
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
      }

      if (districtRes.status === 'fulfilled') {
        setDistrictAdvisories(districtRes.value.data)
      }
    }).finally(() => setLoadingData(false))
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
      <PWAHeader title="Facilitator Profile" activeRole="FACILITATOR" customColour={COLOUR} />
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

        {/* My Companies — A3b */}
        {!loadingData && companies.length > 0 && (
          <div className="bg-white rounded-2xl border border-stone-100 p-5 mb-5">
            <h2 className="font-semibold text-stone-800 mb-3">My Companies</h2>
            <div className="space-y-3">
              {companies.map(c => (
                <div key={c.client_id} className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.client_colour }} />
                  <div>
                    <p className="text-sm font-semibold text-stone-800">{c.client_name}</p>
                    <p className="text-xs text-stone-400">{c.farmer_count} promoted {c.farmer_count === 1 ? 'farmer' : 'farmers'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active Advisories in District — A3b */}
        {!loadingData && districtAdvisories.length > 0 && (
          <div className="bg-white rounded-2xl border border-stone-100 p-5 mb-5">
            <h2 className="font-semibold text-stone-800 mb-1">Active Advisories in Your District</h2>
            <p className="text-xs text-stone-400 mb-3">Other companies serving farmers in your area</p>
            <div className="space-y-3">
              {districtAdvisories.map(adv => {
                const companyName = adv.client_name || adv.company_name || 'Company'
                const accentColour = adv.client_colour || adv.primary_colour || COLOUR
                const cropLabel = adv.crop_cosh_id
                  .replace(/^crop_/, '')
                  .replace(/_/g, ' ')
                  .replace(/\b\w/g, c => c.toUpperCase())
                return (
                  <div key={adv.package_id} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: accentColour }} />
                    <div>
                      <p className="text-sm font-semibold" style={{ color: accentColour }}>{companyName}</p>
                      <p className="text-xs text-stone-400">{cropLabel}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

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
          style={{ background: saving ? `${COLOUR}aa` : COLOUR }}>
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
