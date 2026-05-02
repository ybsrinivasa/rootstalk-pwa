'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

interface Person {
  user_id: string; name: string | null; phone: string | null; distance_km: number; is_promoter: boolean
  shop_name?: string | null; shop_address?: string | null; sell_categories?: string[]
}
interface Subscription {
  id: string; crop_start_date: string | null; client_id: string; package_id: string
}

export default function OrderingScreenPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()

  const practiceIdsParam = searchParams.get('practice_ids') || ''
  const orderType = searchParams.get('order_type') || 'PESTICIDE'
  const dateFrom = searchParams.get('date_from') || ''
  const dateTo = searchParams.get('date_to') || ''

  const practiceIds = practiceIdsParam ? practiceIdsParam.split(',').filter(Boolean) : []

  const [tab, setTab] = useState<'dealers' | 'facilitators'>('dealers')
  const [dealers, setDealers] = useState<Person[]>([])
  const [facilitators, setFacilitators] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [placing, setPlacing] = useState<string | null>(null)
  const [customPhone, setCustomPhone] = useState('')
  const [sub, setSub] = useState<Subscription | null>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [subscriptionId])

  async function load() {
    try {
      const [subsRes, dealerRes, facRes] = await Promise.allSettled([
        api.get<Subscription[]>('/farmer/my-subscriptions'),
        api.get<Person[]>(`/farmer/subscriptions/${subscriptionId}/nearby-dealers?order_type=${orderType}`),
        api.get<Person[]>(`/farmer/subscriptions/${subscriptionId}/nearby-facilitators`),
      ])
      if (subsRes.status === 'fulfilled') setSub(subsRes.value.data.find(s => s.id === subscriptionId) || null)
      if (dealerRes.status === 'fulfilled') setDealers(dealerRes.value.data)
      if (facRes.status === 'fulfilled') setFacilitators(facRes.value.data)
    } finally { setLoading(false) }
  }

  async function sendOrder(person: Person, isDealer: boolean) {
    if (practiceIds.length === 0) {
      router.replace(`/orders`)
      return
    }
    setPlacing(person.user_id)
    try {
      const payload: Record<string, unknown> = {
        subscription_id: subscriptionId,
        client_id: sub?.client_id,
        practice_ids: practiceIds,
        date_from: dateFrom || new Date().toISOString(),
        date_to: dateTo || new Date(Date.now() + 30 * 86400000).toISOString(),
      }
      if (isDealer) payload.dealer_user_id = person.user_id
      else payload.facilitator_user_id = person.user_id

      await api.post('/farmer/orders', payload)
      router.replace('/orders')
    } catch { setPlacing(null) }
  }

  const badgeColour = {
    PESTICIDE: 'bg-amber-100 text-amber-700',
    FERTILISER: 'bg-green-100 text-green-700',
    SEED: 'bg-indigo-100 text-indigo-700',
  }[orderType] || 'bg-slate-100 text-slate-600'

  function PersonCard({ person, isDealer }: { person: Person; isDealer: boolean }) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-bold text-slate-900">{(isDealer ? person.shop_name : null) || person.name || 'Unknown'}</p>
              {person.is_promoter && (
                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Your Promoter</span>
              )}
            </div>
            {isDealer && person.name && person.shop_name && (
              <p className="text-xs text-slate-400">{person.name}</p>
            )}
            <p className="text-xs text-slate-400 mt-0.5">{person.distance_km} km away</p>
            {isDealer && person.shop_address && (
              <p className="text-xs text-slate-400 truncate">{person.shop_address}</p>
            )}
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            {person.phone && (
              <a href={`tel:${person.phone}`}
                className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-center font-medium">
                📞 Call
              </a>
            )}
            <button onClick={() => sendOrder(person, isDealer)}
              disabled={placing === person.user_id}
              className="text-xs text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
              style={{ background: '#1A5C2A' }}>
              {placing === person.user_id ? '…' : 'Send Order'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PWAHeader title="Select Who Will Fulfil" activeRole="FARMER" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        {/* Order type badge + date range */}
        <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-4 flex items-center justify-between">
          <div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColour}`}>{orderType}</span>
            <p className="text-xs text-slate-400 mt-1">{practiceIds.length} item{practiceIds.length !== 1 ? 's' : ''} to order</p>
          </div>
          {(dateFrom || dateTo) && (
            <p className="text-xs text-slate-500">
              {dateFrom && new Date(dateFrom).toLocaleDateString()} {dateTo && `— ${new Date(dateTo).toLocaleDateString()}`}
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex bg-white rounded-2xl border border-slate-100 mt-3 p-1">
          {(['dealers', 'facilitators'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-sm font-medium rounded-xl capitalize transition-all ${tab === t ? 'bg-green-700 text-white shadow-sm' : 'text-slate-400'}`}>
              {t === 'dealers' ? `Dealers (${dealers.length})` : `Facilitators (${facilitators.length})`}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="mt-3 space-y-3">
          {loading ? (
            [1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-2xl animate-pulse" />)
          ) : (tab === 'dealers' ? dealers : facilitators).length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-3">{tab === 'dealers' ? '🏪' : '🌾'}</p>
              <p className="text-slate-500 font-medium">No {tab} found nearby</p>
              <p className="text-xs text-slate-400 mt-1">Try entering a phone number below</p>
            </div>
          ) : (
            (tab === 'dealers' ? dealers : facilitators).map(person => (
              <PersonCard key={person.user_id} person={person} isDealer={tab === 'dealers'} />
            ))
          )}
        </div>

        {/* Custom phone entry */}
        {!loading && (
          <div className="mt-4 bg-white rounded-2xl border border-slate-100 p-4">
            <p className="text-xs font-semibold text-slate-500 mb-2">Or enter a phone number</p>
            <div className="flex gap-2">
              <input value={customPhone} onChange={e => setCustomPhone(e.target.value)}
                placeholder="+91 XXXXX XXXXX"
                type="tel"
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none" />
              <button
                onClick={() => customPhone.trim() && alert('Custom phone routing coming soon')}
                className="px-4 py-2 rounded-xl text-white text-sm font-semibold bg-slate-400">
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
