'use client'
import { useTranslations } from 'next-intl'

/**
 * Small muted-purple chip shown adjacent to a client's name whenever
 * a subscription (or client) is in Advisory-Only Mode. Five canonical
 * placements per scoping §11:
 *   1. Client picker (subscribe flow)
 *   2. My Subscriptions card header
 *   3. Crop dashboard header
 *   4. Any farmer-visible title showing the client name
 *   5. Promoter-assign preview
 *
 * Consistent visual language across all placements so the farmer sees
 * "why does this look different?" answered at the tap.
 */
export default function AdvisoryOnlyChip({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const t = useTranslations('advisoryOnly')
  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-1.5 py-0.5'
    : 'text-[11px] px-2 py-0.5'
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium bg-purple-100 text-purple-700 border border-purple-200 ${sizeClasses}`}>
      {t('chip')}
    </span>
  )
}
