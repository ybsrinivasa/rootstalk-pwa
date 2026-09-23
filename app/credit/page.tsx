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


interface FarmerPortfolioRow {
  dealer_user_id: string
  dealer_name: string | null
  dealer_phone: string | null
  shop_name: string | null
  shop_address: string | null
  confirmed_balance_paise: number
  pending_confirm_count: number
  oldest_overdue_days: number | null
  dealer_upi_vpa: string | null
  dealer_upi_display_name: string | null
}

interface FarmerPortfolioResponse {
  rows: FarmerPortfolioRow[]
  total_owed_paise: number
}


function formatRupees(paise: number, locale: string): string {
  // Indian rupee formatting with locale-aware digits + grouping.
  // Backend guarantees paise is an integer; divide-then-format
  // avoids float noise on the rupee value.
  const rupees = Math.round(paise / 100)
  try {
    return new Intl.NumberFormat(locale === 'en' ? 'en-IN' : locale, {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(rupees)
  } catch {
    return `₹${rupees.toLocaleString('en-IN')}`
  }
}


export default function FarmerCreditPortfolioPage() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('credit.portfolio')
  const [portfolio, setPortfolio] = useState<FarmerPortfolioResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      const { data } = await api.get<FarmerPortfolioResponse>('/farmer/credit')
      setPortfolio(data)
    } catch {
      setError(t('loadError'))
    } finally {
      setLoading(false)
    }
  }

  const rows = portfolio?.rows || []
  const pendingRows = rows.filter(r => r.pending_confirm_count > 0)
  const otherRows = rows.filter(r => r.pending_confirm_count === 0)

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="FARMER" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        {loading ? (
          <div className="mt-4 space-y-3">
            <div className="h-20 bg-white rounded-2xl animate-pulse" />
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
            <div className="h-24 bg-white rounded-2xl animate-pulse" />
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
          </div>
        ) : (
          <>
            {/* Total owed — sticky-feel header card */}
            <div className="mt-4 bg-white rounded-2xl border border-[#EEE4D2] p-4 shadow-sm">
              <p className="text-[#7A8C7E] text-xs uppercase tracking-wider font-medium">{t('totalOwed')}</p>
              <p className="text-3xl font-bold text-[#6B3F1F] mt-1">
                {formatRupees(portfolio!.total_owed_paise, locale)}
              </p>
              {rows.length > 0 && (
                <p className="text-xs text-[#7A8C7E] mt-1">
                  {t('acrossDealers', { count: rows.length })}
                </p>
              )}
            </div>

            {/* Pending your confirmation — surfaced at top */}
            {pendingRows.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="inline-block w-2 h-2 bg-red-500 rounded-full" />
                  <p className="text-xs font-semibold text-[#6B3F1F] uppercase tracking-wider">
                    {t('pendingSectionTitle', { count: pendingRows.length })}
                  </p>
                </div>
                <div className="space-y-2">
                  {pendingRows.map(row => (
                    <DealerCard key={row.dealer_user_id} row={row} locale={locale} t={t}
                      onOpen={() => router.push(`/credit/dealers/${row.dealer_user_id}`)} />
                  ))}
                </div>
              </div>
            )}

            {/* Remaining accounts */}
            {otherRows.length > 0 && (
              <div className="mt-6">
                {pendingRows.length > 0 && (
                  <p className="text-xs font-semibold text-[#7A8C7E] uppercase tracking-wider mb-2 px-1">
                    {t('otherDealers')}
                  </p>
                )}
                <div className="space-y-2">
                  {otherRows.map(row => (
                    <DealerCard key={row.dealer_user_id} row={row} locale={locale} t={t}
                      onOpen={() => router.push(`/credit/dealers/${row.dealer_user_id}`)} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Notification prefs link */}
        <div className="mt-6 text-center">
          <Link href="/credit/prefs"
            className="text-xs text-[#3A7D44] font-medium underline">
            {t('prefsLink')}
          </Link>
        </div>
      </div>
      <BottomNav color="#3A7D44" />
      <ExitOnDoubleBack />
    </div>
  )
}


function DealerCard({
  row, locale, t, onOpen,
}: {
  row: FarmerPortfolioRow
  locale: string
  t: ReturnType<typeof useTranslations>
  onOpen: () => void
}) {
  const owes = row.confirmed_balance_paise > 0
  const overpaid = row.confirmed_balance_paise < 0
  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-white rounded-2xl border border-[#EEE4D2] p-4 hover:bg-[#FAF6EE] transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[#6B3F1F] truncate">
            {row.shop_name || row.dealer_name || row.dealer_phone || '—'}
          </p>
          {row.shop_name && row.dealer_name && (
            <p className="text-xs text-[#7A8C7E] truncate mt-0.5">{row.dealer_name}</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className={`font-semibold text-lg leading-tight ${
            overpaid ? 'text-green-700' : owes ? 'text-[#6B3F1F]' : 'text-[#7A8C7E]'
          }`}>
            {formatRupees(Math.abs(row.confirmed_balance_paise), locale)}
          </p>
          <p className="text-[10px] text-[#7A8C7E] uppercase tracking-wider mt-0.5">
            {overpaid ? t('theyOweYou') : owes ? t('youOwe') : t('settled')}
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {row.pending_confirm_count > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
            <span className="inline-block w-1.5 h-1.5 bg-red-500 rounded-full" />
            {t('pendingBadge', { count: row.pending_confirm_count })}
          </span>
        )}
        {row.oldest_overdue_days !== null && row.oldest_overdue_days > 0 && (
          <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
            {t('overdueBadge', { days: row.oldest_overdue_days })}
          </span>
        )}
      </div>
    </button>
  )
}
