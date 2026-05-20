'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

interface Relationship { id: string; manufacturer_name: string; manufacturer_client_id: string | null }

interface DistrictAdvisory {
  package_id: string
  package_name: string
  crop_cosh_id: string
  client_id: string
  client_name: string
  client_colour: string | null
}

function formatCropName(coshId: string): string {
  return coshId
    .replace(/^crop_/, '')
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export default function MyDealershipsPage() {
  const router = useRouter()
  const [list, setList] = useState<Relationship[]>([])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [districtAdvisories, setDistrictAdvisories] = useState<DistrictAdvisory[]>([])

  const load = () =>
    api.get<Relationship[]>('/dealer/dealerships').then(r => setList(r.data)).catch(() => {})

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
    api.get<DistrictAdvisory[]>('/dealer/district-advisories')
      .then(r => setDistrictAdvisories(r.data))
      .catch(() => {})
  }, [])

  async function add() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      await api.post('/dealer/dealerships', { manufacturer_name: newName.trim() })
      setNewName('')
      setAdding(false)
      load()
    } finally { setSaving(false) }
  }

  async function remove(id: string) {
    await api.delete(`/dealer/dealerships/${id}`)
    load()
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="My Dealerships" activeRole="DEALER" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        <div className="mt-4 mb-4">
          <p className="text-xs text-[#7A8C7E] leading-relaxed">
            Add the companies whose brands you stock. Your preferred brands will appear first when you process orders.
          </p>
        </div>

        {/* List */}
        {list.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] divide-y divide-slate-50 mb-4">
            {list.map(rel => (
              <div key={rel.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-[#6B3F1F]">{rel.manufacturer_name}</p>
                  {rel.manufacturer_client_id && (
                    <p className="text-xs text-emerald-600 mt-0.5">Registered company</p>
                  )}
                </div>
                <button onClick={() => remove(rel.id)}
                  className="text-xs text-[#D4682E] font-medium px-3 py-1.5 rounded-lg hover:bg-red-50">
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {list.length === 0 && !adding && (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] p-8 text-center">
            <p className="text-2xl mb-2">🏭</p>
            <p className="text-sm font-semibold text-[#6B3F1F]">No dealerships yet</p>
            <p className="text-xs text-[#7A8C7E] mt-1">Add companies whose products you sell</p>
          </div>
        )}

        {/* Add form */}
        {/* District Advisories Section */}
        <div className="mt-8 mb-4">
          <p className="text-sm font-bold text-[#6B3F1F]">Active Advisories in My District</p>
          <p className="text-xs text-[#7A8C7E] mt-0.5">What farmers in your area are being advised to buy</p>
        </div>
        {districtAdvisories.length === 0 ? (
          <div className="bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl px-4 py-5 text-center mb-4">
            <p className="text-xs text-[#7A8C7E]">No active advisories in your district yet.</p>
          </div>
        ) : (
          <div className="mb-4">
            {districtAdvisories.map(adv => (
              <div key={adv.package_id}
                className="bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl px-4 py-3 mb-2 flex items-center gap-3">
                <div className="rounded-full shrink-0"
                  style={{ width: 10, height: 10, background: adv.client_colour || '#6b7280' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#6B3F1F] truncate">{adv.client_name}</p>
                  <p className="text-xs text-[#7A8C7E] mt-0.5">
                    {formatCropName(adv.crop_cosh_id)} &middot; {adv.package_name}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {adding ? (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] p-5 space-y-3">
            <p className="text-sm font-semibold text-[#6B3F1F]">Add Company</p>
            <input value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()}
              placeholder="Company / manufacturer name"
              className="w-full border border-[#DDD0B8] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#085041]/20" />
            <div className="flex gap-2">
              <button onClick={add} disabled={saving || !newName.trim()}
                className="flex-1 py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #054a3a, #085041)' }}>
                {saving ? 'Adding…' : 'Add'}
              </button>
              <button onClick={() => { setAdding(false); setNewName('') }}
                className="px-5 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)}
            className="w-full py-4 rounded-2xl border-2 border-dashed border-[#DDD0B8] text-[#7A8C7E] text-sm font-medium hover:border-[#085041] hover:text-[#085041] transition-colors">
            + Add Company
          </button>
        )}
      </div>
    </div>
  )
}
