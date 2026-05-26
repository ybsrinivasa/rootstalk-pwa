'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

type Category = 'PESTICIDE' | 'FERTILIZER'

interface CatalogEntry { cosh_id: string; name: string }
interface Selected {
  id: string
  manufacturer_name: string
  manufacturer_cosh_id: string | null
  category: Category | null
}

const COLOUR = '#085041'

const CATEGORY_LABEL: Record<Category, string> = {
  PESTICIDE: 'Pesticide Dealerships',
  FERTILIZER: 'Fertilizer Dealerships',
}

const CATEGORY_NOTE: Record<Category, string> = {
  PESTICIDE: 'Pesticides + Special Inputs (adjuvants)',
  FERTILIZER: 'Fertilizers + manures + soil amendments + biofertilizers',
}

export default function MyDealershipsPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Category>('PESTICIDE')

  // Per-category state. We cache both tabs' data so switching tabs
  // doesn't refetch unnecessarily — these are big lists.
  const [catalog, setCatalog] = useState<Record<Category, CatalogEntry[]>>({
    PESTICIDE: [], FERTILIZER: [],
  })
  const [selected, setSelected] = useState<Record<Category, Selected[]>>({
    PESTICIDE: [], FERTILIZER: [],
  })
  const [loading, setLoading] = useState<Record<Category, boolean>>({
    PESTICIDE: true, FERTILIZER: true,
  })
  const [search, setSearch] = useState('')
  const [busyCoshId, setBusyCoshId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadTab(cat: Category) {
    setLoading(l => ({ ...l, [cat]: true }))
    try {
      const [catRes, selRes] = await Promise.allSettled([
        api.get<CatalogEntry[]>(`/dealer/manufacturers-catalog?category=${cat}`),
        api.get<Selected[]>(`/dealer/dealerships?category=${cat}`),
      ])
      if (catRes.status === 'fulfilled') {
        setCatalog(c => ({ ...c, [cat]: catRes.value.data }))
      }
      if (selRes.status === 'fulfilled') {
        setSelected(s => ({ ...s, [cat]: selRes.value.data }))
      }
    } finally {
      setLoading(l => ({ ...l, [cat]: false }))
    }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    loadTab('PESTICIDE')
    loadTab('FERTILIZER')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset search when switching tabs — the term that filtered the
  // last list almost never makes sense on the new one.
  useEffect(() => { setSearch('') }, [tab])

  async function addManufacturer(entry: CatalogEntry) {
    setBusyCoshId(entry.cosh_id); setError(null)
    try {
      await api.post('/dealer/dealerships', {
        manufacturer_name: entry.name,
        manufacturer_cosh_id: entry.cosh_id,
        category: tab,
      })
      await loadTab(tab)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Could not add. Try again.')
    } finally { setBusyCoshId(null) }
  }

  async function removeManufacturer(s: Selected) {
    setBusyCoshId(s.manufacturer_cosh_id || s.id); setError(null)
    try {
      await api.delete(`/dealer/dealerships/${s.id}`)
      await loadTab(tab)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Could not remove. Try again.')
    } finally { setBusyCoshId(null) }
  }

  const selectedCoshIds = useMemo(
    () => new Set(selected[tab].map(s => s.manufacturer_cosh_id).filter(Boolean) as string[]),
    [selected, tab],
  )

  const unselectedFiltered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return catalog[tab]
      .filter(c => !selectedCoshIds.has(c.cosh_id))
      .filter(c => !term || c.name.toLowerCase().includes(term))
  }, [catalog, tab, selectedCoshIds, search])

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader activeRole="DEALER" back="/dealer/home" />
      <div className="pt-20 pb-24 px-4 max-w-lg mx-auto">
        <div className="mt-2 mb-4">
          <h1 className="text-xl font-bold text-[#6B3F1F]">My Dealerships</h1>
          <p className="text-xs text-[#7A8C7E] mt-1 leading-relaxed">
            Pick the manufacturers you have a dealership contract with. The same manufacturer may appear in both tabs — you can pick them once per category. You can add and remove any time; nobody verifies these.
          </p>
        </div>

        {/* Category tabs */}
        <div className="flex bg-white rounded-2xl border border-[#DDD0B8] p-1 mb-4">
          {(['PESTICIDE', 'FERTILIZER'] as Category[]).map(c => (
            <button key={c} onClick={() => setTab(c)}
              className={`flex-1 py-2.5 text-xs font-semibold rounded-xl transition-colors ${
                tab === c ? 'text-white' : 'text-[#7A8C7E]'
              }`}
              style={{ background: tab === c ? COLOUR : 'transparent' }}>
              {c === 'PESTICIDE' ? 'Pesticide' : 'Fertilizer'}
              <span className="ml-1 opacity-70 text-[10px] font-normal">
                ({selected[c].length})
              </span>
            </button>
          ))}
        </div>

        <p className="text-xs text-[#7A8C7E] mb-3 px-1">{CATEGORY_NOTE[tab]}</p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs text-red-700 mb-3">
            {error}
          </div>
        )}

        {/* Selected — shown first, always visible, removable */}
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#7A8C7E] mb-2 px-1">
            Your selected ({selected[tab].length})
          </p>
          {selected[tab].length === 0 ? (
            <div className="bg-white border border-[#DDD0B8] rounded-2xl px-4 py-5 text-center">
              <p className="text-xs text-[#7A8C7E]">
                No {tab === 'PESTICIDE' ? 'pesticide' : 'fertilizer'} dealerships yet. Pick from the list below.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selected[tab].map(s => (
                <button key={s.id}
                  onClick={() => removeManufacturer(s)}
                  disabled={busyCoshId === (s.manufacturer_cosh_id || s.id)}
                  className="inline-flex items-center gap-1.5 bg-[#085041]/10 border border-[#085041]/30 text-[#085041] rounded-full pl-3 pr-2 py-1.5 text-xs font-medium disabled:opacity-50">
                  <span>{s.manufacturer_name}</span>
                  <span className="w-4 h-4 rounded-full bg-[#085041] text-white flex items-center justify-center text-[10px] leading-none">×</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Add more */}
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#7A8C7E] mb-2 px-1">
          Add to your list
        </p>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search manufacturer…"
          className="w-full border border-[#DDD0B8] rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#085041]/20 mb-3"
        />

        {loading[tab] ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-6 h-6 border-2 border-[#DDD0B8] border-t-[#085041] rounded-full animate-spin" />
          </div>
        ) : unselectedFiltered.length === 0 ? (
          <div className="bg-white border border-[#DDD0B8] rounded-2xl px-4 py-6 text-center">
            <p className="text-xs text-[#7A8C7E]">
              {search
                ? 'No manufacturers match that search.'
                : 'Every manufacturer in this category is already in your list.'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] divide-y divide-[#DDD0B8]/60 overflow-hidden">
            {unselectedFiltered.map(c => (
              <button key={c.cosh_id}
                onClick={() => addManufacturer(c)}
                disabled={busyCoshId === c.cosh_id}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#F5F0E8]/60 disabled:opacity-50">
                <span className="text-sm text-[#6B3F1F]">{c.name}</span>
                <span className="text-xs font-semibold text-[#085041] shrink-0 ml-3">
                  {busyCoshId === c.cosh_id ? 'Adding…' : '+ Add'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
