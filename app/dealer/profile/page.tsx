'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

const SELL_CATEGORIES = [
  { id: 'SEEDS', label: 'Seeds / Seedlings', licence: false, note: 'No licence required' },
  { id: 'PESTICIDES', label: 'Pesticides', licence: true, note: 'Pesticide licence required' },
  { id: 'FERTILISERS', label: 'Fertilisers', licence: true, note: 'Fertiliser licence required' },
]

export default function DealerProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<any>(null)
  const [form, setForm] = useState({
    shop_name: '', shop_address: '',
    sell_categories: [] as string[],
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get('/dealer/profile').then(r => {
      setProfile(r.data)
      setForm({
        shop_name: r.data.shop_name || '',
        shop_address: r.data.shop_address || '',
        sell_categories: r.data.sell_categories || [],
      })
    }).catch(() => {})
  }, [])

  function toggleCategory(id: string) {
    setForm(f => ({
      ...f,
      sell_categories: f.sell_categories.includes(id)
        ? f.sell_categories.filter(c => c !== id)
        : [...f.sell_categories, id],
    }))
  }

  async function save() {
    if (!form.shop_name.trim()) return
    if (form.sell_categories.length === 0) return
    setSaving(true)
    try {
      await api.put('/dealer/profile', form)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Dealer Profile" activeRole="DEALER" />
      <div className="pt-16 pb-24 px-4 space-y-5 max-w-lg mx-auto">
        <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Shop Details</h2>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Shop Name *</label>
            <input value={form.shop_name}
              onChange={e => setForm(f => ({ ...f, shop_name: e.target.value }))}
              placeholder="Your shop name"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#085041]/20" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Shop Address</label>
            <textarea value={form.shop_address}
              onChange={e => setForm(f => ({ ...f, shop_address: e.target.value }))}
              rows={2} placeholder="Full address"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#085041]/20 resize-none" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
          <div>
            <h2 className="font-semibold text-slate-800">What Do You Sell? *</h2>
            <p className="text-xs text-slate-400 mt-0.5">Select all that apply. Orders are routed based on your selection.</p>
          </div>
          {SELL_CATEGORIES.map(cat => {
            const selected = form.sell_categories.includes(cat.id)
            return (
              <button key={cat.id}
                onClick={() => toggleCategory(cat.id)}
                className={`w-full flex items-center justify-between p-4 rounded-xl border-2 text-left transition-all ${
                  selected ? 'border-[#085041] bg-[#085041]/5' : 'border-slate-200 bg-white'
                }`}>
                <div>
                  <p className={`text-sm font-semibold ${selected ? 'text-[#085041]' : 'text-slate-700'}`}>
                    {cat.label}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{cat.note}</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  selected ? 'border-[#085041] bg-[#085041]' : 'border-slate-300'
                }`}>
                  {selected && <span className="text-white text-xs font-bold">✓</span>}
                </div>
              </button>
            )
          })}
        </div>

        <button onClick={save} disabled={saving || !form.shop_name.trim() || form.sell_categories.length === 0}
          className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-40 transition-opacity"
          style={{ background: 'linear-gradient(135deg, #054a3a, #085041)' }}>
          {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Profile'}
        </button>
      </div>
    </div>
  )
}
