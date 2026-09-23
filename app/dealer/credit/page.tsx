'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import ExitOnDoubleBack from '@/components/ExitOnDoubleBack'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'


const COLOUR = '#7D4196'

type TrustBadge = 'RELIABLE' | 'USUALLY_ON_TIME' | 'MIXED' | 'OFTEN_LATE' | 'UNRELIABLE' | 'NEW_NO_HISTORY'

interface TrustScore {
  score_pct: number | null
  badge: TrustBadge
  resolved_credits_used: number
  open_overdue_count: number
  open_overdue_total_paise: number
}

interface DealerPortfolioRow {
  farmer_user_id: string
  farmer_name: string | null
  farmer_phone: string | null
  farmer_photo_url: string | null
  confirmed_balance_paise: number
  pending_confirm_count: number
  oldest_overdue_days: number | null
  trust: TrustScore
  is_farmer_registered: boolean
}

interface DealerPortfolioResponse {
  rows: DealerPortfolioRow[]
  total_outstanding_paise: number
  bucket_0_30_paise: number
  bucket_31_60_paise: number
  bucket_61_90_paise: number
  bucket_90_plus_paise: number
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


const BADGE_STYLES: Record<TrustBadge, string> = {
  RELIABLE:         'bg-green-100 text-green-800 border-green-200',
  USUALLY_ON_TIME:  'bg-green-100 text-green-800 border-green-200',
  MIXED:            'bg-amber-100 text-amber-800 border-amber-200',
  OFTEN_LATE:       'bg-orange-100 text-orange-800 border-orange-200',
  UNRELIABLE:       'bg-red-100 text-red-800 border-red-200',
  NEW_NO_HISTORY:   'bg-stone-100 text-stone-700 border-stone-200',
}


export default function DealerCreditPortfolioPage() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('credit.dealerPortfolio')
  const tTrust = useTranslations('credit.trustBadge')
  const [portfolio, setPortfolio] = useState<DealerPortfolioResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bucketFilter, setBucketFilter] = useState<'all' | '0-30' | '31-60' | '61-90' | '90+'>('all')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      const { data } = await api.get<DealerPortfolioResponse>('/dealer/credit')
      setPortfolio(data)
    } catch { setError(t('loadError')) }
    finally { setLoading(false) }
  }

  const rows = portfolio?.rows || []
  const filteredRows = rows.filter(r => {
    if (bucketFilter === 'all') return true
    const d = r.oldest_overdue_days
    if (d === null || d < 0) return bucketFilter === '0-30'
    if (d <= 30) return bucketFilter === '0-30'
    if (d <= 60) return bucketFilter === '31-60'
    if (d <= 90) return bucketFilter === '61-90'
    return bucketFilter === '90+'
  })

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/home" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        {loading ? (
          <div className="mt-4 space-y-3">
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
            <div className="h-16 bg-white rounded-2xl animate-pulse" />
            <div className="h-20 bg-white rounded-2xl animate-pulse" />
          </div>
        ) : error ? (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-20 mt-4">
            <span className="text-4xl">💳</span>
            <p className="text-[#7A8C7E] font-medium mt-3">{t('emptyTitle')}</p>
            <p className="text-[#7A8C7E] text-xs mt-2 max-w-xs mx-auto">{t('emptyHint')}</p>
            <Link href="/dealer/credit/new"
              className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-white text-sm font-semibold"
              style={{ background: '#7D4196' }}>
              <span className="text-lg leading-none">+</span>
              {t('newCreditCta')}
            </Link>
          </div>
        ) : (
          <>
            {/* + New credit for a farmer — dedicated entry point for
                farmers who aren't yet in the portfolio (walk-in). */}
            <Link href="/dealer/credit/new"
              className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-[#DDD0B8] text-sm font-medium text-[#7D4196] hover:bg-white/50">
              <span className="text-lg leading-none">+</span>
              {t('newCreditCta')}
            </Link>

            {/* Total outstanding */}
            <div className="mt-3 bg-white rounded-2xl border border-[#EEE4D2] p-4 shadow-sm">
              <p className="text-[#7A8C7E] text-xs uppercase tracking-wider font-medium">{t('totalOutstanding')}</p>
              <p className="text-3xl font-bold text-[#6B3F1F] mt-1">
                {formatRupees(portfolio!.total_outstanding_paise, locale)}
              </p>
              <p className="text-xs text-[#7A8C7E] mt-1">
                {t('acrossFarmers', { count: rows.length })}
              </p>
            </div>

            {/* Overdue buckets */}
            <div className="mt-3 grid grid-cols-4 gap-2">
              {([
                ['0-30', portfolio!.bucket_0_30_paise],
                ['31-60', portfolio!.bucket_31_60_paise],
                ['61-90', portfolio!.bucket_61_90_paise],
                ['90+', portfolio!.bucket_90_plus_paise],
              ] as [typeof bucketFilter, number][]).map(([bucket, amount]) => (
                <button key={bucket}
                  onClick={() => setBucketFilter(bucketFilter === bucket ? 'all' : bucket)}
                  className={`bg-white border rounded-xl p-2 text-left ${
                    bucketFilter === bucket ? 'border-[#7D4196] ring-2 ring-[#7D4196]/20' : 'border-[#EEE4D2]'
                  }`}>
                  <p className="text-[10px] uppercase tracking-wider text-[#7A8C7E] font-medium">
                    {t(`bucket.${bucket}`)}
                  </p>
                  <p className="text-sm font-semibold text-[#6B3F1F] mt-0.5">
                    {amount > 0 ? formatRupees(amount, locale) : '—'}
                  </p>
                </button>
              ))}
            </div>

            {bucketFilter !== 'all' && (
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-[#7A8C7E]">
                  {t('filteredCount', { count: filteredRows.length })}
                </span>
                <button onClick={() => setBucketFilter('all')}
                  className="text-[#7D4196] font-medium">{t('clearFilter')}</button>
              </div>
            )}

            {/* Farmer cards */}
            <div className="mt-4 space-y-2">
              {filteredRows.map(row => (
                <FarmerCard key={row.farmer_user_id} row={row} locale={locale} t={t} tTrust={tTrust}
                  onOpen={() => router.push(`/dealer/credit/farmers/${row.farmer_user_id}`)} />
              ))}
            </div>
          </>
        )}

        {/* Notification prefs link — always shown at the bottom */}
        <div className="mt-6 text-center">
          <Link href="/dealer/credit/prefs"
            className="text-xs text-[#7D4196] font-medium underline">
            {t('prefsLink')}
          </Link>
        </div>
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
      <ExitOnDoubleBack />
    </div>
  )
}


function FarmerCard({
  row, locale, t, tTrust, onOpen,
}: {
  row: DealerPortfolioRow
  locale: string
  t: ReturnType<typeof useTranslations>
  tTrust: ReturnType<typeof useTranslations>
  onOpen: () => void
}) {
  return (
    <button onClick={onOpen}
      className="w-full text-left bg-white rounded-2xl border border-[#EEE4D2] p-4 hover:bg-[#FAF6EE] transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[#6B3F1F] truncate">
            {row.farmer_name || row.farmer_phone || '—'}
          </p>
          {row.farmer_name && row.farmer_phone && (
            <p className="text-xs text-[#7A8C7E] mt-0.5">{row.farmer_phone}</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-semibold text-lg text-[#6B3F1F] leading-tight">
            {formatRupees(Math.max(0, row.confirmed_balance_paise), locale)}
          </p>
          <p className="text-[10px] text-[#7A8C7E] uppercase tracking-wider mt-0.5">
            {t('outstanding')}
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {/* Trust badge */}
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${BADGE_STYLES[row.trust.badge]}`}>
          {tTrust(row.trust.badge)}
          {row.trust.score_pct !== null && (
            <span className="opacity-80">· {row.trust.score_pct}%</span>
          )}
        </span>
        {row.oldest_overdue_days !== null && row.oldest_overdue_days > 0 && (
          <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
            {t('overdueBadge', { days: row.oldest_overdue_days })}
          </span>
        )}
        {row.pending_confirm_count > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
            <span className="inline-block w-1.5 h-1.5 bg-red-500 rounded-full" />
            {t('pendingBadge', { count: row.pending_confirm_count })}
          </span>
        )}
        {!row.is_farmer_registered && (
          <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-stone-300">
            {t('notInstalledBadge')}
          </span>
        )}
      </div>
    </button>
  )
}
