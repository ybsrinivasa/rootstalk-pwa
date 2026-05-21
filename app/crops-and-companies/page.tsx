'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getUser } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import RoleSwitcherDrawer from '@/components/RoleSwitcherDrawer'
import api from '@/lib/api'
import { C } from '@/lib/tokens'

interface Crop {
  crop_cosh_id: string
  name: string
  client_ids: string[]
}

interface Company {
  id: string
  display_name: string
  tagline: string | null
  logo_url: string | null
  primary_colour: string | null
  crop_cosh_ids: string[]
}

interface DiscoverResponse {
  district_cosh_id: string
  district_name: string | null
  crops: Crop[]
  companies: Company[]
}

export default function CropsAndCompaniesPage() {
  const router = useRouter()
  const user = getUser()
  const [data, setData] = useState<DiscoverResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedCropId, setSelectedCropId] = useState<string | null>(null)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [showRoleDrawer, setShowRoleDrawer] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return }
    if (!user?.district_cosh_id) { setLoading(false); return }
    api.get<DiscoverResponse>(
      `/farmer/discover/crops-and-companies?district_cosh_id=${encodeURIComponent(user.district_cosh_id)}`,
    ).then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // Cross-filter locally — no extra round-trips on every tap. When
  // a crop is selected, the visible crops collapse to that one and
  // companies narrow to those covering it; vice versa for company.
  // When both are selected, both lists narrow to the single picks.
  const visibleCrops = useMemo(() => {
    if (!data) return []
    const allCrops = data.crops
    if (selectedCropId) {
      const pick = allCrops.find(c => c.crop_cosh_id === selectedCropId)
      return pick ? [pick] : []
    }
    if (selectedClientId) {
      const company = data.companies.find(c => c.id === selectedClientId)
      if (!company) return allCrops
      const set = new Set(company.crop_cosh_ids)
      return allCrops.filter(c => set.has(c.crop_cosh_id))
    }
    return allCrops
  }, [data, selectedCropId, selectedClientId])

  const visibleCompanies = useMemo(() => {
    if (!data) return []
    const allCompanies = data.companies
    if (selectedClientId) {
      const pick = allCompanies.find(c => c.id === selectedClientId)
      return pick ? [pick] : []
    }
    if (selectedCropId) {
      const crop = data.crops.find(c => c.crop_cosh_id === selectedCropId)
      if (!crop) return allCompanies
      const set = new Set(crop.client_ids)
      return allCompanies.filter(c => set.has(c.id))
    }
    return allCompanies
  }, [data, selectedCropId, selectedClientId])

  function toggleCrop(id: string) {
    setSelectedCropId(cur => cur === id ? null : id)
  }
  function toggleCompany(id: string) {
    setSelectedClientId(cur => cur === id ? null : id)
  }
  function reset() {
    setSelectedCropId(null)
    setSelectedClientId(null)
  }

  return (
    <div className="min-h-screen" style={{ background: C.background }}>
      <PWAHeader onRoleSwitch={() => setShowRoleDrawer(true)} />

      <div className="pt-20 pb-10 px-4 max-w-3xl mx-auto">
        {/* Title + reset */}
        <div className="flex items-end justify-between gap-3 mb-1">
          <div>
            <h1 className="text-xl font-bold" style={{ color: C.textPrimary }}>
              Crops & Companies
            </h1>
            <p className="text-xs mt-0.5" style={{ color: C.textSecond }}>
              Active advisories in {data?.district_name || 'your district'}
            </p>
          </div>
          <button
            onClick={reset}
            disabled={!selectedCropId && !selectedClientId}
            className="text-xs font-medium px-3 py-2 rounded-xl border disabled:opacity-30"
            style={{ borderColor: C.divider, color: C.textPrimary }}>
            ↻ Reset
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 rounded-full animate-spin"
              style={{ borderColor: C.divider, borderTopColor: C.primary }} />
          </div>
        ) : !user?.district_cosh_id ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mt-4">
            <p className="font-semibold text-amber-800 text-sm">Your district isn&apos;t set</p>
            <p className="text-xs text-amber-700 mt-1">
              Open Profile and set your district so we can show advisories near you.
            </p>
            <button onClick={() => router.push('/profile')}
              className="mt-3 text-xs font-medium px-3 py-2 rounded-xl bg-amber-100 text-amber-800">
              Go to Profile →
            </button>
          </div>
        ) : data && data.crops.length === 0 ? (
          <div className="bg-white border rounded-2xl p-5 mt-4 text-center"
            style={{ borderColor: C.divider }}>
            <p className="font-semibold text-sm" style={{ color: C.textPrimary }}>
              Nothing here yet
            </p>
            <p className="text-xs mt-1" style={{ color: C.textSecond }}>
              No companies are currently advising in {data.district_name || 'your district'}.
            </p>
          </div>
        ) : data && (
          <div className="grid grid-cols-2 gap-3 mt-4">
            {/* Crops column */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-2 px-1"
                style={{ color: C.textSecond }}>
                Crops ({visibleCrops.length})
              </p>
              <div className="space-y-2">
                {visibleCrops.map(crop => {
                  const isSelected = crop.crop_cosh_id === selectedCropId
                  return (
                    <button key={crop.crop_cosh_id}
                      onClick={() => toggleCrop(crop.crop_cosh_id)}
                      className="w-full text-left rounded-xl border p-3 transition-colors"
                      style={{
                        background: isSelected ? C.primary + '14' : C.cardBg,
                        borderColor: isSelected ? C.primary : C.divider,
                      }}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold leading-tight"
                          style={{ color: isSelected ? C.primary : C.textPrimary }}>
                          {crop.name}
                        </p>
                        {isSelected && (
                          <span className="text-xs leading-none mt-0.5" style={{ color: C.primary }}>✓</span>
                        )}
                      </div>
                      <p className="text-[10px] mt-1" style={{ color: C.textSecond }}>
                        {crop.client_ids.length} {crop.client_ids.length === 1 ? 'company' : 'companies'}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Companies column */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-2 px-1"
                style={{ color: C.textSecond }}>
                Companies ({visibleCompanies.length})
              </p>
              <div className="space-y-2">
                {visibleCompanies.map(company => {
                  const isSelected = company.id === selectedClientId
                  const accent = company.primary_colour || C.primary
                  const initials = (company.display_name || '?')
                    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                  return (
                    <button key={company.id}
                      onClick={() => toggleCompany(company.id)}
                      className="w-full text-left rounded-xl border p-3 transition-colors"
                      style={{
                        background: isSelected ? accent + '14' : C.cardBg,
                        borderColor: isSelected ? accent : C.divider,
                      }}>
                      <div className="flex items-start gap-2">
                        {company.logo_url ? (
                          <img src={company.logo_url} alt=""
                            className="w-7 h-7 rounded-full object-contain bg-white border shrink-0"
                            style={{ borderColor: C.divider }} />
                        ) : (
                          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white text-[10px] font-bold"
                            style={{ background: accent }}>
                            {initials}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold leading-tight truncate"
                            style={{ color: isSelected ? accent : C.textPrimary }}>
                            {company.display_name}
                          </p>
                          <p className="text-[10px] mt-0.5" style={{ color: C.textSecond }}>
                            {company.crop_cosh_ids.length} {company.crop_cosh_ids.length === 1 ? 'crop' : 'crops'}
                          </p>
                        </div>
                        {isSelected && (
                          <span className="text-xs leading-none mt-0.5" style={{ color: accent }}>✓</span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <RoleSwitcherDrawer
        open={showRoleDrawer}
        onClose={() => setShowRoleDrawer(false)}
        onSwitch={() => setShowRoleDrawer(false)}
      />
    </div>
  )
}
