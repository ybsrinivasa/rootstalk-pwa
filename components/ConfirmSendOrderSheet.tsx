'use client'
import { useTranslations } from 'next-intl'

// 2026-06-19 — Bottom sheet shown to the farmer before any order is
// actually dispatched to a recipient. Wording per user direction:
//   "Do you wish to send the {inputType} Order to {recipient}?"
// Covers every send entry-point (seed + regular, dealer + facilitator,
// fresh + cancel-migrate + reroute). The caller passes localised
// `inputType` (e.g. "Seed/Seedling", "Pesticide") and `recipient`
// (dealer shop_name or facilitator name).
export default function ConfirmSendOrderSheet({
  open, inputType, recipient, busy = false, onConfirm, onCancel,
}: {
  open: boolean
  inputType: string
  recipient: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('orders.common.confirmSend')
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end"
      onClick={() => !busy && onCancel()}>
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
        style={{ paddingBottom: 'max(2.5rem, calc(env(safe-area-inset-bottom) + 5rem))' }}
        onClick={e => e.stopPropagation()}>
        <p className="font-bold text-[#6B3F1F]">{t('title')}</p>
        <p className="text-sm text-[#7A8C7E] mt-2">
          {t('body', { inputType, recipient })}
        </p>
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} disabled={busy}
            className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2.5 rounded-xl disabled:opacity-50">
            {t('cancel')}
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="flex-1 bg-[#085041] text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
            {busy ? '…' : t('confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

// Build a recipient label: dealer shop_name (or person name fallback)
// for dealers, person's name for facilitators. Reused by every send
// site so the wording is consistent.
export function recipientLabel(
  isDealer: boolean,
  person: { name?: string | null; shop_name?: string | null } | null,
  fallback: string,
): string {
  if (!person) return fallback
  if (isDealer) return person.shop_name || person.name || fallback
  return person.name || fallback
}
