'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'
import { digitsOnly } from '@/lib/input-normalization'


type EntryType = 'OPENING_BALANCE' | 'CREDIT_ADVANCED' | 'PAYMENT_MADE'
  | 'ADJUSTMENT_UP' | 'ADJUSTMENT_DOWN' | 'VOID'
type EntryStatus = 'PROPOSED' | 'CONFIRMED' | 'DISPUTED' | 'VOIDED'
type Party = 'DEALER' | 'FARMER'
type PaymentMethod = 'CASH' | 'UPI' | 'BANK' | 'CHEQUE' | 'OTHER'

interface Entry {
  id: string
  entry_type: EntryType
  amount_paise: number
  entry_date: string
  due_date: string | null
  initiated_by: Party
  initiator_user_id: string
  status: EntryStatus
  related_sale_id: string | null
  payment_method: PaymentMethod | null
  payment_ref: string | null
  receipt_media_id: string | null
  initiator_note: string | null
  confirmer_note: string | null
  dispute_reason: string | null
  created_at: string
  updated_at: string
  confirmed_at: string | null
  confirmer_user_id: string | null
  voided_at: string | null
  was_edited_after_proposal: boolean
}

interface AccountBalance {
  confirmed_paise: number
  pending_your_confirm_paise: number
  pending_their_confirm_paise: number
}

interface AccountDetail {
  account_id: string
  dealer_user_id: string
  farmer_user_id: string
  counterparty_name: string | null
  counterparty_phone: string | null
  counterparty_photo_url: string | null
  dealer_upi_vpa: string | null
  dealer_upi_display_name: string | null
  balance: AccountBalance
  trust: null
  entries: Entry[]
  can_add_opening_balance: boolean
  is_active: boolean
  is_farmer_registered: boolean | null
}


function formatRupees(paise: number, locale: string): string {
  const rupees = Math.round(paise / 100)
  try {
    return new Intl.NumberFormat(locale === 'en' ? 'en-IN' : locale, {
      style: 'currency', currency: 'INR', maximumFractionDigits: 0,
    }).format(rupees)
  } catch {
    return `₹${rupees.toLocaleString('en-IN')}`
  }
}


function formatShortDate(iso: string, locale: string): string {
  try {
    // Locale-safe: assemble day+month manually, not toLocaleDateString
    // (which produces awkward strings for Kannada — per kn common gotchas memory).
    const d = new Date(iso)
    return d.toLocaleDateString(locale === 'en' ? 'en-IN' : 'en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch { return iso }
}


export default function FarmerPerDealerCreditPage() {
  const router = useRouter()
  const params = useParams()
  const dealerUserId = params.dealerUserId as string
  const locale = useLocale()
  const t = useTranslations('credit.perDealer')
  const tCommon = useTranslations('common')
  const [detail, setDetail] = useState<AccountDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null)
  const [showPaymentSheet, setShowPaymentSheet] = useState(false)
  const [disputeEntryId, setDisputeEntryId] = useState<string | null>(null)
  const [copiedUpi, setCopiedUpi] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { data } = await api.get<AccountDetail>(`/farmer/credit/dealers/${dealerUserId}`)
      setDetail(data)
    } catch (e: unknown) {
      const err = e as { response?: { status?: number } }
      if (err?.response?.status === 404) setError(t('notFound'))
      else setError(t('loadError'))
    } finally {
      setLoading(false)
    }
  }, [dealerUserId, t])

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [router, load])

  async function copyUpi() {
    if (!detail?.dealer_upi_vpa) return
    try {
      await navigator.clipboard.writeText(detail.dealer_upi_vpa)
      setCopiedUpi(true)
      setTimeout(() => setCopiedUpi(false), 2500)
    } catch { /* older browsers — fall through */ }
  }

  async function confirmEntry(entry: Entry) {
    setBusyEntryId(entry.id)
    try {
      await api.post(`/credit/entries/${entry.id}/confirm`, {})
      await load()
    } catch { alert(t('confirmError')) }
    finally { setBusyEntryId(null) }
  }

  async function submitDispute(entry: Entry, reason: string) {
    setBusyEntryId(entry.id)
    try {
      await api.post(`/credit/entries/${entry.id}/dispute`, { dispute_reason: reason })
      setDisputeEntryId(null)
      await load()
    } catch { alert(t('disputeError')) }
    finally { setBusyEntryId(null) }
  }

  async function withdrawEntry(entry: Entry) {
    if (!confirm(t('withdrawConfirm'))) return
    setBusyEntryId(entry.id)
    try {
      await api.delete(`/credit/entries/${entry.id}`)
      await load()
    } catch { alert(t('withdrawError')) }
    finally { setBusyEntryId(null) }
  }

  if (loading) return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FARMER" back="/credit" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto space-y-3 mt-4">
        <div className="h-20 bg-white rounded-2xl animate-pulse" />
        <div className="h-16 bg-white rounded-2xl animate-pulse" />
        <div className="h-24 bg-white rounded-2xl animate-pulse" />
      </div>
      <BottomNav color="#3A7D44" />
    </div>
  )
  if (error || !detail) return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FARMER" back="/credit" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto mt-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
          {error || t('notFound')}
        </div>
      </div>
      <BottomNav color="#3A7D44" />
    </div>
  )

  const owes = detail.balance.confirmed_paise > 0
  const overpaid = detail.balance.confirmed_paise < 0
  const netAfterPending = detail.balance.confirmed_paise
    + detail.balance.pending_your_confirm_paise
    + detail.balance.pending_their_confirm_paise
  const pendingDealerEntries = detail.entries.filter(
    e => e.status === 'PROPOSED' && e.initiated_by === 'DEALER',
  )
  const myPendingEntries = detail.entries.filter(
    e => (e.status === 'PROPOSED' || e.status === 'DISPUTED') && e.initiated_by === 'FARMER',
  )
  const restEntries = detail.entries.filter(
    e => !pendingDealerEntries.includes(e) && !myPendingEntries.includes(e),
  )

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={detail.counterparty_name || t('headerTitle')} activeRole="FARMER" back="/credit" />
      <div className="pt-16 pb-32 px-4 max-w-lg mx-auto">
        {/* Balance card */}
        <div className="mt-4 bg-white rounded-2xl border border-[#EEE4D2] p-4 shadow-sm">
          <p className="text-[#7A8C7E] text-xs uppercase tracking-wider font-medium">
            {overpaid ? t('inYourFavour') : t('youOwe')}
          </p>
          <p className={`text-3xl font-bold mt-1 ${overpaid ? 'text-green-700' : 'text-[#6B3F1F]'}`}>
            {formatRupees(Math.abs(detail.balance.confirmed_paise), locale)}
          </p>
          {(detail.balance.pending_your_confirm_paise !== 0
            || detail.balance.pending_their_confirm_paise !== 0) && (
            <div className="mt-3 pt-3 border-t border-[#EEE4D2] space-y-1">
              {detail.balance.pending_your_confirm_paise !== 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#7A8C7E]">{t('pendingYourAction')}</span>
                  <span className="font-semibold text-red-700">
                    {detail.balance.pending_your_confirm_paise > 0 ? '+' : ''}
                    {formatRupees(detail.balance.pending_your_confirm_paise, locale)}
                  </span>
                </div>
              )}
              {detail.balance.pending_their_confirm_paise !== 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#7A8C7E]">{t('pendingTheirAction')}</span>
                  <span className="text-[#7A8C7E]">
                    {detail.balance.pending_their_confirm_paise > 0 ? '+' : ''}
                    {formatRupees(detail.balance.pending_their_confirm_paise, locale)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-[#7A8C7E]">{t('ifAllConfirmed')}</span>
                <span className="font-semibold text-[#6B3F1F]">
                  {formatRupees(Math.abs(netAfterPending), locale)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-3 flex gap-2">
          <button onClick={() => setShowPaymentSheet(true)}
            className="flex-1 bg-[#3A7D44] text-white text-sm font-semibold py-3 rounded-2xl">
            {t('recordPayment')}
          </button>
          {detail.counterparty_phone && (
            <a href={`tel:${detail.counterparty_phone}`}
              className="px-4 flex items-center justify-center border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium rounded-2xl">
              {t('call')}
            </a>
          )}
        </div>

        {/* Copy UPI ID */}
        {detail.dealer_upi_vpa && (
          <div className="mt-3 bg-white border border-[#EEE4D2] rounded-2xl p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-[#7A8C7E] font-medium">
                {t('dealerUpiLabel')}
              </p>
              <p className="text-sm font-mono text-[#6B3F1F] truncate">{detail.dealer_upi_vpa}</p>
            </div>
            <button onClick={copyUpi}
              className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg ${
                copiedUpi ? 'bg-green-100 text-green-800' : 'bg-[#3A7D44] text-white'
              }`}>
              {copiedUpi ? t('copied') : t('copy')}
            </button>
          </div>
        )}

        {/* Pending dealer entries — top */}
        {pendingDealerEntries.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="inline-block w-2 h-2 bg-red-500 rounded-full" />
              <p className="text-xs font-semibold text-[#6B3F1F] uppercase tracking-wider">
                {t('needsYourAction')}
              </p>
            </div>
            <div className="space-y-2">
              {pendingDealerEntries.map(entry => (
                <EntryCard key={entry.id} entry={entry} locale={locale} t={t}
                  perspective="FARMER"
                  actions={
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => setDisputeEntryId(entry.id)}
                        disabled={busyEntryId !== null}
                        className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2 rounded-xl disabled:opacity-50">
                        {t('dispute')}
                      </button>
                      <button onClick={() => confirmEntry(entry)}
                        disabled={busyEntryId !== null}
                        className="flex-1 bg-[#3A7D44] text-white text-sm font-semibold py-2 rounded-xl disabled:opacity-50">
                        {busyEntryId === entry.id ? '…' : t('confirm')}
                      </button>
                    </div>
                  } />
              ))}
            </div>
          </div>
        )}

        {/* My in-flight (PROPOSED or DISPUTED) entries */}
        {myPendingEntries.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wider mb-2 px-1">
              {t('yourInFlight')}
            </p>
            <div className="space-y-2">
              {myPendingEntries.map(entry => (
                <EntryCard key={entry.id} entry={entry} locale={locale} t={t}
                  perspective="FARMER"
                  actions={
                    <div className="mt-3">
                      <button onClick={() => withdrawEntry(entry)}
                        disabled={busyEntryId !== null}
                        className="text-xs text-red-700 hover:underline">
                        {t('withdraw')}
                      </button>
                    </div>
                  } />
              ))}
            </div>
          </div>
        )}

        {/* Confirmed / voided — history */}
        {restEntries.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wider mb-2 px-1">
              {t('history')}
            </p>
            <div className="space-y-2">
              {restEntries.map(entry => (
                <EntryCard key={entry.id} entry={entry} locale={locale} t={t} perspective="FARMER" />
              ))}
            </div>
          </div>
        )}

        {detail.entries.length === 0 && (
          <div className="mt-8 text-center py-8">
            <p className="text-[#7A8C7E] text-sm">{t('noEntries')}</p>
          </div>
        )}
      </div>
      <BottomNav color="#3A7D44" />

      {/* Payment recording bottom-sheet */}
      {showPaymentSheet && (
        <PaymentSheet
          dealerUserId={dealerUserId}
          dealerName={detail.counterparty_name}
          dealerUpi={detail.dealer_upi_vpa}
          onClose={() => setShowPaymentSheet(false)}
          onSaved={() => { setShowPaymentSheet(false); load() }}
          locale={locale} />
      )}

      {/* Dispute reason bottom-sheet */}
      {disputeEntryId && (
        <DisputeSheet
          entry={detail.entries.find(e => e.id === disputeEntryId)!}
          locale={locale}
          onClose={() => setDisputeEntryId(null)}
          onSubmit={reason => submitDispute(detail.entries.find(e => e.id === disputeEntryId)!, reason)}
          busy={busyEntryId !== null} />
      )}
    </div>
  )
}


function EntryCard({
  entry, locale, t, perspective, actions,
}: {
  entry: Entry
  locale: string
  t: ReturnType<typeof useTranslations>
  perspective: 'DEALER' | 'FARMER'
  actions?: React.ReactNode
}) {
  const isDebtIncrease = entry.entry_type === 'CREDIT_ADVANCED'
    || entry.entry_type === 'OPENING_BALANCE'
    || entry.entry_type === 'ADJUSTMENT_UP'
  const isVoided = entry.status === 'VOIDED'
  const isDisputed = entry.status === 'DISPUTED'

  const typeLabel = t(`entryType.${entry.entry_type}`)

  return (
    <div className={`bg-white rounded-2xl border p-3 ${
      isVoided ? 'border-stone-200 opacity-60' :
      isDisputed ? 'border-red-200' :
      entry.status === 'PROPOSED' ? 'border-amber-200' :
      'border-[#EEE4D2]'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold text-[#6B3F1F] uppercase tracking-wider">{typeLabel}</p>
            {entry.status === 'PROPOSED' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium uppercase tracking-wider">
                {t('statusPending')}
              </span>
            )}
            {entry.status === 'DISPUTED' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-medium uppercase tracking-wider">
                {t('statusDisputed')}
              </span>
            )}
            {isVoided && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 font-medium uppercase tracking-wider">
                {t('statusVoided')}
              </span>
            )}
          </div>
          <p className="text-xs text-[#7A8C7E] mt-0.5">
            {formatShortDate(entry.entry_date, locale)}
            {entry.due_date && <> · {t('dueBy', { date: formatShortDate(entry.due_date, locale) })}</>}
          </p>
          {entry.initiator_note && (
            <p className="text-xs text-[#6B3F1F] mt-1 leading-snug">{entry.initiator_note}</p>
          )}
          {entry.was_edited_after_proposal && (
            <p className="text-[10px] text-amber-700 mt-1 italic">{t('editedRecently')}</p>
          )}
          {entry.dispute_reason && (
            <p className="text-xs text-red-700 mt-2 leading-snug">
              <span className="font-semibold">{t('disputeLabel')}:</span> {entry.dispute_reason}
            </p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className={`font-semibold text-base ${
            isVoided ? 'line-through text-stone-500' :
            isDebtIncrease ? 'text-[#6B3F1F]' : 'text-green-700'
          }`}>
            {isDebtIncrease ? '+' : '−'}{formatRupees(entry.amount_paise, locale)}
          </p>
          {entry.payment_method && (
            <p className="text-[10px] text-[#7A8C7E] uppercase tracking-wider mt-0.5">
              {entry.payment_method}
            </p>
          )}
        </div>
      </div>
      {actions}
    </div>
  )
}


function PaymentSheet({
  dealerUserId, dealerName, dealerUpi, onClose, onSaved, locale,
}: {
  dealerUserId: string
  dealerName: string | null
  dealerUpi: string | null
  onClose: () => void
  onSaved: () => void
  locale: string
}) {
  const t = useTranslations('credit.paymentSheet')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    const rupees = parseInt(amount, 10)
    if (!(rupees > 0)) { setError(t('amountRequired')); return }
    const paise = rupees * 100
    setBusy(true)
    try {
      await api.post('/farmer/credit/payment', {
        dealer_user_id: dealerUserId,
        amount_paise: paise,
        entry_date: new Date().toISOString().slice(0, 10),
        payment_method: method,
        payment_ref: ref || null,
        initiator_note: note || null,
      })
      onSaved()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: { message?: string } | string } } }
      const msg = typeof err?.response?.data?.detail === 'object'
        ? err.response.data.detail.message
        : (err?.response?.data?.detail as string)
      setError(msg || t('genericError'))
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end" onClick={() => !busy && onClose()}>
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
        style={{ paddingBottom: 'max(2rem, calc(env(safe-area-inset-bottom) + 4rem))' }}
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-4" />
        <p className="font-bold text-[#6B3F1F] text-center">{t('title')}</p>
        {dealerName && (
          <p className="text-xs text-[#7A8C7E] text-center mt-0.5">{t('subtitleFor', { name: dealerName })}</p>
        )}

        <label className="block mt-4">
          <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('amountLabel')}</span>
          <div className="flex items-center border border-[#DDD0B8] rounded-xl mt-1 px-3 focus-within:border-[#3A7D44]">
            <span className="text-[#6B3F1F] font-semibold">₹</span>
            <input
              inputMode="numeric"
              value={amount}
              onChange={e => setAmount(digitsOnly(e.target.value))}
              placeholder="0"
              className="flex-1 py-2.5 pl-2 text-lg text-[#6B3F1F] outline-none" />
          </div>
        </label>

        <div className="mt-4">
          <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('methodLabel')}</span>
          <div className="flex gap-2 mt-2 flex-wrap">
            {(['CASH', 'UPI', 'BANK', 'CHEQUE', 'OTHER'] as PaymentMethod[]).map(m => (
              <button key={m} onClick={() => setMethod(m)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border ${
                  method === m
                    ? 'bg-[#3A7D44] text-white border-[#3A7D44]'
                    : 'bg-white text-[#6B3F1F] border-[#DDD0B8]'
                }`}>
                {t(`method.${m}`)}
              </button>
            ))}
          </div>
        </div>

        {method === 'UPI' && dealerUpi && (
          <div className="mt-3 bg-[#FAF6EE] border border-[#EEE4D2] rounded-xl p-3 text-xs">
            <p className="text-[#7A8C7E]">{t('upiHint')}</p>
            <p className="font-mono text-[#6B3F1F] mt-1">{dealerUpi}</p>
          </div>
        )}

        {(method === 'UPI' || method === 'BANK' || method === 'CHEQUE') && (
          <label className="block mt-3">
            <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('refLabel')}</span>
            <input value={ref} onChange={e => setRef(e.target.value)}
              placeholder={t('refPlaceholder')}
              maxLength={200}
              className="w-full mt-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#3A7D44]" />
          </label>
        )}

        <label className="block mt-3">
          <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('noteLabel')}</span>
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder={t('notePlaceholder')}
            className="w-full mt-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#3A7D44]" />
        </label>

        {error && (
          <p className="text-xs text-red-700 mt-3">{error}</p>
        )}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} disabled={busy}
            className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-3 rounded-2xl disabled:opacity-50">
            {t('cancel')}
          </button>
          <button onClick={submit} disabled={busy || !amount}
            className="flex-1 bg-[#3A7D44] text-white text-sm font-semibold py-3 rounded-2xl disabled:opacity-50">
            {busy ? '…' : t('submit')}
          </button>
        </div>
      </div>
    </div>
  )
}


const DISPUTE_CHIPS = ['wrongAmount', 'wrongDate', 'wrongDueDate', 'noSuchCredit', 'alreadyPaid'] as const


function DisputeSheet({
  entry, locale, onClose, onSubmit, busy,
}: {
  entry: Entry
  locale: string
  onClose: () => void
  onSubmit: (reason: string) => void
  busy: boolean
}) {
  const t = useTranslations('credit.disputeSheet')
  const [reason, setReason] = useState('')
  const [chipKey, setChipKey] = useState<string | null>(null)

  function pickChip(k: string) {
    setChipKey(k)
    setReason(t(`chips.${k}`))
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end" onClick={() => !busy && onClose()}>
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
        style={{ paddingBottom: 'max(2rem, calc(env(safe-area-inset-bottom) + 4rem))' }}
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-4" />
        <p className="font-bold text-[#6B3F1F] text-center">{t('title')}</p>
        <p className="text-xs text-[#7A8C7E] mt-1 text-center">
          {formatRupees(entry.amount_paise, locale)} · {t(`entryType.${entry.entry_type}`)}
        </p>

        <p className="text-xs text-[#6B3F1F] mt-4 font-medium">{t('pickReason')}</p>
        <div className="flex gap-2 mt-2 flex-wrap">
          {DISPUTE_CHIPS.map(k => (
            <button key={k} onClick={() => pickChip(k)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border ${
                chipKey === k
                  ? 'bg-red-100 text-red-800 border-red-300'
                  : 'bg-white text-[#6B3F1F] border-[#DDD0B8]'
              }`}>
              {t(`chips.${k}`)}
            </button>
          ))}
        </div>

        <label className="block mt-3">
          <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('detailsLabel')}</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            placeholder={t('detailsPlaceholder')}
            rows={2} maxLength={500}
            className="w-full mt-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm outline-none focus:border-red-500" />
        </label>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} disabled={busy}
            className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-3 rounded-2xl disabled:opacity-50">
            {t('cancel')}
          </button>
          <button onClick={() => onSubmit(reason)} disabled={busy || !reason.trim()}
            className="flex-1 bg-red-600 text-white text-sm font-semibold py-3 rounded-2xl disabled:opacity-50">
            {busy ? '…' : t('submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
