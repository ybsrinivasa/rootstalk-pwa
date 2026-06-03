'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

// 2026-06-03 — Dedicated Postponed-items surface for the dealer.
// Per user direction: showing the dealer their full order list is
// distracting when all they want to do is close the postpones they
// themselves opened. Each row carries the minimum to act + a focus
// link to the order detail page that hides everything else.

interface PostponedItem {
  item_id: string
  order_id: string
  subscription_id: string
  display_name: string
  farmer_name: string
  farmer_phone: string | null
  category: string | null
  date_from: string | null
  date_to: string | null
  postponed_until: string | null
  days_remaining: number | null
  order_status: string
}

export default function DealerPostponedPage() {
  const router = useRouter()
  const [items, setItems] = useState<PostponedItem[] | null>(null)
  const [confirmNA, setConfirmNA] = useState<PostponedItem | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    const { data } = await api.get<PostponedItem[]>('/dealer/postponed-items')
    setItems(data)
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [])

  function nowAvailable(it: PostponedItem) {
    // Hand off to the order detail page with a focus filter. The
    // detail page renders only that item + opens its form so the
    // dealer goes straight into brand/qty/price entry.
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

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Postponed items" activeRole="DEALER" back="/dealer/home" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto space-y-3">
        <p className="text-xs text-[#7A8C7E] mt-4 leading-relaxed">
          Items you postponed across all orders. Resolve each one with Now available
          (commits brand + price + qty to the farmer for approval) or Not available.
        </p>

        {items === null && (
          <div className="m-4 h-20 bg-white/60 rounded-2xl animate-pulse" />
        )}
        {items && items.length === 0 && (
          <div className="bg-white border border-[#DDD0B8] rounded-2xl p-6 text-center">
            <p className="text-sm text-[#7A8C7E]">No postponed items right now.</p>
            <p className="text-xs text-[#7A8C7E] mt-1">Items you mark Later will show up here.</p>
          </div>
        )}

        {items && items.map(it => (
          <div key={it.item_id} className="bg-white rounded-2xl border border-amber-200 shadow-sm p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  Postponed
                </span>
                <p className="font-semibold text-[#6B3F1F] mt-1.5">{it.display_name}</p>
                <p className="text-xs text-[#7A8C7E] mt-0.5">
                  {it.farmer_name}{it.category ? ` · ${it.category.toLowerCase()}` : ''}
                </p>
                {it.date_from && it.date_to && (
                  <p className="text-[11px] text-[#7A8C7E] mt-0.5">
                    Order: {new Date(it.date_from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – {new Date(it.date_to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </p>
                )}
                {it.days_remaining !== null && (
                  <p className={`text-[11px] mt-1 font-medium ${it.days_remaining <= 1 ? 'text-red-600' : 'text-amber-700'}`}>
                    {it.days_remaining === 0 ? 'Due today' : `${it.days_remaining} day${it.days_remaining === 1 ? '' : 's'} remaining`}
                  </p>
                )}
              </div>
              {it.farmer_phone && (
                <a href={`tel:${it.farmer_phone}`}
                  className="text-[11px] bg-slate-100 text-[#6B3F1F] px-2.5 py-1 rounded-lg shrink-0 font-medium">
                  📞 Call
                </a>
              )}
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => nowAvailable(it)}
                className="flex-1 bg-green-600 text-white text-xs font-semibold py-2.5 rounded-xl">
                ✓ Now available
              </button>
              <button onClick={() => setConfirmNA(it)}
                className="flex-1 bg-red-100 text-[#D4682E] text-xs font-semibold py-2.5 rounded-xl">
                ✗ Not available
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmNA && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => setConfirmNA(null)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5 pb-10" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">Mark as not available?</p>
            <p className="text-xs text-[#7A8C7E] mt-2">
              <strong className="text-[#6B3F1F]">{confirmNA.display_name}</strong> will be returned to the farmer
              ({confirmNA.farmer_name}). They can send it to another dealer from their review screen.
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmNA(null)}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl">
                Cancel
              </button>
              <button onClick={() => notAvailable(confirmNA)} disabled={busy === confirmNA.item_id}
                className="flex-1 bg-red-100 text-[#D4682E] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {busy === confirmNA.item_id ? '…' : 'Yes, return to farmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
