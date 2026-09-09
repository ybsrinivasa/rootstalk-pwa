'use client'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'

type LedgerSource = 'own' | 'own_manual' | 'other_shop'
type FilterKey = 'active' | 'completed' | 'all'

interface LedgerEntry {
  source: LedgerSource
  date: string
  category: string
  product_name: string | null
  brand: string | null
  manufacturer: string | null
  qty: string | number | null
  unit: string | null
  price: string | number | null
  subscription_id: string | null
  package_id: string | null
  crop_name: string | null
  crop_start_date: string | null
  advising_company: string | null
  manual_sale_id: string | null
}

interface FarmerDetail {
  user_id: string
  name: string | null
  phone: string | null
  photo_url: string | null
  state_cosh_id: string | null
  district_cosh_id: string | null
  sub_district: string | null
  state_name: string | null
  district_name: string | null
  note: string | null
  entries: LedgerEntry[]
}

const COLOUR = '#7D4196'

function fmtDate(iso: string | null, locale: string): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString(locale, {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch { return null }
}

function categoryEmoji(cat: string): string {
  if (cat === 'SEED') return '🌱'
  if (cat === 'PESTICIDE') return '🧪'
  if (cat === 'FERTILIZER') return '🧂'
  return '📦'
}

const KNOWN_CATEGORIES = new Set(['SEED', 'PESTICIDE', 'FERTILIZER', 'OTHER'])
function categoryLabel(cat: string, t: (k: string) => string): string {
  if (KNOWN_CATEGORIES.has(cat)) return t(`category.${cat.toLowerCase()}`)
  return cat
}

export default function DealerLedgerDetailPage() {
  const router = useRouter()
  const params = useParams<{ farmerId: string }>()
  const farmerId = params.farmerId
  const locale = useLocale()
  const t = useTranslations('dealer.ledger')
  const [detail, setDetail] = useState<FarmerDetail | null>(null)
  const [filter, setFilter] = useState<FilterKey>('active')
  const [loading, setLoading] = useState(true)
  const [showNoteModal, setShowNoteModal] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [showEditFarmer, setShowEditFarmer] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [subDistrictDraft, setSubDistrictDraft] = useState('')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    setLoading(true)
    api.get<FarmerDetail>(`/dealer/ledger/farmers/${farmerId}?filter=${filter}`)
      .then(r => {
        setDetail(r.data)
        setNoteDraft(r.data.note || '')
        setNameDraft(r.data.name || '')
        setSubDistrictDraft(r.data.sub_district || '')
      })
      .finally(() => setLoading(false))
  }, [router, farmerId, filter])

  const saveNote = async () => {
    setSavingNote(true)
    try {
      await api.put(`/dealer/ledger/farmers/${farmerId}/note`, { note: noteDraft })
      setDetail(d => d ? { ...d, note: noteDraft.trim() || null } : d)
      setShowNoteModal(false)
    } finally {
      setSavingNote(false)
    }
  }

  const saveFarmerInfo = async () => {
    setSavingEdit(true)
    try {
      await api.patch(`/dealer/ledger/farmers/${farmerId}`, {
        name: nameDraft.trim() || undefined,
        sub_district: subDistrictDraft.trim() || null,
      })
      setDetail(d => d ? {
        ...d,
        name: nameDraft.trim() || d.name,
        sub_district: subDistrictDraft.trim() || null,
      } : d)
      setShowEditFarmer(false)
    } finally {
      setSavingEdit(false)
    }
  }

  const addressParts = detail
    ? [detail.sub_district, detail.district_name, detail.state_name].filter(Boolean) as string[]
    : []

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title={t('detailHeaderTitle')} activeRole="DEALER" back="/dealer/ledger" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        {loading && (
          <div className="mt-4 space-y-3">
            <div className="h-28 bg-white rounded-2xl animate-pulse" />
            <div className="h-20 bg-white rounded-2xl animate-pulse" />
          </div>
        )}

        {!loading && detail && (
          <>
            {/* Farmer header card */}
            <div className="mt-4 bg-white rounded-2xl p-4 border border-[#DDD0B8] shadow-sm">
              <div className="flex items-center gap-3">
                {detail.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={detail.photo_url} alt="" className="w-14 h-14 rounded-full object-cover" />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-[#F5F0E8] flex items-center justify-center">
                    <span className="text-2xl">👨‍🌾</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#6B3F1F] truncate">{detail.name || t('unnamedFarmer')}</p>
                  <p className="text-xs text-[#7A8C7E] truncate">{detail.phone || ''}</p>
                  {addressParts.length > 0 && (
                    <p className="text-xs text-[#7A8C7E] truncate">{addressParts.join(', ')}</p>
                  )}
                </div>
                <button
                  onClick={() => setShowEditFarmer(true)}
                  className="text-xs text-[#7D4196] font-medium"
                >
                  {t('edit')}
                </button>
              </div>
              {/* Personal note */}
              <button
                onClick={() => setShowNoteModal(true)}
                className="mt-3 w-full text-left px-3 py-2 rounded-xl bg-[#FEF9E8] border border-[#F1E7B0]"
              >
                <p className="text-[11px] text-[#8A6D0A] uppercase tracking-wide">{t('personalNote')}</p>
                <p className="text-sm text-[#6B3F1F] mt-0.5">
                  {detail.note || <span className="text-[#8A6D0A] italic">{t('addNote')}</span>}
                </p>
              </button>
            </div>

            {/* Filter tabs */}
            <div className="mt-3 flex gap-2">
              {(['active', 'completed', 'all'] as FilterKey[]).map(k => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium ${
                    filter === k
                      ? 'bg-[#7D4196] text-white'
                      : 'bg-white text-[#6B3F1F] border border-[#DDD0B8]'
                  }`}
                >
                  {t(`filter.${k}`)}
                </button>
              ))}
            </div>

            {/* Ledger rows */}
            {detail.entries.length === 0 ? (
              <div className="mt-6 text-center py-12 bg-white rounded-2xl border border-[#DDD0B8]">
                <span className="text-3xl">📒</span>
                <p className="text-[#7A8C7E] text-sm mt-2">{t('noEntriesForFilter')}</p>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {detail.entries.map((e, idx) => {
                  const isOther = e.source === 'other_shop'
                  const isManual = e.source === 'own_manual'
                  const borderClass = isOther
                    ? 'border-blue-300 bg-blue-50/40'
                    : isManual
                      ? 'border-[#DDD0B8] bg-white'
                      : 'border-[#DDD0B8] bg-white'
                  const dateStr = fmtDate(e.date, locale)
                  const startStr = fmtDate(e.crop_start_date, locale)
                  return (
                    <div
                      key={`${e.source}-${idx}`}
                      className={`rounded-2xl p-3 border-2 ${borderClass}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{categoryEmoji(e.category)}</span>
                          <div>
                            <p className="text-sm font-semibold text-[#6B3F1F]">
                              {e.product_name || e.brand || categoryLabel(e.category, t)}
                            </p>
                            {e.brand && e.product_name && e.brand !== e.product_name && (
                              <p className="text-xs text-[#7A8C7E]">{e.brand}</p>
                            )}
                            {e.manufacturer && (
                              <p className="text-[11px] text-[#7A8C7E]">{e.manufacturer}</p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          {e.qty != null && (
                            <p className="text-sm font-medium text-[#6B3F1F]">
                              {String(e.qty)} {e.unit || ''}
                            </p>
                          )}
                          {!isOther && e.price != null && (
                            <p className="text-xs text-[#7A8C7E]">₹ {String(e.price)}</p>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-[#7A8C7E]">
                        <span>{dateStr}</span>
                        {isOther && (
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">
                            {t('otherDealerBadge')}
                          </span>
                        )}
                        {isManual && (
                          <span className="px-2 py-0.5 bg-[#F5F0E8] text-[#6B3F1F] rounded-full font-medium">
                            {t('manualBadge')}
                          </span>
                        )}
                      </div>
                      {(e.crop_name || e.advising_company) && (
                        <div className="mt-2 pt-2 border-t border-dashed border-[#DDD0B8] text-[11px] text-[#7A8C7E] space-y-0.5">
                          {e.crop_name && (
                            <p>
                              <span className="text-[#6B3F1F] font-medium">{e.crop_name}</span>
                              {startStr && ` · ${t('sown')} ${startStr}`}
                            </p>
                          )}
                          {e.advising_company && (
                            <p>{t('advisedBy')}: {e.advising_company}</p>
                          )}
                          {e.package_id && (
                            <p className="text-[10px] text-[#7A8C7E]/70">Pkg: {e.package_id.slice(0, 8)}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
      <BottomNav color={COLOUR} activeRole="DEALER" />

      {/* Personal note modal */}
      {showNoteModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto">
            <p className="font-semibold text-[#6B3F1F] mb-2">{t('personalNote')}</p>
            <textarea
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              rows={5}
              placeholder={t('notePlaceholder')}
              className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm focus:outline-none focus:border-[#7D4196]"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setShowNoteModal(false)}
                className="flex-1 py-2 rounded-xl border border-[#DDD0B8] text-sm text-[#6B3F1F]"
              >
                {t('cancel')}
              </button>
              <button
                onClick={saveNote}
                disabled={savingNote}
                className="flex-1 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50"
                style={{ background: COLOUR }}
              >
                {savingNote ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit farmer info modal */}
      {showEditFarmer && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto">
            <p className="font-semibold text-[#6B3F1F] mb-2">{t('editFarmerTitle')}</p>
            <label className="text-xs text-[#7A8C7E]">{t('name')}</label>
            <input
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mb-3"
            />
            <label className="text-xs text-[#7A8C7E]">{t('subDistrict')}</label>
            <input
              value={subDistrictDraft}
              onChange={e => setSubDistrictDraft(e.target.value)}
              className="w-full px-3 py-2 border border-[#DDD0B8] rounded-xl text-sm mb-3"
            />
            <p className="text-[11px] text-[#7A8C7E] mb-3">{t('editFarmerHint')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowEditFarmer(false)}
                className="flex-1 py-2 rounded-xl border border-[#DDD0B8] text-sm text-[#6B3F1F]"
              >
                {t('cancel')}
              </button>
              <button
                onClick={saveFarmerInfo}
                disabled={savingEdit}
                className="flex-1 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50"
                style={{ background: COLOUR }}
              >
                {savingEdit ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
