'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import AvatarLightbox from '@/components/AvatarLightbox'
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
// Batch 30B — NPK ranking shape (subset of /npk-options response).
interface NPKMixed {
  cosh_id: string; name: string
  n: number; p: number; k: number
  kg_product: number
  // Batch 30C — total over all fertigation applications (= kg_product
  // × applications_multiplier). Same as kg_product for chemical NPK.
  kg_product_total?: number
  delivered: { n: number; p: number; k: number }
  match_target: 'N' | 'P' | 'K'
  total_delivered: number
}
interface NPKStraight {
  cosh_id: string; name: string
  n: number; p: number; k: number
  class: 'STRAIGHT_N' | 'STRAIGHT_P' | 'STRAIGHT_K' | 'MIXED'
  water_soluble: boolean
}
interface NPKOptions {
  is_npk_practice: boolean
  fertigation: boolean
  // Batch 30C — Fertigation multiplier the dealer screen surfaces so
  // the dealer understands "per app × N apps = total kg".
  applications_multiplier?: number
  required_dose: { n: number; p: number; k: number } | null
  ranked_mixed: NPKMixed[]
  enabled_straights: NPKStraight[]
  gap: { n: number; p: number; k: number } | null
}
interface NPKTradeName {
  cosh_id: string; name: string; manufacturer_cosh_id: string | null
}
// Batch 30C — three-group brand picker (spec §3.1). Recommended is
// always empty for NPK because the practice has no BRAND_NAME element;
// hidden in the UI. My Brands = dealer's onboarded manufacturers.
interface NPKTradeNameGroups {
  group_recommended: NPKTradeName[]
  group_my: NPKTradeName[]
  group_other: NPKTradeName[]
}
interface NPKPickedTradeName {
  common_name_cosh_id: string
  trade_name_cosh_id: string
  trade_name: string
}

interface OrderItem {
  id: string; practice_id: string; status: string
  // Fix 2026-06-01: dealer card now reads the SE's COMMON_NAME (or
  // an NPK label) instead of the practice UUID.
  common_name?: string | null
  l2_type?: string | null
  display_name?: string | null
  relation_id: string | null; relation_type: string | null; relation_role?: string | null
  brand_cosh_id: string | null; brand_name: string | null
  given_volume: number | null; estimated_volume: number | null
  volume_unit: string | null; price: number | null
  element_block?: ElementBlock | null
  // Fix 2026-06-01: per-item application window. Orders spanning
  // multiple timelines have different windows per item.
  application_date_from?: string | null
  application_date_to?: string | null
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
  // 2026-06-19 — tap-to-enlarge avatar.
  farmer_photo_url: string | null
  crop_name: string | null
  measure: 'PLANT_WISE' | 'AREA_WISE' | null
  age_value: number | null
  age_unit: 'years' | 'days' | null
  farm_area_acres: number | null
  number_of_plants: number | null
}
// 2026-06-19 — Mirrors FarmerContext so the dealer can call +
// visually identify the facilitator who routed the order. Null on
// orders that came directly from the farmer.
interface FacilitatorContext {
  facilitator_user_id: string
  facilitator_name: string | null
  facilitator_phone: string | null
  facilitator_photo_url: string | null
}
interface Order {
  id: string; status: string; farmer_user_id: string; client_id: string
  // 2026-06-19 — Human-readable Order ID surfaced on the detail header.
  reference_number?: string | null
  date_from: string; date_to: string; created_at: string
  farmer_context?: FarmerContext
  facilitator_context?: FacilitatorContext | null
  items: OrderItem[]
  relations?: RelationGroup[]
  standalone_items?: OrderItem[]
  // Batch 30C — server-side brand consolidation for NPK Volume/Price
  // (spec §4.2). Dealer-facing convenience; farmer view stays per-timeline.
  consolidated_brands?: {
    brand_cosh_id: string
    brand_name: string | null
    volume_unit: string | null
    total_volume: number
    line_count: number
  }[]
  // Batch 28 — server-authoritative in-flight per-item edits the
  // dealer's app debounce-syncs every ~3 s. Hydrated into the
  // client's draft map on mount; IndexedDB mirror lives at
  // `dealer-drafts.ts` so a power-off can't lose partial work.
  dealer_draft?: Record<string, DraftEntry>
  // 2026-06-21 — Packing-state snapshot for the post-share status
  // banner (mirrors /dealer/orders list shape).
  packing_code?: string | null
  packing_list_shared_at?: string | null
  packing_picked_up_at?: string | null
  packing_picked_up_by_role?: 'FARMER' | 'FACILITATOR' | null
  packing_picked_up_by_name?: string | null
  packing_farmer_received_at?: string | null
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
  // Fix 2026-06-01 — per-brand allowed pack units from Cosh's
  // tradenames_units Connect. When present this wins over the
  // formulation-family fallback (above).
  units_by_brand?: Record<string, { cosh_id: string; name: string }[]>
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
  APPROVED: 'bg-purple-100 text-purple-700',
  REJECTED: 'bg-rose-100 text-rose-600',
  NOT_NEEDED: 'bg-slate-100 text-[#7A8C7E]',
  SKIPPED: 'bg-slate-100 text-[#7A8C7E]',
  REMOVED: 'bg-slate-100 text-[#7A8C7E]',
}

const PART_STATUS_COLOUR: Record<string, string> = {
  PENDING: 'bg-slate-100 text-[#6B3F1F] border-[#DDD0B8]',
  RESOLVED: 'bg-purple-100 text-purple-700 border-purple-200',
  FAILED: 'bg-red-100 text-[#D4682E] border-red-200',
}

export default function DealerOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const t = useTranslations('dealer.orderDetail')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  // 2026-06-03 — focus_item=<id> hides everything else and pre-opens
  // the brand form on that one item. Used by /dealer/postponed to
  // route the dealer straight into resolving one postponed item
  // without the noise of the full order.
  const searchParams = useSearchParams()
  const focusItemId = searchParams.get('focus_item')
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
  // Fix 2026-06-01: surface volume-estimate errors so the dealer sees
  // why no estimate appeared (formula missing, brand_unit unknown,
  // etc.) instead of silently nothing.
  const [estimateError, setEstimateError] = useState<string | null>(null)
  // Surfaces server errors from PUT /items/{id}/available (BRAND_REQUIRED,
  // BRAND_NOT_IN_SYSTEM, transition failures, etc.) — previously these
  // bubbled as unhandled promise rejections and the Save button looked
  // dead. 2026-06-02.
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Per-relation: which Part is currently expanded (defaults to first PENDING)
  const [expandedPartByRelation, setExpandedPartByRelation] = useState<Record<string, number>>({})
  // Duplicate-check modal
  const [dupModal, setDupModal] = useState<
    | null
    | { relationId: string; partIndex: number; optionIndex: number; check: DuplicateCheck }
  >(null)
  const [committingOption, setCommittingOption] = useState<string | null>(null)
  // 2026-06-26 — Tracks the (relation, part) currently being reset
  // by the "Change selection" link in a pure-OR Part. Keyed as
  // `${relationId}-${partIndex}`.
  const [resettingPart, setResettingPart] = useState<string | null>(null)
  // Batch 29 — confirm-before-submit + dealer Abort dialog.
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const [showAbortConfirm, setShowAbortConfirm] = useState(false)
  const [aborting, setAborting] = useState(false)
  // Batch 30B — NPK practice screen.
  const [npkOptions, setNpkOptions] = useState<NPKOptions | null>(null)
  const [npkSelectedMixed, setNpkSelectedMixed] = useState<string | null>(null)  // common_name_cosh_id, or null for "skip mixed"
  const [npkPickedTradeNames, setNpkPickedTradeNames] = useState<Record<string, NPKPickedTradeName>>({})  // keyed by common_name_cosh_id
  const [npkPickedStraights, setNpkPickedStraights] = useState<Set<string>>(new Set())  // common_name_cosh_ids
  const [npkTradeNameSheet, setNpkTradeNameSheet] = useState<{ common_name_cosh_id: string; target?: 'N' | 'P' | 'K' } | null>(null)
  const [npkTradeNameList, setNpkTradeNameList] = useState<NPKTradeName[]>([])
  const [npkTradeNameGroups, setNpkTradeNameGroups] = useState<NPKTradeNameGroups | null>(null)
  const [npkSubmitting, setNpkSubmitting] = useState(false)

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

  // 2026-06-03 — focus_item mode: auto-open the brand form on the
  // target item once the order is loaded. Saves the dealer a tap
  // and matches the "go straight into resolving" expectation.
  useEffect(() => {
    if (!focusItemId || !order) return
    const target = order.items?.find(i => i.id === focusItemId)
    if (target && editingItem !== focusItemId) {
      openItemForm(target)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusItemId, order])

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

  // 2026-06-06 — Decline a fresh SENT order. Backend mirrors farmer
  // cancel-with-migrate: original goes CANCELLED, items duplicate to
  // a new DRAFT carrying lineage_root_id so the farmer can pick a
  // new dealer.
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false)
  const [declining, setDeclining] = useState(false)
  async function declineOrder() {
    setDeclining(true)
    try {
      await api.put(`/dealer/orders/${orderId}/decline`, {})
      router.replace('/dealer/orders')
    } catch { alert(t('errors.decline')) }
    finally {
      setDeclining(false)
      setShowDeclineConfirm(false)
    }
  }

  async function openItemForm(item: OrderItem) {
    setEditingItem(item.id)
    setEstimate(null)
    setSaveError(null)
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

    // Batch 30B — NPK detection. The two NPK L2s skip the normal
    // brand picker; the system discovers candidate common names and
    // the dealer picks one Mixed (optional) + Straights (per gap).
    try {
      const { data: npk } = await api.get<NPKOptions>(`/dealer/orders/${orderId}/items/${item.id}/npk-options`)
      if (npk.is_npk_practice) {
        setNpkOptions(npk)
        setNpkSelectedMixed(null)
        setNpkPickedTradeNames({})
        setNpkPickedStraights(new Set())
        return  // skip the brand-options path entirely
      }
      setNpkOptions(null)
    } catch { setNpkOptions(null) }

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
        return
      }
    } catch { setBrandOptions(null) }

    // Fix 2026-06-01 — on re-open of an item with a brand already
    // picked (either committed on the OrderItem, or persisted in the
    // dealer_draft from Batch 28's debounced sync), re-fire the
    // estimate so the dealer doesn't have to re-pick the brand. Sits
    // OUTSIDE the brand-options try-catch because a brand-options
    // blip shouldn't suppress the estimate. The brand_cosh_id itself
    // isn't required by BL-06 — the practice + brand_unit + dosage
    // carries enough. Reuses the `d` draft snapshot from the top of
    // openItemForm.
    const persistedBrand = item.brand_cosh_id || d.brand_cosh_id
    const persistedUnit = item.volume_unit ?? d.volume_unit ?? undefined
    if (persistedBrand) {
      void getEstimate(item.id, persistedUnit ?? undefined)
    }
  }

  async function getEstimate(itemId: string, brandUnitOverride?: string) {
    setEstimating(true)
    setEstimate(null)
    setEstimateError(null)
    try {
      const qs = brandUnitOverride ? `?brand_unit=${encodeURIComponent(brandUnitOverride)}` : ''
      const { data } = await api.get(`/dealer/orders/${orderId}/items/${itemId}/volume-estimate${qs}`)
      if (data.estimated_volume) {
        setEstimate({ volume: data.estimated_volume, unit: data.volume_unit })
        // 2026-06-03 — DO NOT auto-fill `given_volume`. Estimated
        // volume rarely matches a real pack size (1.125 L when packs
        // are 1 L / 500 mL) and the dealer kept committing the raw
        // estimate. Show the estimate as guidance only; the dealer
        // types in the actual pack-multiple. Unit hint is still
        // useful so we keep that pre-fill.
        setItemEdit(f => ({ ...f, volume_unit: data.volume_unit || f.volume_unit }))
      } else if (data.error_code === 'UNIT_PAIR_MISMATCH' && data.message) {
        // Backend caught a brand-unit × dosage-unit phase mismatch
        // (e.g. g brand + ml/L dose). Surface its specific message so
        // the dealer / SE can see what's wrong.
        setEstimateError(data.message)
      } else if (data.error_code === 'FORMULA_NOT_FOUND') {
        // Common pre-launch state — formula table not yet populated
        // for this (measure, L2, method, unit) combination. Don't
        // surface the raw DATA_CONFIG_ERROR; a short hint is enough
        // for the dealer to enter Qty manually.
        setEstimateError(t('errors.estimateUnavailable'))
      } else if (data.message) {
        setEstimateError(data.message)
      }
    } catch { } finally { setEstimating(false) }
  }

  // 2026-06-05 — In focus_item (postpone-resolve) mode, the Save
  // details click first opens a confirmation modal that summarises
  // brand + qty + price and confirms "Send to farmer for approval?"
  // The backend auto-flips POSTPONED → SENT_FOR_APPROVAL on the
  // PUT, so the dealer's confirm = farmer's review queue grows by
  // one item. Outside focus mode (regular order processing) the
  // bulk Submit-for-Approval modal handles that confirmation step;
  // here we mirror it inline since the focus flow has only one
  // item and no batch UI.
  const [showFocusConfirm, setShowFocusConfirm] = useState(false)

  async function markAvailable(itemId: string, opts?: { skipFocusConfirm?: boolean }) {
    if (!itemEdit.given_volume) return
    if (focusItemId === itemId && !opts?.skipFocusConfirm) {
      setShowFocusConfirm(true)
      return
    }
    setSaveError(null)
    setSaving(true)
    // Batch 28 — cancel any pending debounced sync so we don't race
    // the AVAILABLE flip with a stale draft write that would
    // recreate the entry the server just cleared.
    if (draftSyncTimer.current) {
      clearTimeout(draftSyncTimer.current)
      draftSyncTimer.current = null
    }
    try {
      await api.put(`/dealer/orders/${orderId}/items/${itemId}/available`, {
        brand_name: itemEdit.brand_name || null,
        brand_cosh_id: itemEdit.brand_cosh_id || null,
        given_volume: parseFloat(itemEdit.given_volume),
        volume_unit: itemEdit.volume_unit,
        price: itemEdit.price ? parseFloat(itemEdit.price) : null,
      })
    } catch (err) {
      // axios error shape: err.response.data.detail can be a string
      // OR a {error_code, message} object (BL-07 strict-brand errors).
      const e = err as { response?: { data?: { detail?: unknown } } }
      const detail = e.response?.data?.detail
      let msg = t('errors.save')
      if (typeof detail === 'string') msg = detail
      else if (detail && typeof detail === 'object' && 'message' in (detail as object)) {
        msg = String((detail as { message?: unknown }).message ?? msg)
      }
      setSaveError(msg)
      setSaving(false)
      return
    }
    // Drop matching entry locally + from IDB.
    const nextDrafts = { ...drafts }
    delete nextDrafts[itemId]
    setDrafts(nextDrafts)
    await writeDraftMap(orderId, nextDrafts)
    setEditingItem(null)
    setEstimate(null)
    setBrandOptions(null)
    setItemEdit({ brand_cosh_id: '', brand_name: '', given_volume: '', volume_unit: 'kg', price: '' })
    setSaving(false)
    // 2026-06-03 — In focus_item mode, the dealer came in to resolve
    // exactly one postponed item; pop back to the Postponed list
    // when it's saved so they continue with the next one.
    if (focusItemId === itemId) {
      router.replace('/dealer/postponed')
      return
    }
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
        alert(t('errors.postponeWindowTight', { days: data.remaining_days }))
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
        alert(t('errors.postpone'))
      }
    } finally { setPostponeBusy(false) }
  }

  async function markUnavailable(itemId: string) {
    await api.put(`/dealer/orders/${orderId}/items/${itemId}/not-available`, {})
    if (focusItemId === itemId) {
      router.replace('/dealer/postponed')
      return
    }
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

  // 2026-06-26 — Wipes every item in a (relation, part) back to PENDING
  // so the dealer can re-decide a pure-OR Part after an earlier
  // commit. Backend clears brand / volume / price on rows that were
  // AVAILABLE. Only valid while the order is PROCESSING.
  async function resetPart(relationId: string, partIndex: number) {
    const key = `${relationId}-${partIndex}`
    setResettingPart(key)
    try {
      await api.post(
        `/dealer/orders/${orderId}/relations/${relationId}/parts/${partIndex}/reset`,
      )
      await load()
    } finally {
      setResettingPart(null)
    }
  }

  async function submitForApproval() {
    if (!order) return
    setSubmitting(true)
    setSaveError(null)
    try {
      await api.put(`/dealer/orders/${orderId}/submit-for-approval`, {})
      setShowSubmitConfirm(false)
      // Dealer is done with this order — bounce back to /dealer/orders on
      // the Pending pill so the now-Returned-to-Farmer order disappears
      // from view and the feed shows what's actually still pending.
      router.push('/dealer/orders?pill=pending')
    } catch (err) {
      const e = err as { response?: { data?: { detail?: unknown } } }
      const d = e.response?.data?.detail
      let msg = t('errors.submit')
      if (typeof d === 'string') msg = d
      else if (d && typeof d === 'object' && 'message' in (d as object)) {
        msg = String((d as { message?: unknown }).message ?? msg)
      }
      setSaveError(msg)
    } finally { setSubmitting(false) }
  }

  // Batch 30B — NPK handlers.

  async function npkPickMixed(common_name_cosh_id: string | null) {
    setNpkSelectedMixed(common_name_cosh_id)
    // Re-fetch options with the Mixed pick so Straights narrow to the gap.
    if (!editingItem) return
    try {
      const qs = common_name_cosh_id ? `?picked_mixed_cosh_id=${encodeURIComponent(common_name_cosh_id)}` : ''
      const { data: npk } = await api.get<NPKOptions>(`/dealer/orders/${orderId}/items/${editingItem}/npk-options${qs}`)
      setNpkOptions(npk)
      // Drop any picked Straights that the new gap suppressed.
      const stillAllowed = new Set(npk.enabled_straights.map(s => s.cosh_id))
      setNpkPickedStraights(prev => new Set([...prev].filter(id => stillAllowed.has(id))))
      // Drop trade-name picks for those too.
      setNpkPickedTradeNames(prev => {
        const next = { ...prev }
        Object.keys(next).forEach(cn => {
          if (cn !== common_name_cosh_id && !stillAllowed.has(cn)) {
            delete next[cn]
          }
        })
        return next
      })
    } catch { /* noop — keep previous state */ }
  }

  async function npkOpenTradeNameSheet(common_name_cosh_id: string, target?: 'N' | 'P' | 'K') {
    if (!editingItem) return
    setNpkTradeNameSheet({ common_name_cosh_id, target })
    setNpkTradeNameList([])
    setNpkTradeNameGroups(null)
    try {
      const { data } = await api.get<{ trade_names: NPKTradeName[] } & NPKTradeNameGroups>(
        `/dealer/orders/${orderId}/items/${editingItem}/npk-trade-names?common_name_cosh_id=${encodeURIComponent(common_name_cosh_id)}`,
      )
      setNpkTradeNameList(data.trade_names || [])
      setNpkTradeNameGroups({
        group_recommended: data.group_recommended || [],
        group_my: data.group_my || [],
        group_other: data.group_other || [],
      })
    } catch { setNpkTradeNameList([]); setNpkTradeNameGroups(null) }
  }

  function npkPickTradeName(tn: NPKTradeName) {
    if (!npkTradeNameSheet) return
    const cn = npkTradeNameSheet.common_name_cosh_id
    setNpkPickedTradeNames(prev => ({
      ...prev,
      [cn]: { common_name_cosh_id: cn, trade_name_cosh_id: tn.cosh_id, trade_name: tn.name },
    }))
    setNpkTradeNameSheet(null)
  }

  function npkToggleStraight(common_name_cosh_id: string) {
    setNpkPickedStraights(prev => {
      const next = new Set(prev)
      if (next.has(common_name_cosh_id)) {
        next.delete(common_name_cosh_id)
        // Also drop its trade-name pick to keep state consistent.
        setNpkPickedTradeNames(p => {
          const np = { ...p }; delete np[common_name_cosh_id]; return np
        })
      } else {
        next.add(common_name_cosh_id)
      }
      return next
    })
  }

  async function npkSubmit() {
    if (!editingItem || !npkOptions) return
    setNpkSubmitting(true)
    try {
      // Build payload from picks. Mixed pick is optional; each picked
      // Straight must have a trade-name pick (the UI gate already
      // enforces this but be defensive).
      let mixedPayload: { common_name_cosh_id: string; trade_name_cosh_id: string } | null = null
      if (npkSelectedMixed) {
        const tn = npkPickedTradeNames[npkSelectedMixed]
        if (!tn) return  // shouldn't reach
        mixedPayload = {
          common_name_cosh_id: npkSelectedMixed,
          trade_name_cosh_id: tn.trade_name_cosh_id,
        }
      }
      const straightsPayload = [...npkPickedStraights].flatMap(cn => {
        const tn = npkPickedTradeNames[cn]
        const cand = npkOptions.enabled_straights.find(s => s.cosh_id === cn)
        if (!tn || !cand) return []
        const target = cand.class === 'STRAIGHT_N' ? 'N' : cand.class === 'STRAIGHT_P' ? 'P' : 'K'
        return [{
          target_nutrient: target,
          common_name_cosh_id: cn,
          trade_name_cosh_id: tn.trade_name_cosh_id,
        }]
      })
      await api.post(`/dealer/orders/${orderId}/items/${editingItem}/npk-select`, {
        mixed: mixedPayload,
        straights: straightsPayload,
      })
      // Reset NPK state and reload.
      setNpkOptions(null)
      setNpkSelectedMixed(null)
      setNpkPickedTradeNames({})
      setNpkPickedStraights(new Set())
      setEditingItem(null)
      load()
    } finally { setNpkSubmitting(false) }
  }

  // Batch 29 — Abort: dealer returns the order to the pool. Server
  // resets items, wipes the draft map, and flips status back to
  // SENT. We additionally clear the local IndexedDB mirror and
  // bounce to the dealer home so the dealer doesn't sit on a stale
  // detail screen.
  async function abortOrder() {
    if (!order) return
    setAborting(true)
    try {
      await api.put(`/dealer/orders/${orderId}/abort`, {})
      await clearDraftForOrder(orderId)
      router.replace('/dealer/home')
    } finally {
      setAborting(false)
      setShowAbortConfirm(false)
    }
  }

  async function loadPackingList() {
    const { data } = await api.get<PackingList>(`/dealer/orders/${orderId}/packing-list`)
    setPackingList(data)
    setShowPacking(true)
  }

  function selectBrand(cosh_id: string, name: string) {
    // Fix 2026-06-01 — tradenames_units wins. If Cosh has unit rows
    // for this brand, the dropdown shows only those; the default unit
    // is the first one. Falls back to the formulation-family inference
    // when Cosh has no tradenames_units rows yet for this brand.
    const tnUnits = brandOptions?.units_by_brand?.[cosh_id] || []
    let defaultUnit: string | undefined = tnUnits[0]?.name
    if (!defaultUnit) {
      const family = brandOptions?.brand_unit_family?.[cosh_id]
        ?? brandOptions?.locked_brand_unit_family
      defaultUnit = family && brandOptions?.unit_options_by_family
        ? brandOptions.unit_options_by_family[family]?.[0]
        : undefined
    }
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

  // Standalone items: items without a relation_id (or without relation_role).
  // 2026-06-03 — sort so the items the dealer needs to look at first
  // (POSTPONED / NOT_AVAILABLE) land at the top, PENDING in the middle
  // (his open work), and AVAILABLE settled at the bottom. Lets the
  // dealer cross-check the problem cases without scrolling past
  // already-decided items.
  const ITEM_SORT_RANK: Record<string, number> = {
    POSTPONED: 0,
    NOT_AVAILABLE: 1,
    PENDING: 2,
    AVAILABLE: 3,
  }
  const standaloneItems = useMemo<OrderItem[]>(() => {
    if (!order) return []
    const base = (order.standalone_items && order.standalone_items.length >= 0 && order.relations)
      ? order.standalone_items
      : order.items.filter(i => !(i.relation_id && i.relation_role))
    return [...base].sort((a, b) =>
      (ITEM_SORT_RANK[a.status] ?? 9) - (ITEM_SORT_RANK[b.status] ?? 9)
    )
  }, [order])

  const relations = order?.relations || []

  if (loading || !order) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#7D4196] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const activeItems = order.items.filter(i =>
    !['NOT_NEEDED', 'SKIPPED', 'REMOVED', 'APPROVED', 'SENT_FOR_APPROVAL'].includes(i.status)
  )
  // 2026-06-03 — every active item must be decided (no PENDING) before
  // the dealer can submit. Submit succeeds if at least one item is
  // AVAILABLE or NOT_AVAILABLE (both give the farmer something to act on).
  // All-POSTPONED blocks submit — dealer waits, nothing for farmer.
  const pendingCount = activeItems.filter(i => i.status === 'PENDING').length
  const availableCount = activeItems.filter(i => i.status === 'AVAILABLE').length
  const notAvailableCount = activeItems.filter(i => i.status === 'NOT_AVAILABLE').length
  const everyAvailableHasVolume = activeItems
    .filter(i => i.status === 'AVAILABLE')
    .every(i => i.given_volume)
  const canSubmit =
    order.status === 'PROCESSING' &&
    pendingCount === 0 &&
    (availableCount > 0 || notAvailableCount > 0) &&
    everyAvailableHasVolume
  const submitButtonLabel =
    availableCount === 0 && notAvailableCount > 0
      ? t('footer.submitLabelNotify', { count: notAvailableCount })
      : t('footer.submitLabelSend')

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
  // Count N/A items so the submit-confirmation modal can tell the
  // dealer how many items the farmer will see as "returned" — these
  // become his lead to forward to another dealer.
  const notAvailableItemCount = order?.items.filter(
    i => i.status === 'NOT_AVAILABLE'
  ).length || 0

  // ── Renderers ───────────────────────────────────────────────────────────────

  function renderItemRow(
    item: OrderItem,
    opts: {
      compactMeta?: boolean
      // 2026-06-26 — When the parent renders a pure-AND or pure-OR
      // Relation Part as individual items, PENDING rows need the
      // three-button decision row inline. Mirrors the standalone-item
      // surface so the dealer's mental model is one consistent card
      // pattern regardless of whether the item is grouped or not.
      showPendingActions?: boolean
      // 2026-06-26 — In a pure-OR Part, an item that's been resolved
      // by the dealer (AVAILABLE, NOT_AVAILABLE, or auto-NOT_AVAILABLE
      // via sibling pick) carries a single "Change selection" reset
      // button on the chosen leg. The caller owns the reset action;
      // this row just renders the button.
      onChangeSelection?: () => void
      changeSelectionBusy?: boolean
      // 2026-06-26 — Pure-OR Part state once one leg has been
      // committed AVAILABLE. The chosen leg gets the single
      // "Change selection" reset button (replacing both Edit details
      // and the inline link — they're functionally identical for OR).
      // Sibling legs auto-cascaded to NOT_AVAILABLE are visually
      // locked — dimmed, no action buttons of any kind — because
      // they're not real decisions: they were set when the dealer
      // picked the alternative. The only path back is the chosen
      // leg's Reset, which puts the whole Part back to PENDING.
      orGroupState?: 'chosen' | 'locked'
    } = {},
  ) {
    const showPriceColumn = item.status === 'AVAILABLE'
    const isLocked = opts.orGroupState === 'locked'
    const isChosen = opts.orGroupState === 'chosen'
    return (
      <div
        key={item.id}
        className={`bg-white rounded-xl border border-[#DDD0B8] p-3 ${
          isLocked ? 'opacity-60' : ''
        }`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex gap-1.5 flex-wrap">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[item.status] || 'bg-slate-100 text-[#6B3F1F]'}`}>
                {item.status.replace(/_/g, ' ')}
              </span>
            </div>
            {!opts.compactMeta && (
              <p className="text-sm font-semibold text-[#6B3F1F] mt-1 truncate">
                {item.display_name || item.common_name || t('item.practiceFallback')}
              </p>
            )}
            <ItemDateRange from={item.application_date_from} to={item.application_date_to} />
            {item.brand_name && <p className="text-sm font-semibold text-[#6B3F1F] mt-1">{item.brand_name}</p>}
            {item.given_volume != null && (
              <p className="text-xs text-[#7A8C7E] mt-0.5">
                {item.given_volume} {item.volume_unit}
              </p>
            )}
          </div>
          {showPriceColumn && (
            <div className="text-right shrink-0">
              {item.price != null ? (
                <p className="text-base font-bold text-[#7D4196]">₹{item.price.toLocaleString(locale)}</p>
              ) : (
                <p className="text-[10px] text-amber-700 font-medium italic">{t('item.priceNotProvided')}</p>
              )}
            </div>
          )}
        </div>

        {opts.showPendingActions
          && !isLocked
          && order!.status === 'PROCESSING'
          && item.status === 'PENDING'
          && editingItem !== item.id && (
          <div className="flex gap-2 mt-3">
            <button onClick={() => openItemForm(item)}
              className="flex-1 bg-green-600 text-white text-xs font-semibold py-2 rounded-lg">
              {t('item.available')}
            </button>
            <button onClick={() => openPostponePicker(item.id)}
              disabled={postponeBusy}
              className="flex-1 bg-amber-100 text-amber-700 text-xs font-semibold py-2 rounded-lg disabled:opacity-50">
              {t('item.later')}
            </button>
            <button onClick={() => markUnavailable(item.id)}
              className="flex-1 bg-red-100 text-[#D4682E] text-xs font-semibold py-2 rounded-lg">
              {t('item.na')}
            </button>
          </div>
        )}
        {/* OR-chosen leg: single Reset button replaces both Edit
            details and the underline Change-selection link. They were
            functionally identical for an OR group — "change my mind"
            redoes the whole choice. */}
        {isChosen && opts.onChangeSelection
          && order!.status === 'PROCESSING'
          && editingItem !== item.id && (
          <button
            onClick={opts.onChangeSelection}
            disabled={opts.changeSelectionBusy}
            className="mt-3 w-full border border-[#DDD0B8] text-[#6B3F1F] text-xs font-medium py-2 rounded-lg disabled:opacity-50">
            {opts.changeSelectionBusy ? t('relation.changing') : t('relation.changeSelection')}
          </button>
        )}
        {!isChosen && !isLocked
          && order!.status === 'PROCESSING'
          && item.status === 'AVAILABLE' && !item.brand_name && editingItem !== item.id && (
          <button onClick={() => openItemForm(item)}
            className="mt-2 w-full bg-[#7D4196] text-white text-xs font-semibold py-2 rounded-lg">
            {t('item.pickBrandAndVolume')}
          </button>
        )}
        {!isChosen && !isLocked && opts.onChangeSelection
          && order!.status === 'PROCESSING'
          && (item.status === 'AVAILABLE' || item.status === 'NOT_AVAILABLE')
          && editingItem !== item.id && (
          <button
            onClick={opts.onChangeSelection}
            disabled={opts.changeSelectionBusy}
            className="mt-2 w-full text-[11px] text-[#7D4196] underline underline-offset-2 disabled:opacity-50">
            {opts.changeSelectionBusy ? t('relation.changing') : t('relation.changeSelection')}
          </button>
        )}
        {!isChosen && !isLocked
          && order!.status === 'PROCESSING'
          && item.status === 'AVAILABLE' && item.brand_name && editingItem !== item.id && (
          <button onClick={() => openItemForm(item)}
            className="mt-2 w-full border border-[#DDD0B8] text-[#6B3F1F] text-xs font-medium py-2 rounded-lg">
            {t('item.editDetails')}
          </button>
        )}
        {/* 2026-06-03 — Change decision on POSTPONED / NOT_AVAILABLE.
            For NOT_AVAILABLE we keep the order.status === 'PROCESSING'
            gate (a once-NA item revisited only makes sense pre-submit).
            For POSTPONED we relax the gate — the dealer needs to
            resolve postpones AFTER the order is submitted too, because
            that's exactly when "I now have this" or "I cannot supply
            this" happens. Backend's mark_item_available auto-flips
            POSTPONED → SENT_FOR_APPROVAL when order is past PROCESSING,
            so the farmer's review picks the item up automatically. */}
        {!isChosen && !isLocked
          && order!.status === 'PROCESSING'
          && item.status === 'NOT_AVAILABLE' && editingItem !== item.id && (
          <button onClick={() => openItemForm(item)}
            className="mt-2 w-full border border-[#DDD0B8] text-[#6B3F1F] text-xs font-medium py-2 rounded-lg">
            {t('item.changeDecision')}
          </button>
        )}
        {!isChosen && !isLocked
          && item.status === 'POSTPONED' && editingItem !== item.id && (
          <div className="mt-2 flex gap-2">
            <button onClick={() => openItemForm(item)}
              className="flex-1 bg-green-600 text-white text-xs font-semibold py-2 rounded-lg">
              {t('item.nowAvailable')}
            </button>
            <button onClick={() => markUnavailable(item.id)}
              className="flex-1 bg-red-100 text-[#D4682E] text-xs font-semibold py-2 rounded-lg">
              {t('item.notAvailable')}
            </button>
          </div>
        )}

        {editingItem === item.id && renderInlineForm(item)}
      </div>
    )
  }

  function renderInlineForm(item: OrderItem) {
    // Batch 30B — NPK practice path: replace the entire brand-picker
    // form with the discover-and-pick flow per RootsTalk_NPK_Handling
    // §2-3. No common name on the practice; the dealer picks from the
    // system-ranked Mixed list + Straight gap-list.
    if (npkOptions?.is_npk_practice) {
      return renderNPKForm(item)
    }
    return (
      <div className="mt-3 space-y-2.5 bg-[#F5F0E8] rounded-xl p-3">
        {brandOptions?.type === 'LOCKED' ? (
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
            <p className="text-xs text-blue-500 font-medium mb-0.5">{t('form.lockedBrandLabel')}</p>
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
              {itemEdit.brand_name || t('form.selectBrandPlaceholder')}
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
        {/* Fix 2026-06-01: surface the SE's dosage + application method
            BEFORE the dealer picks a brand. Previously gated on brand
            pick, which left this card empty on first open. The
            Estimated Volume row stays gated on brand pick because BL-06
            needs brand_unit. */}
        {item.element_block && (
          <ElementGuidance
            block={item.element_block}
            estimate={estimate}
            estimating={estimating}
            estimateError={estimateError}
          />
        )}

        {/* Fix 2026-06-01 — Unit dropdown sources from Cosh's
            tradenames_units Connect via units_by_brand. Falls back to
            the formulation-family inference when Cosh hasn't shipped
            unit rows for the brand. */}
        {(() => {
          const tnUnits = brandOptions?.units_by_brand?.[itemEdit.brand_cosh_id] || []
          let allowed: string[]
          if (tnUnits.length > 0) {
            allowed = tnUnits.map(u => u.name)
          } else {
            const family = brandOptions?.brand_unit_family?.[itemEdit.brand_cosh_id]
              ?? brandOptions?.locked_brand_unit_family
              ?? null
            allowed = family && brandOptions?.unit_options_by_family
              ? brandOptions.unit_options_by_family[family]
              : ['kg', 'g', 'L', 'mL', 'numbers']
          }
          return (
            <div className="grid grid-cols-3 gap-2">
              <input type="number" value={itemEdit.given_volume}
                onChange={e => setItemEdit(f => ({ ...f, given_volume: e.target.value }))}
                placeholder={t('form.qtyPlaceholder')}
                className="border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
              <select value={itemEdit.volume_unit}
                onChange={e => setItemEdit(f => ({ ...f, volume_unit: e.target.value }))}
                className="border border-[#DDD0B8] rounded-lg px-2 py-2 text-sm bg-white focus:outline-none">
                {allowed.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <input type="number" value={itemEdit.price}
                onChange={e => setItemEdit(f => ({ ...f, price: e.target.value }))}
                placeholder={t('form.pricePlaceholder')}
                className="border border-[#DDD0B8] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none" />
            </div>
          )
        })()}
        {saveError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
            {saveError}
          </div>
        )}
        {!itemEdit.brand_cosh_id && (
          <p className="text-[11px] text-amber-700">{t('form.pickBrandBeforeSaving')}</p>
        )}
        <div className="flex gap-2">
          <button onClick={() => markAvailable(item.id)}
            disabled={!itemEdit.given_volume || !itemEdit.brand_cosh_id || saving}
            className="flex-1 bg-green-600 text-white text-xs font-semibold py-2.5 rounded-xl disabled:opacity-40">
            {saving ? t('form.saving') : t('form.saveDetails')}
          </button>
          <button onClick={() => { setEditingItem(null); setEstimate(null); setBrandOptions(null); setSaveError(null) }}
            className="px-4 border border-[#DDD0B8] text-[#6B3F1F] text-xs font-medium py-2.5 rounded-xl">
            {tCommon('cancel')}
          </button>
        </div>
      </div>
    )
  }

  // Batch 30B — NPK practice form. Required N:P:K at the top, then
  // the ranked Mixed list (single-select with a "Skip" option), then
  // Straights filtered by the gap that remains after the Mixed pick.
  // Brand selection per fertiliser via /npk-trade-names bottom sheet.
  function renderNPKForm(item: OrderItem) {
    if (!npkOptions || !npkOptions.required_dose) return null
    const dose = npkOptions.required_dose
    const gap = npkOptions.gap || dose
    const mixedPick = npkSelectedMixed
    const mixedPickTradeName = mixedPick ? npkPickedTradeNames[mixedPick] : null
    // Submit enabled iff: at least one pick, AND every pick has a trade name.
    const everyPickHasTradeName =
      (!mixedPick || !!mixedPickTradeName) &&
      [...npkPickedStraights].every(cn => !!npkPickedTradeNames[cn])
    const hasAnyPick = !!mixedPick || npkPickedStraights.size > 0
    const canSubmit = hasAnyPick && everyPickHasTradeName
    return (
      <div className="mt-3 space-y-3 bg-[#F5F0E8] rounded-xl p-3">
        <div className="bg-white rounded-lg p-3 border border-[#DDD0B8]">
          <p className="text-[11px] text-[#7A8C7E] uppercase tracking-wide">
            {npkOptions.fertigation ? t('npk.fertigationHeader') : t('npk.dosageHeader')}
          </p>
          <p className="text-sm font-bold text-[#6B3F1F] mt-1">
            {t('npk.doseLine', { n: dose.n, p: dose.p, k: dose.k })}
          </p>
          {npkOptions.fertigation && (npkOptions.applications_multiplier ?? 1) > 1 && (
            <p className="text-[11px] text-[#7D4196] font-semibold mt-1">
              {t('npk.multiplierLine', { multiplier: npkOptions.applications_multiplier ?? 1 })}
            </p>
          )}
        </div>

        {/* Mixed fertilisers — ranked list, single-select. */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[#6B3F1F] px-1">
            {t('npk.mixedHeader')}
          </p>
          {npkOptions.ranked_mixed.length === 0 ? (
            <p className="text-xs text-[#7A8C7E] italic px-2">{t('npk.mixedEmpty')}</p>
          ) : npkOptions.ranked_mixed.map(m => {
            const selected = npkSelectedMixed === m.cosh_id
            const tn = npkPickedTradeNames[m.cosh_id]
            return (
              <div key={m.cosh_id} className={`rounded-lg border ${selected ? 'border-[#7D4196] bg-purple-50/40' : 'border-[#DDD0B8] bg-white'}`}>
                <button onClick={() => npkPickMixed(selected ? null : m.cosh_id)}
                  className="w-full text-left px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-[#6B3F1F]">{m.name}</p>
                      <p className="text-[11px] text-[#7A8C7E]">
                        {t('npk.mixedSummary', { n: m.n, p: m.p, k: m.k, kg: m.kg_product })}
                        {npkOptions.fertigation && m.kg_product_total && m.kg_product_total !== m.kg_product && (
                          <> · <span className="font-semibold text-[#7D4196]">{t('npk.mixedTotalAffix', { kg: m.kg_product_total })}</span></>
                        )}
                      </p>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 ${selected ? 'border-[#7D4196] bg-[#7D4196]' : 'border-[#7A8C7E]'}`} />
                  </div>
                </button>
                {selected && (
                  <div className="px-3 pb-2.5">
                    {tn ? (
                      <button onClick={() => npkOpenTradeNameSheet(m.cosh_id)}
                        className="w-full text-xs font-medium text-[#7D4196] bg-purple-50 border border-[#7D4196]/30 rounded-lg py-1.5">
                        {t('npk.brandPicked', { name: tn.trade_name })}
                      </button>
                    ) : (
                      <button onClick={() => npkOpenTradeNameSheet(m.cosh_id)}
                        className="w-full text-xs font-semibold text-white bg-[#7D4196] rounded-lg py-2">
                        {t('npk.pickBrand')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <button onClick={() => npkPickMixed(null)}
            className={`w-full text-xs font-medium py-2 rounded-lg border ${
              npkSelectedMixed === null
                ? 'border-[#7D4196] bg-purple-50/40 text-[#7D4196]'
                : 'border-[#DDD0B8] text-[#7A8C7E]'
            }`}>
            {t('npk.skipMixed')}
          </button>
        </div>

        {/* Straight fertilisers — gap-filtered, multi-select. */}
        {npkOptions.enabled_straights.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#6B3F1F] px-1">
              {t('npk.straightHeader', { n: gap.n, p: gap.p, k: gap.k })}
            </p>
            {npkOptions.enabled_straights.map(s => {
              const selected = npkPickedStraights.has(s.cosh_id)
              const tn = npkPickedTradeNames[s.cosh_id]
              return (
                <div key={s.cosh_id} className={`rounded-lg border ${selected ? 'border-[#7D4196] bg-purple-50/40' : 'border-[#DDD0B8] bg-white'}`}>
                  <button onClick={() => npkToggleStraight(s.cosh_id)}
                    className="w-full text-left px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[#6B3F1F]">
                        {s.name} <span className="text-[11px] text-[#7A8C7E] font-normal">{t('npk.straightOnly', { letter: s.class.replace('STRAIGHT_', '') })}</span>
                      </p>
                      <div className={`w-4 h-4 rounded ${selected ? 'bg-[#7D4196]' : 'border border-[#7A8C7E]'}`} />
                    </div>
                  </button>
                  {selected && (
                    <div className="px-3 pb-2.5">
                      {tn ? (
                        <button onClick={() => npkOpenTradeNameSheet(s.cosh_id)}
                          className="w-full text-xs font-medium text-[#7D4196] bg-purple-50 border border-[#7D4196]/30 rounded-lg py-1.5">
                          {t('npk.brandPicked', { name: tn.trade_name })}
                        </button>
                      ) : (
                        <button onClick={() => npkOpenTradeNameSheet(s.cosh_id)}
                          className="w-full text-xs font-semibold text-white bg-[#7D4196] rounded-lg py-2">
                          {t('npk.pickBrand')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={npkSubmit} disabled={!canSubmit || npkSubmitting}
            className="flex-1 bg-[#7D4196] text-white text-xs font-semibold py-2.5 rounded-xl disabled:opacity-40">
            {npkSubmitting ? t('npk.committing') : t('npk.commitCta')}
          </button>
          <button onClick={() => {
            setEditingItem(null); setNpkOptions(null)
            setNpkSelectedMixed(null); setNpkPickedTradeNames({}); setNpkPickedStraights(new Set())
          }} className="px-4 border border-[#DDD0B8] text-[#6B3F1F] text-xs font-medium py-2.5 rounded-xl">
            {tCommon('cancel')}
          </button>
        </div>
      </div>
    )
  }

  // 2026-06-26 — Classify a Part by shape so the dealer surface can
  // strip the "Multi-step recommendation" framing for the simple
  // cases. The AND/OR labels are farmer-side semantics (how the
  // farmer applies the inputs); for the dealer they collapse to a
  // flat per-item decision list.
  //  - AND:        one Option, compound (≥ 2 positions). Dealer marks
  //                each Position Available / Later / N/A independently.
  //  - OR:         multiple Options, every Option size 1. Dealer marks
  //                ONE Position Available — siblings auto-resolve via
  //                the existing per-item sibling-cascade in
  //                mark_item_available, and a single "Change selection"
  //                button on the chosen leg resets the Part.
  //  - COMPLEX_OR: multiple Options with at least one compound (e.g.
  //                (A+B) OR (C+D) or (A+B) OR C). Each Option renders
  //                as its own flat block under one outer OR card; the
  //                same sibling cascade locks the non-chosen Options;
  //                a card-level Change-selection button resets the
  //                whole Part.
  //  - COMPLEX:    anything else (residual / IF-gated cases). Falls
  //                back to the existing Part-collapsed + Option-pick UI.
  type PartPattern = 'AND' | 'OR' | 'COMPLEX_OR' | 'COMPLEX'
  function classifyPart(part: RelationPart): PartPattern {
    if (part.options.length === 1 && part.options[0].is_compound) return 'AND'
    if (part.options.length >= 2 && part.options.every(o => !o.is_compound)) return 'OR'
    if (part.options.length >= 2 && part.options.some(o => o.is_compound)) return 'COMPLEX_OR'
    return 'COMPLEX'
  }

  function renderRelation(rel: RelationGroup) {
    // If every Part in this Relation collapses to a flat pattern,
    // drop the heavy "Multi-step recommendation" wrapper — the dealer
    // sees a quiet bordered card per Part with a subtle hint label.
    const allFlat = rel.parts.every(p => classifyPart(p) !== 'COMPLEX')

    if (allFlat) {
      return (
        <div key={rel.relation_id} className="space-y-3">
          {rel.parts.map(part => renderFlatPart(rel, part))}
        </div>
      )
    }

    return renderComplexRelation(rel)
  }

  function renderFlatPart(rel: RelationGroup, part: RelationPart) {
    const pattern = classifyPart(part)
    if (pattern === 'AND')        return renderFlatAndPart(rel, part)
    if (pattern === 'OR')         return renderFlatOrPart(rel, part)
    if (pattern === 'COMPLEX_OR') return renderComplexOrPart(rel, part)
    return null
  }

  function renderFlatAndPart(rel: RelationGroup, part: RelationPart) {
    // AND: the single Option's positions become a flat list of items
    // with independent decisions. The "Apply together" hint reminds
    // the dealer (and the order trail) that the farmer plans to use
    // these as one combined intervention — useful context when
    // something goes NOT_AVAILABLE.
    const items = part.options[0]?.items ?? []
    return (
      <div key={`${rel.relation_id}-${part.part_index}`}
        className="bg-white rounded-xl border border-[#DDD0B8] overflow-hidden">
        <div className="px-3 pt-3 pb-1">
          <p className="text-[11px] text-[#7A8C7E] italic">
            <span className="not-italic font-bold text-[#6B3F1F]">
              {t('relation.andPrefix')}
            </span>
            {' — '}
            {t('relation.andApplyTogether')}
          </p>
        </div>
        <div className="px-3 pb-3 space-y-2">
          {items.map(it => renderItemRow(it, { showPendingActions: true }))}
        </div>
      </div>
    )
  }

  function renderFlatOrPart(rel: RelationGroup, part: RelationPart) {
    // OR: each Option holds exactly one Position. Render each as a
    // per-item row. mark_item_available already cascades siblings
    // to NOT_AVAILABLE for same-Part-different-Option items (see
    // backend audit 2026-06-26), so the dealer's "Available" tap on
    // any leg locks the alternatives without any frontend
    // coordination.
    //
    // Once one leg is AVAILABLE, the OR is decided:
    //   - The chosen leg gets a single "Change selection" reset
    //     button (collapsed from the old Change-selection link +
    //     Edit-details button, which were functionally identical
    //     for OR — both end up redoing the choice).
    //   - The auto-cascaded sibling(s) are visually locked — dimmed,
    //     no action buttons. They're not real decisions; they were
    //     set when the dealer picked the alternative.
    // Reset on the chosen leg sends the whole Part back to PENDING.
    const items = part.options.map(o => o.items[0]).filter(Boolean)
    const hasAvailable = items.some(it => it.status === 'AVAILABLE')
    const partKey = `${rel.relation_id}-${part.part_index}`
    const isResetting = resettingPart === partKey
    return (
      <div key={partKey}
        className="bg-white rounded-xl border border-[#DDD0B8] overflow-hidden">
        <div className="px-3 pt-3 pb-1">
          <p className="text-[11px] text-[#7A8C7E] italic">
            <span className="not-italic font-bold text-[#6B3F1F]">
              {t('relation.orPrefix')}
            </span>
            {' — '}
            {t('relation.orEitherOr')}
          </p>
        </div>
        <div className="px-3 pb-3 space-y-2">
          {items.map(it => {
            let orGroupState: 'chosen' | 'locked' | undefined
            if (hasAvailable) {
              orGroupState = it.status === 'AVAILABLE' ? 'chosen' : 'locked'
            }
            return renderItemRow(it, {
              showPendingActions: true,
              orGroupState,
              onChangeSelection: orGroupState === 'chosen'
                ? () => resetPart(rel.relation_id, part.part_index)
                : undefined,
              changeSelectionBusy: isResetting,
            })
          })}
        </div>
      </div>
    )
  }

  function renderComplexOrPart(rel: RelationGroup, part: RelationPart) {
    // COMPLEX_OR — multiple Options with at least one compound, e.g.
    // (A+B) OR (C+D) or (A+B) OR C. Each Option is flattened into its
    // own block under one outer card:
    //
    //   ┌─ OR — Pick either one ───────────────────┐
    //   │  AND — apply together                    │
    //   │  [A row + buttons]                       │
    //   │  [B row + buttons]                       │
    //   │  ───────  OR  ───────                    │
    //   │  AND — apply together                    │
    //   │  [C row + buttons]                       │
    //   │  [D row + buttons]                       │
    //   │  [Change selection]   (only when chosen) │
    //   └──────────────────────────────────────────┘
    //
    // mark_item_available's cascade already does the locking — once
    // any item in Option 1 is AVAILABLE, every PENDING item in
    // Option 2 becomes NOT_AVAILABLE. We surface that by passing
    // orGroupState='locked' for items in the non-chosen Options, so
    // their cards dim and shed buttons. Items in the chosen Option
    // render normally (Edit details on AVAILABLE rows still works —
    // unlike pure-OR, editing a compound-leg brand isn't the same
    // as redoing the whole choice, so we keep that path).
    //
    // The card-level Change-selection button replaces the inline
    // ones: a compound Option may have multiple AVAILABLE rows, and
    // N inline reset buttons would be noisy.
    const partKey = `${rel.relation_id}-${part.part_index}`
    const isResetting = resettingPart === partKey
    const chosenOpt = part.options.find(o =>
      o.items.some(it => it.status === 'AVAILABLE'),
    )
    const chosenOptionIndex = chosenOpt?.option_index ?? null
    return (
      <div key={partKey}
        className="bg-white rounded-xl border border-[#DDD0B8] overflow-hidden">
        <div className="px-3 py-3 space-y-3">
          {part.options.map((opt, idx) => {
            const isLockedOption = chosenOptionIndex != null
              && opt.option_index !== chosenOptionIndex
            return (
              <div key={opt.option_index}>
                {idx > 0 && (
                  <div className="flex items-center gap-3 my-2">
                    <div className="h-px flex-1 bg-[#DDD0B8]" />
                    <span className="text-[10px] font-bold text-[#7A8C7E] uppercase tracking-wider">
                      {t('relation.orPrefix')}
                    </span>
                    <div className="h-px flex-1 bg-[#DDD0B8]" />
                  </div>
                )}
                {opt.is_compound && (
                  <p className={`text-[11px] italic mb-2 ${
                    isLockedOption ? 'text-[#7A8C7E]/50' : 'text-[#7A8C7E]'
                  }`}>
                    <span className={`not-italic font-bold ${
                      isLockedOption ? 'text-[#6B3F1F]/50' : 'text-[#6B3F1F]'
                    }`}>
                      {t('relation.andPrefix')}
                    </span>
                    {' — '}
                    {t('relation.andApplyTogether')}
                  </p>
                )}
                <div className="space-y-2">
                  {opt.items.map(it => renderItemRow(it, {
                    showPendingActions: true,
                    orGroupState: isLockedOption ? 'locked' : undefined,
                  }))}
                </div>
                {/* 2026-06-26 — Per-Option Change-selection button.
                    Sits at the bottom of each LOCKED Option block, so
                    the dealer's path to "switch to the other set" is
                    discoverable right where their attention is —
                    instead of an abstract card-level reset. Tapping
                    runs the same reset endpoint (whole Part back to
                    PENDING); the locked Option then becomes pickable
                    fresh. Same wording as pure-OR's button. */}
                {isLockedOption && order!.status === 'PROCESSING' && (
                  <button
                    onClick={() => resetPart(rel.relation_id, part.part_index)}
                    disabled={isResetting}
                    className="mt-2 w-full border border-[#DDD0B8] text-[#6B3F1F] text-xs font-medium py-2 rounded-lg disabled:opacity-50">
                    {isResetting ? t('relation.changing') : t('relation.changeSelection')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderComplexRelation(rel: RelationGroup) {
    const expandedPart = expandedPartByRelation[rel.relation_id]
    const totalParts = rel.parts.length
    const resolvedParts = rel.parts.filter(p => p.part_status === 'RESOLVED').length
    const failedParts = rel.parts.filter(p => p.part_status === 'FAILED').length

    return (
      <div key={rel.relation_id}
        className="bg-purple-50/40 border-l-4 border-[#7D4196] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-purple-100/60">
          <p className="text-xs font-semibold text-[#7D4196] uppercase tracking-wider">
            {t('relation.label')}
          </p>
          <p className="text-xs text-[#7A8C7E] mt-0.5">
            {t('relation.progress', { resolved: resolvedParts, total: totalParts })}
            {failedParts > 0 ? t('relation.progressFailedSuffix', { failed: failedParts }) : ''}.
          </p>
          {/* Step indicator */}
          <div className="flex gap-1.5 mt-2">
            {rel.parts.map(p => {
              const colour =
                p.part_status === 'RESOLVED' ? 'bg-purple-500' :
                p.part_status === 'FAILED' ? 'bg-red-400' :
                p.part_index === expandedPart ? 'bg-[#7D4196]' : 'bg-slate-300'
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
                    <span className="text-sm font-bold text-[#6B3F1F]">{t('relation.partLabel', { n: part.part_index })}</span>
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
                        {t('relation.allOptionsUnavailable')}
                      </div>
                    )}
                    {part.options.filter(o => o.visible).map(opt => renderOption(rel.relation_id, part, opt))}
                    {part.options.some(o => !o.visible) && (
                      <p className="text-[11px] text-[#7A8C7E] italic px-1">
                        {t('relation.alternativeHint')}
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
      opt.option_status === 'AVAILABLE' ? 'border-purple-300 bg-purple-50/40' :
      opt.option_status === 'NOT_AVAILABLE' ? 'border-red-200 bg-red-50/30 opacity-70' :
      'border-[#DDD0B8] bg-white'
    return (
      <div key={opt.option_index} className={`rounded-xl border ${tone} overflow-hidden`}>
        <div className="px-3 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#6B3F1F]">
              {t('relation.optionLabel', { n: opt.option_index })}
              {opt.is_compound ? t('relation.compoundSuffix') : ''}
            </span>
            {opt.has_locked_brand && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                {t('relation.lockedBrandBadge')}
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
                className="flex-1 bg-[#7D4196] text-white text-xs font-semibold py-2.5 rounded-lg disabled:opacity-50">
                {isCommitting ? t('relation.checking') : t('relation.markOptionAvailable')}
              </button>
              <button
                onClick={() => markOptionNotAvailable(relationId, part.part_index, opt.option_index)}
                className="flex-1 bg-red-100 text-[#D4682E] text-xs font-semibold py-2.5 rounded-lg">
                {t('relation.markNotAvailable')}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderStandaloneItem(item: OrderItem) {
    // 2026-06-03 — Right-aligned price column so the dealer can
    // scan the price list down the right edge. "Price not provided"
    // for AVAILABLE items without a price (still optional, not
    // mandatory). No price column for non-AVAILABLE statuses.
    const showPriceColumn = item.status === 'AVAILABLE'
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
              <p className="text-base font-semibold text-[#6B3F1F] mt-1.5 truncate">
                {item.display_name || item.common_name || t('item.practiceFallback')}
              </p>
              <ItemDateRange from={item.application_date_from} to={item.application_date_to} />
              {item.brand_name && <p className="text-sm text-[#6B3F1F] mt-1">{item.brand_name}</p>}
              {item.given_volume != null && (
                <p className="text-xs text-[#7A8C7E] mt-0.5">
                  {item.given_volume} {item.volume_unit}
                </p>
              )}
            </div>
            {showPriceColumn && (
              <div className="text-right shrink-0">
                {item.price != null ? (
                  <p className="text-lg font-bold text-[#7D4196]">₹{item.price.toLocaleString(locale)}</p>
                ) : (
                  <p className="text-[11px] text-amber-700 font-medium italic">{t('item.priceNotProvided')}</p>
                )}
              </div>
            )}
          </div>

          {order!.status === 'PROCESSING' && item.status === 'PENDING' && editingItem !== item.id && (
            <div className="flex gap-2 mt-3">
              <button onClick={() => openItemForm(item)}
                className="flex-1 bg-green-600 text-white text-xs font-semibold py-2.5 rounded-xl">
                {t('item.available')}
              </button>
              <button onClick={() => openPostponePicker(item.id)}
                disabled={postponeBusy}
                className="flex-1 bg-amber-100 text-amber-700 text-xs font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {t('item.later')}
              </button>
              <button onClick={() => markUnavailable(item.id)}
                className="flex-1 bg-red-100 text-[#D4682E] text-xs font-semibold py-2.5 rounded-xl">
                {t('item.na')}
              </button>
            </div>
          )}

          {/* 2026-06-03 — Edit on decided standalone items. AVAILABLE
              re-opens the brand form; POSTPONED / NOT_AVAILABLE flip
              the decision via the state-machine self-edges. */}
          {order!.status === 'PROCESSING' && item.status === 'AVAILABLE' && editingItem !== item.id && (
            <button onClick={() => openItemForm(item)}
              className="mt-3 w-full border border-[#DDD0B8] text-[#6B3F1F] text-xs font-medium py-2 rounded-lg">
              {t('item.editDetails')}
            </button>
          )}
          {order!.status === 'PROCESSING' && item.status === 'NOT_AVAILABLE' && editingItem !== item.id && (
            <button onClick={() => openItemForm(item)}
              className="mt-3 w-full border border-[#DDD0B8] text-[#6B3F1F] text-xs font-medium py-2 rounded-lg">
              {t('item.changeDecision')}
            </button>
          )}
          {/* POSTPONED items remain actionable regardless of order
              status — see comment near the relation-grouped renderer. */}
          {item.status === 'POSTPONED' && editingItem !== item.id && (
            <div className="mt-3 flex gap-2">
              <button onClick={() => openItemForm(item)}
                className="flex-1 bg-green-600 text-white text-xs font-semibold py-2.5 rounded-xl">
                {t('item.nowAvailable')}
              </button>
              <button onClick={() => markUnavailable(item.id)}
                className="flex-1 bg-red-100 text-[#D4682E] text-xs font-semibold py-2.5 rounded-xl">
                {t('item.notAvailable')}
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
      <PWAHeader title={focusItemId ? t('focusHeader') : t('headerTitle')} activeRole="DEALER"
        back={focusItemId ? '/dealer/postponed' : '/dealer/orders'} />
      <div className="pt-16 pb-24 px-4 space-y-4 max-w-lg mx-auto">

        {/* Batch 24 — farmer context. Skipped in focus mode (the dealer
            knows who the farmer is from the Postponed list they came
            from). */}
        {/* 2026-06-05 — Show farmer context in focus mode too. The
            dealer needs the crop name + farmer + acres/plants to
            decide on the resolving postponed item. The "hide
            distractions" gate from before stripped too much. */}
        {/* 2026-06-19 — Human-readable Order ID at the top so the
            dealer can confirm the order over phone with the farmer
            or facilitator before doing anything else. */}
        {order.reference_number && (
          <div className="bg-white rounded-2xl px-4 py-3 border border-[#DDD0B8] mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-[#7A8C7E]">{t('orderIdLabel')}</p>
            <p className="font-mono text-sm font-semibold text-[#7D4196] tracking-wide">{order.reference_number}</p>
          </div>
        )}

        <PickupStatusBanner order={order} />

        {order.farmer_context && <FarmerContextCard ctx={order.farmer_context} />}
        {order.facilitator_context && (
          <FacilitatorContextCard ctx={order.facilitator_context} />
        )}

        {/* Header card — skipped in focus mode so the screen stays
            clean on a single postponed-item resolve. */}
        {!focusItemId && (
          <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] mt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-[#7A8C7E]">{t('status.orderStatusLabel')}</p>
                <p className="font-semibold text-[#6B3F1F]">{order.status.replace(/_/g, ' ')}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-[#7A8C7E]">{t('status.dateRangeLabel')}</p>
                <p className="text-xs text-[#6B3F1F]">
                  {new Date(order.date_from).toLocaleDateString()} — {new Date(order.date_to).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 2026-06-06 — Accept + Decline CTAs. Item details are
            hidden until acceptance (the next blocks render only when
            order.status !== 'SENT'), so the dealer makes their
            accept/decline call WITHOUT seeing what's inside. */}
        {!focusItemId && order.status === 'SENT' && (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900 leading-relaxed">
              <p className="font-semibold mb-1">{t('acceptDecline.title')}</p>
              <p className="text-xs">
                {t('acceptDecline.body')}
              </p>
            </div>
            <button onClick={acceptOrder} disabled={accepting || declining}
              className="w-full py-4 rounded-2xl bg-[#7D4196] text-white font-semibold text-sm disabled:opacity-50">
              {accepting ? t('acceptDecline.accepting') : t('acceptDecline.acceptCta')}
            </button>
            <button onClick={() => setShowDeclineConfirm(true)} disabled={accepting || declining}
              className="w-full py-3 rounded-2xl border-2 border-red-200 text-[#D4682E] font-semibold text-sm disabled:opacity-50">
              {t('acceptDecline.declineCta')}
            </button>
          </>
        )}

        {/* Relations (Build C) */}
        {/* 2026-06-03 — focus_item mode renders ONLY that one item so
            the dealer resolving a postponed item isn't distracted by
            the rest of the order. Hides the multi-step + relations
            entirely; if the focus item is standalone it still shows
            under "Standalone items"; if it's part of a relation we
            render only its relation. */}
        {!focusItemId && order.status !== 'SENT' && relations.length > 0 && (
          <div className="space-y-3">
            {relations.map(renderRelation)}
          </div>
        )}

        {/* Standalone items — hidden when order.status === 'SENT'
            (pre-accept) so the dealer makes their accept/decline call
            blind. Section headers ("Standalone items (N)" /
            "Multi-step recommendations (N)") were dropped 2026-06-26
            now that the cards carry their own per-group hint label
            (AND / OR italics) and the standalone cards are visually
            indistinguishable in shape — the dealer reads a single
            flat list of decisions. The focus-item path keeps the
            "Resolve this postponed item" label because the framing
            is genuinely contextual there. */}
        {(() => {
          if (order.status === 'SENT' && !focusItemId) return null
          const visible = focusItemId
            ? standaloneItems.filter(i => i.id === focusItemId)
            : standaloneItems
          if (visible.length === 0) return null
          return (
            <div className="space-y-3">
              {focusItemId && (
                <p className="text-sm font-semibold text-[#6B3F1F] px-1">
                  {t('sections.resolvePostponed')}
                </p>
              )}
              {visible.map(renderStandaloneItem)}
            </div>
          )
        })()}

        {/* Batch 30C — brand consolidation (spec §4.2). Only renders
            when at least one brand spans more than one line — single
            lines stay on their items so the dealer doesn't see noise. */}
        {(order.consolidated_brands || []).filter(b => b.line_count > 1).length > 0 && (
          <div className="bg-purple-50/40 border border-[#7D4196]/15 rounded-2xl p-4 space-y-2">
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] text-[#7A8C7E] uppercase tracking-wide">
                {t('sections.consolidatedBrands')}
              </p>
              <p className="text-[10px] text-[#7A8C7E]">{t('sections.acrossTimelines')}</p>
            </div>
            {(order.consolidated_brands || [])
              .filter(b => b.line_count > 1)
              .map(b => (
                <div key={b.brand_cosh_id} className="flex items-baseline justify-between gap-3 border-t border-[#7D4196]/10 pt-1.5 first:border-0 first:pt-0">
                  <div>
                    <p className="text-sm font-semibold text-[#6B3F1F]">{b.brand_name}</p>
                    <p className="text-[10px] text-[#7A8C7E]">{t('sections.linesCount', { count: b.line_count })}</p>
                  </div>
                  <p className="text-sm font-bold text-[#7D4196]">
                    {b.total_volume} {b.volume_unit}
                  </p>
                </div>
              ))}
          </div>
        )}

        {pricedItems.length > 0 && (
          <div className="bg-white border-2 border-[#7D4196]/15 rounded-2xl p-4 flex items-baseline justify-between gap-3">
            <div>
              <p className="text-[11px] text-[#7A8C7E] uppercase tracking-wide">{t('footer.totalAmount')}</p>
              <p className="text-[10px] text-[#7A8C7E] mt-0.5">
                {t('footer.pricedCoverage', { priced: pricedItems.length, total: availableItemCount })}
              </p>
            </div>
            <p className="text-2xl font-bold text-[#7D4196]">₹{totalAmount.toLocaleString(locale)}</p>
          </div>
        )}

        {/* 2026-06-03 — Hint when there are still undecided items, so
            the dealer knows what's blocking submission. The Submit
            button only renders once everyone is decided. */}
        {order.status === 'PROCESSING' && pendingCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-800">
            {t('footer.pendingHint', { count: pendingCount })}
          </div>
        )}
        {order.status === 'PROCESSING' && pendingCount === 0 && availableCount === 0 && notAvailableCount === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-800">
            {t('footer.allPostponed')}
          </div>
        )}
        {canSubmit && (
          <button onClick={() => setShowSubmitConfirm(true)} disabled={submitting}
            className="w-full py-4 rounded-2xl text-white font-semibold text-sm disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #054a3a, #7D4196)' }}>
            {submitting ? t('footer.sending') : `✓ ${submitButtonLabel}`}
          </button>
        )}

        {order.status === 'SENT_FOR_APPROVAL' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
            <p className="text-amber-700 font-semibold text-sm">{t('footer.awaitingApproval')}</p>
          </div>
        )}

        {/* Batch 29 — Abort. Returns the order to SENT so a different
            order back to the pool. Spec correction 2026-06-01: now a
            "Reset items" affordance — clears the dealer's in-flight
            picks but KEEPS the order's acceptance. Backend gate still
            covers PROCESSING / SENT_FOR_APPROVAL / PARTIALLY_APPROVED. */}
        {['PROCESSING', 'SENT_FOR_APPROVAL', 'PARTIALLY_APPROVED'].includes(order.status) && (
          <button onClick={() => setShowAbortConfirm(true)}
            className="w-full py-3 rounded-2xl border-2 border-amber-300 text-amber-700 font-medium text-sm">
            {t('footer.resetItems')}
          </button>
        )}

      </div>

      {/* Brand selection bottom sheet */}
      {showBrandSheet && brandOptions && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setShowBrandSheet(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl pb-10 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#DDD0B8]">
              <p className="font-bold text-[#6B3F1F]">{t('brandSheet.title')}</p>
              <button onClick={() => setShowBrandSheet(false)} className="text-[#7A8C7E] text-xl">✕</button>
            </div>
            {brandOptions.groups.every(g => g.brands.length === 0) ? (
              // Batch 25 / fix 2026-06-01 — manual entry removed
              // (creates manipulation risk and dilutes brand analytics).
              // When the system has no brands for this common name yet,
              // the dealer's only path is to report the missing brand
              // so the CM can add it to Cosh.
              <div className="px-5 py-8 text-center">
                <p className="text-[#7A8C7E] text-sm font-medium">{t('brandSheet.noBrandsTitle')}</p>
                <p className="text-[#7A8C7E] text-xs mt-1">
                  {t('brandSheet.noBrandsHint')}
                </p>
                <button onClick={() => setShowBrandSheet(false)}
                  className="mt-4 px-4 py-2 border border-[#7D4196] text-[#7D4196] rounded-xl text-sm font-medium">
                  {t('brandSheet.close')}
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
            <p className="text-sm font-bold text-[#6B3F1F]">{t('dup.title')}</p>
            <p className="text-xs text-[#6B3F1F] mt-2">
              {t('dup.bodyPrefix')}
              {' '}
              <span className="font-semibold text-[#6B3F1F]">{dupModal.check.duplicate_input_name}</span>
              {' '}
              {t('dup.bodySuffix')}
            </p>
            {dupModal.check.suggested_alternatives.length > 0 ? (
              <p className="text-xs text-[#6B3F1F] mt-2">
                {t('dup.suggestedPrefix')}
                {' '}
                <span className="font-semibold text-[#7D4196]">
                  {dupModal.check.suggested_alternatives.join(', ')}
                </span>
              </p>
            ) : (
              <p className="text-xs text-[#7A8C7E] mt-2 italic">
                {t('dup.noAlternative')}
              </p>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setDupModal(null)}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl">
                {tCommon('cancel')}
              </button>
              <button
                onClick={() => commitSelectOption(dupModal.relationId, dupModal.partIndex, dupModal.optionIndex)}
                className="flex-1 bg-[#7D4196] text-white text-sm font-semibold py-2.5 rounded-xl">
                {t('dup.continueAnyway')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2026-06-05 — Focus-mode submit confirmation. Mirrors the
          bulk Submit-for-Approval sheet but with the single-item
          summary the dealer just authored. */}
      {showFocusConfirm && focusItemId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !saving && setShowFocusConfirm(false)}>
          <div className="bg-white max-w-sm w-full rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-[#6B3F1F]">{t('focusConfirm.title')}</p>
            <p className="text-xs text-amber-700 mt-1.5">
              {t('focusConfirm.body')}
            </p>
            <div className="mt-3 space-y-1.5 text-xs text-[#6B3F1F]">
              <div className="flex justify-between gap-3">
                <span className="text-[#7A8C7E]">{t('focusConfirm.brandLabel')}</span>
                <span className="font-semibold">{itemEdit.brand_name || '—'}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[#7A8C7E]">{t('focusConfirm.qtyLabel')}</span>
                <span className="font-semibold">{itemEdit.given_volume || '—'} {itemEdit.volume_unit}</span>
              </div>
              <div className="flex justify-between gap-3 pt-1 border-t border-[#F0E5D0]">
                <span className="text-[#7A8C7E]">{t('focusConfirm.priceLabel')}</span>
                <span className="font-bold text-[#7D4196]">
                  {itemEdit.price ? `₹${parseFloat(itemEdit.price).toLocaleString(locale)}` : t('focusConfirm.priceMissing')}
                </span>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowFocusConfirm(false)} disabled={saving}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                {tCommon('cancel')}
              </button>
              <button
                onClick={() => { setShowFocusConfirm(false); markAvailable(focusItemId, { skipFocusConfirm: true }) }}
                disabled={saving}
                className="flex-1 bg-[#7D4196] text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {saving ? t('footer.sending') : t('focusConfirm.confirmCta')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch 29 — Submit confirmation. Shows the farmer-visible
          summary so the dealer can catch a missing price or stray
          PENDING item before the order leaves their hands. */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !submitting && setShowSubmitConfirm(false)}>
          <div className="bg-white max-w-sm w-full rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-[#6B3F1F]">
              {availableCount === 0 ? t('submitConfirm.titleNotify') : t('submitConfirm.titleSend')}
            </p>
            <p className="text-xs text-amber-700 mt-1.5">
              {t('submitConfirm.body')}
            </p>
            <div className="mt-3 space-y-1.5 text-xs text-[#6B3F1F]">
              <div className="flex justify-between gap-3">
                <span className="text-[#7A8C7E]">{t('submitConfirm.itemsReady')}</span>
                <span className="font-semibold">{availableItemCount}</span>
              </div>
              {pricedItems.length < availableItemCount && (
                <div className="flex justify-between gap-3">
                  <span className="text-[#7A8C7E]">{t('submitConfirm.unpriced')}</span>
                  <span className="font-semibold text-amber-700">
                    {availableItemCount - pricedItems.length}
                  </span>
                </div>
              )}
              {notAvailableItemCount > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-[#7A8C7E]">{t('submitConfirm.returnedLabel')}</span>
                  <span className="font-semibold text-red-700">{notAvailableItemCount}</span>
                </div>
              )}
              <div className="flex justify-between gap-3 pt-1 border-t border-[#F0E5D0]">
                <span className="text-[#7A8C7E]">{t('submitConfirm.totalLabel')}</span>
                <span className="font-bold text-[#7D4196]">
                  ₹{totalAmount.toLocaleString(locale)}
                </span>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowSubmitConfirm(false)} disabled={submitting}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                {tCommon('cancel')}
              </button>
              <button onClick={submitForApproval} disabled={submitting}
                className="flex-1 bg-[#7D4196] text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {submitting ? t('footer.sending') : t('submitConfirm.confirmCta')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2026-06-06 — Decline order confirmation. The dealer hasn't
          seen items (they're hidden pre-accept), so the copy keeps
          it generic — "this order goes back to the farmer." */}
      {showDeclineConfirm && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={() => !declining && setShowDeclineConfirm(false)}>
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
            style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
            onClick={e => e.stopPropagation()}>
            <p className="font-bold text-[#6B3F1F]">{t('declineConfirm.title')}</p>
            <p className="text-xs text-[#7A8C7E] mt-2">
              {t('declineConfirm.body')}
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowDeclineConfirm(false)} disabled={declining}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                {tCommon('cancel')}
              </button>
              <button onClick={declineOrder} disabled={declining}
                className="flex-1 bg-red-100 text-[#D4682E] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {declining ? '…' : t('declineConfirm.yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset items confirmation (was Abort order pre-2026-06-01).
          The order's acceptance stays — only the item-level work is
          rolled back, like a Refresh & Go Back. */}
      {showAbortConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !aborting && setShowAbortConfirm(false)}>
          <div className="bg-white max-w-sm w-full rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-amber-700">{t('resetConfirm.title')}</p>
            <p className="text-xs text-[#6B3F1F] mt-2">
              {t('resetConfirm.body')}
            </p>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowAbortConfirm(false)} disabled={aborting}
                className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
                {t('resetConfirm.keepWorking')}
              </button>
              <button onClick={abortOrder} disabled={aborting}
                className="flex-1 bg-amber-600 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                {aborting ? t('resetConfirm.resetting') : t('resetConfirm.yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch 30C — NPK trade-name picker bottom sheet, three groups
          (Recommended / My / Other) per spec §3.1. Empty groups are
          hidden. Falls back to the flat list when grouping wasn't
          returned (older backend). */}
      {npkTradeNameSheet && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setNpkTradeNameSheet(null)}>
          <div className="bg-white w-full rounded-t-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-[#DDD0B8] flex items-center justify-between">
              <p className="text-sm font-bold text-[#6B3F1F]">{t('npkSheet.title')}</p>
              <button onClick={() => setNpkTradeNameSheet(null)} className="text-[#7A8C7E] text-xl">✕</button>
            </div>
            <div className="overflow-y-auto p-3 space-y-3">
              {npkTradeNameGroups
                ? (['group_recommended', 'group_my', 'group_other'] as const).map(key => {
                    const list = npkTradeNameGroups[key]
                    if (!list || list.length === 0) return null
                    const label = key === 'group_recommended' ? t('npkSheet.groupRecommended')
                                : key === 'group_my' ? t('npkSheet.groupMy')
                                : t('npkSheet.groupOther')
                    return (
                      <div key={key} className="space-y-1.5">
                        <p className="text-[11px] font-semibold text-[#7A8C7E] uppercase tracking-wide px-1">
                          {label}
                        </p>
                        {list.map(tn => (
                          <button key={tn.cosh_id} onClick={() => npkPickTradeName(tn)}
                            className="w-full text-left px-3 py-2.5 border border-[#DDD0B8] rounded-lg hover:bg-purple-50">
                            <p className="text-sm font-semibold text-[#6B3F1F]">{tn.name}</p>
                          </button>
                        ))}
                      </div>
                    )
                  })
                : npkTradeNameList.length === 0
                  ? <p className="text-xs text-[#7A8C7E] italic text-center py-6">{t('npkSheet.empty')}</p>
                  : npkTradeNameList.map(tn => (
                      <button key={tn.cosh_id} onClick={() => npkPickTradeName(tn)}
                        className="w-full text-left px-3 py-2.5 border border-[#DDD0B8] rounded-lg hover:bg-purple-50">
                        <p className="text-sm font-semibold text-[#6B3F1F]">{tn.name}</p>
                      </button>
                    ))}
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
                <p className="font-bold text-[#6B3F1F] text-base">{t('packingSheet.title')}</p>
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
                    <p className="text-sm font-semibold text-[#6B3F1F]">{item.brand_name || t('packingSheet.itemFallback', { n: i + 1 })}</p>
                    <p className="text-xs text-[#7A8C7E]">{item.given_volume} {item.volume_unit}</p>
                  </div>
                  {item.price != null && <p className="text-sm font-bold text-[#6B3F1F]">₹{item.price}</p>}
                </div>
              ))}
            </div>
            {packingList.total_amount > 0 && (
              <div className="mt-4 pt-3 border-t border-[#DDD0B8] flex items-center justify-between">
                <p className="font-semibold text-[#6B3F1F]">{t('packingSheet.totalLabel')}</p>
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
              <p className="font-semibold text-[#6B3F1F]">{t('postponeSheet.title')}</p>
              <button onClick={() => !postponeBusy && setPostponeItemId(null)} className="text-[#7A8C7E] text-xl">×</button>
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
    </div>
  )
}

// ── Batch 26 — Element guidance block ─────────────────────────────────────────
// Three short lines the dealer reads after picking a brand:
//   - Recommended Dosage + Unit
//   - Application Method
//   - Volume per Plant + Unit (plant-wise items only)
// Fix 2026-06-01: per-item application window. Orders that span
// multiple timelines have different windows per item; the order-level
// date range at the top doesn't tell the dealer when this specific
// item should be sold. Renders `Apply: DD MMM – DD MMM` when the
// backend resolved a window; null otherwise (calendar timelines, no
// crop_start_date, etc.) so we don't fall back to the order range.
function ItemDateRange({ from, to }: { from?: string | null; to?: string | null }) {
  const t = useTranslations('dealer.orderDetail.item')
  const locale = useLocale()
  if (!from || !to) return null
  const fmt = (iso: string) => {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString(locale, { day: '2-digit', month: 'short' })
  }
  return (
    <p className="text-[11px] text-[#7A8C7E] mt-0.5">
      {t('applyDates', { from: fmt(from), to: fmt(to) })}
    </p>
  )
}

// Pure render; values come from the backend's `element_block`.
function ElementGuidance({
  block, estimate, estimating, estimateError,
}: {
  block: ElementBlock
  estimate: { volume: number; unit: string } | null
  estimating: boolean
  estimateError?: string | null
}) {
  const t = useTranslations('dealer.orderDetail.elementGuidance')
  const rows: { label: string; value: string; emphasis?: boolean; italic?: boolean }[] = []
  if (block.dosage_value != null) {
    const unit = block.dosage_unit_name || block.dosage_unit_cosh_id || ''
    rows.push({ label: t('recommendedDosage'), value: `${block.dosage_value} ${unit}`.trim() })
  }
  if (block.application_method_name) {
    rows.push({ label: t('applicationMethod'), value: block.application_method_name })
  }
  if (block.vol_per_plant_value != null) {
    const unit = block.vol_per_plant_unit_name || block.vol_per_plant_unit_cosh_id || ''
    rows.push({ label: t('volumePerPlant'), value: `${block.vol_per_plant_value} ${unit}`.trim() })
  }
  // Batch 27 — BL-06 estimated volume in the same warm-tan card so
  // the dealer reads SE guidance + computed estimate together, right
  // above the Given-Volume input. "Calculating…" while the request
  // is in flight; the error row appears when the formula isn't yet
  // configured for this combination.
  if (estimating) {
    rows.push({ label: t('estimatedVolume'), value: t('calculating'), emphasis: true })
  } else if (estimate) {
    rows.push({ label: t('estimatedVolume'), value: `${estimate.volume} ${estimate.unit || ''}`.trim(), emphasis: true })
  } else if (estimateError) {
    rows.push({ label: t('estimatedVolume'), value: estimateError, italic: true })
  }
  if (rows.length === 0) return null
  return (
    <div className="bg-[#F5F0E8] border border-[#DDD0B8] rounded-lg p-3 space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] text-[#7A8C7E]">{r.label}</span>
          <span className={`text-xs ${r.emphasis ? 'font-bold text-[#7D4196]' : r.italic ? 'italic text-[#7A8C7E]' : 'font-semibold text-[#6B3F1F]'} text-right`}>
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
// 2026-06-21 — Post-share status banner on the dealer detail page.
// Mirrors the PickupStatus line on the /dealer/orders Packing card so
// the dealer sees the same state info after tapping into an order.
// Renders nothing until the packing list has actually been shared —
// before then the order is still mid-packing and the banner would just
// add noise.
function PickupStatusBanner({ order }: { order: Order }) {
  const t = useTranslations('dealer.orders.pickup')
  const locale = useLocale()
  if (!order.packing_list_shared_at) return null

  const code = order.packing_code

  if (order.packing_farmer_received_at) {
    const stamp = new Date(order.packing_farmer_received_at)
    return (
      <div className="bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3 mt-4 text-sm text-purple-800">
        {t('receivedByFarmer', {
          date: stamp.toLocaleDateString(locale, { day: '2-digit', month: 'short' }),
          time: stamp.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
        })}
        {code && <span className="ml-2 text-[10px] font-mono tracking-widest opacity-70">#{code}</span>}
      </div>
    )
  }

  if (order.packing_picked_up_at) {
    const stamp = new Date(order.packing_picked_up_at)
    const date = stamp.toLocaleDateString(locale, { day: '2-digit', month: 'short' })
    const time = stamp.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    let line: string
    if (order.packing_picked_up_by_role === 'FACILITATOR') {
      line = order.packing_picked_up_by_name
        ? t('pickedUpByFacilitatorNamed', { name: order.packing_picked_up_by_name, date, time })
        : t('pickedUpByFacilitator', { date, time })
    } else {
      line = t('pickedUpByFarmer', { date, time })
    }
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mt-4 text-sm text-amber-800">
        {line}
        {code && <span className="ml-2 text-[10px] font-mono tracking-widest opacity-70">#{code}</span>}
      </div>
    )
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 mt-4 text-sm text-slate-700">
      {t('awaitingPickup')}
      {code && <span className="ml-2 text-[10px] font-mono tracking-widest opacity-70">#{code}</span>}
    </div>
  )
}

function FarmerContextCard({ ctx }: { ctx: FarmerContext }) {
  const t = useTranslations('dealer.orderDetail.farmerContext')
  const measureLine = ctx.measure === 'PLANT_WISE' && ctx.number_of_plants != null
    ? t('plantsValue', { count: ctx.number_of_plants })
    : ctx.measure === 'AREA_WISE' && ctx.farm_area_acres != null
      ? t('acresValue', { count: ctx.farm_area_acres })
      : null

  const ageLine = ctx.age_value != null && ctx.age_unit
    ? (ctx.age_unit === 'years'
        ? t('ageYears', { value: ctx.age_value })
        : t('ageDays', { value: ctx.age_value }))
    : null

  return (
    <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] mt-4 space-y-3">
      <div className="flex items-start gap-3">
        {/* 2026-06-19 — tap-to-enlarge avatar (WhatsApp-style). */}
        <AvatarLightbox photoUrl={ctx.farmer_photo_url} name={ctx.farmer_name} size={56} />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-[#7A8C7E]">{t('farmerLabel')}</p>
          <p className="font-semibold text-[#6B3F1F] truncate">{ctx.farmer_name || '—'}</p>
        </div>
        {ctx.farmer_phone && (
          <a href={`tel:${ctx.farmer_phone}`}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-100 text-purple-800 text-xs font-semibold">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {t('callBtn')}
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#F0E8D6]">
        <div>
          <p className="text-xs text-[#7A8C7E]">{t('cropLabel')}</p>
          <p className="text-sm font-medium text-[#6B3F1F] truncate">{ctx.crop_name || '—'}</p>
          {ageLine && <p className="text-xs text-[#7A8C7E] mt-0.5">{ageLine}</p>}
        </div>
        <div>
          <p className="text-xs text-[#7A8C7E]">
            {ctx.measure === 'PLANT_WISE' ? t('plantsLabel') : t('areaLabel')}
          </p>
          <p className="text-sm font-medium text-[#6B3F1F]">{measureLine || '—'}</p>
        </div>
      </div>
    </div>
  )
}

// 2026-06-19 — Facilitator identity confirm. Only renders on orders
// routed via a facilitator. Same shape as the farmer card minus the
// crop/area block (facilitator isn't the producer; the farmer is).
function FacilitatorContextCard({ ctx }: { ctx: FacilitatorContext }) {
  const t = useTranslations('dealer.orderDetail.facilitatorContext')
  return (
    <div className="bg-white rounded-2xl p-4 border border-[#DDD0B8] space-y-3">
      <div className="flex items-start gap-3">
        <AvatarLightbox photoUrl={ctx.facilitator_photo_url} name={ctx.facilitator_name} size={56}
          ringColor="#DDD0B8" bgColor="rgba(125, 78, 0, 0.1)" textColor="#7D4E00" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-[#7A8C7E]">{t('facilitatorLabel')}</p>
          <p className="font-semibold text-[#6B3F1F] truncate">{ctx.facilitator_name || '—'}</p>
          <p className="text-[10px] text-[#7A8C7E] mt-0.5">{t('routedViaHint')}</p>
        </div>
        {ctx.facilitator_phone && (
          <a href={`tel:${ctx.facilitator_phone}`}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-100 text-purple-800 text-xs font-semibold">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {t('callBtn')}
          </a>
        )}
      </div>
    </div>
  )
}
