'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import {
  type DraftEntry, readDraftMap, writeDraftMap, clearDraftForOrder,
} from '@/lib/dealer-drafts'

// Batch 26 — SE-authored element guidance the dealer reads after
// picking a brand. Plant-wise fields are null on area-wise items.
interface ElementBlock {
  dosage_value: number | null
  dosage_unit_cosh_id: string | null
  dosage_unit_name: string | null
  application_method_cosh_id: string | null
  application_method_name: string | null
  vol_per_plant_value: number | null
  vol_per_plant_unit_cosh_id: string | null
  vol_per_plant_unit_name: string | null
}
interface OrderItem {
  id: string; practice_id: string; status: string
  relation_id: string | null; relation_type: string | null; relation_role?: string | null
  brand_cosh_id: string | null; brand_name: string | null
  given_volume: number | null; estimated_volume: number | null
  volume_unit: string | null; price: number | null
  element_block?: ElementBlock | null
}
interface RelationOption {
  option_index: number
  is_compound: boolean
  has_locked_brand: boolean
  visible: boolean
  option_status: 'NEW' | 'AVAILABLE' | 'NOT_AVAILABLE'
  items: OrderItem[]
}
interface RelationPart {
  part_index: number
  options: RelationOption[]
  part_status: 'PENDING' | 'RESOLVED' | 'FAILED'
}
interface RelationGroup {
  relation_id: string
  relation_type: string | null
  parts: RelationPart[]
}
// Batch 24 — farmer context for the dealer's order detail header.
// Crop-age semantics: plant-wise = years (today.year - planting_year),
// area-wise = days (today - crop_start_date).
interface FarmerContext {
  farmer_name: string | null
  farmer_phone: string | null
  crop_name: string | null
  measure: 'PLANT_WISE' | 'AREA_WISE' | null
  age_value: number | null
  age_unit: 'years' | 'days' | null
  farm_area_acres: number | null
  number_of_plants: number | null
}
interface Order {
  id: string; status: string; farmer_user_id: string; client_id: string
  date_from: string; date_to: string; created_at: string
  farmer_context?: FarmerContext
  items: OrderItem[]
  relations?: RelationGroup[]
  standalone_items?: OrderItem[]
  // Batch 28 — server-authoritative in-flight per-item edits the
  // dealer's app debounce-syncs every ~3 s. Hydrated into the
  // client's draft map on mount; IndexedDB mirror lives at
  // `dealer-drafts.ts` so a power-off can't lose partial work.
  dealer_draft?: Record<string, DraftEntry>
}
interface BrandGroup { label: string; brands: { cosh_id: string; name: string; manufacturer: string | null }[] }
interface BrandOptions {
  type: 'LOCKED' | 'UNLOCKED'
  locked_brand_cosh_id: string | null; locked_brand_name: string | null
  locked_brand_unit_family?: 'solid' | 'liquid' | 'discrete' | null
  groups: BrandGroup[]
  // Batch 25 — formulation-derived unit family per brand. The Given-
  // Volume Unit dropdown reads from `unit_options_by_family[family]`
  // to constrain what the dealer can pick once a brand is selected.
  brand_unit_family?: Record<string, 'solid' | 'liquid' | 'discrete'>
  unit_options_by_family?: Record<'solid' | 'liquid' | 'discrete', string[]>
}
interface PackingItem {
  id: string; brand_name: string | null; given_volume: number | null
  volume_unit: string | null; price: number | null; status: string
}
interface PackingList {
  order_id: string; farmer_name: string | null; farmer_phone: string | null
  items: PackingItem[]; total_amount: number
}
interface DuplicateCheck {
  would_duplicate: boolean
  duplicate_input_name: string | null
  suggested_alternatives: number[]
}

const STATUS_COLOUR: Record<string, string> = {
  PENDING: 'bg-slate-100 text-[#6B3F1F]',
  AVAILABLE: 'bg-green-100 text-green-700',
  POSTPONED: 'bg-amber-100 text-amber-700',
  NOT_AVAILABLE: 'bg-red-100 text-[#D4682E]',
  SENT_FOR_APPROVAL: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-rose-100 text-rose-600',
  NOT_NEEDED: 'bg-slate-100 text-[#7A8C7E]',
  SKIPPED: 'bg-slate-100 text-[#7A8C7E]',
  REMOVED: 'bg-slate-100 text-[#7A8C7E]',
}

const PART_STATUS_COLOUR: Record<string, string> = {
  PENDING: 'bg-slate-100 text-[#6B3F1F] border-[#DDD0B8]',
  RESOLVED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  FAILED: 'bg-red-100 text-[#D4682E] border-red-200',
}

export default function DealerOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<Order | null>(null)
  const [packingList, setPackingList] = useState<PackingList | null>(null)
  const [showPacking, setShowPacking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [brandOptions, setBrandOptions] = useState<BrandOptions | null>(null)
  const [showBrandSheet, setShowBrandSheet] = useState(false)
  const [itemEdit, setItemEdit] = useState({ brand_cosh_id: '', brand_name: '', given_volume: '', volume_unit: 'kg', price: '' })
  const [estimating, setEstimating] = useState(false)
  const [estimate, setEstimate] = useState<{ volume: number; unit: string } | null>(null)
  // Per-relation: which Part is currently expanded (defaults to first PENDING)
  const [expandedPartByRelation, setExpandedPartByRelation] = useState<Record<string, number>>({})
  // Duplicate-check modal
  const [dupModal, setDupModal] = useState<
    | null
    | { relationId: string; partIndex: number; optionIndex: number; check: DuplicateCheck }
  >(null)
  const [committingOption, setCommittingOption] = useState<string | null>(null)

  // Batch 28 — draft state. Map of item_id -> {brand_cosh_id, brand_name,
  // given_volume, volume_unit, price}. On mount we read the server copy
  // from the order payload and merge IDB on top (IDB wins for entries
  // present in both — the user's most recent local edit). After that,
  // `itemEdit` changes get debounced into PUT /draft/{item_id} + IDB.
  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({})
  const draftSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSyncedItem = useRef<string | null>(null)

  const load = async () => {
    try {
      const { data } = await api.get<Order>(`/dealer/orders/${orderId}`)
      setOrder(data)
      // Batch 28 — server payload + IDB hydration. IDB entries win
      // over server entries for the same item id: if both exist, the
      // local one is by definition newer or equal (the debounced
      // sync writes to IDB first, server second).
      const server = data.dealer_draft || {}
      const local = await readDraftMap(orderId)
      setDrafts({ ...server, ...local })
      // Auto-expand the first PENDING Part for each relation
      if (data.relations) {
        setExpandedPartByRelation(prev => {
          const next = { ...prev }
          for (const rel of data.relations || []) {
            if (next[rel.relation_id] !== undefined) continue
            const firstPending = rel.parts.find(p => p.part_status === 'PENDING')
            if (firstPending) next[rel.relation_id] = firstPending.part_index
            else if (rel.parts[0]) next[rel.relation_id] = rel.parts[0].part_index
          }
          return next
        })
      }
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  // Orders V2 Batch 2: presence heartbeat. While the dealer is on
  // this screen, ping the server every 20 s. The server stamps a
  // 30-s lease on the order; the farmer's cancel endpoint refuses
  // while the lease is in the future. Closing the tab or
  // navigating away clears the interval and the lease expires
  // naturally within 30 s. Network errors are swallowed — the
  // worst case is the lease lapses and the farmer can cancel.
  useEffect(() => {
    if (!orderId || !getToken()) return
    let cancelled = false
    const ping = () => {
      if (cancelled) return
      api.put(`/dealer/orders/${orderId}/heartbeat`, {}).catch(() => {})
    }
    ping()  // first heartbeat right away so the lease lands fast
    const handle = setInterval(ping, 20_000)
    return () => { cancelled = true; clearInterval(handle) }
  }, [orderId])

  // Batch 28 — debounced sync of in-flight per-item edits. Every
  // time itemEdit changes for an open item, wait ~3 s of typing
  // quiet then write to IDB and PUT to the server. The IDB write
  // is synchronous-feeling so even a power-off seconds later won't
  // lose work; the server PUT is the cross-device source of truth.
  useEffect(() => {
    if (!editingItem || !orderId) return
    // Skip the synthetic edit fired by openItemForm — no point
    // round-tripping the values we just hydrated.
    if (lastSyncedItem.current === editingItem &&
        !itemEdit.brand_cosh_id && !itemEdit.given_volume && !itemEdit.price) {
      return
    }
    if (draftSyncTimer.current) clearTimeout(draftSyncTimer.current)
    draftSyncTimer.current = setTimeout(async () => {
      const entry: DraftEntry = {
        brand_cosh_id: itemEdit.brand_cosh_id || null,
        brand_name: itemEdit.brand_name || null,
        given_volume: itemEdit.given_volume ? parseFloat(itemEdit.given_volume) : null,
        volume_unit: itemEdit.volume_unit || null,
        price: itemEdit.price ? parseFloat(itemEdit.price) : null,
      }
      const hasAny = Object.values(entry).some(v => v !== null && v !== '')
      const next = { ...drafts }
      if (hasAny) next[editingItem] = entry
      else delete next[editingItem]
      setDrafts(next)
      await writeDraftMap(orderId, next)
      try {
        await api.put(
          `/dealer/orders/${orderId}/draft/${editingItem}`,
          hasAny ? entry : {},
        )
      } catch {
        // server-side sync best-effort; IDB still has it for next mount
      }
    }, 3000)
    return () => {
      if (draftSyncTimer.current) clearTimeout(draftSyncTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemEdit, editingItem, orderId])

  async function acceptOrder() {
    setAccepting(true)
    try {
      await api.put(`/dealer/orders/${orderId}/accept`, {})
      load()
    } finally { setAccepting(false) }
  }

  async function openItemForm(item: OrderItem) {
    setEditingItem(item.id)
    setEstimate(null)
    // Batch 28 — draft beats the item's committed fields. The dealer
    // closed the screen mid-edit with no Mark-Available; on re-open,
    // the in-flight values resurface so they don't have to type again.
    const d = drafts[item.id] || {}
    lastSyncedItem.current = item.id  // skip the immediate sync on open
    setItemEdit({
      brand_cosh_id: d.brand_cosh_id ?? item.brand_cosh_id ?? '',
      brand_name: d.brand_name ?? item.brand_name ?? '',
      given_volume: d.given_volume != null
        ? String(d.given_volume)
        : (item.given_volume != null ? String(item.given_volume) : ''),
      volume_unit: d.volume_unit ?? item.volume_unit ?? 'kg',
      price: d.price != null
        ? String(d.price)
        : (item.price != null ? String(item.price) : ''),
    })

    try {
      const { data } = await api.get<BrandOptions>(`/dealer/orders/${orderId}/items/${item.id}/brand-options`)
      setBrandOptions(data)
      if (data.type === 'LOCKED' && data.locked_brand_name) {
        const family = data.locked_brand_unit_family
        const defaultUnit = family && data.unit_options_by_family
          ? data.unit_options_by_family[family]?.[0]
          : undefined
        setItemEdit(f => ({
          ...f,
          brand_cosh_id: data.locked_brand_cosh_id || '',
          brand_name: data.locked_brand_name || '',
          volume_unit: defaultUnit || f.volume_unit,
        }))
        // Batch 27 — auto-fire BL-06 estimate for locked-brand flow
        // too, so the dealer sees the estimate without an extra tap.
        void getEstimate(item.id, defaultUnit)
      }
    } catch { setBrandOptions(null) }
  }

  async function getEstimate(itemId: string, brandUnitOverride?: string) {
    setEstimating(true)
    setEstimate(null)
    try {
      const qs = brandUnitOverride ? `?brand_unit=${encodeURIComponent(brandUnitOverride)}` : ''
      const { data } = await api.get(`/dealer/orders/${orderId}/items/${itemId}/volume-estimate${qs}`)
      if (data.estimated_volume) {
        setEstimate({ volume: data.estimated_volume, unit: data.volume_unit })
        setItemEdit(f => ({ ...f, given_volume: String(data.estimated_volume), volume_unit: data.volume_unit || f.volume_unit }))
      }
    } catch { } finally { setEstimating(false) }
  }

  async function markAvailable(itemId: string) {
    if (!itemEdit.given_volume) return
    // Batch 28 — cancel any pending debounced sync so we don't race
    // the AVAILABLE flip with a stale draft write that would
    // recreate the entry the server just cleared.
    if (draftSyncTimer.current) {
      clearTimeout(draftSyncTimer.current)
      draftSyncTimer.current = null
    }
    await api.put(`/dealer/orders/${orderId}/items/${itemId}/available`, {
      brand_name: itemEdit.brand_name || null,
      brand_cosh_id: itemEdit.brand_cosh_id || null,
      given_volume: parseFloat(itemEdit.given_volume),
      volume_unit: itemEdit.volume_unit,
      price: itemEdit.price ? parseFloat(itemEdit.price) : null,
    })
    // Drop matching entry locally + from IDB.
    const nextDrafts = { ...drafts }
    delete nextDrafts[itemId]
    setDrafts(nextDrafts)
    await writeDraftMap(orderId, nextDrafts)
    setEditingItem(null)
    setEstimate(null)
    setBrandOptions(null)
    setItemEdit({ brand_cosh_id: '', brand_name: '', given_volume: '', volume_unit: 'kg', price: '' })
    load()
  }

  // Orders V2 Batch 7 — postpone-days picker
  const [postponeItemId, setPostponeItemId] = useState<string | null>(null)
  const [postponeMaxDays, setPostponeMaxDays] = useState<number>(0)
  const [postponeDays, setPostponeDays] = useState<number>(1)
  const [postponeBusy, setPostponeBusy] = useState(false)

  async function openPostponePicker(itemId: string) {
    setPostponeBusy(true)
    try {
      const { data } = await api.get<{
        max_days: number; can_postpone: boolean; remaining_days: number
        timeline_end: string | null
      }>(`/dealer/orders/${orderId}/items/${itemId}/postpone-window`)
      if (!data.can_postpone || data.max_days < 1) {
        alert(`This item's window is too tight to postpone. ${data.remaining_days} day(s) remain — please mark Available or Not Available.`)
        return
      }
      setPostponeItemId(itemId)
      setPostponeMaxDays(data.max_days)
      setPostponeDays(1)
    } finally { setPostponeBusy(false) }
  }

  async function confirmPostpone() {
    if (!postponeItemId) return
    setPostponeBusy(true)
    try {
      await api.put(`/dealer/orders/${orderId}/items/${postponeItemId}/postpone`, {
        days: postponeDays,
      })
      setPostponeItemId(null)
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: { code?: string; message?: string } } } }
      const detail = e?.response?.data?.detail
      if (detail && typeof detail === 'object' && detail.message) {
        alert(detail.message)
      } else {
        alert('Could not postpone the item. Please try again.')
      }
    } finally { setPostponeBusy(false) }
  }

  async function markUnavailable(itemId: string) {
    await api.put(`/dealer/orders/${orderId}/items/${itemId}/not-available`, {})
    load()
  }

  // ── Relation actions ────────────────────────────────────────────────────────

  async function tryPickOption(relationId: string, partIndex: number, optionIndex: number) {
    const key = `${relationId}-${partIndex}-${optionIndex}`
    setCommittingOption(key)
    try {
      const { data } = await api.post<DuplicateCheck>(
        `/dealer/orders/${orderId}/relations/${relationId}/parts/${partIndex}/check-duplicate`,
        { option_index: optionIndex },
      )
      if (data.would_duplicate) {
        setDupModal({ relationId, partIndex, optionIndex, check: data })
        return
      }
      await commitSelectOption(relationId, partIndex, optionIndex)
    } finally {
      setCommittingOption(null)
    }
  }

  async function commitSelectOption(relationId: string, partIndex: number, optionIndex: number) {
    await api.post(
      `/dealer/orders/${orderId}/relations/${relationId}/parts/${partIndex}/select-option`,
      { option_index: optionIndex },
    )
    setDupModal(null)
    load()
  }

  async function markOptionNotAvailable(relationId: string, partIndex: number, optionIndex: number) {
    await api.post(
      `/dealer/orders/${orderId}/relations/${relationId}/parts/${partIndex}/mark-option-not-available`,
      { option_index: optionIndex },
    )
    load()
  }

  async function submitForApproval() {
    if (!order) return
    setSubmitting(true)
    try {
      await api.put(`/dealer/orders/${orderId}/submit-for-approval`, {})
      load()
    } finally { setSubmitting(false) }
  }

  async function loadPackingList() {
    const { data } = await api.get<PackingList>(`/dealer/orders/${orderId}/packing-list`)
    setPackingList(data)
    setShowPacking(true)
  }

  function selectBrand(cosh_id: string, name: string) {
    // Derive default unit from the brand's formulation family so
    // the BL-06 lookup has a brand_unit to key on (the volume-estimate
    // endpoint returns BRAND_UNIT_MISSING otherwise).
    const family = brandOptions?.brand_unit_family?.[cosh_id]
      ?? brandOptions?.locked_brand_unit_family
    const defaultUnit = family && brandOptions?.unit_options_by_family
      ? brandOptions.unit_options_by_family[family]?.[0]
      : undefined
    setItemEdit(f => ({
      ...f,
      brand_cosh_id: cosh_id,
      brand_name: name,
      volume_unit: defaultUnit || f.volume_unit,
    }))
    setShowBrandSheet(false)
    // Batch 27 — auto-fire BL-06 estimate as soon as the brand is
    // committed. The dealer no longer has to tap a "Calculate"
    // button; the estimated volume appears in the guidance block
    // and pre-fills the Given-Volume input.
    if (editingItem) {
      void getEstimate(editingItem, defaultUnit)
    }
  }

  // Standalone items: items without a relation_id (or without relation_role)
  const standaloneItems = useMemo<OrderItem[]>(() => {
    if (!order) return []
    if (order.standalone_items && order.standalone_items.length >= 0 && order.relations) {
      return order.standalone_items
    }
    return order.items.filter(i => !(i.relation_id && i.relation_role))
  }, [order])

  const relations = order?.relations || []

  if (loading || !order) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#085041] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const activeItems = order.items.filter(i =>
    !['NOT_NEEDED', 'SKIPPED', 'REMOVED', 'APPROVED', 'SENT_FOR_APPROVAL'].includes(i.status)
  )
  const canSubmit = activeItems.some(i => i.status === 'AVAILABLE') &&
    order.status === 'PROCESSING' &&
    activeItems.filter(i => i.status === 'AVAILABLE').every(i => i.given_volume)

  const showPL = ['SENT_FOR_APPROVAL', 'PARTIALLY_APPROVED', 'COMPLETED'].includes(order.status)

  // Batch 27 — Total amount footer. `price` is the line-item total
  // the dealer entered for the given volume (e.g., "2 kg · ₹500"
  // means ₹500 for the whole 2 kg). Sum across every AVAILABLE
  // item that has a price. Price is optional, so partial coverage
  // is expected — show "N of M priced" so the dealer sees coverage.
  const pricedItems = activeItems.filter(
    i => i.status === 'AVAILABLE' && i.price != null
  )
  const availableItemCount = activeItems.filter(i => i.status === 'AVAILABLE').length
  const totalAmount = pricedItems.reduce((s, i) => s + i.price!, 0)

  // ── Renderers ───────────────────────────────────────────────────────────────

  function renderItemRow(item: OrderItem, opts: { compactMeta?: boolean } = {}) {
    return (
      <div key={item.id} className="bg-white rounded-xl border border-[#DDD0B8] p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex gap-1.5 flex-wrap">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[item.status] || 'bg-slate-100 text-[#6B3F1F]'}`}>
                {item.status.replace(/_/g, ' ')}
              </span>
            </div>
            {!opts.compactMeta && (
              <p className="text-[10px] text-[#7A8C7E] font-mono mt-1 truncate">{item.practice_id}</p>
            )}
            {item.brand_name && <p className="text-sm font-semibold text-[#6B3F1F] mt-1">{item.brand_name}</p>}
            {item.given_volume != null && (
              <p className="text-xs text-[#7A8C7E] mt-0.5">
                {item.given_volume} {item.volume_unit}{item.price != null ? ` · ₹${item.price}` : ''}
              </p>
            )}
          </div>
        </div>

        {order!.status === 'PROCESSING' && item.status === 'AVAILABLE' && !item.brand_name && editingItem !== item.id && (
          <button onClick={() => openItemForm(item)}
            className="mt-2 w-full bg-[#085041] text-white text-xs font-semibold py-2 rounded-lg">
            Pick brand & volume
          </button>
        )}
        {order!.status === 'PROCESSING' && item.status === 'AVAILABLE' && item.brand_name && editingItem !== item.id && (
          <button onClick={() => openItemForm(item)}
            className="mt-2 w-full border border-[#DDD0B8] text-[#6B3F1F] text-xs font-medium py-2 rounded-lg">
            Edit details
          </button>
        )}

        {editingItem === item.id && renderInlineForm(item)}
      </div>
    )
  }

  function renderInlineForm(item: OrderItem) {
    return (
      <div className="mt-3 space-y-2.5 bg-[#F5F0E8] rounded-xl p-3">
        {brandOptions?.type === 'LOCKED' ? (
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
            <p className="text-xs text-blue-500 font-medium mb-0.5">Locked brand (pre-specified)</p>
            <p className="text-sm font-bold text-blue-900">{brandOptions.locked_brand_name}</p>
          </div>
        ) : (
          // Batch 25 — three-group dropdown only. The manual brand
          // text input was removed (2026-05-31): "In the current UI
          // you've allowed the dealer to enter a brand name manually.
          // That shouldn't be allowed. It will make room for
          // manipulations."  If the dealer's brand isn't in the list,
          // they use the Report-Missing-Brand flow further down.
          <button onClick={() => setShowBrandSheet(true)}
            className="w-full flex items-center justify-between border border-[#DDD0B8] rounded-lg px-3 py-2.5 bg-white text-sm text-left">
            <span className={itemEdit.brand_name ? 'text-[#6B3F1F] font-medium' : 'text-[#7A8C7E]'}>
              {itemEdit.brand_name || 'Select brand…'}
            </span>
            <span className="text-[#7A8C7E] text-xs">▼</span>
          </button>
        )}

        {/* Batch 26 — SE-authored guidance shown ONCE the dealer has
            committed to a brand. Pre-brand-selection this stays
            collapsed so the dealer focuses on the picker; once a
            brand lands we surface Recommended Dosage, Application
            Method, and (plant-wise only) Volume per Plant — the
            three pieces of SE guidance that frame the Given-Volume
            entry below. */}
        {(itemEdit.brand_cosh_id || brandOptions?.type === 'LOCKED') && item.element_block && (
          <ElementGuidance
            block={item.element_block}
            estimate={estimate}
            estimating={estimating}
          />
        )}

        {/* Batch 25 — Unit dropdown constrained to the brand's
            formulation family. Solid brands get kg/g, liquid brands
            get L/ml, discrete brands get numbers. Falls back to the
            full set when no brand is picked yet. */}
        {(() => {
          const family = brandOptions?.brand_unit_family?.[itemEdit.brand_cosh_id]
            ?? brandOptions?.locked_brand_unit_family
            ?? null
          const allowed = family && brandOptions?.unit_options_by_family
            ? brandOptions.unit_options_by_family[family]
            : ['kg', 'g', 'L', 'mL', 'numbers']
          return (
            <div className="grid grid-cols-3 gap-2">
              <input type="number" value={itemEdit.given_volume}
                onChange={e => setItemEdit(f => ({ ...f, given_volume: e.target.value }))}
                placeholder="Qty *"
                className="border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
              <select value={itemEdit.volume_unit}
                onChange={e => setItemEdit(f => ({ ...f, volume_unit: e.target.value }))}
                className="border border-[#DDD0B8] rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                {allowed.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <input type="number" value={itemEdit.price}
                onChange={e => setItemEdit(f => ({ ...f, price: e.target.value }))}
                placeholder="₹ Price"
                className="border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
            </div>
          )
        })()}
        <div className="flex gap-2">
          <button onClick={() => markAvailable(item.id)}
            disabled={!itemEdit.given_volume}
            className="flex-1 bg-green-600 text-white text-xs font-semibold py-2.5 rounded-xl disabled:opacity-40">
            Save details
          </button>
          <button onClick={() => { setEditingItem(null); setEstimate(null); setBrandOptions(null) }}
            className="px-4 border border-[#DDD0B8] text-[#6B3F1F] text-xs font-medium py-2.5 rounded-xl">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  function renderRelation(rel: RelationGroup) {
    const expandedPart = expandedPartByRelation[rel.relation_id]
    const totalParts = rel.parts.length
    const resolvedParts = rel.parts.filter(p => p.part_status === 'RESOLVED').length
    const failedParts = rel.parts.filter(p => p.part_status === 'FAILED').length

    return (
      <div key={rel.relation_id}
        className="bg-emerald-50/40 border-l-4 border-[#085041] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-emerald-100/60">
          <p className="text-xs font-semibold text-[#085041] uppercase tracking-wider">
            Multi-step recommendation
          </p>
          <p className="text-xs text-[#7A8C7E] mt-0.5">
            Process each Part. {resolvedParts} of {totalParts} resolved
            {failedParts > 0 ? `, ${failedParts} returned to farmer` : ''}.
          </p>
          {/* Step indicator */}
          <div className="flex gap-1.5 mt-2">
            {rel.parts.map(p => {
              const colour =
                p.part_status === 'RESOLVED' ? 'bg-emerald-500' :
                p.part_status === 'FAILED' ? 'bg-red-400' :
                p.part_index === expandedPart ? 'bg-[#085041]' : 'bg-slate-300'
              return <div key={p.part_index} className={`h-1.5 flex-1 rounded-full ${colour}`} />
            })}
          </div>
        </div>

        <div className="p-3 space-y-3">
          {rel.parts.map(part => {
            const isExpanded = part.part_index === expandedPart
            return (
              <div key={part.part_index} className="bg-white rounded-xl border border-[#DDD0B8] overflow-hidden">
                <button
                  onClick={() => setExpandedPartByRelation(prev => ({
                    ...prev,
                    [rel.relation_id]: isExpanded ? -1 : part.part_index,
                  }))}
                  className="w-full flex items-center justify-between px-4 py-3 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[#6B3F1F]">Part {part.part_index}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${PART_STATUS_COLOUR[part.part_status]}`}>
                      {part.part_status}
                    </span>
                  </div>
                  <span className="text-[#7A8C7E] text-xs">{isExpanded ? '▾' : '▸'}</span>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 space-y-2.5">
                    {part.part_status === 'FAILED' && (
                      <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">
                        All Options unavailable. Items in this Part have been returned to the farmer.
                      </div>
                    )}
                    {part.options.filter(o => o.visible).map(opt => renderOption(rel.relation_id, part, opt))}
                    {part.options.some(o => !o.visible) && (
                      <p className="text-[11px] text-[#7A8C7E] italic px-1">
                        Some alternative Options will appear if no Locked-brand Option works.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderOption(relationId: string, part: RelationPart, opt: RelationOption) {
    const optKey = `${relationId}-${part.part_index}-${opt.option_index}`
    const isCommitting = committingOption === optKey
    const optionPickable = part.part_status === 'PENDING' && opt.option_status === 'NEW'
    const tone =
      opt.option_status === 'AVAILABLE' ? 'border-emerald-300 bg-emerald-50/40' :
      opt.option_status === 'NOT_AVAILABLE' ? 'border-red-200 bg-red-50/30 opacity-70' :
      'border-[#DDD0B8] bg-white'
    return (
      <div key={opt.option_index} className={`rounded-xl border ${tone} overflow-hidden`}>
        <div className="px-3 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#6B3F1F]">
              Option {opt.option_index}
              {opt.is_compound ? ' (compound)' : ''}
            </span>
            {opt.has_locked_brand && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                Locked brand
              </span>
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[opt.option_status] || 'bg-slate-100 text-[#6B3F1F]'}`}>
              {opt.option_status.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

        <div className="px-3 pb-3 space-y-2">
          {opt.items.map(it => renderItemRow(it, { compactMeta: true }))}

          {optionPickable && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => tryPickOption(relationId, part.part_index, opt.option_index)}
                disabled={isCommitting}
                className="flex-1 bg-[#085041] text-white text-xs font-semibold py-2.5 rounded-lg disabled:opacity-50">
                {isCommitting ? 'Checking…' : 'Mark Option Available'}
              </button>
              <button
                onClick={() => markOptionNotAvailable(relationId, part.part_index, opt.option_index)}
                className="flex-1 bg-red-100 text-[#D4682E] text-xs font-semibold py-2.5 rounded-lg">
                Mark Not Available
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderStandaloneItem(item: OrderItem) {
    return (
      <div key={item.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden">
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex gap-1.5 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[item.status] || 'bg-slate-100 text-[#6B3F1F]'}`}>
                  {item.status.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-xs text-[#7A8C7E] font-mono mt-1.5 truncate">{item.practice_id}</p>
              {item.brand_name && <p className="text-sm font-semibold text-[#6B3F1F] mt-1">{item.brand_name}</p>}
              {item.given_volume != null && (
                <p className="text-xs text-[#7A8C7E] mt-0.5">
                  {item.given_volume} {item.volume_unit}{item.price != null ? ` · ₹${item.price}` : ''}
                </p>
              )}
            </div>
          </div>

          {order!.status === 'PROCESSING' && item.status === 'PENDING' && editingItem !== item.id && (
            <div className="flex gap-2 mt-3">
              <button onClick={() => openItemForm(item)}
                className="flex-1 bg-green-600 text-white text-xs font-semibold py-2.5 rounded-xl">
                ✓ Available
              </button>
              <button onClick={() => openPostponePicker(item.id)}
                disabled={postponeBusy}
                className="flex-1 bg-amber-100 text-amber-700 text-xs font-semibold py-2.5 rounded-xl disabled:opacity-50">
                ⏰ Later
              </button>
              <button onClick={() => markUnavailable(item.id)}
                className="flex-1 bg-red-100 text-[#D4682E] text-xs font-semibold py-2.5 rounded-xl">
                ✗ N/A
              </button>
            </div>
          )}

          {editingItem === item.id && renderInlineForm(item)}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Order Details" activeRole="DEALER" back="/dealer/orders" />
      <div className="pt-16 pb-24 px-4 space-y-4 max-w-lg mx-auto">

        {/* Batch 24 — farmer context. The dealer needs farmer name,
            a tap-to-call number, crop, crop age, and acres/plants
            to make sense of the order. Per user 2026-05-31. */}
        {order.farmer_context && <FarmerContextCard ctx={order.farmer_context} />}

        {/* Header card */}
        <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] mt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[#7A8C7E]">Order status</p>
              <p className="font-semibold text-[#6B3F1F]">{order.status.replace(/_/g, ' ')}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[#7A8C7E]">Date range</p>
              <p className="text-xs text-[#6B3F1F]">
                {new Date(order.date_from).toLocaleDateString()} — {new Date(order.date_to).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        {/* Accept CTA */}
        {order.status === 'SENT' && (
          <button onClick={acceptOrder} disabled={accepting}
            className="w-full py-4 rounded-2xl bg-[#085041] text-white font-semibold text-sm disabled:opacity-50">
            {accepting ? 'Accepting…' : 'Accept Order & Start Processing'}
          </button>
        )}

        {/* Relations (Build C) */}
        {relations.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-[#6B3F1F] px-1">
              Multi-step recommendations ({relations.length})
            </p>
            {relations.map(renderRelation)}
          </div>
        )}

        {/* Standalone items */}
        {standaloneItems.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-[#6B3F1F] px-1">
              Standalone items ({standaloneItems.length})
            </p>
            {standaloneItems.map(renderStandaloneItem)}
          </div>
        )}

        {pricedItems.length > 0 && (
          <div className="bg-white border-2 border-[#085041]/15 rounded-2xl p-4 flex items-baseline justify-between gap-3">
            <div>
              <p className="text-[11px] text-[#7A8C7E] uppercase tracking-wide">Total amount</p>
              <p className="text-[10px] text-[#7A8C7E] mt-0.5">
                {pricedItems.length} of {availableItemCount} priced
              </p>
            </div>
            <p className="text-2xl font-bold text-[#085041]">₹{totalAmount.toLocaleString('en-IN')}</p>
          </div>
        )}

        {canSubmit && (
          <button onClick={submitForApproval} disabled={submitting}
            className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #054a3a, #085041)' }}>
            {submitting ? 'Sending…' : '✓ Send to Farmer for Approval'}
          </button>
        )}

        {order.status === 'SENT_FOR_APPROVAL' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
            <p className="text-amber-700 font-semibold text-sm">Waiting for farmer approval</p>
          </div>
        )}

        {showPL && (
          <button onClick={loadPackingList}
            className="w-full py-3.5 rounded-2xl border-2 border-[#085041] text-[#085041] font-semibold text-sm">
            View Packing List
          </button>
        )}

        {order.status === 'COMPLETED' && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
            <p className="text-emerald-700 font-semibold text-sm">Order Complete</p>
          </div>
        )}
      </div>

      {/* Brand selection bottom sheet */}
      {showBrandSheet && brandOptions && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setShowBrandSheet(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl pb-10 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#DDD0B8]">
              <p className="font-bold text-[#6B3F1F]">Select Brand</p>
              <button onClick={() => setShowBrandSheet(false)} className="text-[#7A8C7E] text-xl">✕</button>
            </div>
            {brandOptions.groups.every(g => g.brands.length === 0) ? (
              <div className="px-5 py-8 text-center">
                <p className="text-[#7A8C7E] text-sm font-medium">No brands in system yet</p>
                <p className="text-[#7A8C7E] text-xs mt-1">Enter brand name manually below, or report a missing brand</p>
                <button onClick={() => setShowBrandSheet(false)}
                  className="mt-4 px-4 py-2 bg-slate-100 rounded-xl text-sm text-[#6B3F1F] font-medium">
                  Enter manually
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {brandOptions.groups.map((group, gi) => group.brands.length > 0 && (
                  <div key={gi}>
                    <p className="px-5 pt-4 pb-2 text-xs font-bold text-[#7A8C7E] uppercase tracking-wider">
                      {group.label}
                    </p>
                    {group.brands.map(brand => (
                      <button key={brand.cosh_id}
                        onClick={() => selectBrand(brand.cosh_id, brand.name)}
                        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#F5F0E8] text-left">
                        <div>
                          <p className="text-sm font-semibold text-[#6B3F1F]">{brand.name}</p>
                          {brand.manufacturer && (
                            <p className="text-xs text-[#7A8C7E]">{brand.manufacturer}</p>
                          )}
                        </div>
                        {/* Batch 25 — group label is the affordance now;
                            the old "Your brand" badge presumed group 0
                            was My Brands but with three groups that's
                            no longer true. The section header tells
                            the dealer where this brand sits. */}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Duplicate-check warning modal */}
      {dupModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDupModal(null)}>
          <div className="bg-white max-w-sm w-full rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-[#6B3F1F]">Possible duplicate purchase</p>
            <p className="text-xs text-[#6B3F1F] mt-2">
              Selecting this Option would result in purchasing
              {' '}
              <span className="font-semibold text-[#6B3F1F]">{dupModal.check.duplicate_input_name}</span>
              {' '}
              twice in this order.
            </p>
            {dupModal.check.suggested_alternatives.length > 0 ? (
              <p className="text-xs text-[#6B3F1F] mt-2">
                Suggested alternative Option(s):
                {' '}
                <span className="font-semibold text-[#085041]">
                  {dupModal.check.suggested_alternatives.join(', ')}
                </span>
              </p>
            ) : (
              <p className="text-xs text-[#7A8C7E] mt-2 italic">
                No alternative Option in this Part avoids the duplicate.
              </p>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setDupModal(null)}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl">
                Cancel
              </button>
              <button
                onClick={() => commitSelectOption(dupModal.relationId, dupModal.partIndex, dupModal.optionIndex)}
                className="flex-1 bg-[#085041] text-white text-sm font-semibold py-2.5 rounded-xl">
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Packing list bottom sheet */}
      {showPacking && packingList && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setShowPacking(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5 pb-10 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-bold text-[#6B3F1F] text-base">Packing List</p>
                {packingList.farmer_name && (
                  <p className="text-xs text-[#7A8C7E]">{packingList.farmer_name} · {packingList.farmer_phone}</p>
                )}
              </div>
              <button onClick={() => setShowPacking(false)} className="text-[#7A8C7E] text-xl">✕</button>
            </div>
            <div className="space-y-2">
              {packingList.items.map((item, i) => (
                <div key={item.id} className="flex items-center justify-between py-3 border-b border-[#DDD0B8]">
                  <div>
                    <p className="text-sm font-semibold text-[#6B3F1F]">{item.brand_name || `Item ${i + 1}`}</p>
                    <p className="text-xs text-[#7A8C7E]">{item.given_volume} {item.volume_unit}</p>
                  </div>
                  {item.price != null && <p className="text-sm font-bold text-[#6B3F1F]">₹{item.price}</p>}
                </div>
              ))}
            </div>
            {packingList.total_amount > 0 && (
              <div className="mt-4 pt-3 border-t border-[#DDD0B8] flex items-center justify-between">
                <p className="font-semibold text-[#6B3F1F]">Total</p>
                <p className="font-bold text-lg text-[#6B3F1F]">₹{packingList.total_amount.toFixed(2)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Orders V2 Batch 7 — Postpone picker. Server gives us the max
          days (= remaining timeline window minus one). The dealer
          picks a value; we send `{ days }` to the postpone endpoint
          and the server stamps `postponed_until` in UTC. */}
      {postponeItemId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={() => !postponeBusy && setPostponeItemId(null)}>
          <div className="bg-white rounded-t-2xl w-full" onClick={e => e.stopPropagation()}
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
            <div className="px-4 py-3 border-b border-[#DDD0B8] flex items-center justify-between">
              <p className="font-semibold text-[#6B3F1F]">Postpone this item</p>
              <button onClick={() => !postponeBusy && setPostponeItemId(null)} className="text-[#7A8C7E] text-xl">×</button>
            </div>
            <div className="p-5">
              <p className="text-sm text-[#7A8C7E] mb-1">How many days?</p>
              <p className="text-xs text-[#7A8C7E] mb-4">
                Pick 1 to {postponeMaxDays} — the farmer needs at least one clear day to re-route after the postpone elapses.
              </p>
              <div className="flex items-center justify-center gap-3 mb-5">
                <button onClick={() => setPostponeDays(d => Math.max(1, d - 1))}
                  disabled={postponeDays <= 1 || postponeBusy}
                  className="w-12 h-12 rounded-full border border-[#DDD0B8] text-[#6B3F1F] text-xl font-bold disabled:opacity-30">
                  −
                </button>
                <div className="min-w-[80px] text-center">
                  <p className="text-3xl font-bold text-[#6B3F1F]">{postponeDays}</p>
                  <p className="text-xs text-[#7A8C7E]">day{postponeDays === 1 ? '' : 's'}</p>
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
                {postponeBusy ? 'Postponing…' : `Postpone for ${postponeDays} day${postponeDays === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Batch 26 — Element guidance block ─────────────────────────────────────────
// Three short lines the dealer reads after picking a brand:
//   - Recommended Dosage + Unit
//   - Application Method
//   - Volume per Plant + Unit (plant-wise items only)
// Pure render; values come from the backend's `element_block`.
function ElementGuidance({
  block, estimate, estimating,
}: {
  block: ElementBlock
  estimate: { volume: number; unit: string } | null
  estimating: boolean
}) {
  const rows: { label: string; value: string; emphasis?: boolean }[] = []
  if (block.dosage_value != null) {
    const unit = block.dosage_unit_name || block.dosage_unit_cosh_id || ''
    rows.push({ label: 'Recommended dosage', value: `${block.dosage_value} ${unit}`.trim() })
  }
  if (block.application_method_name) {
    rows.push({ label: 'Application method', value: block.application_method_name })
  }
  if (block.vol_per_plant_value != null) {
    const unit = block.vol_per_plant_unit_name || block.vol_per_plant_unit_cosh_id || ''
    rows.push({ label: 'Volume per plant', value: `${block.vol_per_plant_value} ${unit}`.trim() })
  }
  // Batch 27 — BL-06 estimated volume in the same warm-tan card so
  // the dealer reads SE guidance + computed estimate together, right
  // above the Given-Volume input. "Calculating…" while the request
  // is in flight; empty when no estimate could be computed.
  if (estimating) {
    rows.push({ label: 'Estimated volume', value: 'Calculating…', emphasis: true })
  } else if (estimate) {
    rows.push({ label: 'Estimated volume', value: `${estimate.volume} ${estimate.unit || ''}`.trim(), emphasis: true })
  }
  if (rows.length === 0) return null
  return (
    <div className="bg-[#F5F0E8] border border-[#DDD0B8] rounded-lg p-3 space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] text-[#7A8C7E]">{r.label}</span>
          <span className={`text-xs ${r.emphasis ? 'font-bold text-[#085041]' : 'font-semibold text-[#6B3F1F]'} text-right`}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Batch 24 — farmer context card ────────────────────────────────────────────
// Renders the farmer details + crop context the dealer needs to act on the
// order. Phone is a `tel:` link for one-tap calling. Age renders as days
// (area-wise) or years (plant-wise) per the subscription's measure.
function FarmerContextCard({ ctx }: { ctx: FarmerContext }) {
  const measureLine = ctx.measure === 'PLANT_WISE' && ctx.number_of_plants != null
    ? `${ctx.number_of_plants} plant${ctx.number_of_plants === 1 ? '' : 's'}`
    : ctx.measure === 'AREA_WISE' && ctx.farm_area_acres != null
      ? `${ctx.farm_area_acres} ${ctx.farm_area_acres === 1 ? 'acre' : 'acres'}`
      : null

  const ageLine = ctx.age_value != null && ctx.age_unit
    ? `${ctx.age_value} ${
        ctx.age_unit === 'years'
          ? (ctx.age_value === 1 ? 'year' : 'years')
          : (ctx.age_value === 1 ? 'day' : 'days')
      } old`
    : null

  return (
    <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] mt-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[#7A8C7E]">Farmer</p>
          <p className="font-semibold text-[#6B3F1F] truncate">{ctx.farmer_name || '—'}</p>
        </div>
        {ctx.farmer_phone && (
          <a href={`tel:${ctx.farmer_phone}`}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-100 text-emerald-800 text-xs font-semibold">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Call
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#F0E8D6]">
        <div>
          <p className="text-xs text-[#7A8C7E]">Crop</p>
          <p className="text-sm font-medium text-[#6B3F1F] truncate">{ctx.crop_name || '—'}</p>
          {ageLine && <p className="text-xs text-[#7A8C7E] mt-0.5">{ageLine}</p>}
        </div>
        <div>
          <p className="text-xs text-[#7A8C7E]">
            {ctx.measure === 'PLANT_WISE' ? 'Plants' : 'Area'}
          </p>
          <p className="text-sm font-medium text-[#6B3F1F]">{measureLine || '—'}</p>
        </div>
      </div>
    </div>
  )
}
