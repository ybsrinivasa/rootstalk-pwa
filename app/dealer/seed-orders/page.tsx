'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

interface SeedOrder {
  id: string; status: string; variety_name: string | null; crop_cosh_id: string | null
  // 2026-06-19 — Backend ships the localised crop name so the
  // card doesn't fall through to the "Crop" placeholder.
  crop_name?: string | null
  // Backend hides variety_name pre-accept so a non-onboarded dealer
  // can't fish for brand-locked variety names. Flag lets us render
  // the "🔒 accept to view" hint instead of the unknown-variety
  // fallback.
  variety_name_hidden?: boolean
  farmer_name: string | null; farm_area_acres: number | null
  unit: string | null; quantity: number | null; total_price: number | null
  created_at: string
}

const STATUS_COLOUR: Record<string, string> = {
  // Batch 13 (Orders V2): seeds share the OrderItem vocabulary —
  // statuses align with the pesticide/fertiliser palette so the
  // dealer's mental model stays the same across both flows.
  DRAFT: 'bg-slate-100 text-[#7A8C7E]',
  SENT: 'bg-indigo-100 text-indigo-700',
  ACCEPTED: 'bg-sky-100 text-sky-700',
  AVAILABLE: 'bg-blue-100 text-blue-700',
  POSTPONED: 'bg-amber-100 text-amber-800',
  NOT_AVAILABLE: 'bg-red-100 text-[#D4682E]',
  SENT_FOR_APPROVAL: 'bg-amber-100 text-amber-700',
  READY_FOR_PICKUP: 'bg-purple-100 text-purple-700',
  PURCHASED: 'bg-emerald-100 text-emerald-700',
  REROUTED: 'bg-slate-100 text-[#7A8C7E]',
  CANCELLED: 'bg-slate-100 text-[#7A8C7E]',
  REJECTED: 'bg-rose-100 text-rose-600',
}

const UNITS = ['Grams', 'Kilograms', 'Numbers']

export default function DealerSeedOrdersPage() {
  const router = useRouter()
  const t = useTranslations('dealer.seedOrders')
  const tCommon = useTranslations('common')
  const [orders, setOrders] = useState<SeedOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [form, setForm] = useState({ unit: 'Kilograms', quantity: '', total_price: '' })
  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState<'pending' | 'done'>('pending')

  const load = () =>
    api.get<SeedOrder[]>('/dealer/seed-orders')
      .then(r => setOrders(r.data))
      .finally(() => setLoading(false))

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [])

  async function accept(id: string) {
    await api.put(`/dealer/seed-orders/${id}/accept`, {})
    load()
  }

  async function submit(id: string) {
    if (!form.quantity) return
    setSubmitting(true)
    try {
      await api.put(`/dealer/seed-orders/${id}/submit-for-approval`, {
        unit: form.unit,
        quantity: parseFloat(form.quantity),
        total_price: form.total_price ? parseFloat(form.total_price) : null,
      })
      setProcessing(null)
      setForm({ unit: 'Kilograms', quantity: '', total_price: '' })
      // 2026-06-19 — Send-for-approval moves the seed into the With
      // Farmer pill on the unified Orders surface. Land the dealer
      // there directly instead of leaving them on this legacy Active
      // tab so the workflow loops back into the canonical view.
      router.push('/dealer/orders?pill=farmer')
    } finally { setSubmitting(false) }
  }

  // Orders V2 Batch 13 — postpone-days picker for seeds
  const [postponeId, setPostponeId] = useState<string | null>(null)
  const [postponeMaxDays, setPostponeMaxDays] = useState(0)
  const [postponeDays, setPostponeDays] = useState(1)
  const [postponeBusy, setPostponeBusy] = useState(false)

  async function openPostpone(id: string) {
    setPostponeBusy(true)
    try {
      const { data } = await api.get<{ max_days: number; can_postpone: boolean }>(
        `/dealer/seed-orders/${id}/postpone-window`,
      )
      if (!data.can_postpone) {
        alert(t('errorPostponeWindow'))
        return
      }
      setPostponeId(id)
      setPostponeMaxDays(data.max_days)
      setPostponeDays(1)
    } finally { setPostponeBusy(false) }
  }

  async function confirmPostpone() {
    if (!postponeId) return
    setPostponeBusy(true)
    try {
      await api.put(`/dealer/seed-orders/${postponeId}/postpone`, {
        days: postponeDays,
      })
      setPostponeId(null)
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: { message?: string } } } }
      alert(e?.response?.data?.detail?.message || t('errorPostpone'))
    } finally { setPostponeBusy(false) }
  }

  // 2026-06-19 — Hand-over completes the seed flow. Farmer-approval
  // parks the order at READY_FOR_PICKUP (purple chip); this action
  // moves it to PURCHASED (terminal).
  async function handover(id: string) {
    if (!confirm(t('confirmHandover'))) return
    try {
      await api.put(`/dealer/seed-orders/${id}/handover`, {})
      load()
    } catch {
      alert(t('errorHandover'))
    }
  }

  async function markNotAvailable(id: string) {
    if (!confirm(t('confirmNa'))) return
    try {
      await api.put(`/dealer/seed-orders/${id}/not-available`, {})
      load()
    } catch {
      alert(t('errorMarkNa'))
    }
  }

  // 2026-06-06 — Blind-accept on fresh seed orders. SENT-state cards
  // surface only Accept + Decline so the dealer can't cherry-pick by
  // staring at the variety + farm area before committing. Decline
  // reuses /not-available (it bounces the order back to the farmer
  // for re-route). Other actions reveal after ACCEPTED.
  const [confirmDecline, setConfirmDecline] = useState<string | null>(null)
  const [declining, setDeclining] = useState(false)
  async function declineOrder(id: string) {
    setDeclining(true)
    try {
      await api.put(`/dealer/seed-orders/${id}/not-available`, {})
      setConfirmDecline(null)
      load()
    } catch {
      alert(t('errorDecline'))
    } finally { setDeclining(false) }
  }

  // NOT_AVAILABLE bounces the order back to the farmer for re-route
  // — the dealer has no further work on it (2026-06-18 fix). Group
  // it with the terminal statuses so the Active tab only carries
  // cards the dealer can still act on.
  const DEALER_DONE_STATUSES = ['PURCHASED', 'CANCELLED', 'REJECTED', 'REROUTED', 'NOT_AVAILABLE']
  const pending = orders.filter(o => !DEALER_DONE_STATUSES.includes(o.status))
  const done = orders.filter(o => DEALER_DONE_STATUSES.includes(o.status))

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/home" />
      <div className="pt-16 pb-24">
        <div className="flex bg-white border-b border-[#DDD0B8]">
          {(['pending', 'done'] as const).map(tabKey => (
            <button key={tabKey} onClick={() => setTab(tabKey)}
              className={`flex-1 py-3 text-sm font-medium capitalize border-b-2 transition-colors ${tab === tabKey ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-[#7A8C7E]'}`}>
              {tabKey === 'pending' ? t('tabActive', { count: pending.length }) : t('tabCompleted')}
            </button>
          ))}
        </div>

        <div className="px-4 mt-4 space-y-3 max-w-lg mx-auto">
          {loading ? <div className="h-24 bg-white rounded-2xl animate-pulse" /> :
            (tab === 'pending' ? pending : done).length === 0 ? (
              <div className="text-center py-16">
                <span className="text-4xl">🌱</span>
                <p className="text-[#7A8C7E] text-sm mt-3">{t('empty')}</p>
              </div>
            ) : (
              (tab === 'pending' ? pending : done).map(order => (
                <div key={order.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <span className="inline-block bg-indigo-50 text-indigo-600 text-xs font-semibold px-2 py-0.5 rounded-full mb-1">
                          {t('seedTag')}
                        </span>
                        <p className="font-bold text-[#6B3F1F]">
                          {order.variety_name
                            || (order.variety_name_hidden
                                  ? t('varietyHiddenUntilAccept')
                                  : t('unknownVariety'))}
                        </p>
                        <p className="text-xs text-[#7A8C7E]">{cropDisplayName(order.crop_cosh_id, order.crop_name)}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLOUR[order.status] || ''}`}>
                        {order.status.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="bg-[#F5F0E8] rounded-xl p-3 text-xs text-[#6B3F1F] space-y-1">
                      {order.farmer_name && <p><span className="text-[#7A8C7E]">{t('farmerLabel')} </span>{order.farmer_name}</p>}
                      {order.farm_area_acres && <p><span className="text-[#7A8C7E]">{t('farmAreaLabel')} </span>{t('farmAreaValue', { acres: order.farm_area_acres })}</p>}
                      {order.unit && order.quantity && (
                        <p><span className="text-[#7A8C7E]">{t('qtyLabel')} </span>{t('qtyValue', { quantity: order.quantity, unit: order.unit })}
                          {order.total_price ? t('priceSuffix', { price: order.total_price }) : ''}
                        </p>
                      )}
                    </div>

                    {/* 2026-06-06 — Blind-accept on SENT seed orders.
                        Mirrors the regular dealer-orders flow: the
                        only decision at SENT is Accept vs Decline.
                        Process / Postpone / Not-Available reveal only
                        after the dealer has accepted. */}
                    {order.status === 'SENT' && processing !== order.id && (
                      <>
                        <p className="mt-3 text-[11px] text-[#7A8C7E]">
                          {t('blindAcceptHint')}
                        </p>
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => accept(order.id)}
                            className="flex-1 bg-emerald-600 text-white text-xs font-semibold py-2.5 rounded-xl">
                            {t('acceptCta')}
                          </button>
                          <button onClick={() => setConfirmDecline(order.id)}
                            className="flex-1 bg-red-100 text-[#D4682E] text-xs font-semibold py-2.5 rounded-xl">
                            {t('declineCta')}
                          </button>
                        </div>
                      </>
                    )}

                    {order.status === 'ACCEPTED' && processing !== order.id && (
                      <button onClick={() => { setProcessing(order.id); setForm({ unit: 'Kilograms', quantity: '', total_price: '' }) }}
                        className="w-full mt-3 bg-indigo-600 text-white text-xs font-semibold py-2.5 rounded-xl">
                        {t('enterQtyPrice')}
                      </button>
                    )}

                    {/* Postpone + Not Available reveal after Accept.
                        Two-button row independent of the primary
                        Process CTA above. */}
                    {(['ACCEPTED', 'POSTPONED'].includes(order.status)) && processing !== order.id && (
                      <div className="mt-2 flex gap-2">
                        {order.status !== 'POSTPONED' && (
                          <button onClick={() => openPostpone(order.id)}
                            disabled={postponeBusy}
                            className="flex-1 bg-amber-100 text-amber-800 text-xs font-semibold py-2.5 rounded-xl disabled:opacity-50">
                            {t('later')}
                          </button>
                        )}
                        <button onClick={() => markNotAvailable(order.id)}
                          className="flex-1 bg-red-100 text-[#D4682E] text-xs font-semibold py-2.5 rounded-xl">
                          {t('notAvailable')}
                        </button>
                      </div>
                    )}

                    {/* Processing form */}
                    {processing === order.id && (
                      <div className="mt-3 bg-[#F5F0E8] rounded-xl p-4 space-y-3">
                        <p className="text-xs font-semibold text-[#6B3F1F]">{t('form.title')}</p>
                        <div>
                          <label className="block text-xs text-[#7A8C7E] mb-1">{t('form.unitLabel')}</label>
                          <div className="flex gap-2">
                            {UNITS.map(u => (
                              <button key={u}
                                onClick={() => setForm(f => ({ ...f, unit: u }))}
                                className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                                  form.unit === u ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-[#6B3F1F] border-[#DDD0B8]'
                                }`}>
                                {u === 'Grams' ? t('units.grams') : u === 'Kilograms' ? t('units.kilograms') : t('units.numbers')}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs text-[#7A8C7E] mb-1">{t('form.qtyLabel')}</label>
                            <input type="number" value={form.quantity}
                              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                              placeholder={t('form.qtyPlaceholder', { unit: form.unit })}
                              className="w-full border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
                          </div>
                          <div>
                            <label className="block text-xs text-[#7A8C7E] mb-1">{t('form.totalPriceLabel')}</label>
                            <input type="number" value={form.total_price}
                              onChange={e => setForm(f => ({ ...f, total_price: e.target.value }))}
                              placeholder={t('form.totalPricePlaceholder')}
                              className="w-full border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => submit(order.id)} disabled={submitting || !form.quantity}
                            className="flex-1 bg-indigo-600 text-white text-xs font-semibold py-2.5 rounded-xl disabled:opacity-40">
                            {submitting ? t('form.sending') : t('form.sendForApproval')}
                          </button>
                          <button onClick={() => setProcessing(null)}
                            className="px-4 border border-[#DDD0B8] text-[#6B3F1F] text-xs font-medium py-2.5 rounded-xl">
                            {tCommon('cancel')}
                          </button>
                        </div>
                      </div>
                    )}

                    {order.status === 'SENT_FOR_APPROVAL' && (
                      <div className="mt-3 bg-amber-50 rounded-xl p-3 text-xs text-amber-700 text-center font-medium">
                        {t('statusBanners.awaitingApproval')}
                      </div>
                    )}
                    {/* 2026-06-19 — Farmer-approval lands here.
                        Dealer's action is to physically hand over
                        the seed packet and confirm via the button. */}
                    {order.status === 'READY_FOR_PICKUP' && (
                      <>
                        <div className="mt-3 bg-purple-50 rounded-xl p-3 text-xs text-purple-800 text-center font-medium">
                          {t('statusBanners.readyForPickup')}
                        </div>
                        <button onClick={() => handover(order.id)}
                          className="w-full mt-2 bg-purple-600 text-white text-xs font-semibold py-2.5 rounded-xl">
                          {t('handoverCta')}
                        </button>
                      </>
                    )}
                    {order.status === 'PURCHASED' && (
                      <div className="mt-3 bg-emerald-50 rounded-xl p-3 text-xs text-emerald-700 text-center font-medium">
                        {t('statusBanners.purchased')}
                      </div>
                    )}
                    {order.status === 'POSTPONED' && (
                      <div className="mt-3 bg-amber-50 rounded-xl p-3 text-xs text-amber-800 text-center font-medium">
                        {t('statusBanners.postponed')}
                      </div>
                    )}
                    {order.status === 'NOT_AVAILABLE' && (
                      <div className="mt-3 bg-red-50 rounded-xl p-3 text-xs text-[#D4682E] text-center font-medium">
                        {t('statusBanners.notAvailable')}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )
          }
        </div>
      </div>

      {/* Batch 13 — Postpone picker. Mirrors the pesticide picker
          on /dealer/orders/[id] so the dealer's gesture is identical
          across both flows. Max-days is fetched from the server. */}
      {postponeId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => !postponeBusy && setPostponeId(null)}>
          <div className="bg-white rounded-t-2xl w-full" onClick={e => e.stopPropagation()}
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
            <div className="px-4 py-3 border-b border-[#DDD0B8] flex items-center justify-between">
              <p className="font-semibold text-[#6B3F1F]">{t('postponeSheet.title')}</p>
              <button onClick={() => !postponeBusy && setPostponeId(null)} className="text-[#7A8C7E] text-xl">×</button>
            </div>
            <div className="p-5">
              <p className="text-sm text-[#7A8C7E] mb-1">{t('postponeSheet.howManyDays')}</p>
              <p className="text-xs text-[#7A8C7E] mb-4">
                {t('postponeSheet.pickRange', { max: postponeMaxDays })}
              </p>
              <div className="flex items-center justify-center gap-3 mb-5">
                <button onClick={() => setPostponeDays(d => Math.max(1, d - 1))}
                  disabled={postponeDays <= 1 || postponeBusy}
                  className="w-12 h-12 rounded-full border border-[#DDD0B8] text-[#6B3F1F] text-xl font-bold disabled:opacity-30">
                  −
                </button>
                <div className="min-w-[80px] text-center">
                  <p className="text-3xl font-bold text-[#6B3F1F]">{postponeDays}</p>
                  <p className="text-xs text-[#7A8C7E]">{t('postponeSheet.dayUnit', { count: postponeDays })}</p>
                </div>
                <button onClick={() => setPostponeDays(d => Math.min(postponeMaxDays, d + 1))}
                  disabled={postponeDays >= postponeMaxDays || postponeBusy}
                  className="w-12 h-12 rounded-full border border-[#DDD0B8] text-[#6B3F1F] text-xl font-bold disabled:opacity-30">
                  +
                </button>
              </div>
              <button onClick={confirmPostpone}
                disabled={postponeBusy}
                className="w-full py-3 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #d97706, #b45309)' }}>
                {postponeBusy ? t('postponeSheet.postponing') : t('postponeSheet.postponeCta', { count: postponeDays })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2026-06-06 — Decline confirmation sheet for SENT seed orders.
          Mirrors the bottom-sheet shape used elsewhere in dealer
          surfaces (z-[60] + safe-area-bottom so it sits above the
          BottomNav). Confirms the dealer-facing wording — the
          back-end action is /not-available which bounces the order
          back to the farmer's queue. */}
      {confirmDecline && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end"
          onClick={() => !declining && setConfirmDecline(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">{t('declineSheet.title')}</p>
            <p className="text-xs text-[#7A8C7E] mt-2">
              {t('declineSheet.body')}
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmDecline(null)} disabled={declining}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                {tCommon('cancel')}
              </button>
              <button onClick={() => declineOrder(confirmDecline)} disabled={declining}
                className="flex-1 bg-red-100 text-[#D4682E] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {declining ? '…' : t('declineSheet.yes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
