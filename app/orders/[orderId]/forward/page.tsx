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

  const backHref = order?.subscription_id
    ? `/crop-detail/${order.subscription_id}/orders?tab=manage`
    : '/orders'

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<ForwardOrder>(`/farmer/orders/${orderId}`).then(o => {
      setOrder(o.data)
      const returnedN = o.data.returned_items?.length || 0
      const postponedN = o.data.postponed_items?.length || 0
      if (postponedN > 0 && returnedN === 0) {
        // Postpone-only path: auto-include (no choice to make).
        setIncludePostponed(true)
      } else if (postponedN === 0) {
        setIncludePostponed(false)
      }
    }).catch((e: unknown) => {
      const err = e as { response?: { data?: { detail?: string | { message?: string } } } }
      const detail = err.response?.data?.detail
      setLoadError(
        typeof detail === 'string'
          ? detail
          : (detail && typeof detail === 'object' && detail.message)
            || t('errorLoad')
      )
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
