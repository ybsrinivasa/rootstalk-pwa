'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import RecipientLookupCard, { type RecipientLookupResult } from '@/components/RecipientLookupCard'
import ConfirmSendOrderSheet, { recipientLabel } from '@/components/ConfirmSendOrderSheet'
import api from '@/lib/api'

// 2026-06-06 — Focused forward-the-returned-items surface. Routes from
// the Manage tab's "Send to another dealer" link AND from the
// review-page bundle-reroute CTA. Shows ONLY the recipient picker
// (and a nudge sheet when postponed items exist on the same order).
// Server-side state changes only on commit — backing out leaves the
// returned items where they were and the CTA available on Manage.
//
// 2026-06-22 — Picker switched from tabs + nearby-recipients lists to
// phone-entry + RecipientLookupCard, matching the first-time picker
// at /order/new/[subscriptionId]. Backend endpoint
// /farmer/orders/{id}/lookup-recipient mirrors the new-order shape
// but scopes brand-lock to the order's items.
//
// 2026-07-11 — List brought back on top of phone-entry to match the
// /order/new picker (which kept both). User feedback: the phone-only
// path made it look like nothing was available when the farmer
// hadn't typed anything yet. Backend endpoint
// /farmer/orders/{id}/eligible-recipients has existed all along;
// this page just never called it.

interface Person {
  user_id: string
  name: string | null
  phone: string | null
  distance_km: number
  is_promoter: boolean
  shop_name?: string | null
  shop_address?: string | null
  sell_categories?: string[]
}

interface EligibleRecipientsResult {
  dealers: Person[]
  facilitators: Person[]
  has_locked_brand: boolean
  locked_brand_explainer: string | null
}

interface ForwardOrder {
  id: string
  subscription_id: string
  category?: string | null
  returned_items?: { id: string }[]
  postponed_items?: { id: string }[]
}

export default function FarmerForwardPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const t = useTranslations('orders.forward')
  const tOrdersCommon = useTranslations('orders.common')
  const tCommon = useTranslations('common')
  const [order, setOrder] = useState<ForwardOrder | null>(null)
  const [loading, setLoading] = useState(true)
  // Nudge for postponed items — only shown when the order has any.
  // `null` means the choice hasn't been made yet OR there's nothing
  // to nudge about (no postponed items). `true`/`false` mean the
  // user has picked include vs keep.
  const [includePostponed, setIncludePostponed] = useState<boolean | null>(null)
  const [sending, setSending] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Phone-entry lookup (matches /order/new picker).
  const [customPhone, setCustomPhone] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookup, setLookup] = useState<RecipientLookupResult | null>(null)

  // 2026-07-11 — Pre-filtered dealer / facilitator lists (mirror of
  // /order/new). Populated once from /eligible-recipients when the
  // order loads.
  const [tab, setTab] = useState<'dealers' | 'facilitators'>('dealers')
  const [dealers, setDealers] = useState<Person[]>([])
  const [facilitators, setFacilitators] = useState<Person[]>([])
  const [lockedBrandExplainer, setLockedBrandExplainer] = useState<string | null>(null)

  const backHref = order?.subscription_id
    ? `/crop-detail/${order.subscription_id}/orders?tab=manage`
    : '/orders'

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    Promise.allSettled([
      api.get<ForwardOrder>(`/farmer/orders/${orderId}`),
      api.get<EligibleRecipientsResult>(`/farmer/orders/${orderId}/eligible-recipients`),
    ]).then(([orderRes, eligibleRes]) => {
      if (orderRes.status === 'fulfilled') {
        setOrder(orderRes.value.data)
        const returnedN = orderRes.value.data.returned_items?.length || 0
        const postponedN = orderRes.value.data.postponed_items?.length || 0
        if (postponedN > 0 && returnedN === 0) {
          // Postpone-only path: auto-include (no choice to make).
          setIncludePostponed(true)
        } else if (postponedN === 0) {
          setIncludePostponed(false)
        }
      } else {
        const err = orderRes.reason as { response?: { data?: { detail?: string | { message?: string } } } }
        const detail = err.response?.data?.detail
        setLoadError(
          typeof detail === 'string'
            ? detail
            : (detail && typeof detail === 'object' && detail.message)
              || t('errorLoad')
        )
      }
      if (eligibleRes.status === 'fulfilled') {
        setDealers(eligibleRes.value.data.dealers || [])
        setFacilitators(eligibleRes.value.data.facilitators || [])
        setLockedBrandExplainer(eligibleRes.value.data.locked_brand_explainer)
        if (eligibleRes.value.data.has_locked_brand) setTab('dealers')
      }
    }).finally(() => setLoading(false))
  }, [orderId, router, t])

  // Debounced phone-entry lookup against the forward-scoped endpoint.
  useEffect(() => {
    const digits = customPhone.replace(/\D/g, '')
    if (digits.length < 10) { setLookup(null); setLookupLoading(false); return }
    setLookupLoading(true)
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get<RecipientLookupResult>(
          `/farmer/orders/${orderId}/lookup-recipient?phone=${encodeURIComponent('+91' + digits.slice(-10))}`,
        )
        setLookup(data)
      } catch {
        setLookup(null)
      } finally {
        setLookupLoading(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [customPhone, orderId])

  // Confirm-before-send wrapper.
  const [pendingForward, setPendingForward] = useState<{
    user_id: string
    name: string | null
    phone: string | null
    isDealer: boolean
  } | null>(null)
  function startSendFromLookup() {
    if (!lookup?.found || !lookup.user_id || !lookup.can_receive || !lookup.role) return
    if (!order || includePostponed === null) return
    setPendingForward({
      user_id: lookup.user_id,
      name: lookup.name ?? null,
      phone: lookup.phone ?? null,
      isDealer: lookup.role === 'DEALER',
    })
  }

  function startSendFromList(person: Person, isDealer: boolean) {
    if (!order || includePostponed === null) return
    setPendingForward({
      user_id: person.user_id,
      name: (isDealer ? person.shop_name : null) || person.name || null,
      phone: person.phone,
      isDealer,
    })
  }

  async function commitForward() {
    if (!order || includePostponed === null || !pendingForward) return
    setSending(true)
    const target = pendingForward
    setPendingForward(null)
    try {
      const { data } = await api.post<{ new_draft_order_id: string }>(
        `/farmer/orders/${order.id}/reroute-returned`,
        { include_postponed: includePostponed },
      )
      const payload = target.isDealer
        ? { dealer_user_id: target.user_id }
        : { facilitator_user_id: target.user_id }
      await api.put(`/farmer/orders/${data.new_draft_order_id}/send`, payload)
      router.replace(backHref)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: { message?: string } } } }
      const msg = e?.response?.data?.detail?.message
      alert(msg || tOrdersCommon('errors.forwardFailed'))
      setSending(false)
    }
  }

  function PersonCard({ person, isDealer }: { person: Person; isDealer: boolean }) {
    return (
      <div className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-bold text-[#6B3F1F]">{(isDealer ? person.shop_name : null) || person.name || tOrdersCommon('unknownRecipient')}</p>
              {person.is_promoter && (
                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">{tOrdersCommon('promoterBadge')}</span>
              )}
            </div>
            {isDealer && person.name && person.shop_name && (
              <p className="text-xs text-[#7A8C7E]">{person.name}</p>
            )}
            <p className="text-xs text-[#7A8C7E] mt-0.5">{tOrdersCommon('distanceKm', { km: person.distance_km })}</p>
            {isDealer && person.shop_address && (
              <p className="text-xs text-[#7A8C7E] truncate">{person.shop_address}</p>
            )}
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            {person.phone && (
              <a href={`tel:${person.phone}`}
                className="text-xs bg-slate-100 text-[#6B3F1F] px-3 py-1.5 rounded-lg text-center font-medium">
                {tOrdersCommon('callBtn')}
              </a>
            )}
            <button onClick={() => startSendFromList(person, isDealer)}
              disabled={sending || includePostponed === null}
              className="text-xs text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
              style={{ background: '#3A7D44' }}>
              {t('sendOrder')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={t('headerTitle')} activeRole="FARMER" back={backHref} />
        <div className="pt-16 px-4 mt-4 max-w-lg mx-auto">
          <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center">
            <p className="text-3xl mb-2">📦</p>
            <p className="text-sm font-semibold text-[#6B3F1F] mb-1">{t('errorTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mb-4">{loadError}</p>
            <button onClick={() => router.replace(backHref)}
              className="w-full py-2.5 rounded-xl bg-[#3A7D44] text-white text-sm font-semibold">
              {t('backToManage')}
            </button>
          </div>
        </div>
      </div>
    )
  }
  if (loading || !order) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={t('headerTitle')} activeRole="FARMER" back="/orders" />
        <div className="pt-16 px-4 mt-4">
          <div className="h-28 bg-white/60 rounded-2xl animate-pulse" />
        </div>
      </div>
    )
  }
  if ((order.returned_items?.length || 0) + (order.postponed_items?.length || 0) === 0) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={t('headerTitle')} activeRole="FARMER" back={backHref} />
        <div className="pt-16 px-4 mt-4 max-w-lg mx-auto">
          <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center">
            <p className="text-3xl mb-2">📦</p>
            <p className="text-sm font-semibold text-[#6B3F1F] mb-1">{t('emptyTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mb-4">{t('emptyBody')}</p>
            <button onClick={() => router.replace(backHref)}
              className="w-full py-2.5 rounded-xl bg-[#3A7D44] text-white text-sm font-semibold">
              {t('backToManage')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const returnedN = order.returned_items?.length || 0
  const postponedN = order.postponed_items?.length || 0
  const postponeOnly = returnedN === 0 && postponedN > 0
  const totalForwardable = returnedN + (includePostponed ? postponedN : 0)

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FARMER" back={backHref} />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">

        <p className="text-xs text-[#7A8C7E] mt-4 mb-3 leading-relaxed">
          {postponeOnly
            ? t('postponeOnlyReady', { count: postponedN })
            : t('readyToForward', { count: totalForwardable })}
          {t('pickHint')}
        </p>

        {/* 2026-07-11 — Locked-brand explainer + tabs + list, mirrors
            /order/new picker. Only rendered once the postpone-nudge
            has been resolved (includePostponed !== null). */}
        {includePostponed !== null && lockedBrandExplainer && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2.5 text-xs text-purple-800 leading-relaxed mb-3">
            <p className="font-semibold mb-0.5">{t('brandLockedTitle')}</p>
            <p>{lockedBrandExplainer}</p>
          </div>
        )}
        {includePostponed !== null && (
          <div className="flex bg-white rounded-2xl border border-[#DDD0B8] mb-3 p-1">
            {(['dealers', 'facilitators'] as const).map(tabKey => {
              if (tabKey === 'facilitators' && lockedBrandExplainer) return null
              return (
                <button key={tabKey} onClick={() => setTab(tabKey)}
                  className={`flex-1 py-2.5 text-sm font-medium rounded-xl capitalize transition-all ${tab === tabKey ? 'bg-green-700 text-white shadow-sm' : 'text-[#7A8C7E]'}`}>
                  {tabKey === 'dealers'
                    ? tOrdersCommon('tabDealers', { count: dealers.length })
                    : tOrdersCommon('tabFacilitators', { count: facilitators.length })}
                </button>
              )
            })}
          </div>
        )}
        {includePostponed !== null && (
          <div className="space-y-3 mb-3">
            {(tab === 'dealers' ? dealers : facilitators).length === 0 ? (
              <div className="text-center py-8 bg-white rounded-2xl border border-[#DDD0B8]">
                <p className="text-2xl mb-2">{tab === 'dealers' ? '🏪' : '🌾'}</p>
                <p className="text-[#7A8C7E] font-medium text-sm">
                  {tab === 'dealers' ? tOrdersCommon('emptyDealers') : tOrdersCommon('emptyFacilitators')}
                </p>
                <p className="text-xs text-[#7A8C7E] mt-1">{tOrdersCommon('tryPhoneHint')}</p>
              </div>
            ) : (
              (tab === 'dealers' ? dealers : facilitators).map(person => (
                <PersonCard key={person.user_id} person={person} isDealer={tab === 'dealers'} />
              ))
            )}
          </div>
        )}

        {/* Phone-entry — same shape as /order/new picker so the
            farmer sees one consistent dealer/facilitator picker
            across first-order and forward-returned flows. */}
        {includePostponed !== null && (
          <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4">
            <p className="text-xs font-semibold text-[#7A8C7E] mb-2">{t('customPhoneLabel')}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#7A8C7E] px-2 py-2 bg-[#F5F0E8] border border-[#DDD0B8] rounded-xl">+91</span>
              <input value={customPhone} onChange={e => setCustomPhone(e.target.value)}
                placeholder={t('customPhonePlaceholder')}
                type="tel" inputMode="numeric"
                className="flex-1 min-w-0 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#3A7D44]" />
            </div>
            {lookupLoading && (
              <div className="mt-2 flex items-center gap-2 text-xs text-[#7A8C7E]">
                <div className="w-3 h-3 border-2 border-[#DDD0B8] border-t-[#3A7D44] rounded-full animate-spin" />
                {t('phoneChecking')}
              </div>
            )}
            {lookup && !lookupLoading && (
              <RecipientLookupCard lookup={lookup}
                placing={sending ? 'sending' : null} onSend={startSendFromLookup} t={t} />
            )}
          </div>
        )}
      </div>

      {/* Postponed nudge — only shown when the order has postpones
          AND the user hasn't chosen yet. Picker is hidden behind
          this until the user commits. */}
      {includePostponed === null && postponedN > 0 && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end">
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}>
            <p className="font-bold text-[#6B3F1F]">{t('nudgeTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mt-2 leading-relaxed">
              {t('nudgeBodyPrefix')} <strong className="text-[#6B3F1F]">{t('postponedItemsCount', { count: postponedN })}</strong> {t('nudgeBodyMiddle')}{' '}
              {returnedN} {t('nudgeBodySuffix')}
            </p>
            <div className="space-y-2 mt-4">
              <button onClick={() => setIncludePostponed(true)}
                className="w-full py-3 rounded-xl text-white text-sm font-semibold"
                style={{ background: 'linear-gradient(135deg, #b45309, #92400e)' }}>
                {t('bundleCta', { count: returnedN + postponedN })}
              </button>
              <button onClick={() => setIncludePostponed(false)}
                className="w-full py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium">
                {t('keepCta', { count: returnedN })}
              </button>
              <button onClick={() => router.replace(backHref)}
                className="w-full py-2 text-[#7A8C7E] text-sm">
                {tCommon('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmSendOrderSheet
        open={!!pendingForward}
        inputType={tOrdersCommon(
          order?.category === 'PESTICIDE' ? 'inputType.pesticide'
          : order?.category === 'FERTILIZER' || order?.category === 'FERTILISER' ? 'inputType.fertilizer'
          : 'inputType.fallback'
        )}
        recipient={recipientLabel(
          pendingForward?.isDealer ?? false,
          pendingForward ? { name: pendingForward.name } : null,
          tOrdersCommon('unknownRecipient'),
        )}
        busy={sending}
        onCancel={() => setPendingForward(null)}
        onConfirm={commitForward}
      />
    </div>
  )
}
