'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'
import ConfirmSendOrderSheet, { recipientLabel } from '@/components/ConfirmSendOrderSheet'
import QRScannerModal from '@/components/QRScannerModal'

// Orders V2 Batch 14 — farmer-side seed order detail. Same
// affordances as the pesticide/fertiliser detail
// (/orders/[orderId]) so the farmer's interaction stays consistent
// across categories: status badge, cancel, DRAFT recipient picker,
// delete cancelled husk, approve / reject when dealer's submitted.

interface SeedOrder {
  id: string
  status: string
  variety_id: string
  variety_name: string | null
  crop_cosh_id: string | null
  unit: string | null
  quantity: number | null
  total_price: number | null
  dealer_user_id: string | null
  facilitator_user_id: string | null
  subscription_id: string
  client_id: string
  postponed_until: string | null
  scan_verified?: boolean
  qr_available?: boolean
  created_at: string
}

interface Recipient {
  user_id: string
  name: string
  phone: string
  shop_name?: string | null
  shop_address?: string | null
  distance_km?: number
  is_promoter?: boolean
}

const STATUS_TONE: Record<string, string> = {
  DRAFT:             'bg-stone-100 text-[#7A8C7E]',
  SENT:              'bg-purple-100 text-purple-700',
  ACCEPTED:          'bg-blue-100 text-blue-700',
  AVAILABLE:         'bg-blue-100 text-blue-700',
  POSTPONED:         'bg-amber-100 text-amber-800',
  NOT_AVAILABLE:     'bg-red-100 text-[#D4682E]',
  SENT_FOR_APPROVAL: 'bg-amber-100 text-amber-700',
  READY_FOR_PICKUP:  'bg-purple-100 text-purple-700',
  PURCHASED:         'bg-emerald-100 text-emerald-700',
  REJECTED:          'bg-rose-100 text-rose-600',
  CANCELLED:         'bg-stone-100 text-[#7A8C7E]',
  REROUTED:          'bg-stone-100 text-[#7A8C7E]',
}

export default function FarmerSeedOrderDetailPage() {
  const t = useTranslations('seedOrders')
  const tDetail = useTranslations('seedOrders.detail')
  const tCommon = useTranslations('orders.common')
  const tQr = useTranslations('qrScan')
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<SeedOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)

  // DRAFT recipient picker
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTab, setPickerTab] = useState<'dealers' | 'facilitators'>('dealers')
  const [dealers, setDealers] = useState<Recipient[]>([])
  const [facilitators, setFacilitators] = useState<Recipient[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [sending, setSending] = useState<string | null>(null)

  // 2026-06-21 — Receipt confirmation modal (mirrors regular-order
  // ReceiveBanner). READY_FOR_PICKUP is the only state where this fires.
  const [confirmReceive, setConfirmReceive] = useState(false)

  const load = async () => {
    try {
      const { data } = await api.get<SeedOrder>(`/farmer/seed-orders/${orderId}`)
      setOrder(data)
    } catch {
      // 2026-06-19 — /seed-orders flat list page retired; bounce
      // to the bottom-nav Orders picker so the farmer always lands
      // in a maintained surface.
      router.replace('/orders')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  async function cancelOrder() {
    if (!order) return
    if (!confirm(tDetail('confirmCancel'))) return
    setBusy(true)
    try {
      // 2026-06-21 — Release-not-migrate parity with regular cancel.
      // No DRAFT continuation; the farmer creates a fresh seed order
      // through advisory if they want one.
      await api.put(`/farmer/seed-orders/${order.id}/cancel`, {})
      router.replace(
        order.subscription_id
          ? `/crop-detail/${order.subscription_id}/orders?tab=manage`
          : '/orders'
      )
    } catch {
      alert(tDetail('errorCancel'))
    } finally { setBusy(false) }
  }

  async function deleteHusk() {
    if (!order) return
    if (!confirm(tDetail('confirmDelete'))) return
    setBusy(true)
    try {
      await api.delete(`/farmer/seed-orders/${order.id}`)
      router.replace(
        order.subscription_id
          ? `/crop-detail/${order.subscription_id}/orders?tab=manage`
          : '/orders'
      )
    } catch {
      alert(tDetail('errorDelete'))
    } finally { setBusy(false) }
  }

  async function approveOrder() {
    if (!order) return
    setBusy(true)
    try {
      await api.put(`/farmer/seed-orders/${order.id}/approve`, {})
      // 2026-06-19 — Bounce back to Manage Pickup pill so the farmer
      // sees the seed under "I've picked up the seed" alongside any
      // regular orders awaiting pickup. Pre-fix the farmer was left
      // on the legacy seed-order detail page with no clear next step.
      if (order.subscription_id) {
        router.replace(`/crop-detail/${order.subscription_id}/orders?tab=manage&pill=pickup`)
      } else {
        load()
      }
    } catch {
      alert(tDetail('errorApprove'))
    } finally { setBusy(false) }
  }

  async function rejectOrder() {
    if (!order) return
    if (!confirm(tDetail('confirmReject'))) return
    setBusy(true)
    try {
      await api.put(`/farmer/seed-orders/${order.id}/reject`, {})
      load()
    } catch {
      alert(tDetail('errorReject'))
    } finally { setBusy(false) }
  }

  async function markReceived() {
    if (!order) return
    setBusy(true)
    try {
      await api.put(`/farmer/seed-orders/${order.id}/mark-received`, {})
      setConfirmReceive(false)
      // 2026-06-21 — Bounce back to Manage so the now-PURCHASED order
      // drops off the Pickup pill and shows in History (mirrors the
      // regular-order post-receive nav).
      if (order.subscription_id) {
        router.replace(`/crop-detail/${order.subscription_id}/orders?tab=manage`)
      } else {
        load()
      }
    } catch {
      alert(tDetail('errorReceive'))
    } finally { setBusy(false) }
  }

  async function openPicker() {
    if (!order) return
    setPickerOpen(true)
    setPickerLoading(true)
    try {
      const [d, f] = await Promise.allSettled([
        api.get<Recipient[]>(`/farmer/subscriptions/${order.subscription_id}/nearby-dealers?order_type=SEED`),
        api.get<Recipient[]>(`/farmer/subscriptions/${order.subscription_id}/nearby-facilitators`),
      ])
      setDealers(d.status === 'fulfilled' ? d.value.data : [])
      setFacilitators(f.status === 'fulfilled' ? f.value.data : [])
    } finally { setPickerLoading(false) }
  }

  // 2026-06-19 — Picker → ConfirmSendOrderSheet → actual send. The
  // tap on a recipient row stashes the pending send; the sheet shows
  // "Do you wish to send the Seed/Seedling Order to {recipient}?";
  // confirm fires sendToRecipient.
  const [pendingSend, setPendingSend] = useState<{ r: Recipient; isDealer: boolean } | null>(null)
  function requestSend(r: Recipient, isDealer: boolean) {
    if (!order) return
    setPendingSend({ r, isDealer })
  }

  async function sendToRecipient(r: Recipient, isDealer: boolean) {
    if (!order) return
    setSending(r.user_id)
    try {
      const payload = isDealer
        ? { dealer_user_id: r.user_id }
        : { facilitator_user_id: r.user_id }
      await api.put(`/farmer/seed-orders/${order.id}/send`, payload)
      setPendingSend(null)
      setPickerOpen(false)
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: { message?: string } } } }
      alert(e?.response?.data?.detail?.message || tDetail('errorSend'))
    } finally { setSending(null) }
  }

  if (loading) return (
    <div className="min-h-screen bg-[#F5F0E8] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-green-700 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!order) return null

  const isDraft = order.status === 'DRAFT'
  const isCancelled = order.status === 'CANCELLED'
  // 2026-06-19 — READY_FOR_PICKUP joins the cancel-blocked set.
  // Once approved the commercial transaction is committed; the
  // dealer's hand-over endpoint is the only way out.
  const canCancel = !['DRAFT', 'CANCELLED', 'PURCHASED', 'REJECTED', 'REROUTED', 'READY_FOR_PICKUP'].includes(order.status)
  const canApprove = order.status === 'SENT_FOR_APPROVAL'
  const statusKeys: readonly string[] = [
    'DRAFT', 'SENT', 'ACCEPTED', 'AVAILABLE', 'POSTPONED', 'NOT_AVAILABLE',
    'SENT_FOR_APPROVAL', 'READY_FOR_PICKUP', 'PURCHASED', 'REJECTED', 'CANCELLED', 'REROUTED',
  ]
  const statusCopy = statusKeys.includes(order.status)
    ? t(`status.${order.status}` as 'status.DRAFT')
    : order.status
  const toneClass = STATUS_TONE[order.status] || 'bg-slate-100'

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={tDetail('headerTitle')} activeRole="FARMER"
        back={order.subscription_id ? `/crop-detail/${order.subscription_id}/orders?tab=manage` : '/orders'} />
      <div className="pt-16 pb-24 px-4 space-y-4 max-w-lg mx-auto">

        <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] mt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-[#6B3F1F] truncate">{order.variety_name || t('unknownVariety')}</p>
              <p className="text-xs text-[#7A8C7E]">{cropDisplayName(order.crop_cosh_id)}</p>
            </div>
            <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${toneClass}`}>
              {statusCopy}
            </span>
          </div>
          {order.unit && order.quantity != null && (
            <p className="text-xs text-[#7A8C7E] mt-2">
              {order.quantity} {order.unit}
              {order.total_price != null && order.status === 'PURCHASED' ? ` · ₹${order.total_price}` : ''}
            </p>
          )}
          {/* QR verification — only meaningful once the farmer has
              taken delivery (PURCHASED) AND the seed company has
              actually rolled out QR authentication for this variety
              (qr_available from backend). Otherwise the Scan CTA
              would send them chasing a QR that isn't on the package. */}
          {order.status === 'PURCHASED' && (
            order.scan_verified ? (
              <span className="inline-block mt-3 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                ✓ {tQr('verified')}
              </span>
            ) : order.qr_available ? (
              <button onClick={() => setScanning(true)}
                className="mt-3 text-xs bg-[#3A7D44] text-white px-3 py-1.5 rounded-full font-medium">
                {tQr('scanButton')}
              </button>
            ) : null
          )}
        </div>

        {/* Dealer-submitted qty/price awaiting farmer approval */}
        {canApprove && order.unit && order.quantity != null && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-sm font-semibold text-amber-900 mb-2">{tDetail('dealerSubmittedTitle')}</p>
            <div className="space-y-1 text-sm text-[#6B3F1F]">
              <p><span className="text-[#7A8C7E]">{tDetail('quantityLabel')}</span>{order.quantity} {order.unit}</p>
              {order.total_price != null && (
                <p><span className="text-[#7A8C7E]">{tDetail('priceLabel')}</span>₹{order.total_price}</p>
              )}
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={approveOrder} disabled={busy}
                className="flex-1 py-3 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #3A7D44, #22773a)' }}>
                {tDetail('approveCta')}
              </button>
              <button onClick={rejectOrder} disabled={busy}
                className="px-5 py-3 rounded-2xl bg-red-100 text-[#D4682E] font-semibold text-sm">
                {tDetail('rejectCta')}
              </button>
            </div>
          </div>
        )}

        {/* READY_FOR_PICKUP — receive-confirmation banner.
            Mirrors the regular-order ReceiveBanner so the farmer's
            seed flow looks identical to pesticide / fertilizer. */}
        {order.status === 'READY_FOR_PICKUP' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-xs text-amber-800 mb-2">
              {tDetail('pickupBannerBody')}
            </p>
            <button onClick={() => setConfirmReceive(true)} disabled={busy}
              className="w-full bg-[#085041] text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
              {tDetail('pickupConfirmCta')}
            </button>
          </div>
        )}

        {/* DRAFT — picker CTA */}
        {isDraft && (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900 leading-relaxed">
              <p className="font-semibold mb-1">{tDetail('draftTitle')}</p>
              <p>{tDetail('draftBody')}</p>
            </div>
            <button onClick={openPicker}
              className="w-full py-4 rounded-2xl text-white font-semibold text-sm"
              style={{ background: 'linear-gradient(135deg, #3A7D44, #22773a)' }}>
              {tDetail('pickRecipientCta')}
            </button>
          </>
        )}

        {/* POSTPONED — explainer + cancel CTA below */}
        {order.status === 'POSTPONED' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900 leading-relaxed">
            {tDetail('postponedBody')}
          </div>
        )}

        {/* NOT_AVAILABLE — explainer + cancel CTA below */}
        {order.status === 'NOT_AVAILABLE' && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800 leading-relaxed">
            {tDetail('notAvailableBody')}
          </div>
        )}

        {/* Cancel */}
        {canCancel && (
          <button onClick={cancelOrder} disabled={busy}
            className="w-full py-3 rounded-2xl border-2 border-red-200 text-[#D4682E] font-semibold text-sm disabled:opacity-50">
            {tDetail('cancelOrderCta')}
          </button>
        )}

        {/* Delete husk */}
        {isCancelled && (
          <button onClick={deleteHusk} disabled={busy}
            className="w-full py-3 rounded-2xl border-2 border-slate-200 text-slate-600 font-semibold text-sm disabled:opacity-50">
            {tDetail('deleteOrderCta')}
          </button>
        )}
      </div>

      {/* Picker sheet — same shape as /orders/[id] for consistency */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => !sending && setPickerOpen(false)}>
          <div className="bg-white rounded-t-2xl w-full max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
            <div className="px-4 py-3 border-b border-[#DDD0B8] flex items-center justify-between">
              <p className="font-semibold text-[#6B3F1F]">{tDetail('pickerTitle')}</p>
              <button onClick={() => !sending && setPickerOpen(false)} className="text-[#7A8C7E] text-xl">×</button>
            </div>
            <div className="flex border-b border-[#DDD0B8]">
              {(['dealers', 'facilitators'] as const).map(tabKey => (
                <button key={tabKey} onClick={() => setPickerTab(tabKey)}
                  className={`flex-1 py-3 text-sm font-medium ${pickerTab === tabKey ? 'text-[#6B3F1F] border-b-2 border-[#3A7D44]' : 'text-[#7A8C7E]'}`}>
                  {tabKey === 'dealers'
                    ? tDetail('pickerTabDealers', { count: dealers.length })
                    : tDetail('pickerTabFacilitators', { count: facilitators.length })}
                </button>
              ))}
            </div>
            <div className="p-4 space-y-3">
              {pickerLoading ? (
                [1, 2, 3].map(i => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)
              ) : (pickerTab === 'dealers' ? dealers : facilitators).length === 0 ? (
                <div className="text-center py-10 text-sm text-[#7A8C7E]">
                  {pickerTab === 'dealers' ? tDetail('emptyDealers') : tDetail('emptyFacilitators')}
                </div>
              ) : (
                (pickerTab === 'dealers' ? dealers : facilitators).map(r => {
                  const isDealer = pickerTab === 'dealers'
                  const busy = sending === r.user_id
                  return (
                    <div key={r.user_id} className="bg-white border border-[#DDD0B8] rounded-xl p-3 flex items-center justify-between">
                      <div className="min-w-0 mr-3">
                        <p className="font-semibold text-[#6B3F1F] text-sm truncate">{r.name}</p>
                        {isDealer && r.shop_name && <p className="text-xs text-[#7A8C7E] truncate">{r.shop_name}</p>}
                        {typeof r.distance_km === 'number' && <p className="text-xs text-[#7A8C7E]">{tDetail('kmAway', { km: r.distance_km })}</p>}
                        {r.is_promoter && <span className="text-[10px] text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded-full font-medium">{tDetail('promoterBadge')}</span>}
                      </div>
                      <button onClick={() => requestSend(r, isDealer)}
                        disabled={!!sending}
                        className="shrink-0 px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                        style={{ background: '#3A7D44' }}>
                        {busy ? tDetail('sendingCta') : tDetail('sendCta')}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
      <ConfirmSendOrderSheet
        open={!!pendingSend}
        inputType={tCommon('inputType.seed')}
        recipient={recipientLabel(
          pendingSend?.isDealer ?? false,
          pendingSend?.r ?? null,
          tCommon('unknownRecipient'),
        )}
        busy={!!sending}
        onCancel={() => setPendingSend(null)}
        onConfirm={() => {
          if (pendingSend) sendToRecipient(pendingSend.r, pendingSend.isDealer)
        }}
      />

      {/* 2026-06-21 — Receive confirmation sheet (parity with regular
          order ReceiveBanner's confirm modal). */}
      {scanning && (
        <QRScannerModal
          seedOrderId={order.id}
          onClose={() => setScanning(false)}
          onVerified={load}
        />
      )}
      {confirmReceive && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={() => !busy && setConfirmReceive(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">{tDetail('pickupConfirmTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mt-2">{tDetail('pickupConfirmBody')}</p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmReceive(false)} disabled={busy}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                {tDetail('pickupCancelCta')}
              </button>
              <button onClick={markReceived} disabled={busy}
                className="flex-1 bg-[#085041] text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {busy ? '…' : tDetail('pickupYesCta')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
