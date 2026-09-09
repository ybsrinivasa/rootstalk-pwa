'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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

const COLOUR = '#7D4196'
const CATEGORIES = ['SEED', 'PESTICIDE', 'FERTILIZER'] as const
type Category = typeof CATEGORIES[number]

function normalisePhoneInput(raw: string): string {
  return raw.replace(/[^\d+]/g, '')
}

export default function DealerLedgerAddSalePage() {
  const router = useRouter()
  const t = useTranslations('dealer.ledger')
  const [phone, setPhone] = useState('')
  const [lookupState, setLookupState] = useState<'idle' | 'looking' | 'found' | 'new'>('idle')
  const [existingUser, setExistingUser] = useState<PhoneLookupResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // New farmer fields (used when lookupState === 'new')
  const [farmerName, setFarmerName] = useState('')
  const [coshLocations, setCoshLocations] = useState<CoshLocations | null>(null)
  const [stateId, setStateId] = useState('')
  const [districtId, setDistrictId] = useState('')
  const [subDistrict, setSubDistrict] = useState('')

  // Sale fields
  const [category, setCategory] = useState<Category>('PESTICIDE')
  const [productName, setProductName] = useState('')
  const [brand, setBrand] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('')
  const [price, setPrice] = useState('')
  const [saleDate, setSaleDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<CoshLocations>('/cosh/locations/india').then(r => setCoshLocations(r.data)).catch(() => {})
  }, [router])

  const districts = coshLocations?.states.find(s => s.cosh_id === stateId)?.districts || []

  const doLookup = async () => {
    setError(null)
    if (phone.replace(/\D/g, '').length < 10) {
      setError(t('phoneInvalidHint'))
      return
    }
    setLookupState('looking')
    try {
      const r = await api.post<PhoneLookupResponse>('/dealer/ledger/lookup-phone', { phone })
      if (r.data.found) {
        setExistingUser(r.data)
        setLookupState('found')
      } else {
        setExistingUser(null)
        setLookupState('new')
      }
    } catch {
      setLookupState('idle')
      setError(t('lookupFailed'))
    }
  }

  const canSubmit = () => {
    if (!productName.trim() || !qty.trim() || !unit.trim() || !saleDate) return false
    if (lookupState === 'found') return !!existingUser?.user_id
    if (lookupState === 'new') {
      return !!farmerName.trim() && !!stateId && !!districtId
    }
    return false
  }

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        sale: {
          category,
          product_name: productName.trim(),
          brand: brand.trim() || undefined,
          manufacturer: manufacturer.trim() || undefined,
          qty: parseFloat(qty),
          unit: unit.trim(),
          price: price.trim() ? parseFloat(price) : undefined,
          sale_date: saleDate,
          notes: notes.trim() || undefined,
        },
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
      const r = await api.post<{ id: string; farmer_user_id: string }>('/dealer/ledger/manual-sale', body)
      router.replace(`/dealer/ledger/${r.data.farmer_user_id}`)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: { message?: string; code?: string } } } })
        ?.response?.data?.detail
      setError(detail?.message || detail?.code || t('saveFailed'))
      setSaving(false)
    }
  }

  const resetLookup = () => {
    setLookupState('idle')
    setExistingUser(null)
    setError(null)
    setFarmerName('')
    setStateId('')
    setDistrictId('')
    setSubDistrict('')
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('addSaleHeaderTitle')} activeRole="DEALER" back="/dealer/ledger" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto space-y-3">

        {/* Step 1: phone */}
        <div className="mt-4 bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm">
          <p className="text-sm font-semibold text-[#6B3F1F] mb-2">{t('step1PhoneLabel')}</p>
          <div className="flex gap-2">
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={e => { setPhone(normalisePhoneInput(e.target.value)); resetLookup() }}
              placeholder="+91 98xxxxxxxx"
              disabled={lookupState === 'found' || lookupState === 'new'}
              className="flex-1 px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm focus:outline-none focus:border-[#7D4196] disabled:bg-[#F5F0E8]"
            />
            {(lookupState === 'idle' || lookupState === 'looking') && (
              <button
                onClick={doLookup}
                disabled={lookupState === 'looking'}
                className="px-4 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50"
                style={{ background: COLOUR }}
              >
                {lookupState === 'looking' ? t('looking') : t('lookup')}
              </button>
            )}
            {(lookupState === 'found' || lookupState === 'new') && (
              <button
                onClick={resetLookup}
                className="px-4 py-2 rounded-xl border border-[#DDD0B8] text-sm text-[#6B3F1F]"
              >
                {t('change')}
              </button>
            )}
          </div>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>

        {/* Step 2a: existing farmer preview */}
        {lookupState === 'found' && existingUser && (
          <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm">
            <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-1">{t('existingFarmer')}</p>
            <p className="font-semibold text-[#6B3F1F]">{existingUser.name || t('unnamedFarmer')}</p>
            {(existingUser.state_name || existingUser.district_name || existingUser.sub_district) && (
              <p className="text-xs text-[#7A8C7E] mt-0.5">
                {[existingUser.sub_district, existingUser.district_name, existingUser.state_name]
                  .filter(Boolean).join(', ')}
              </p>
            )}
          </div>
        )}

        {/* Step 2b: new farmer form */}
        {lookupState === 'new' && (
          <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm space-y-3">
            <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">{t('newFarmerDetails')}</p>
            <div>
              <label className="text-xs text-[#7A8C7E]">{t('name')} *</label>
              <input
                value={farmerName}
                onChange={e => setFarmerName(e.target.value)}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5"
              />
            </div>
            <div>
              <label className="text-xs text-[#7A8C7E]">{t('state')} *</label>
              <select
                value={stateId}
                onChange={e => { setStateId(e.target.value); setDistrictId('') }}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5 bg-white"
              >
                <option value="">{t('pickState')}</option>
                {(coshLocations?.states || []).map(s => (
                  <option key={s.cosh_id} value={s.cosh_id}>{s.name || s.cosh_id}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#7A8C7E]">{t('district')} *</label>
              <select
                value={districtId}
                onChange={e => setDistrictId(e.target.value)}
                disabled={!stateId}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5 bg-white disabled:bg-[#F5F0E8]"
              >
                <option value="">{t('pickDistrict')}</option>
                {districts.map(d => (
                  <option key={d.cosh_id} value={d.cosh_id}>{d.name || d.cosh_id}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#7A8C7E]">{t('subDistrict')}</label>
              <input
                value={subDistrict}
                onChange={e => setSubDistrict(e.target.value)}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5"
              />
            </div>
          </div>
        )}

        {/* Step 3: sale details */}
        {(lookupState === 'found' || lookupState === 'new') && (
          <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm space-y-3">
            <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">{t('saleDetails')}</p>
            <div>
              <label className="text-xs text-[#7A8C7E]">{t('categoryLabel')} *</label>
              <div className="mt-1 flex gap-2">
                {CATEGORIES.map(c => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium ${
                      category === c
                        ? 'bg-[#7D4196] text-white'
                        : 'bg-[#F5F0E8] text-[#6B3F1F]'
                    }`}
                  >
                    {t(`category.${c.toLowerCase()}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-[#7A8C7E]">{t('productName')} *</label>
              <input
                value={productName}
                onChange={e => setProductName(e.target.value)}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-[#7A8C7E]">{t('brand')}</label>
                <input
                  value={brand}
                  onChange={e => setBrand(e.target.value)}
                  className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5"
                />
              </div>
              <div>
                <label className="text-xs text-[#7A8C7E]">{t('manufacturer')}</label>
                <input
                  value={manufacturer}
                  onChange={e => setManufacturer(e.target.value)}
                  className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-[#7A8C7E]">{t('qty')} *</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={qty}
                  onChange={e => setQty(e.target.value)}
                  className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5"
                />
              </div>
              <div>
                <label className="text-xs text-[#7A8C7E]">{t('unit')} *</label>
                <input
                  value={unit}
                  onChange={e => setUnit(e.target.value)}
                  placeholder="kg / L / packet"
                  className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5"
                />
              </div>
              <div>
                <label className="text-xs text-[#7A8C7E]">{t('price')} (₹)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-[#7A8C7E]">{t('saleDate')} *</label>
              <input
                type="date"
                value={saleDate}
                onChange={e => setSaleDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5"
              />
            </div>
            <div>
              <label className="text-xs text-[#7A8C7E]">{t('notes')}</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5"
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              onClick={submit}
              disabled={!canSubmit() || saving}
              className="w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
              style={{ background: COLOUR }}
            >
              {saving ? t('saving') : t('saveEntry')}
            </button>
          </div>
        )}
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
    </div>
  )
}
