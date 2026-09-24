'use client'
import { useTranslations } from 'next-intl'

/**
 * Small green chip shown adjacent to a client's name whenever a
 * subscription (or client) is in the "Shop-Led" mode — the internal
 * `advisory_only_mode = false` state, formerly labelled "Regular
 * Mode." Named after 2026-09-24 relabel: Shop-Led signals to farmers
 * that the shop delivers the inputs (they don't have to plan/pick).
 *
 * Five canonical placements (mirror of the previous AdvisoryOnlyChip):
 *   1. Client picker (subscribe flow)
 *   2. My Subscriptions card header
 *   3. Crop dashboard header
 *   4. Any farmer-visible title showing the client name
 *   5. Promoter-assign preview
 *
 * Advisory-Only is now the unlabelled default — no chip renders for
 * those subs. Only Shop-Led subs get the chip.
 */
export default function ShopLedChip({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const t = useTranslations('advisoryOnly')
  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-1.5 py-0.5'
    : 'text-[11px] px-2 py-0.5'
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium bg-emerald-100 text-emerald-800 border border-emerald-200 ${sizeClasses}`}>
      {t('shopLedChip')}
    </span>
  )
}
