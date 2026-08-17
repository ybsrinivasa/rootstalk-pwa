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
  // 2026-08-17 — Item's own status. Postponed page now surfaces
  // AVAILABLE items too (post-resolve, awaiting Submit) so the dealer
  // can complete the flow from here. Chip distinguishes the two on
  // the card.
  item_status?: string
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
  const locale = useLocale()
  const [items, setItems] = useState<PostponedItem[] | null>(null)
  // Items the dealer has "skipped for now" — frontend-only. Resets
  // when the page is reloaded. No backend writes.
  const [skipped] = useState<Set<string>>(new Set())
  // 2026-08-16 — Card tap navigates to /dealer/orders/{oid}?scope=postponed
  // (order detail page with postponed-only filter). Inline expand removed
  // per user direction: dealer wants a dedicated action screen, not an
  // accordion where a 2-postponed-item card force-opens buttons inline.

  async function load() {
    const { data } = await api.get<PostponedItem[]>('/dealer/postponed-items')
    setItems(data)
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [])

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
          const soonestDaysRemaining = remainingItems.reduce<number | null>((min, it) => {
            if (it.days_remaining === null) return min
            if (min === null) return it.days_remaining
            return Math.min(min, it.days_remaining)
          }, null)
          return (
            <div key={g.order_id}
              className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">

              {/* 2026-08-16 — Card tap navigates to the dealer detail
                  page scoped to this order's postponed items. The
                  detail page's ?scope=postponed mode filters standalone
                  + relation items to only POSTPONED, and the dealer
                  works through them per-item — Now Available → brand
                  form → Submit for Approval (POSTPONED counts as
                  decided, so the submit-for-approval gate accepts a
                  batch where the OTHER postpones stay untouched). */}
              <button
                type="button"
                onClick={() => router.push(`/dealer/orders/${g.order_id}?scope=postponed`)}
                className="w-full text-left p-4 bg-amber-50/50 active:bg-amber-100/50">
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
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {(() => {
                        // 2026-08-17 — Split by item_status so resolved
                        // (AVAILABLE) items get their own "ready to
                        // submit" chip alongside the still-postponed ones.
                        const postponedN = remainingItems.filter(
                          i => (i.item_status ?? 'POSTPONED') === 'POSTPONED',
                        ).length
                        const readyN = remainingItems.filter(
                          i => i.item_status === 'AVAILABLE',
                        ).length
                        return (
                          <>
                            {postponedN > 0 && (
                              <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                                {postponedN === 1 ? '1 postponed' : `${postponedN} postponed`}
                              </span>
                            )}
                            {readyN > 0 && (
                              <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                                {readyN === 1 ? '1 ready to submit' : `${readyN} ready to submit`}
                              </span>
                            )}
                          </>
                        )
                      })()}
                      {soonestDaysRemaining !== null && (
                        <span className={`text-[10px] font-medium ${
                          soonestDaysRemaining <= 1 ? 'text-red-600' : 'text-amber-700'
                        }`}>
                          {soonestDaysRemaining === 0
                            ? t('dueToday')
                            : t('daysLeft', { count: soonestDaysRemaining })}
                        </span>
                      )}
                      <span className="text-[10px] text-[#7A8C7E] ml-auto shrink-0">›</span>
                    </div>
                  </div>
                  {g.farmer_phone && (
                    <a href={`tel:${g.farmer_phone}`}
                      onClick={e => e.stopPropagation()}
                      className="text-[11px] bg-white text-[#7D4196] border border-amber-300 px-2.5 py-1 rounded-lg shrink-0 font-semibold">
                      {t('callBtn')}
                    </a>
                  )}
                </div>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
