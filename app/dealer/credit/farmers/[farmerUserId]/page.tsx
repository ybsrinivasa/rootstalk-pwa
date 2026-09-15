'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'
import { digitsOnly } from '@/lib/input-normalization'


const COLOUR = '#7D4196'

type EntryType = 'OPENING_BALANCE' | 'CREDIT_ADVANCED' | 'PAYMENT_MADE'
  | 'ADJUSTMENT_UP' | 'ADJUSTMENT_DOWN' | 'VOID'
type EntryStatus = 'PROPOSED' | 'CONFIRMED' | 'DISPUTED' | 'VOIDED'
type Party = 'DEALER' | 'FARMER'
type PaymentMethod = 'CASH' | 'UPI' | 'BANK' | 'CHEQUE' | 'OTHER'
type TrustBadge = 'RELIABLE' | 'USUALLY_ON_TIME' | 'MIXED' | 'OFTEN_LATE' | 'UNRELIABLE' | 'NEW_NO_HISTORY'

interface Entry {
  id: string; entry_type: EntryType; amount_paise: number
  entry_date: string; due_date: string | null
  initiated_by: Party; initiator_user_id: string
  status: EntryStatus; related_sale_id: string | null
  payment_method: PaymentMethod | null; payment_ref: string | null
  receipt_media_id: string | null
  initiator_note: string | null; confirmer_note: string | null
  dispute_reason: string | null
  created_at: string; updated_at: string
  confirmed_at: string | null; confirmer_user_id: string | null
  voided_at: string | null
  was_edited_after_proposal: boolean
}

interface AccountBalance {
  confirmed_paise: number
  pending_your_confirm_paise: number
  pending_their_confirm_paise: number
}

interface TrustScore {
  score_pct: number | null
  badge: TrustBadge
  resolved_credits_used: number
  open_overdue_count: number
  open_overdue_total_paise: number
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
  trust: TrustScore | null
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
  } catch { return `₹${rupees.toLocaleString('en-IN')}` }
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return iso }
}


const BADGE_STYLES: Record<TrustBadge, string> = {
  RELIABLE:         'bg-green-100 text-green-800 border-green-200',
  USUALLY_ON_TIME:  'bg-green-100 text-green-800 border-green-200',
  MIXED:            'bg-amber-100 text-amber-800 border-amber-200',
  OFTEN_LATE:       'bg-orange-100 text-orange-800 border-orange-200',
  UNRELIABLE:       'bg-red-100 text-red-800 border-red-200',
  NEW_NO_HISTORY:   'bg-stone-100 text-stone-700 border-stone-200',
}


export default function DealerPerFarmerCreditPage() {
  const router = useRouter()
  const params = useParams()
  const farmerUserId = params.farmerUserId as string
  const locale = useLocale()
  const t = useTranslations('credit.dealerPerFarmer')
  const tPer = useTranslations('credit.perDealer')  // reuse entry-card labels
  const tTrust = useTranslations('credit.trustBadge')

  const [detail, setDetail] = useState<AccountDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'opening' | 'credit' | 'payment' | 'statement' | null>(null)
  const [disputeEntryId, setDisputeEntryId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { data } = await api.get<AccountDetail>(`/dealer/credit/farmers/${farmerUserId}`)
      setDetail(data)
    } catch (e: unknown) {
      const err = e as { response?: { status?: number } }
      if (err?.response?.status === 404) setError(t('notFound'))
      else setError(t('loadError'))
    } finally { setLoading(false) }
  }, [farmerUserId, t])

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
  }, [router, load])

  async function confirmEntry(entry: Entry) {
    setBusyEntryId(entry.id)
    try { await api.post(`/credit/entries/${entry.id}/confirm`, {}); await load() }
    catch { alert(t('confirmError')) }
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
    try { await api.delete(`/credit/entries/${entry.id}`); await load() }
    catch { alert(t('withdrawError')) }
    finally { setBusyEntryId(null) }
  }

  if (loading) return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/credit" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto space-y-3 mt-4">
        <div className="h-20 bg-white rounded-2xl animate-pulse" />
        <div className="h-20 bg-white rounded-2xl animate-pulse" />
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
    </div>
  )
  if (error || !detail) return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/credit" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto mt-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
          {error || t('notFound')}
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
    </div>
  )

  const owes = detail.balance.confirmed_paise > 0
  const overpaid = detail.balance.confirmed_paise < 0
  const netAfterPending = detail.balance.confirmed_paise
    + detail.balance.pending_your_confirm_paise
    + detail.balance.pending_their_confirm_paise
  const pendingFarmerEntries = detail.entries.filter(
    e => e.status === 'PROPOSED' && e.initiated_by === 'FARMER',
  )
  const myPendingEntries = detail.entries.filter(
    e => (e.status === 'PROPOSED' || e.status === 'DISPUTED') && e.initiated_by === 'DEALER',
  )
  const restEntries = detail.entries.filter(
    e => !pendingFarmerEntries.includes(e) && !myPendingEntries.includes(e),
  )

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={detail.counterparty_name || t('headerTitle')} activeRole="DEALER" back="/dealer/credit" />
      <div className="pt-16 pb-32 px-4 max-w-lg mx-auto">
        {/* Farmer identification — name + phone + Call. Repeats the
            header title on purpose; the top-bar title is easy to miss
            on this dense screen. */}
        <div className="mt-4 bg-white rounded-2xl p-3 border border-[#DDD0B8] shadow-sm flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-[#F5F0E8] flex items-center justify-center flex-shrink-0 overflow-hidden">
            {detail.counterparty_photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={detail.counterparty_photo_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[#7D4196] font-semibold text-sm">
                {(detail.counterparty_name || '?').trim().charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[#6B3F1F] truncate">
              {detail.counterparty_name || t('unnamedFarmerFallback')}
            </p>
            {detail.counterparty_phone && (
              <p className="text-xs text-[#7A8C7E]">{detail.counterparty_phone}</p>
            )}
          </div>
          {detail.counterparty_phone && (
            <a
              href={`tel:${detail.counterparty_phone}`}
              aria-label={t('callFarmerAria')}
              className="flex-shrink-0 w-11 h-11 rounded-full bg-green-500 text-white flex items-center justify-center active:scale-95 transition-transform">
              <span className="text-lg">📞</span>
            </a>
          )}
        </div>

        {/* Not-registered banner */}
        {detail.is_farmer_registered === false && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-2xl p-3">
            <p className="text-xs font-semibold text-amber-900 uppercase tracking-wider">
              {t('notInstalledTitle')}
            </p>
            <p className="text-xs text-amber-800 mt-1 leading-snug">
              {t('notInstalledHint')}
            </p>
          </div>
        )}

        {/* Balance card */}
        <div className="mt-4 bg-white rounded-2xl border border-[#EEE4D2] p-4 shadow-sm">
          <p className="text-[#7A8C7E] text-xs uppercase tracking-wider font-medium">
            {overpaid ? t('youOweFarmer') : t('farmerOwes')}
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
                  <span className="text-[#7A8C7E]">{t('pendingFarmerAction')}</span>
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

        {/* Trust score */}
        {detail.trust && detail.trust.badge !== 'NEW_NO_HISTORY' && (
          <div className="mt-3 bg-white rounded-2xl border border-[#EEE4D2] p-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#7A8C7E] font-medium">
                {t('trustLabel')}
              </p>
              <p className="text-sm font-semibold text-[#6B3F1F] mt-0.5">
                {tTrust(detail.trust.badge)}
                {detail.trust.score_pct !== null && (
                  <span className="text-[#7A8C7E] ml-1">· {detail.trust.score_pct}%</span>
                )}
              </p>
              <p className="text-[10px] text-[#7A8C7E] mt-0.5">
                {t('trustBasis', { count: detail.trust.resolved_credits_used })}
              </p>
            </div>
            <span className={`inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full border ${BADGE_STYLES[detail.trust.badge]}`}>
              {tTrust(detail.trust.badge)}
            </span>
          </div>
        )}
        {detail.trust?.open_overdue_count && detail.trust.open_overdue_count > 0 ? (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-2xl p-3">
            <p className="text-xs font-semibold text-red-800">
              {t('openOverdueTitle', { count: detail.trust.open_overdue_count })}
            </p>
            <p className="text-xs text-red-700 mt-0.5">
              {formatRupees(detail.trust.open_overdue_total_paise, locale)}
            </p>
          </div>
        ) : null}

        {/* Action buttons */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => setSheet('credit')}
            className="bg-[#7D4196] text-white text-sm font-semibold py-3 rounded-2xl">
            {t('addCredit')}
          </button>
          <button onClick={() => setSheet('payment')}
            className="bg-green-700 text-white text-sm font-semibold py-3 rounded-2xl">
            {t('recordPayment')}
          </button>
          {detail.can_add_opening_balance && (
            <button onClick={() => setSheet('opening')}
              className="col-span-2 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-3 rounded-2xl">
              {t('enterOpeningBalance')}
            </button>
          )}
        </div>

        {/* Pending farmer entries — top */}
        {pendingFarmerEntries.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="inline-block w-2 h-2 bg-red-500 rounded-full" />
              <p className="text-xs font-semibold text-[#6B3F1F] uppercase tracking-wider">
                {t('needsYourAction')}
              </p>
            </div>
            <div className="space-y-2">
              {pendingFarmerEntries.map(entry => (
                <EntryCard key={entry.id} entry={entry} locale={locale} tPer={tPer}
                  actions={
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => setDisputeEntryId(entry.id)}
                        disabled={busyEntryId !== null}
                        className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-2 rounded-xl disabled:opacity-50">
                        {tPer('dispute')}
                      </button>
                      <button onClick={() => confirmEntry(entry)}
                        disabled={busyEntryId !== null}
                        className="flex-1 bg-[#7D4196] text-white text-sm font-semibold py-2 rounded-xl disabled:opacity-50">
                        {busyEntryId === entry.id ? '…' : tPer('confirm')}
                      </button>
                    </div>
                  } />
              ))}
            </div>
          </div>
        )}

        {/* My in-flight entries */}
        {myPendingEntries.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wider mb-2 px-1">
              {t('yourInFlight')}
            </p>
            <div className="space-y-2">
              {myPendingEntries.map(entry => (
                <EntryCard key={entry.id} entry={entry} locale={locale} tPer={tPer}
                  actions={
                    <div className="mt-3">
                      <button onClick={() => withdrawEntry(entry)}
                        disabled={busyEntryId !== null}
                        className="text-xs text-red-700 hover:underline">
                        {tPer('withdraw')}
                      </button>
                    </div>
                  } />
              ))}
            </div>
          </div>
        )}

        {/* History */}
        {restEntries.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wider mb-2 px-1">
              {tPer('history')}
            </p>
            <div className="space-y-2">
              {restEntries.map(entry => (
                <EntryCard key={entry.id} entry={entry} locale={locale} tPer={tPer} />
              ))}
            </div>
          </div>
        )}

        {detail.entries.length === 0 && (
          <div className="mt-8 text-center py-8">
            <p className="text-[#7A8C7E] text-sm">{tPer('noEntries')}</p>
            {detail.can_add_opening_balance && (
              <p className="text-[#7A8C7E] text-xs mt-2 max-w-xs mx-auto">{t('startWithOpening')}</p>
            )}
          </div>
        )}

        {/* Statement + prefs links */}
        {detail.entries.length > 0 && (
          <div className="mt-6 flex items-center justify-center gap-4">
            <button onClick={() => setSheet('statement')}
              className="text-xs text-[#7D4196] font-medium underline">
              {t('generateStatement')}
            </button>
          </div>
        )}
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />

      {sheet === 'opening' && (
        <OpeningBalanceSheet farmerUserId={farmerUserId} onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); load() }} />
      )}
      {sheet === 'credit' && (
        <CreditSheet farmerUserId={farmerUserId} onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); load() }} />
      )}
      {sheet === 'payment' && (
        <DealerPaymentSheet farmerUserId={farmerUserId} onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); load() }} />
      )}
      {sheet === 'statement' && (
        <StatementSheet farmerUserId={farmerUserId}
          farmerName={detail.counterparty_name}
          onClose={() => setSheet(null)} />
      )}
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
  entry, locale, tPer, actions,
}: {
  entry: Entry
  locale: string
  tPer: ReturnType<typeof useTranslations>
  actions?: React.ReactNode
}) {
  const isDebtIncrease = entry.entry_type === 'CREDIT_ADVANCED'
    || entry.entry_type === 'OPENING_BALANCE'
    || entry.entry_type === 'ADJUSTMENT_UP'
  const isVoided = entry.status === 'VOIDED'
  const isDisputed = entry.status === 'DISPUTED'
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
            <p className="text-xs font-semibold text-[#6B3F1F] uppercase tracking-wider">
              {tPer(`entryType.${entry.entry_type}`)}
            </p>
            {entry.status === 'PROPOSED' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium uppercase tracking-wider">
                {tPer('statusPending')}
              </span>
            )}
            {entry.status === 'DISPUTED' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-medium uppercase tracking-wider">
                {tPer('statusDisputed')}
              </span>
            )}
            {isVoided && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 font-medium uppercase tracking-wider">
                {tPer('statusVoided')}
              </span>
            )}
          </div>
          <p className="text-xs text-[#7A8C7E] mt-0.5">
            {formatShortDate(entry.entry_date)}
            {entry.due_date && <> · {tPer('dueBy', { date: formatShortDate(entry.due_date) })}</>}
          </p>
          {entry.initiator_note && (
            <p className="text-xs text-[#6B3F1F] mt-1 leading-snug">{entry.initiator_note}</p>
          )}
          {entry.dispute_reason && (
            <p className="text-xs text-red-700 mt-2 leading-snug">
              <span className="font-semibold">{tPer('disputeLabel')}:</span> {entry.dispute_reason}
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


// ── Bottom sheets ────────────────────────────────────────────────────

function OpeningBalanceSheet({
  farmerUserId, onClose, onSaved,
}: { farmerUserId: string; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('credit.openingBalanceSheet')
  const [amount, setAmount] = useState('')
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    const rupees = parseInt(amount, 10)
    if (!(rupees > 0)) { setError(t('amountRequired')); return }
    setBusy(true)
    try {
      await api.post('/dealer/credit/opening-balance', {
        farmer_user_id: farmerUserId,
        amount_paise: rupees * 100,
        as_of_date: asOfDate,
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
    <SheetShell title={t('title')} onClose={onClose} busy={busy}>
      <p className="text-xs text-[#7A8C7E] mt-1 leading-snug">{t('help')}</p>
      <label className="block mt-4">
        <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('amountLabel')}</span>
        <div className="flex items-center border border-[#DDD0B8] rounded-xl mt-1 px-3 focus-within:border-[#7D4196]">
          <span className="text-[#6B3F1F] font-semibold">₹</span>
          <input inputMode="numeric" value={amount}
            onChange={e => setAmount(digitsOnly(e.target.value))}
            placeholder="0"
            className="flex-1 py-2.5 pl-2 text-lg text-[#6B3F1F] outline-none" />
        </div>
      </label>
      <label className="block mt-3">
        <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('asOfLabel')}</span>
        <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
          className="w-full mt-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#7D4196]" />
      </label>
      <label className="block mt-3">
        <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('noteLabel')}</span>
        <input value={note} onChange={e => setNote(e.target.value)}
          placeholder={t('notePlaceholder')}
          className="w-full mt-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#7D4196]" />
      </label>
      {error && <p className="text-xs text-red-700 mt-3">{error}</p>}
      <SheetActions cancelLabel={t('cancel')} submitLabel={t('submit')}
        onCancel={onClose} onSubmit={submit} busy={busy} canSubmit={!!amount} />
    </SheetShell>
  )
}


function CreditSheet({
  farmerUserId, onClose, onSaved,
}: { farmerUserId: string; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('credit.creditSheet')
  const [amount, setAmount] = useState('')
  const today = new Date()
  const defaultDue = new Date(today.getTime() + 30 * 86400 * 1000).toISOString().slice(0, 10)
  const [dueDate, setDueDate] = useState(defaultDue)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    const rupees = parseInt(amount, 10)
    if (!(rupees > 0)) { setError(t('amountRequired')); return }
    if (!dueDate) { setError(t('dueRequired')); return }
    setBusy(true)
    try {
      await api.post('/dealer/credit/credit', {
        farmer_user_id: farmerUserId,
        amount_paise: rupees * 100,
        due_date: dueDate,
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
    <SheetShell title={t('title')} onClose={onClose} busy={busy}>
      <label className="block mt-4">
        <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('amountLabel')}</span>
        <div className="flex items-center border border-[#DDD0B8] rounded-xl mt-1 px-3 focus-within:border-[#7D4196]">
          <span className="text-[#6B3F1F] font-semibold">₹</span>
          <input inputMode="numeric" value={amount}
            onChange={e => setAmount(digitsOnly(e.target.value))}
            placeholder="0"
            className="flex-1 py-2.5 pl-2 text-lg text-[#6B3F1F] outline-none" />
        </div>
      </label>
      <label className="block mt-3">
        <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('dueLabel')}</span>
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
          min={new Date().toISOString().slice(0, 10)}
          className="w-full mt-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#7D4196]" />
        <span className="text-[10px] text-[#7A8C7E] mt-1 inline-block">{t('dueHint')}</span>
      </label>
      <label className="block mt-3">
        <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('noteLabel')}</span>
        <input value={note} onChange={e => setNote(e.target.value)}
          placeholder={t('notePlaceholder')}
          className="w-full mt-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#7D4196]" />
      </label>
      {error && <p className="text-xs text-red-700 mt-3">{error}</p>}
      <SheetActions cancelLabel={t('cancel')} submitLabel={t('submit')}
        onCancel={onClose} onSubmit={submit} busy={busy} canSubmit={!!amount && !!dueDate} />
    </SheetShell>
  )
}


function DealerPaymentSheet({
  farmerUserId, onClose, onSaved,
}: { farmerUserId: string; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('credit.paymentSheet')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10))
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    const rupees = parseInt(amount, 10)
    if (!(rupees > 0)) { setError(t('amountRequired')); return }
    setBusy(true)
    try {
      await api.post('/dealer/credit/payment', {
        farmer_user_id: farmerUserId,
        amount_paise: rupees * 100,
        entry_date: entryDate,
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
    <SheetShell title={t('title')} onClose={onClose} busy={busy}>
      <label className="block mt-4">
        <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('amountLabel')}</span>
        <div className="flex items-center border border-[#DDD0B8] rounded-xl mt-1 px-3 focus-within:border-green-700">
          <span className="text-[#6B3F1F] font-semibold">₹</span>
          <input inputMode="numeric" value={amount}
            onChange={e => setAmount(digitsOnly(e.target.value))}
            placeholder="0"
            className="flex-1 py-2.5 pl-2 text-lg text-[#6B3F1F] outline-none" />
        </div>
      </label>
      <label className="block mt-3">
        <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('dateLabel')}</span>
        <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
          className="w-full mt-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm outline-none focus:border-green-700" />
      </label>
      <div className="mt-3">
        <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('methodLabel')}</span>
        <div className="flex gap-2 mt-2 flex-wrap">
          {(['CASH', 'UPI', 'BANK', 'CHEQUE', 'OTHER'] as PaymentMethod[]).map(m => (
            <button key={m} onClick={() => setMethod(m)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border ${
                method === m ? 'bg-green-700 text-white border-green-700' : 'bg-white text-[#6B3F1F] border-[#DDD0B8]'
              }`}>
              {t(`method.${m}`)}
            </button>
          ))}
        </div>
      </div>
      {(method === 'UPI' || method === 'BANK' || method === 'CHEQUE') && (
        <label className="block mt-3">
          <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('refLabel')}</span>
          <input value={ref} onChange={e => setRef(e.target.value)}
            placeholder={t('refPlaceholder')} maxLength={200}
            className="w-full mt-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm outline-none focus:border-green-700" />
        </label>
      )}
      <label className="block mt-3">
        <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('noteLabel')}</span>
        <input value={note} onChange={e => setNote(e.target.value)}
          placeholder={t('notePlaceholder')}
          className="w-full mt-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm outline-none focus:border-green-700" />
      </label>
      {error && <p className="text-xs text-red-700 mt-3">{error}</p>}
      <SheetActions cancelLabel={t('cancel')} submitLabel={t('submitAsDealer')}
        onCancel={onClose} onSubmit={submit} busy={busy} canSubmit={!!amount} accent="green" />
    </SheetShell>
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

  function pickChip(k: string) { setChipKey(k); setReason(t(`chips.${k}`)) }

  return (
    <SheetShell title={t('title')} onClose={onClose} busy={busy}>
      <p className="text-xs text-[#7A8C7E] mt-1 text-center">
        {formatRupees(entry.amount_paise, locale)} · {t(`entryType.${entry.entry_type}`)}
      </p>
      <p className="text-xs text-[#6B3F1F] mt-4 font-medium">{t('pickReason')}</p>
      <div className="flex gap-2 mt-2 flex-wrap">
        {DISPUTE_CHIPS.map(k => (
          <button key={k} onClick={() => pickChip(k)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border ${
              chipKey === k ? 'bg-red-100 text-red-800 border-red-300' : 'bg-white text-[#6B3F1F] border-[#DDD0B8]'
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
      <SheetActions cancelLabel={t('cancel')} submitLabel={t('submit')}
        onCancel={onClose} onSubmit={() => onSubmit(reason)}
        busy={busy} canSubmit={!!reason.trim()} accent="red" />
    </SheetShell>
  )
}


function StatementSheet({
  farmerUserId, farmerName, onClose,
}: {
  farmerUserId: string
  farmerName: string | null
  onClose: () => void
}) {
  const t = useTranslations('credit.statementSheet')
  const today = new Date()
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 3, 1).toISOString().slice(0, 10)
  const defaultTo = today.toISOString().slice(0, 10)
  const [fromDate, setFromDate] = useState(defaultFrom)
  const [toDate, setToDate] = useState(defaultTo)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    setError('')
    if (fromDate > toDate) { setError(t('badRange')); return }
    setBusy(true)
    try {
      const res = await api.get(
        `/dealer/credit/farmers/${farmerUserId}/statement.pdf`,
        {
          params: { from: fromDate, to: toDate },
          responseType: 'blob',
        },
      )
      const blob = new Blob([res.data], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      // Try sharing first (mobile-native), then fall back to open + download.
      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>
        canShare?: (data: ShareData) => boolean
      }
      const file = new File(
        [blob],
        `statement-${(farmerName || 'farmer').replace(/\s+/g, '_')}-${fromDate}-to-${toDate}.pdf`,
        { type: 'application/pdf' },
      )
      const shareData: ShareData = {
        title: t('shareTitle'),
        files: [file],
      } as ShareData
      if (nav.share && (!nav.canShare || nav.canShare(shareData))) {
        try {
          await nav.share(shareData)
          onClose()
          return
        } catch { /* user cancelled — fall through */ }
      }
      window.open(url, '_blank')
      onClose()
    } catch (e: unknown) {
      const err = e as { response?: { data?: unknown } }
      setError(t('genericError'))
    } finally { setBusy(false) }
  }

  return (
    <SheetShell title={t('title')} onClose={onClose} busy={busy}>
      <p className="text-xs text-[#7A8C7E] mt-1 leading-snug">
        {t('help')}
      </p>
      <label className="block mt-4">
        <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('fromLabel')}</span>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
          max={toDate}
          className="w-full mt-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#7D4196]" />
      </label>
      <label className="block mt-3">
        <span className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium">{t('toLabel')}</span>
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
          min={fromDate}
          max={new Date().toISOString().slice(0, 10)}
          className="w-full mt-1 border border-[#DDD0B8] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#7D4196]" />
      </label>
      {error && <p className="text-xs text-red-700 mt-3">{error}</p>}
      <SheetActions cancelLabel={t('cancel')} submitLabel={t('generate')}
        onCancel={onClose} onSubmit={generate} busy={busy}
        canSubmit={!!fromDate && !!toDate} />
    </SheetShell>
  )
}


function SheetShell({
  title, onClose, busy, children,
}: {
  title: string; onClose: () => void; busy: boolean
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end" onClick={() => !busy && onClose()}>
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-5"
        style={{ paddingBottom: 'max(2rem, calc(env(safe-area-inset-bottom) + 4rem))' }}
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-4" />
        <p className="font-bold text-[#6B3F1F] text-center">{title}</p>
        {children}
      </div>
    </div>
  )
}


function SheetActions({
  cancelLabel, submitLabel, onCancel, onSubmit, busy, canSubmit, accent = 'purple',
}: {
  cancelLabel: string; submitLabel: string
  onCancel: () => void; onSubmit: () => void
  busy: boolean; canSubmit: boolean
  accent?: 'purple' | 'green' | 'red'
}) {
  const submitClass =
    accent === 'green' ? 'bg-green-700' :
    accent === 'red'   ? 'bg-red-600' :
    'bg-[#7D4196]'
  return (
    <div className="flex gap-2 mt-5">
      <button onClick={onCancel} disabled={busy}
        className="flex-1 border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium py-3 rounded-2xl disabled:opacity-50">
        {cancelLabel}
      </button>
      <button onClick={onSubmit} disabled={busy || !canSubmit}
        className={`flex-1 text-white text-sm font-semibold py-3 rounded-2xl disabled:opacity-50 ${submitClass}`}>
        {busy ? '…' : submitLabel}
      </button>
    </div>
  )
}
