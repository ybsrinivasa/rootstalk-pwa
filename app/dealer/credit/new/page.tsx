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
const INSTALL_URL = 'https://rootstalk.in'

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
  is_claimed?: boolean
}


function normalisePhoneInput(raw: string): string {
  return digitsOnly(raw)
}


export default function DealerCreditNewAccountPage() {
  const router = useRouter()
  const t = useTranslations('credit.newAccount')
  const tLedger = useTranslations('dealer.ledger')

  const [phone, setPhone] = useState('')
  const [lookupState, setLookupState] = useState<'idle' | 'looking' | 'foundClaimed' | 'notEligible'>('idle')
  const [existingUser, setExistingUser] = useState<PhoneLookupResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
  }, [router])

  const invalidateLookup = () => {
    setLookupState('idle'); setExistingUser(null); setError(null)
  }

  const doLookup = async () => {
    setError(null)
    if (phone.replace(/\D/g, '').length < 10) {
      setError(tLedger('phoneInvalidHint')); return
    }
    setLookupState('looking')
    try {
      const r = await api.post<PhoneLookupResponse>('/dealer/ledger/lookup-phone', { phone })
      if (r.data.found && r.data.is_claimed) {
        // Real self-registered farmer — proceed.
        setExistingUser(r.data)
        setLookupState('foundClaimed')
      } else {
        // Either no user row, or a dealer-created unclaimed row.
        // Either way: farmer must install + register before we can
        // open a credit account. Business rule per user 2026-09-15.
        setExistingUser(r.data.found ? r.data : null)
        setLookupState('notEligible')
      }
    } catch {
      setLookupState('idle'); setError(tLedger('lookupFailed'))
    }
  }

  // Native SMS intent — opens the dealer's SMS composer with the
  // recipient + a pre-filled install message. Zero cost to us, comes
  // from a number the farmer already trusts (the dealer's own).
  const smsHref = () => {
    const body = t('smsBody', { url: INSTALL_URL })
    // sms: URI with query-string body — supported by Android + iOS.
    // `?` separator works on both; some older Android needs `?` too.
    return `sms:${phone}?body=${encodeURIComponent(body)}`
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
              disabled={lookupState === 'foundClaimed' || lookupState === 'notEligible'}
              className="flex-1 px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm focus:outline-none focus:border-[#7D4196] disabled:bg-[#F5F0E8]" />
            {(lookupState === 'idle' || lookupState === 'looking') && (
              <button onClick={doLookup} disabled={lookupState === 'looking'}
                className="px-4 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50"
                style={{ background: COLOUR }}>
                {lookupState === 'looking' ? tLedger('looking') : tLedger('lookup')}
              </button>
            )}
            {(lookupState === 'foundClaimed' || lookupState === 'notEligible') && (
              <button onClick={invalidateLookup}
                className="px-4 py-2 rounded-xl border border-[#DDD0B8] text-sm text-[#6B3F1F]">
                {tLedger('change')}
              </button>
            )}
          </div>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>

        {/* Existing self-registered farmer — proceed to credit account */}
        {lookupState === 'foundClaimed' && existingUser && (
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

        {/* Not on RootsTalk yet — invite via SMS. Covers both no-user-row
            and dealer-created-unclaimed cases (same next step from the
            dealer's POV). */}
        {lookupState === 'notEligible' && (
          <div className="bg-white rounded-2xl p-4 border border-amber-200 shadow-sm">
            <p className="text-sm font-semibold text-[#6B3F1F]">
              {t('notEligibleTitle')}
            </p>
            <p className="text-xs text-[#7A8C7E] mt-2 leading-relaxed">
              {t('notEligibleBody')}
            </p>
            <a
              href={smsHref()}
              className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold"
              style={{ background: COLOUR }}>
              <span>💬</span>
              {t('sendInstallSmsCta', { phone })}
            </a>
            <p className="text-[10px] text-[#7A8C7E] mt-2 text-center">
              {t('smsHint')}
            </p>
          </div>
        )}
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
    </div>
  )
}
