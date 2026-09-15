'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'
import { digitsOnly } from '@/lib/input-normalization'


const COLOUR = '#7D4196'

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


function normalisePhoneInput(raw: string): string {
  return digitsOnly(raw)
}


export default function DealerCreditNewAccountPage() {
  const router = useRouter()
  const t = useTranslations('credit.newAccount')
  const tLedger = useTranslations('dealer.ledger')

  const [phone, setPhone] = useState('')
  const [lookupState, setLookupState] = useState<'idle' | 'looking' | 'found' | 'new'>('idle')
  const [existingUser, setExistingUser] = useState<PhoneLookupResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [farmerName, setFarmerName] = useState('')
  const [coshLocations, setCoshLocations] = useState<CoshLocations | null>(null)
  const [stateId, setStateId] = useState('')
  const [districtId, setDistrictId] = useState('')
  const [subDistrict, setSubDistrict] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<CoshLocations>('/cosh/locations/india')
      .then(r => setCoshLocations(r.data)).catch(() => {})
  }, [router])

  const districts = coshLocations?.states.find(s => s.cosh_id === stateId)?.districts || []

  const invalidateLookup = () => {
    setLookupState('idle'); setExistingUser(null); setError(null)
    setFarmerName(''); setStateId(''); setDistrictId(''); setSubDistrict('')
  }

  const doLookup = async () => {
    setError(null)
    if (phone.replace(/\D/g, '').length < 10) {
      setError(tLedger('phoneInvalidHint')); return
    }
    setLookupState('looking')
    try {
      const r = await api.post<PhoneLookupResponse>('/dealer/ledger/lookup-phone', { phone })
      if (r.data.found && r.data.user_id) {
        // Show the farmer's details so the dealer can confirm they
        // typed the right number before we open a credit account.
        setExistingUser(r.data)
        setLookupState('found')
      } else {
        setExistingUser(null); setLookupState('new')
      }
    } catch {
      setLookupState('idle'); setError(tLedger('lookupFailed'))
    }
  }

  const canSubmit = () => {
    if (lookupState !== 'new') return false
    return !!farmerName.trim() && !!stateId && !!districtId
  }

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      const r = await api.post<PhoneLookupResponse>('/dealer/ledger/farmers', {
        phone,
        name: farmerName.trim(),
        state_cosh_id: stateId,
        district_cosh_id: districtId,
        sub_district: subDistrict.trim() || undefined,
      })
      if (r.data.user_id) {
        router.replace(`/dealer/credit/farmers/${r.data.user_id}`)
      }
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: { message?: string; code?: string; user_id?: string } | string } } })
        ?.response?.data?.detail
      const obj = typeof detail === 'object' ? detail : null
      if (obj?.code === 'phone_already_exists' && obj?.user_id) {
        // Race — someone created the farmer between our lookup and our
        // create call. Just route to their credit account.
        router.replace(`/dealer/credit/farmers/${obj.user_id}`)
        return
      }
      setError(obj?.message || (typeof detail === 'string' ? detail : null) || tLedger('saveFailed'))
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/credit" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto space-y-3">
        <p className="mt-4 text-xs text-[#7A8C7E] leading-snug">{t('intro')}</p>

        {/* Phone lookup */}
        <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm">
          <p className="text-sm font-semibold text-[#6B3F1F] mb-2">{tLedger('step1PhoneLabel')}</p>
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
                {lookupState === 'looking' ? tLedger('looking') : tLedger('lookup')}
              </button>
            )}
            {(lookupState === 'found' || lookupState === 'new') && (
              <button onClick={invalidateLookup}
                className="px-4 py-2 rounded-xl border border-[#DDD0B8] text-sm text-[#6B3F1F]">
                {tLedger('change')}
              </button>
            )}
          </div>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>

        {/* Existing farmer preview — confirm-before-open step */}
        {lookupState === 'found' && existingUser && (
          <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm">
            <p className="text-xs text-[#7A8C7E] uppercase tracking-wide mb-1">
              {tLedger('existingFarmer')}
            </p>
            <p className="font-semibold text-[#6B3F1F]">
              {existingUser.name || tLedger('unnamedFarmer')}
            </p>
            {existingUser.phone && (
              <p className="text-xs text-[#7A8C7E]">{existingUser.phone}</p>
            )}
            {(existingUser.state_name || existingUser.district_name || existingUser.sub_district) && (
              <p className="text-xs text-[#7A8C7E] mt-0.5">
                {[existingUser.sub_district, existingUser.district_name, existingUser.state_name]
                  .filter(Boolean).join(', ')}
              </p>
            )}
            <button
              onClick={() => router.replace(`/dealer/credit/farmers/${existingUser.user_id}`)}
              className="mt-3 w-full py-3 rounded-xl text-white text-sm font-semibold"
              style={{ background: COLOUR }}>
              {t('openCreditAccount')}
            </button>
          </div>
        )}

        {/* New-farmer form */}
        {lookupState === 'new' && (
          <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm space-y-3">
            <p className="text-xs text-[#7A8C7E] uppercase tracking-wide">{tLedger('newFarmerDetails')}</p>
            <div>
              <label className="text-xs text-[#7A8C7E]">{tLedger('name')} *</label>
              <input value={farmerName} onChange={e => setFarmerName(e.target.value)}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5" />
            </div>
            <div>
              <label className="text-xs text-[#7A8C7E]">{tLedger('state')} *</label>
              <select value={stateId}
                onChange={e => { setStateId(e.target.value); setDistrictId('') }}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5 bg-white">
                <option value="">{tLedger('pickState')}</option>
                {(coshLocations?.states || []).map(s => (
                  <option key={s.cosh_id} value={s.cosh_id}>{s.name || s.cosh_id}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#7A8C7E]">{tLedger('district')} *</label>
              <select value={districtId} onChange={e => setDistrictId(e.target.value)}
                disabled={!stateId}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5 bg-white disabled:bg-[#F5F0E8]">
                <option value="">{tLedger('pickDistrict')}</option>
                {districts.map(d => (
                  <option key={d.cosh_id} value={d.cosh_id}>{d.name || d.cosh_id}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#7A8C7E]">{tLedger('subDistrict')}</label>
              <input value={subDistrict} onChange={e => setSubDistrict(e.target.value)}
                className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mt-0.5" />
            </div>
            <button onClick={submit} disabled={!canSubmit() || saving}
              className="w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
              style={{ background: COLOUR }}>
              {saving ? tLedger('saving') : t('createAndContinue')}
            </button>
          </div>
        )}
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
    </div>
  )
}
