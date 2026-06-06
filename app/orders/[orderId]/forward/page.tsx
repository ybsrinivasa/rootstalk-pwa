'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

// 2026-06-06 — Focused forward-the-returned-items surface. Routes from
// the Manage tab's "Send to another dealer" link AND from the
// review-page bundle-reroute CTA. Shows ONLY the recipient picker
// (and a nudge sheet when postponed items exist on the same order).
// Server-side state changes only on commit — backing out leaves the
// returned items where they were and the CTA available on Manage.

interface Recipient {
  user_id: string
  name: string | null
  phone: string | null
  shop_name?: string | null
  shop_address?: string | null
  distance_km?: number
  is_promoter?: boolean
}

interface RecipientResp {
  category: string | null
  has_locked_brand: boolean
  locked_brand_explainer: string | null
  dealers: Recipient[]
  facilitators: Recipient[]
}

interface ForwardOrder {
  id: string
  subscription_id: string
  returned_items?: { id: string }[]
  postponed_items?: { id: string }[]
}

export default function FarmerForwardPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<ForwardOrder | null>(null)
  const [recipients, setRecipients] = useState<RecipientResp | null>(null)
  const [tab, setTab] = useState<'dealers' | 'facilitators'>('dealers')
  const [loading, setLoading] = useState(true)
  // Nudge for postponed items — only shown when the order has any.
  // `null` means the choice hasn't been made yet OR there's nothing
  // to nudge about (no postponed items). `true`/`false` mean the
  // user has picked include vs keep. Picker is hidden until a value
  // is set so we don't fire the chained POSTs without a clear answer.
  const [includePostponed, setIncludePostponed] = useState<boolean | null>(null)
  const [sending, setSending] = useState<string | null>(null)

  const backHref = order?.subscription_id
    ? `/crop-detail/${order.subscription_id}/orders?tab=manage`
    : '/orders'

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    Promise.all([
      api.get<ForwardOrder>(`/farmer/orders/${orderId}`),
      api.get<RecipientResp>(`/farmer/orders/${orderId}/eligible-recipients`),
    ]).then(([o, r]) => {
      setOrder(o.data)
      setRecipients(r.data)
      // If no postponed items, the picker is shown immediately
      // (includePostponed=false is the right value to chain with).
      if ((o.data.postponed_items?.length || 0) === 0) {
        setIncludePostponed(false)
      }
      if (r.data.has_locked_brand) setTab('dealers')
    }).finally(() => setLoading(false))
  }, [orderId, router])

  async function pick(r: Recipient, isDealer: boolean) {
    if (!order || includePostponed === null) return
    setSending(r.user_id)
    try {
      const { data } = await api.post<{ new_draft_order_id: string }>(
        `/farmer/orders/${order.id}/reroute-returned`,
        { include_postponed: includePostponed },
      )
      const payload = isDealer
        ? { dealer_user_id: r.user_id }
        : { facilitator_user_id: r.user_id }
      await api.put(`/farmer/orders/${data.new_draft_order_id}/send`, payload)
      router.replace(backHref)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: { message?: string } } } }
      const msg = e?.response?.data?.detail?.message
      alert(msg || 'Could not forward. Please try again.')
      setSending(null)
    }
  }

  if (loading || !order || !recipients) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title="Forward returned items" activeRole="FARMER" back />
        <div className="pt-16 px-4 mt-4">
          <div className="h-28 bg-white/60 rounded-2xl animate-pulse" />
        </div>
      </div>
    )
  }

  const returnedN = order.returned_items?.length || 0
  const postponedN = order.postponed_items?.length || 0
  const dealers = recipients.dealers || []
  const facilitators = recipients.facilitators || []
  const hasFacilitators = facilitators.length > 0 && !recipients.has_locked_brand

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Forward returned items" activeRole="FARMER" back={backHref} />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">

        <p className="text-xs text-[#7A8C7E] mt-4 mb-3 leading-relaxed">
          {returnedN} returned item{returnedN === 1 ? '' : 's'} ready to forward.
          Pick a dealer or facilitator below.
        </p>

        {recipients.locked_brand_explainer && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2.5 text-xs text-purple-800 mb-3 leading-relaxed">
            <p className="font-semibold mb-0.5">Brand-locked order</p>
            <p>{recipients.locked_brand_explainer}</p>
          </div>
        )}

        {hasFacilitators && (
          <div className="flex bg-white rounded-xl border border-[#DDD0B8] mb-3 overflow-hidden">
            {(['dealers', 'facilitators'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-2 text-xs font-semibold capitalize transition-colors ${
                  tab === t ? 'bg-[#085041] text-white' : 'text-[#6B3F1F]'
                }`}>
                {t} ({t === 'dealers' ? dealers.length : facilitators.length})
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {(tab === 'dealers' ? dealers : facilitators).length === 0 ? (
            <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center">
              <p className="text-sm text-[#7A8C7E]">No {tab} available right now.</p>
            </div>
          ) : (
            (tab === 'dealers' ? dealers : facilitators).map(r => (
              <button key={r.user_id} onClick={() => pick(r, tab === 'dealers')}
                disabled={sending !== null || includePostponed === null}
                className="w-full bg-white rounded-2xl border border-[#DDD0B8] shadow-sm p-4 text-left active:scale-[0.99] transition-transform disabled:opacity-60">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-bold text-[#6B3F1F]">
                        {(tab === 'dealers' ? r.shop_name : null) || r.name || 'Unknown'}
                      </p>
                      {r.is_promoter && (
                        <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Your Promoter</span>
                      )}
                    </div>
                    {tab === 'dealers' && r.name && r.shop_name && (
                      <p className="text-xs text-[#7A8C7E]">{r.name}</p>
                    )}
                    {r.distance_km != null && (
                      <p className="text-xs text-[#7A8C7E] mt-0.5">{r.distance_km} km away</p>
                    )}
                    {tab === 'dealers' && r.shop_address && (
                      <p className="text-xs text-[#7A8C7E] truncate">{r.shop_address}</p>
                    )}
                  </div>
                  <div className="text-xs font-semibold text-[#3A7D44] shrink-0">
                    {sending === r.user_id ? '…' : 'Send →'}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Postponed nudge — only shown when the order has postpones
          AND the user hasn't chosen yet. Picker is hidden behind
          this until the user commits to a choice. */}
      {includePostponed === null && postponedN > 0 && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end">
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}>
            <p className="font-bold text-[#6B3F1F]">Send postponed items too?</p>
            <p className="text-xs text-[#7A8C7E] mt-2 leading-relaxed">
              You have <strong className="text-[#6B3F1F]">{postponedN} postponed item{postponedN === 1 ? '' : 's'}</strong> still
              with the current dealer. Want to cancel them and bundle with the
              {returnedN} returned, or keep them with the current dealer?
            </p>
            <div className="space-y-2 mt-4">
              <button onClick={() => setIncludePostponed(true)}
                className="w-full py-3 rounded-xl text-white text-sm font-semibold"
                style={{ background: 'linear-gradient(135deg, #b45309, #92400e)' }}>
                Cancel postponed & forward together ({returnedN + postponedN})
              </button>
              <button onClick={() => setIncludePostponed(false)}
                className="w-full py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium">
                Keep postponed with current dealer · forward {returnedN}
              </button>
              <button onClick={() => router.replace(backHref)}
                className="w-full py-2 text-[#7A8C7E] text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
