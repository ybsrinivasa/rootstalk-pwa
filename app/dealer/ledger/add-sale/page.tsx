'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'


interface CoshLocations {
  states: { cosh_id: string; name: string | null;
            districts: { cosh_id: string; name: string | null }[] }[]
}

interface PhoneLookupResponse {
  found: boolean
  user_id?: string
  name?: string | null
  phone?: string | null
  photo_url?: string | null
  state_cosh_id?: string | null
  district_cosh_id?: string | null
  sub_district?: string | null
  state_name?: string | null
  district_name?: string | null
}

interface FarmerDetail {
  user_id: string
  name: string | null
  phone: string | null
  photo_url: string | null
  state_name?: string | null
  district_name?: string | null
  sub_district?: string | null
}

const COLOUR = '#7D4196'
const CATEGORIES = ['SEED', 'PESTICIDE', 'FERTILIZER'] as const
type Category = typeof CATEGORIES[number]
const MAX_ITEMS = 20

function normalisePhoneInput(raw: string): string {
  return raw.replace(/[^\d+]/g, '')
}

// Client-side draft — one per item card in the multi-item list.
interface ItemDraft {
  key: string  // React key
  category: Category
  productName: string
  brand: string
  manufacturer: string
  qty: string
  unit: string
  price: string
  notes: string
}

function blankItem(): ItemDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category: 'PESTICIDE',
    productName: '',
    brand: '',
    manufacturer: '',
    qty: '',
    unit: '',
    price: '',
    notes: '',
  }
}

function itemValid(i: ItemDraft): boolean {
  return !!i.productName.trim() && !!i.qty.trim() && !!i.unit.trim()
}


export default function DealerLedgerAddSalePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F5F0E8]" />}>
      <AddSaleInner />
    </Suspense>
  )
}


function AddSaleInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedFarmerId = searchParams.get('farmer_user_id')
  const t = useTranslations('dealer.ledger')

  // Farmer selection state — same as v1.
  const [phone, setPhone] = useState('')
  const [lookupState, setLookupState] = useState<'idle' | 'looking' | 'found' | 'new'>('idle')
  const [existingUser, setExistingUser] = useState<PhoneLookupResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // New-farmer fields.
  const [farmerName, setFarmerName] = useState('')
  const [coshLocations, setCoshLocations] = useState<CoshLocations | null>(null)
  const [stateId, setStateId] = useState('')
  const [districtId, setDistrictId] = useState('')
  const [subDistrict, setSubDistrict] = useState('')

  // Shared sale_date + multi-item list.
  const [saleDate, setSaleDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [items, setItems] = useState<ItemDraft[]>([blankItem()])
  const [saving, setSaving] = useState(false)

  // Preselect path: dealer came from farmer's ledger page with
  // ?farmer_user_id=<id>. Fetch farmer info + skip phone lookup.
  const preselectFarmer = useCallback(async (id: string) => {
    try {
      const r = await api.get<FarmerDetail>(`/dealer/ledger/farmers/${id}`)
      setExistingUser({
        found: true,
        user_id: r.data.user_id,
        name: r.data.name,
        phone: r.data.phone,
        photo_url: r.data.photo_url,
        state_name: r.data.state_name,
        district_name: r.data.district_name,
        sub_district: r.data.sub_district,
      })
      setPhone(r.data.phone || '')
      setLookupState('found')
    } catch {
      setError(t('lookupFailed'))
    }
  }, [t])

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<CoshLocations>('/cosh/locations/india').then(r => setCoshLocations(r.data)).catch(() => {})
    if (preselectedFarmerId) preselectFarmer(preselectedFarmerId)
  }, [router, preselectedFarmerId, preselectFarmer])

  const districts = coshLocations?.states.find(s => s.cosh_id === stateId)?.districts || []

  const doLookup = async () => {
    setError(null)
    if (phone.replace(/\D/g, '').length < 10) {
      setError(t('phoneInvalidHint')); return
    }
    setLookupState('looking')
    try {
      const r = await api.post<PhoneLookupResponse>('/dealer/ledger/lookup-phone', { phone })
      if (r.data.found) {
        setExistingUser(r.data); setLookupState('found')
      } else {
        setExistingUser(null); setLookupState('new')
      }
    } catch {
      setLookupState('idle'); setError(t('lookupFailed'))
    }
  }

  // Fires on every phone keystroke — invalidates the previous lookup
  // result so the user has to tap Lookup again after editing. Does
  // NOT clear the phone itself (that's what the user is typing into).
  const invalidateLookup = () => {
    setLookupState('idle'); setExistingUser(null); setError(null)
    setFarmerName(''); setStateId(''); setDistrictId(''); setSubDistrict('')
  }

  // Full reset — called only from the explicit Change / Change farmer
  // buttons. Also drops the ?farmer_user_id= query param when the
  // dealer arrived via the farmer-scoped entry point.
  const changeFarmer = () => {
    if (preselectedFarmerId) {
      router.replace('/dealer/ledger/add-sale')
    }
    invalidateLookup()
    setPhone('')
  }

  const farmerReady = lookupState === 'found' || lookupState === 'new'
  const validItems = items.every(itemValid)
  const canSubmit = () => {
    if (!farmerReady || !saleDate) return false
    if (lookupState === 'new'
      && (!farmerName.trim() || !stateId || !districtId)) return false
    if (lookupState === 'found' && !existingUser?.user_id) return false
    if (items.length === 0 || !validItems) return false
    return true
  }

  const addItem = () => {
    if (items.length >= MAX_ITEMS) return
    setItems(prev => [...prev, blankItem()])
  }
  const removeItem = (key: string) => {
    setItems(prev => prev.length <= 1 ? prev : prev.filter(i => i.key !== key))
  }
  const patchItem = (key: string, patch: Partial<ItemDraft>) => {
    setItems(prev => prev.map(i => i.key === key ? { ...i, ...patch } : i))
  }

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      const body: Record<string, unknown> = {
        sale_date: saleDate,
        sales: items.map(i => ({
          category: i.category,
          product_name: i.productName.trim(),
          brand: i.brand.trim() || undefined,
          manufacturer: i.manufacturer.trim() || undefined,
          qty: parseFloat(i.qty),
          unit: i.unit.trim(),
          price: i.price.trim() ? parseFloat(i.price) : undefined,
          notes: i.notes.trim() || undefined,
        })),
      }
      if (lookupState === 'found' && existingUser?.user_id) {
        body.farmer_user_id = existingUser.user_id
      } else if (lookupState === 'new') {
        body.new_farmer = {
          phone,
          name: farmerName.trim(),
          state_cosh_id: stateId,
          district_cosh_id: districtId,
          sub_district: subDistrict.trim() || undefined,
        }
      }
      const r = await api.post<{ farmer_user_id: string; sale_ids: string[] }>(
        '/dealer/ledger/manual-sales-batch', body,
      )
      router.replace(`/dealer/ledger/${r.data.farmer_user_id}`)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: { message?: string; code?: string } | string } } })
        ?.response?.data?.detail
      const msg = typeof detail === 'object'
        ? (detail?.message || detail?.code)
        : (detail as string)
      setError(msg || t('saveFailed'))
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('addSaleHeaderTitle')} activeRole="DEALER"
        back={preselectedFarmerId ? `/dealer/ledger/${preselectedFarmerId}` : '/dealer/ledger'} />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto space-y-3">

        {/* Step 1: phone (skipped when preselect via query param) */}
        {!preselectedFarmerId && (
          <div className="mt-4 bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm">
            <p className="text-sm font-semibold text-[#6B3F1F] mb-2">{t('step1PhoneLabel')}</p>
            <div className="flex gap-2">
              <input
                type="tel" inputMode="tel"
                value={phone}
                onChange={e => { setPhone(normalisePhoneInput(e.target.value)); invalidateLookup() }}
                placeholder="+91 98xxxxxxxx"
                disabled={lookupState === 'found' || lookupState === 'new'}
                className="flex-1 px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm focus:outline-none focus:border-[#7D4196] disabled:bg-[#F5F0E8]" />
              {(lookupState === 'idle' || lookupState === 'looking') && (
                <button onClick={doLookup} disabled={lookupState === 'looking'}
                  className="px-4 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50"
                  style={{ background: COLOUR }}>
                  {lookupState === 'looking' ? t('looking') : t('lookup')}
                </button>
              )}
              {(lookupState === 'found' || lookupState === 'new') && (
                <button onClick={changeFarmer}
                  className="px-4 py-2 rounded-xl border border-[#DDD0B8] text-sm text-[#6B3F1F]">
                  {t('change')}
                </button>
              )}
            </div>
            {error && !farmerReady && <p className="text-xs text-red-600 mt-2">{error}</p>}
          </div>
        )}

        {/* Farmer card — appears once we have a farmer (either lookup or preselect) */}
        {lookupState === 'found' && existingUser && (
          <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-1">
                {preselectedFarmerId ? t('recordingSaleFor') : t('existingFarmer')}
              </p>
              <p className="font-semibold text-[#6B3F1F]">{existingUser.name || t('unnamedFarmer')}</p>
              {existingUser.phone && (
                <p className="text-xs text-[#7A8C7E]">{existingUser.phone}</p>
              )}
              {(existingUser.state_name || existingUser.district_name || existingUser.sub_district) && (
                <p className="text-xs text-[#7A8C7E] mt-0.5">
                  {[existingUser.sub_district, existingUser.district_name, existingUser.state_name]
                    .filter(Boolean).join(', ')}
                </p>
              )}
            </div>
            <button onClick={changeFarmer}
              className="text-xs text-[#7D4196] font-medium flex-shrink-0">
              {t('changeFarmer')}
            </button>
          </div>
        )}

        {/* New-farmer form */}
        {lookupState === 'new' && (
          <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm space-y-3">
            <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">{t('newFarmerDetails')}</p>
            <div>
              <label className="text-xs text-[#7A8C7E]">{t('name')} *</label>
              <input value={farmerName} onChange={e => setFarmerName(e.target.value)}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5" />
            </div>
            <div>
              <label className="text-xs text-[#7A8C7E]">{t('state')} *</label>
              <select value={stateId}
                onChange={e => { setStateId(e.target.value); setDistrictId('') }}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5 bg-white">
                <option value="">{t('pickState')}</option>
                {(coshLocations?.states || []).map(s => (
                  <option key={s.cosh_id} value={s.cosh_id}>{s.name || s.cosh_id}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#7A8C7E]">{t('district')} *</label>
              <select value={districtId} onChange={e => setDistrictId(e.target.value)}
                disabled={!stateId}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5 bg-white disabled:bg-[#F5F0E8]">
                <option value="">{t('pickDistrict')}</option>
                {districts.map(d => (
                  <option key={d.cosh_id} value={d.cosh_id}>{d.name || d.cosh_id}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#7A8C7E]">{t('subDistrict')}</label>
              <input value={subDistrict} onChange={e => setSubDistrict(e.target.value)}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5" />
            </div>
          </div>
        )}

        {/* Item list — appears once farmer is ready */}
        {farmerReady && (
          <>
            {/* Shared sale_date at top of the items block */}
            <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm">
              <label className="text-xs text-[#7A8C7E] uppercase tracking-wide">{t('saleDate')} *</label>
              <input type="date" value={saleDate}
                onChange={e => setSaleDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-1" />
              <p className="text-[10px] text-[#7A8C7E] mt-1">{t('saleDateSharedHint')}</p>
            </div>

            {items.map((item, idx) => (
              <ItemCard
                key={item.key} item={item} index={idx}
                canRemove={items.length > 1}
                t={t}
                onPatch={patch => patchItem(item.key, patch)}
                onRemove={() => removeItem(item.key)} />
            ))}

            {/* + Add another item */}
            <button
              onClick={addItem}
              disabled={items.length >= MAX_ITEMS}
              className="w-full py-3 rounded-2xl border-2 border-dashed border-[#DDD0B8] text-sm font-medium text-[#7D4196] hover:bg-white/50 disabled:opacity-50">
              {items.length >= MAX_ITEMS
                ? t('itemCapReached', { max: MAX_ITEMS })
                : t('addAnotherItem')}
            </button>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <button
              onClick={submit}
              disabled={!canSubmit() || saving}
              className="w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
              style={{ background: COLOUR }}>
              {saving
                ? t('saving')
                : t('saveBatchButton', { count: items.length })}
            </button>
          </>
        )}
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
    </div>
  )
}


function ItemCard({
  item, index, canRemove, t, onPatch, onRemove,
}: {
  item: ItemDraft
  index: number
  canRemove: boolean
  t: ReturnType<typeof useTranslations>
  onPatch: (patch: Partial<ItemDraft>) => void
  onRemove: () => void
}) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">
          {t('itemNumberLabel', { n: index + 1 })}
        </p>
        {canRemove && (
          <button onClick={onRemove}
            className="text-xs text-red-600 font-medium">
            {t('removeItem')}
          </button>
        )}
      </div>
      <div>
        <label className="text-xs text-[#7A8C7E]">{t('categoryLabel')} *</label>
        <div className="mt-1 flex gap-2">
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => onPatch({ category: c })}
              className={`flex-1 py-2 rounded-xl text-sm font-medium ${
                item.category === c
                  ? 'bg-[#7D4196] text-white'
                  : 'bg-[#F5F0E8] text-[#6B3F1F]'
              }`}>
              {t(`category.${c.toLowerCase()}`)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-[#7A8C7E]">{t('productName')} *</label>
        <input value={item.productName} onChange={e => onPatch({ productName: e.target.value })}
          className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-[#7A8C7E]">{t('brand')}</label>
          <input value={item.brand} onChange={e => onPatch({ brand: e.target.value })}
            className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5" />
        </div>
        <div>
          <label className="text-xs text-[#7A8C7E]">{t('manufacturer')}</label>
          <input value={item.manufacturer} onChange={e => onPatch({ manufacturer: e.target.value })}
            className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs text-[#7A8C7E]">{t('qty')} *</label>
          <input type="number" inputMode="decimal"
            value={item.qty} onChange={e => onPatch({ qty: e.target.value })}
            className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5" />
        </div>
        <div>
          <label className="text-xs text-[#7A8C7E]">{t('unit')} *</label>
          <input value={item.unit} onChange={e => onPatch({ unit: e.target.value })}
            placeholder="kg / L / packet"
            className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5" />
        </div>
        <div>
          <label className="text-xs text-[#7A8C7E]">{t('price')} (₹)</label>
          <input type="number" inputMode="decimal"
            value={item.price} onChange={e => onPatch({ price: e.target.value })}
            className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5" />
        </div>
      </div>
      <div>
        <label className="text-xs text-[#7A8C7E]">{t('notes')}</label>
        <textarea value={item.notes} onChange={e => onPatch({ notes: e.target.value })}
          rows={2}
          className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5" />
      </div>
    </div>
  )
}
