/*
 * Advisory-Only Mode — Brands + Record-Purchase screen.
 *
 * Started as pure-browse (v1.2 pesticide/fertiliser Brands info).
 * v2 Checkbox 3 rework (2026-09-23) — became the SINGLE place for
 * a farmer to record which brand they actually bought, addressing
 * the mis-attribution hole when the SE authored a recommended
 * (non-locked) brand and the farmer bought a substitute.
 *
 * Design principles from the 2026-09-23 discussion:
 *   - This is now the primary purchase-recording surface. The
 *     PracticeAckFooter's "I've purchased this" tap-when-unticked
 *     also lands here.
 *   - No pre-selection when nothing is recorded. Every brand row has
 *     equal weight so the app doesn't bias the farmer.
 *   - When a brand IS already recorded (edit case), that brand
 *     starts ticked and the photo shows attached — farmer can change.
 *   - Photo is optional in code but presented without an "(Optional)"
 *     label — nudge, not requirement.
 *   - "Not on this list? Type it in" writes a MissingBrandReport
 *     (backend, source=FARMER) so SA can close the catalog gap.
 *   - Save = commit brand + photo → POST /farmer/practice-ack/purchase
 *     with the payload + auto-tick "I've purchased this."
 *   - Cancel = navigate back without saving (preserves pure-browse).
 */
'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'


interface BrandRow {
  cosh_id: string
  name: string
  manufacturer: string | null
}

interface BrandsResponse {
  is_locked: boolean
  locked_brand_name: string | null
  brands: BrandRow[]
  client_name: string
  practice_common_name?: string | null
  practice_ai_display?: string | null
  practice_formulation_display?: string | null
  practice_combined_display?: string | null
  recommended_brand_name?: string | null
  recommended_manufacturer_name?: string | null
}

function formulationAcronym(name: string): string {
  if (!name) return ''
  const m = name.match(/\(([^)]+)\)\s*$/)
  return (m ? m[1] : name).trim()
}

function shortBrandName(fullName: string): string {
  if (!fullName) return ''
  const idx = fullName.indexOf(' - ')
  return idx > 0 ? fullName.slice(0, idx).trim() : fullName.trim()
}

function composeChemistryLine(data: BrandsResponse): string | null {
  const cn = (data.practice_common_name || '').trim()
  const ai = (data.practice_ai_display || '').trim()
  const fmtRaw = (data.practice_formulation_display || '').trim()
  const combined = (data.practice_combined_display || '').trim()
  const fmt = fmtRaw ? formulationAcronym(fmtRaw) : ''
  if (ai || fmt) {
    const parts: string[] = []
    if (cn) parts.push(cn)
    if (ai) parts.push(`${ai}%`)
    if (fmt) parts.push(fmt)
    return parts.length > 0 ? parts.join(' ') : null
  }
  if (combined) return cn ? `${cn} ${combined}` : combined
  return cn || null
}


export default function AdvisoryBrandsPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const subscriptionId = params.subscriptionId as string
  const practiceId = params.practiceId as string
  const t = useTranslations('advisoryOnly.brands')

  // Ack context — passed as URL params from the advisory page. Needed
  // to POST the ack on Save.
  const lineageParam = searchParams.get('lineage') || ''
  const dateParam = searchParams.get('date') || ''
  // Existing ack state — pre-populates when the farmer is editing a
  // previously-recorded purchase. Empty for fresh recordings.
  const initialCoshId = searchParams.get('brand') || ''
  const initialText = searchParams.get('text') || ''

  const [data, setData] = useState<BrandsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Selection state.
  const [selectedCoshId, setSelectedCoshId] = useState<string | null>(
    initialCoshId || null,
  )
  const [otherMode, setOtherMode] = useState(!!initialText)
  const [otherText, setOtherText] = useState(initialText)
  // 2026-09-25: photo capture moved OUT of this screen — it now lives
  // inline on the practice card (unified with the auto-lock case) so
  // farmers have ONE place to capture/retake regardless of the
  // purchase path. This screen is brand + manufacturer only.
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    ;(async () => {
      try {
        const r = await api.get<BrandsResponse>(
          `/farmer/subscriptions/${subscriptionId}/practices/${practiceId}/brands`,
        )
        setData(r.data)
      } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: { message?: string } | string } } }
        const detail = err?.response?.data?.detail
        const msg = typeof detail === 'object' ? detail?.message : (detail as string)
        setError(msg || t('loadError'))
      } finally {
        setLoading(false)
      }
    })()
  }, [subscriptionId, practiceId, router, t])

  const isLocked = data?.is_locked
  const chemistryLine = data ? composeChemistryLine(data) : null

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q || !data) return data?.brands || []
    return (data.brands || []).filter(b => {
      const n = (b.name || '').toLowerCase()
      const m = (b.manufacturer || '').toLowerCase()
      return n.includes(q) || m.includes(q)
    })
  }, [data, search])

  const isEditMode = !!(initialCoshId || initialText)
  const canRecord = !isLocked && !!lineageParam && !!dateParam
  const canSave = canRecord && (
    (otherMode && otherText.trim().length > 0)
    || (!otherMode && !!selectedCoshId)
  )

  const onSave = useCallback(async () => {
    if (!canSave || saving) return
    setSaving(true)
    try {
      // 2026-09-25: purchased_photo_url intentionally NOT included —
      // backend preserves the existing photo when the field is
      // omitted, so brand edits from here don't clobber a photo the
      // farmer captured inline on the practice card.
      const payload = {
        subscription_id: subscriptionId,
        timeline_lineage_id: lineageParam,
        practice_id: practiceId,
        occurrence_date: dateParam,
        purchased_brand_cosh_id: otherMode ? null : selectedCoshId,
        purchased_brand_text: otherMode ? otherText.trim() : null,
      }
      await api.post('/farmer/practice-ack/purchase', payload)
      // v2 (2026-09-23) — replace, don't push, so the device back
      // button from Advisory doesn't return the farmer to this Brands
      // screen. Bug repro: Advisory → Brands → Save → Advisory → 📷 →
      // device back landed on Brands instead of leaving Advisory.
      router.replace(`/advisory/${subscriptionId}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: { message?: string } | string } } }
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'object' ? detail?.message : (detail as string)
      setError(msg || t('saveError'))
      setSaving(false)
    }
  }, [
    canSave, saving, subscriptionId, lineageParam, practiceId, dateParam,
    otherMode, otherText, selectedCoshId, router, t,
  ])

  const onCancel = useCallback(() => {
    // v2 (2026-09-23) — same reasoning as onSave: replace, don't push,
    // so the device back button from Advisory doesn't return the farmer
    // to this Brands screen.
    router.replace(`/advisory/${subscriptionId}`)
  }, [router, subscriptionId])

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader
        title={
          isLocked ? t('lockedTitle')
          : isEditMode ? t('editTitle')
          : t('title')
        }
        activeRole="FARMER"
        back={`/advisory/${subscriptionId}`}
      />
      <div className="pt-16 pb-40 px-4 max-w-lg mx-auto">
        {loading ? (
          <div className="mt-4 space-y-3">
            <div className="h-14 bg-white rounded-2xl animate-pulse" />
            <div className="h-14 bg-white rounded-2xl animate-pulse" />
            <div className="h-14 bg-white rounded-2xl animate-pulse" />
          </div>
        ) : error && !data ? (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
            {error}
          </div>
        ) : !data ? null : (
          <>
            {chemistryLine && (
              <div className="mt-4 bg-white rounded-2xl border border-emerald-200 shadow-sm px-4 py-3">
                <p className="text-base font-bold text-[#6B3F1F]">{chemistryLine}</p>
              </div>
            )}

            {/* Recommended brand highlight */}
            {data.recommended_brand_name && !isLocked && (
              <div className="mt-4 bg-white rounded-2xl border-2 border-purple-200 shadow-sm px-4 py-3">
                <p className="text-[11px] text-purple-700 uppercase tracking-wider font-bold">
                  {t('recommendedBy', { client: data.client_name || '' })}
                </p>
                <p className="text-base font-bold text-[#6B3F1F] mt-1">
                  {shortBrandName(data.recommended_brand_name)}
                </p>
                {data.recommended_manufacturer_name && (
                  <p className="text-xs text-[#7A8C7E] mt-0.5">
                    {data.recommended_manufacturer_name}
                  </p>
                )}
                <p className="text-[11px] text-purple-600 mt-2 leading-relaxed">
                  {t('recommendedNote')}
                </p>
              </div>
            )}

            {/* Search (hidden in other/typing mode + locked view) */}
            {!isLocked && !otherMode && data.brands.length > 0 && (
              <div className="mt-5">
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white" />
              </div>
            )}

            {isLocked ? (
              <>
                <p className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium mt-5">
                  {t('lockedHeader')}
                </p>
                <div className="mt-2 bg-white rounded-2xl border border-[#DDD0B8] overflow-hidden">
                  {data.brands.map((b, idx) => (
                    <div key={`${b.name}-${idx}`}
                      className={`px-4 py-3 ${idx > 0 ? 'border-t border-[#EEE4D2]' : ''}`}>
                      <p className="font-semibold text-[#6B3F1F]">{shortBrandName(b.name)}</p>
                      {b.manufacturer && (
                        <p className="text-xs text-[#7A8C7E] mt-0.5">{b.manufacturer}</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : otherMode ? (
              <div className="mt-4 bg-white rounded-2xl border border-[#DDD0B8] shadow-sm px-4 py-3">
                <button
                  onClick={() => { setOtherMode(false); setOtherText('') }}
                  className="text-xs text-slate-500 mb-3">
                  ← {t('backToList')}
                </button>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {t('otherTypeLabel')}
                </label>
                <input
                  type="text"
                  value={otherText}
                  onChange={e => setOtherText(e.target.value)}
                  placeholder={t('otherTypePlaceholder')}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                  {t('otherHint')}
                </p>
              </div>
            ) : (
              <>
                <p className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium mt-5">
                  {data.brands.length === 0 ? t('empty') : t('header')}
                </p>
                {filtered.length > 0 && (
                  <ul className="mt-2 bg-white rounded-2xl border border-[#DDD0B8] overflow-hidden">
                    {filtered.map((b) => {
                      const active = selectedCoshId === b.cosh_id
                      return (
                        <li key={b.cosh_id}>
                          <button
                            onClick={() => setSelectedCoshId(active ? null : b.cosh_id)}
                            className="w-full px-4 py-3 flex items-start gap-3 text-left border-b border-[#EEE4D2] active:bg-[#F5F0E8] last:border-b-0">
                            <span
                              className={`inline-flex items-center justify-center w-6 h-6 rounded-full border shrink-0 mt-0.5 ${
                                active
                                  ? 'bg-emerald-600 border-emerald-700 text-white'
                                  : 'bg-white border-slate-300 text-transparent'
                              }`}>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                              </svg>
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-[#6B3F1F]">{shortBrandName(b.name)}</p>
                              {b.manufacturer && (
                                <p className="text-xs text-[#7A8C7E] mt-0.5">{b.manufacturer}</p>
                              )}
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {search && filtered.length === 0 && data.brands.length > 0 && (
                  <p className="mt-3 text-sm text-slate-500 text-center">{t('noResults')}</p>
                )}
                {/* Other affordance — always available regardless of
                    search. Farmer might have bought a truly local
                    brand that isn't in Cosh. */}
                {canRecord && (
                  <button
                    onClick={() => { setOtherMode(true); setSelectedCoshId(null) }}
                    className="mt-3 w-full text-center py-3 rounded-2xl bg-white border border-dashed border-purple-300 text-sm font-medium text-purple-700 active:bg-purple-50">
                    + {t('otherLabel')}
                  </button>
                )}
              </>
            )}

            {/* Recording-mode footer: save/cancel. Locked or missing
                ack context (no lineage/date) hides these; then the
                screen behaves like pure browse (back button = out).
                2026-09-25: photo affordance removed — moved inline to
                the practice card (unified with the auto-lock case). */}
            {canRecord && (
              <div className="fixed inset-x-0 bottom-16 bg-white border-t border-[#DDD0B8] px-4 py-3 shadow-lg">
                <div className="flex gap-2">
                  <button
                    onClick={onCancel}
                    className="flex-1 py-3 rounded-xl text-slate-700 text-sm font-semibold bg-slate-100 active:bg-slate-200">
                    {t('cancelButton')}
                  </button>
                  <button
                    onClick={onSave}
                    disabled={!canSave || saving}
                    className="flex-1 py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                    style={{ background: '#3A7D44' }}>
                    {saving ? t('saving') : t('saveButton')}
                  </button>
                </div>
              </div>
            )}

            {error && data && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-2xl p-3 text-xs text-red-700">
                {error}
              </div>
            )}

            <p className="text-[11px] text-[#7A8C7E] leading-relaxed mt-4">
              {t('disclaimer', { client: data.client_name || '' })}
            </p>
          </>
        )}
      </div>
      <BottomNav color="#3A7D44" />
    </div>
  )
}
