'use client'
import type { useTranslations } from 'next-intl'

// Shared lookup-result card used by the seed-varieties picker and
// the pesticide/fertiliser order/new picker. Renders the five
// verdicts the backend lookup endpoints return:
//
//   phone_not_registered     — red, "no RootsTalk user with this number"
//   self                     — amber, "cannot send to yourself"
//   not_dealer_or_facilitator — amber, name + "ask them to register first"
//   dealer_not_onboarded     — amber, photo + name + role +
//                              reason referencing the seed company
//   ok                       — green, photo + name + role badge +
//                              state/district + Send Order CTA
//
// The hosting page passes its own `useTranslations` instance so the
// keys land inside that page's namespace (seedVarieties.lookup.*,
// orders.new.lookup.*, etc). Each caller must mirror the same key
// shape: `lookup.notRegistered`, `lookup.self`,
// `lookup.notDealerOrFacilitator`, `lookup.dealerNotOnboarded`,
// `lookup.roleDealer`, `lookup.roleFacilitator`,
// `lookup.companyFallback`, plus `sendOrder` at the top level.

export interface RecipientLookupResult {
  found: boolean
  user_id?: string
  name?: string | null
  phone?: string | null
  photo_url?: string | null
  role?: 'DEALER' | 'FACILITATOR' | null
  state_name?: string | null
  district_name?: string | null
  is_active?: boolean
  client_name?: string | null
  can_receive?: boolean
  reason: string
}

interface Props {
  lookup: RecipientLookupResult
  placing: string | null
  onSend: () => void
  t: ReturnType<typeof useTranslations>
}

export default function RecipientLookupCard({ lookup, placing, onSend, t }: Props) {
  if (!lookup.found) {
    return (
      <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
        <p className="text-xs text-red-700">{t('lookup.notRegistered')}</p>
      </div>
    )
  }
  if (lookup.reason === 'self') {
    return (
      <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
        <p className="text-xs text-amber-800">{t('lookup.self')}</p>
      </div>
    )
  }
  if (lookup.reason === 'not_dealer_or_facilitator') {
    return (
      <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
        <p className="text-sm text-[#6B3F1F] font-medium">{lookup.name || lookup.phone}</p>
        <p className="text-xs text-amber-800 mt-1">{t('lookup.notDealerOrFacilitator')}</p>
      </div>
    )
  }
  if (lookup.reason === 'dealer_not_onboarded') {
    return (
      <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex items-start gap-3">
        {lookup.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lookup.photo_url} alt=""
            className="w-12 h-12 rounded-full object-cover shrink-0 border border-[#DDD0B8]" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-[#F5F0E8] flex items-center justify-center shrink-0">
            <span className="text-xl">🧑‍🌾</span>
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm text-[#6B3F1F] font-semibold">{lookup.name || lookup.phone}</p>
          <p className="text-xs text-[#7A8C7E]">{t('lookup.roleDealer')}</p>
          {(lookup.state_name || lookup.district_name) && (
            <p className="text-xs text-[#7A8C7E]">{[lookup.district_name, lookup.state_name].filter(Boolean).join(', ')}</p>
          )}
          <p className="text-xs text-amber-800 mt-1.5">
            {t('lookup.dealerNotOnboarded', { client: lookup.client_name || t('lookup.companyFallback') })}
          </p>
        </div>
      </div>
    )
  }
  // ok — eligible recipient
  return (
    <div className="mt-3 bg-green-50 border border-green-200 rounded-xl p-3">
      <div className="flex items-start gap-3">
        {lookup.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lookup.photo_url} alt=""
            className="w-12 h-12 rounded-full object-cover shrink-0 border border-[#DDD0B8]" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shrink-0">
            <span className="text-xl">🧑‍🌾</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[#6B3F1F] font-bold">{lookup.name || lookup.phone}</p>
          <p className="text-xs text-[#7A8C7E]">
            {lookup.role === 'DEALER' ? t('lookup.roleDealer') : t('lookup.roleFacilitator')}
          </p>
          {(lookup.state_name || lookup.district_name) && (
            <p className="text-xs text-[#7A8C7E]">{[lookup.district_name, lookup.state_name].filter(Boolean).join(', ')}</p>
          )}
        </div>
      </div>
      <button onClick={onSend} disabled={placing === lookup.user_id}
        className="mt-3 w-full py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
        style={{ background: '#3A7D44' }}>
        {placing === lookup.user_id ? '…' : t('sendOrder')}
      </button>
    </div>
  )
}
