'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import PhoneVerify from '@/components/PhoneVerify'
import ClientCropChip from '@/components/ClientCropChip'
import api from '@/lib/api'

interface Person {
  user_id: string; name: string | null; phone: string | null; distance_km: number; is_promoter: boolean
  shop_name?: string | null; shop_address?: string | null; sell_categories?: string[]
}
interface Subscription {
  id: string; crop_start_date: string | null; client_id: string; package_id: string
  farm_area_acres: number | null
  area_unit: string | null
  farm_area_confirmed_at: string | null
}

// All formulas calibrated for acres — see crop-detail/page.tsx
// for the rationale. No unit picker; farmer types acres only.

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
  // Orders V2 Batch 9 — locked-brand awareness on the new-order
  // picker. Server returns a banner string if any of the bundled
  // practices is brand-locked; we render it and hide the
  // facilitators tab (locked-brand can't be routed via facilitator).
  const [lockedBrandExplainer, setLockedBrandExplainer] = useState<string | null>(null)

  // Hard-confirm acreage step (only when farm_area_confirmed_at is null)
  const [confirmStep, setConfirmStep] = useState<{ person: Person; isDealer: boolean } | null>(null)
  const [confirmAreaInput, setConfirmAreaInput] = useState('')
  const [editingArea, setEditingArea] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [subscriptionId])

  async function load() {
    try {
      // Batch 9 — one server-filtered endpoint replaces the two
      // nearby-* calls. The server applies licence-category AND
      // locked-brand filtering, identical to the cancel→re-send
      // picker on /orders/[id]. Inconsistency was a real gap.
      const pidsParam = practiceIds.length ? `&practice_ids=${encodeURIComponent(practiceIds.join(','))}` : ''
      const [subsRes, eligibleRes] = await Promise.allSettled([
        api.get<Subscription[]>('/farmer/my-subscriptions'),
        api.get<{
          dealers: Person[]
          facilitators: Person[]
          has_locked_brand: boolean
          locked_brand_explainer: string | null
        }>(
          `/farmer/subscriptions/${subscriptionId}/eligible-recipients-for-new-order`
          + `?category=${encodeURIComponent(orderType)}${pidsParam}`,
        ),
      ])
      if (subsRes.status === 'fulfilled') setSub(subsRes.value.data.find(s => s.id === subscriptionId) || null)
      if (eligibleRes.status === 'fulfilled') {
        setDealers(eligibleRes.value.data.dealers || [])
        setFacilitators(eligibleRes.value.data.facilitators || [])
        setLockedBrandExplainer(eligibleRes.value.data.locked_brand_explainer)
        // Force the dealers tab when only dealers are eligible.
        if (eligibleRes.value.data.has_locked_brand) setTab('dealers')
      }
    } finally { setLoading(false) }
  }

  function startSendOrder(person: Person, isDealer: boolean) {
    if (practiceIds.length === 0) {
      router.replace(`/orders`)
      return
    }
    // If acreage not yet hard-locked, force a confirmation step.
    if (sub && !sub.farm_area_confirmed_at) {
      setConfirmAreaInput(sub.farm_area_acres != null ? String(sub.farm_area_acres) : '')
      setEditingArea(sub.farm_area_acres == null)
      setErrorMsg(null)
      setConfirmStep({ person, isDealer })
      return
    }
    void executeSendOrder(person, isDealer)
  }

  async function executeSendOrder(person: Person, isDealer: boolean, acreage?: { acres: number; unit: string }) {
    setPlacing(person.user_id)
    setErrorMsg(null)
    try {
      const payload: Record<string, unknown> = {
        subscription_id: subscriptionId,
        client_id: sub?.client_id,
        practice_ids: practiceIds,
        // Batch 9 — pass category so the server doesn't have to
        // re-derive from practices, and so Order.category lands set.
        category: orderType,
        date_from: dateFrom || new Date().toISOString(),
        date_to: dateTo || new Date(Date.now() + 30 * 86400000).toISOString(),
      }
      if (isDealer) payload.dealer_user_id = person.user_id
      else payload.facilitator_user_id = person.user_id
      if (acreage) {
        payload.farm_area_acres = acreage.acres
        payload.area_unit = acreage.unit
      }

      await api.post('/farmer/orders', payload)
      setConfirmStep(null)
      router.replace('/orders')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setErrorMsg(err.response?.data?.detail || 'Could not send order')
      setPlacing(null)
    }
  }

  async function confirmAndSend() {
    if (!confirmStep) return
    // Acreage is required because confirmStep only opens when not yet locked
    const valStr = confirmAreaInput.trim()
    if (!valStr || isNaN(parseFloat(valStr)) || parseFloat(valStr) <= 0) {
      setErrorMsg('Enter a valid farm area')
      return
    }
    await executeSendOrder(confirmStep.person, confirmStep.isDealer, {
      acres: parseFloat(valStr),
      unit: 'acres',
    })
  }

  const badgeColour = {
    PESTICIDE: 'bg-amber-100 text-amber-700',
    FERTILISER: 'bg-green-100 text-green-700',
    SEED: 'bg-indigo-100 text-indigo-700',
  }[orderType] || 'bg-slate-100 text-[#6B3F1F]'

  function PersonCard({ person, isDealer }: { person: Person; isDealer: boolean }) {
    return (
      <div className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-bold text-[#6B3F1F]">{(isDealer ? person.shop_name : null) || person.name || 'Unknown'}</p>
              {person.is_promoter && (
                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Your Promoter</span>
              )}
            </div>
            {isDealer && person.name && person.shop_name && (
              <p className="text-xs text-[#7A8C7E]">{person.name}</p>
            )}
            <p className="text-xs text-[#7A8C7E] mt-0.5">{person.distance_km} km away</p>
            {isDealer && person.shop_address && (
              <p className="text-xs text-[#7A8C7E] truncate">{person.shop_address}</p>
            )}
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            {person.phone && (
              <a href={`tel:${person.phone}`}
                className="text-xs bg-slate-100 text-[#6B3F1F] px-3 py-1.5 rounded-lg text-center font-medium">
                📞 Call
              </a>
            )}
            <button onClick={() => startSendOrder(person, isDealer)}
              disabled={placing === person.user_id}
              className="text-xs text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
              style={{ background: '#3A7D44' }}>
              {placing === person.user_id ? '…' : 'Send Order'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Select Who Will Fulfil" activeRole="FARMER" back />
      <div className="pt-16">
        <ClientCropChip subscriptionId={subscriptionId} />
      </div>
      <div className="pb-24 px-4 max-w-lg mx-auto">
        {/* Order type badge + date range */}
        <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-4 flex items-center justify-between">
          <div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColour}`}>{orderType}</span>
            <p className="text-xs text-[#7A8C7E] mt-1">{practiceIds.length} item{practiceIds.length !== 1 ? 's' : ''} to order</p>
          </div>
          {(dateFrom || dateTo) && (
            <p className="text-xs text-[#7A8C7E]">
              {dateFrom && new Date(dateFrom).toLocaleDateString()} {dateTo && `— ${new Date(dateTo).toLocaleDateString()}`}
            </p>
          )}
        </div>

        {/* Batch 9 — locked-brand explainer, same surface as the
            cancel→re-send picker so the farmer's mental model stays
            consistent across both entry points. */}
        {lockedBrandExplainer && (
          <div className="mt-3 bg-purple-50 border border-purple-200 rounded-xl px-3 py-2.5 text-xs text-purple-800 leading-relaxed">
            <p className="font-semibold mb-0.5">Brand-locked order</p>
            <p>{lockedBrandExplainer}</p>
          </div>
        )}

        {/* Tabs — hide the facilitators tab when locked-brand is on. */}
        <div className="flex bg-white rounded-2xl border border-[#DDD0B8] mt-3 p-1">
          {(['dealers', 'facilitators'] as const).map(t => {
            if (t === 'facilitators' && lockedBrandExplainer) return null
            return (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-sm font-medium rounded-xl capitalize transition-all ${tab === t ? 'bg-green-700 text-white shadow-sm' : 'text-[#7A8C7E]'}`}>
                {t === 'dealers' ? `Dealers (${dealers.length})` : `Facilitators (${facilitators.length})`}
              </button>
            )
          })}
        </div>

        {/* List */}
        <div className="mt-3 space-y-3">
          {loading ? (
            [1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-2xl animate-pulse" />)
          ) : (tab === 'dealers' ? dealers : facilitators).length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-3">{tab === 'dealers' ? '🏪' : '🌾'}</p>
              <p className="text-[#7A8C7E] font-medium">No {tab} found nearby</p>
              <p className="text-xs text-[#7A8C7E] mt-1">Try entering a phone number below</p>
            </div>
          ) : (
            (tab === 'dealers' ? dealers : facilitators).map(person => (
              <PersonCard key={person.user_id} person={person} isDealer={tab === 'dealers'} />
            ))
          )}
        </div>

        {/* Custom phone entry */}
        {!loading && (
          <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] p-4">
            <p className="text-xs font-semibold text-[#7A8C7E] mb-2">Or enter a phone number</p>
            <div className="flex gap-2">
              <input value={customPhone} onChange={e => setCustomPhone(e.target.value)}
                placeholder="+91 XXXXX XXXXX"
                type="tel"
                className="flex-1 border border-[#DDD0B8] rounded-xl px-3 py-2.5 text-sm focus:outline-none" />
              <button
                onClick={() => customPhone.trim() && alert('Custom phone routing coming soon')}
                className="px-4 py-2 rounded-xl text-white text-sm font-semibold bg-slate-400">
                Send
              </button>
            </div>
            <PhoneVerify phone={customPhone} />
          </div>
        )}
      </div>

      {/* Hard-confirm acreage step (shown only when farm_area_confirmed_at is null) */}
      {confirmStep && sub && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end" onClick={() => placing == null && setConfirmStep(null)}>
          <div className="bg-white w-full rounded-t-3xl p-5 max-w-lg mx-auto" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F] text-base">Confirm your farm area</p>

            {sub.farm_area_acres != null && !editingArea ? (
              <p className="text-sm text-[#6B3F1F] mt-3">
                <span className="font-semibold">{sub.farm_area_acres} acres</span>{' '}
                <button
                  onClick={() => setEditingArea(true)}
                  className="ml-1 text-xs underline text-green-700"
                >Change</button>
              </p>
            ) : (
              <div className="flex gap-2 mt-3">
                <input
                  type="number" inputMode="decimal" step="0.01" min="0"
                  value={confirmAreaInput}
                  onChange={e => setConfirmAreaInput(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 min-w-0 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]"
                />
                <span className="flex items-center px-3 py-2 text-sm text-[#6B3F1F] bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl shrink-0">
                  acres
                </span>
              </div>
            )}

            <div className="mt-4 bg-orange-50 border border-orange-200 rounded-xl px-3 py-3">
              <p className="text-orange-800 text-xs leading-relaxed">
                <span className="font-bold">This is your final confirmation.</span>{' '}
                Volumes for ALL your future orders will be calculated on this.{' '}
                <span className="font-bold">It cannot be changed afterwards.</span>
              </p>
            </div>

            {errorMsg && (
              <p className="text-xs text-[#D4682E] mt-3">{errorMsg}</p>
            )}

            <div className="grid grid-cols-2 gap-3 mt-5">
              <button
                onClick={() => { setConfirmStep(null); setErrorMsg(null) }}
                disabled={placing != null}
                className="py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-semibold disabled:opacity-40"
              >Cancel</button>
              <button
                onClick={confirmAndSend}
                disabled={placing != null}
                className="py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                style={{ background: '#3A7D44' }}
              >{placing != null ? 'Sending…' : 'Confirm and send order'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
