'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

// 2026-06-05 — Postponed surface rebuild per user direction:
// - One card per Order (not per item). Header carries farmer
//   identity + company + order date range + when the order was
//   received. Body lists the postponed items belonging to that
//   order, each with its own days-remaining + action buttons.
// - Three buttons per item: Available / NA / Later. Later is a
//   frontend-only "skip this item now" — keeps the original
//   postpone window, just collapses the buttons so the dealer can
//   focus on the rest. Hidden when days_remaining <= 1 (the dealer
//   is forced to decide on the last day).
// - When every item in a card is resolved (Available/NA) or
//   skipped via Later, the card collapses out of the way.
// - Expired postpones are pre-filtered server-side — they've
//   already returned to the farmer.

interface PostponedItem {
  item_id: string
  order_id: string
  subscription_id: string
  display_name: string
  farmer_name: string
  farmer_phone: string | null
  farmer_photo_url: string | null
  client_name: string | null
  category: string | null
  date_from: string | null
  date_to: string | null
  order_received_at: string | null
  postponed_until: string | null
  days_remaining: number | null
  order_status: string
}

interface OrderGroup {
  order_id: string
  subscription_id: string
  farmer_name: string
  farmer_phone: string | null
  farmer_photo_url: string | null
  client_name: string | null
  category: string | null
  date_from: string | null
  date_to: string | null
  order_received_at: string | null
  items: PostponedItem[]
}

function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

function shortDate(iso: string | null, locale: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short' })
}

export default function DealerPostponedPage() {
  const router = useRouter()
  const t = useTranslations('dealer.postponed')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  const [items, setItems] = useState<PostponedItem[] | null>(null)
  const [confirmNA, setConfirmNA] = useState<PostponedItem | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Items the dealer has "skipped for now" — frontend-only. Resets
  // when the page is reloaded. No backend writes.
  const [skipped, setSkipped] = useState<Set<string>>(new Set())

  async function load() {
    const { data } = await api.get<PostponedItem[]>('/dealer/postponed-items')
    setItems(data)
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [])

  function nowAvailable(it: PostponedItem) {
    router.push(`/dealer/orders/${it.order_id}?focus_item=${it.item_id}`)
  }

  async function notAvailable(it: PostponedItem) {
    setBusy(it.item_id)
    try {
      await api.put(`/dealer/orders/${it.order_id}/items/${it.item_id}/not-available`, {})
      setConfirmNA(null)
      load()
    } finally { setBusy(null) }
  }

  function laterSkip(it: PostponedItem) {
    setSkipped(prev => {
      const next = new Set(prev)
      next.add(it.item_id)
      return next
    })
  }

  // Group items by order_id, preserving the backend's chronological
  // order (earliest-received order first).
  const groups: OrderGroup[] = useMemo(() => {
    if (!items) return []
    const byOrder = new Map<string, OrderGroup>()
    for (const it of items) {
      let g = byOrder.get(it.order_id)
      if (!g) {
        g = {
          order_id: it.order_id,
          subscription_id: it.subscription_id,
          farmer_name: it.farmer_name,
          farmer_phone: it.farmer_phone,
          farmer_photo_url: it.farmer_photo_url,
          client_name: it.client_name,
          category: it.category,
          date_from: it.date_from,
          date_to: it.date_to,
          order_received_at: it.order_received_at,
          items: [],
        }
        byOrder.set(it.order_id, g)
      }
      g.items.push(it)
    }
    return Array.from(byOrder.values())
  }, [items])

  // A group disappears from the visible list when every item has been
  // either acted on (no longer in the items list after a refresh) or
  // dealer-skipped via Later for this session.
  const visibleGroups = groups.filter(g => g.items.some(i => !skipped.has(i.item_id)))

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/home" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto space-y-3">
        <p className="text-xs text-[#7A8C7E] mt-4 leading-relaxed">
          {t('intro')}
        </p>

        {items === null && (
          <div className="m-4 h-20 bg-white/60 rounded-2xl animate-pulse" />
        )}
        {items !== null && visibleGroups.length === 0 && (
          <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center">
            <p className="text-sm text-[#7A8C7E]">{t('emptyTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mt-1">{t('emptyHint')}</p>
          </div>
        )}

        {visibleGroups.map(g => {
          const remainingItems = g.items.filter(i => !skipped.has(i.item_id))
          return (
            <div key={g.order_id}
              className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">

              {/* Order header — farmer + company + dates */}
              <div className="p-4 bg-amber-50/50 border-b border-amber-200">
                <div className="flex items-start gap-3">
                  {g.farmer_photo_url ? (
                    <img src={g.farmer_photo_url} alt={g.farmer_name}
                      className="w-12 h-12 rounded-full object-cover border border-amber-300 shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-amber-200/60 border border-amber-300 shrink-0 flex items-center justify-center">
                      <span className="text-sm font-bold text-amber-900">{initials(g.farmer_name)}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#6B3F1F] truncate">{g.farmer_name}</p>
                    {g.client_name && (
                      <p className="text-xs text-[#7A8C7E] truncate">{g.client_name}</p>
                    )}
                    <p className="text-[11px] text-[#7A8C7E] mt-0.5">
                      {g.category && (
                        <span className="uppercase tracking-wider font-medium text-[10px]">
                          {g.category.toLowerCase()}
                        </span>
                      )}
                      {g.category && g.order_received_at && ' · '}
                      {g.order_received_at && (
                        <>{t('receivedShort', { date: shortDate(g.order_received_at, locale) })}</>
                      )}
                    </p>
                    {g.date_from && g.date_to && (
                      <p className="text-[11px] text-[#7A8C7E]">
                        {t('orderRange', { from: shortDate(g.date_from, locale), to: shortDate(g.date_to, locale) })}
                      </p>
                    )}
                  </div>
                  {g.farmer_phone && (
                    <a href={`tel:${g.farmer_phone}`}
                      className="text-[11px] bg-white text-[#7D4196] border border-amber-300 px-2.5 py-1 rounded-lg shrink-0 font-semibold">
                      {t('callBtn')}
                    </a>
                  )}
                </div>
              </div>

              {/* Postponed items */}
              <div className="divide-y divide-amber-100">
                {remainingItems.map(it => {
                  const dr = it.days_remaining
                  // Hide Later when on the last day (must decide).
                  const allowLater = dr !== null && dr > 1
                  return (
                    <div key={it.item_id} className="p-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-semibold text-[#6B3F1F] truncate">
                          {it.display_name}
                        </p>
                        {dr !== null && (
                          <p className={`text-[11px] font-medium shrink-0 ${
                            dr <= 1 ? 'text-red-600' : 'text-amber-700'
                          }`}>
                            {dr === 0 ? t('dueToday') : t('daysLeft', { count: dr })}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => nowAvailable(it)}
                          className="flex-1 bg-green-600 text-white text-[11px] font-semibold py-2 rounded-lg">
                          {t('ctaAvailable')}
                        </button>
                        <button onClick={() => setConfirmNA(it)}
                          className="flex-1 bg-red-100 text-[#D4682E] text-[11px] font-semibold py-2 rounded-lg">
                          {t('ctaNa')}
                        </button>
                        {allowLater && (
                          <button onClick={() => laterSkip(it)}
                            className="flex-1 bg-amber-100 text-amber-800 text-[11px] font-semibold py-2 rounded-lg">
                            {t('ctaLater')}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {confirmNA && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => setConfirmNA(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5 pb-10" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">{t('confirmNa.title')}</p>
            <p className="text-xs text-[#7A8C7E] mt-2">
              <strong className="text-[#6B3F1F]">{confirmNA.display_name}</strong> {t('confirmNa.bodyMiddle')}{' '}
              {t('confirmNa.farmerParen', { name: confirmNA.farmer_name })}{t('confirmNa.bodySuffix')}
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmNA(null)}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl">
                {tCommon('cancel')}
              </button>
              <button onClick={() => notAvailable(confirmNA)} disabled={busy === confirmNA.item_id}
                className="flex-1 bg-red-100 text-[#D4682E] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {busy === confirmNA.item_id ? '…' : t('confirmNa.yesReturn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
