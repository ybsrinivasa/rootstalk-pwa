'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

interface RosterFarmer {
  user_id: string
  name: string | null
  phone: string | null
  photo_url: string | null
  state_cosh_id: string | null
  district_cosh_id: string | null
  sub_district: string | null
  state_name: string | null
  district_name: string | null
  last_purchase_date: string | null
  recent_purchase_count: number
  no_purchases_in_12_months: boolean
}

interface RosterResponse {
  farmers: RosterFarmer[]
  total_count: number
}

type SortKey = 'recency' | 'name' | 'phone'

const COLOUR = '#7D4196'

function fmtDate(iso: string | null, locale: string): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString(locale, {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch { return null }
}

function addressLine(f: RosterFarmer): string {
  const parts = [f.sub_district, f.district_name, f.state_name].filter(Boolean) as string[]
  return parts.join(', ')
}

export default function DealerLedgerPage() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('dealer.ledger')
  const [farmers, setFarmers] = useState<RosterFarmer[]>([])
  const [sort, setSort] = useState<SortKey>('recency')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    setLoading(true)
    const params = new URLSearchParams({ sort })
    if (query.trim()) params.set('q', query.trim())
    api.get<RosterResponse>(`/dealer/ledger/farmers?${params.toString()}`)
      .then(r => setFarmers(r.data.farmers))
      .finally(() => setLoading(false))
  }, [router, sort, query])

  const showEmpty = !loading && farmers.length === 0

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('headerTitle')} activeRole="DEALER" back="/dealer/home" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">

        {/* Add manual entry CTA */}
        <div className="mt-4 mb-3 flex justify-end">
          <button onClick={() => router.push('/dealer/ledger/add-sale')}
            className="text-sm font-semibold px-4 py-2.5 rounded-xl text-white"
            style={{ background: COLOUR }}>
            {t('addSaleCta')}
          </button>
        </div>

        {/* Search + sort */}
        <div className="bg-white rounded-2xl p-3 border border-[#DDD0B8] shadow-sm space-y-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full px-3 py-2 text-sm border border-[#DDD0B8] rounded-xl focus:outline-none focus:border-[#7D4196]"
          />
          <div className="flex gap-2 text-xs">
            <span className="text-[#7A8C7E] py-1.5">{t('sortBy')}:</span>
            {(['recency', 'name', 'phone'] as SortKey[]).map(k => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={`px-3 py-1.5 rounded-full font-medium ${
                  sort === k
                    ? 'bg-[#7D4196] text-white'
                    : 'bg-[#F5F0E8] text-[#6B3F1F]'
                }`}
              >
                {t(`sort.${k}`)}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="mt-4 space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-white rounded-2xl animate-pulse" />)}
          </div>
        )}

        {showEmpty && (
          <div className="mt-8 text-center py-16">
            <span className="text-4xl">📒</span>
            <p className="text-[#7A8C7E] font-medium mt-3">{t('emptyTitle')}</p>
            <p className="text-xs text-[#7A8C7E] mt-1">{t('emptyHint')}</p>
          </div>
        )}

        {!loading && farmers.length > 0 && (
          <div className="mt-4 space-y-2">
            {farmers.map(f => {
              const addr = addressLine(f)
              const lastDate = fmtDate(f.last_purchase_date, locale)
              return (
                <div
                  key={f.user_id}
                  className="w-full bg-white rounded-2xl p-3 border border-[#DDD0B8] shadow-sm flex items-center gap-3"
                >
                  <button
                    onClick={() => router.push(`/dealer/ledger/${f.user_id}`)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    {f.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.photo_url} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-[#F5F0E8] flex items-center justify-center flex-shrink-0">
                        <span className="text-xl">👨‍🌾</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-[#6B3F1F] truncate">{f.name || t('unnamedFarmer')}</p>
                        {f.no_purchases_in_12_months && (
                          <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full flex-shrink-0">
                            {t('inactive12m')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#7A8C7E] truncate">{f.phone || ''}</p>
                      {addr && <p className="text-xs text-[#7A8C7E] truncate">{addr}</p>}
                      {lastDate && (
                        <p className="text-[11px] text-[#7A8C7E] mt-0.5">
                          {t('lastPurchase')}: {lastDate}
                        </p>
                      )}
                    </div>
                  </button>
                  {f.phone && (
                    <a
                      href={`tel:${f.phone}`}
                      aria-label={t('callFarmer')}
                      className="flex-shrink-0 w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center active:scale-95 transition-transform"
                    >
                      <span className="text-lg">📞</span>
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />
    </div>
  )
}
