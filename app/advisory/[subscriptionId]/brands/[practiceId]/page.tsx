'use client'
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import BottomNav from '@/components/layout/BottomNav'
import api from '@/lib/api'


interface BrandRow {
  name: string
  manufacturer: string | null
}

interface BrandsResponse {
  is_locked: boolean
  locked_brand_name: string | null
  brands: BrandRow[]
  client_name: string
  // v1.9.2 — chemistry pieces the practice was authored with. Every
  // brand on the filtered list shares these values (that's the filter);
  // rendered ONCE at the top instead of on every row.
  practice_common_name?: string | null
  practice_ai_display?: string | null
  practice_formulation_display?: string | null
  practice_combined_display?: string | null
  // v2 Checkbox 3 follow-up (2026-09-22) — SE's recommended brand
  // (BRAND_NAME element on the practice, non-locked). Highlighted at
  // top of the Brands screen with a "you may substitute" note.
  recommended_brand_name?: string | null
  recommended_manufacturer_name?: string | null
}


// v1.9.2 helpers — mirror of formulationAcronym on the advisory page.
// Cosh stores formulations as "Emulsifiable Concentrate (EC)"; farmers
// know the acronym from packaging, not the long form.
function formulationAcronym(name: string): string {
  if (!name) return ''
  const m = name.match(/\(([^)]+)\)\s*$/)
  return (m ? m[1] : name).trim()
}

// Cosh trade names often carry the chemistry as a suffix
// ("Assault - Acephate 40% EC"). Since we put chemistry at the top of
// the Brands page as one header line, strip the redundant suffix from
// every brand row. Handles the two shapes Cosh uses:
//   "Assault - Acephate 40% EC"  → "Assault"
//   "Roger DF"                   → "Roger DF"
function shortBrandName(fullName: string): string {
  if (!fullName) return ''
  const idx = fullName.indexOf(' - ')
  return idx > 0 ? fullName.slice(0, idx).trim() : fullName.trim()
}

// Compose "Acephate 40% EC" from the three chemistry pieces returned
// by the Brands endpoint. Degrades gracefully — CN alone, CN + F,
// CN + AI + F, or nothing. Text-box FORMULATION_AI_CONC variant is a
// pre-composed string; concat with CN.
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
  if (combined) {
    return cn ? `${cn} ${combined}` : combined
  }
  return cn || null
}


/**
 * Advisory-Only Mode — Brands screen for a specific recommended input.
 *
 * Reached from a Brands button on any PracticeCard in the advisory
 * screen (fertilisers/pesticides only). Purely informational — no
 * action buttons. Positioned as "some brands available in the market"
 * with an explicit no-endorsement disclaimer.
 *
 * v1.9.2 — chemistry identifier moved to top of page (was repeated per
 * row); brand rows show just the short trade name + manufacturer.
 */
export default function AdvisoryBrandsPage() {
  const router = useRouter()
  const params = useParams()
  const subscriptionId = params.subscriptionId as string
  const practiceId = params.practiceId as string
  const t = useTranslations('advisoryOnly.brands')

  const [data, setData] = useState<BrandsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    (async () => {
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

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader
        title={isLocked ? t('lockedTitle') : t('title')}
        activeRole="FARMER"
        back={`/advisory/${subscriptionId}`}
      />
      <div className="pt-16 pb-32 px-4 max-w-lg mx-auto">
        {loading ? (
          <div className="mt-4 space-y-3">
            <div className="h-14 bg-white rounded-2xl animate-pulse" />
            <div className="h-14 bg-white rounded-2xl animate-pulse" />
            <div className="h-14 bg-white rounded-2xl animate-pulse" />
          </div>
        ) : error ? (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
            {error}
          </div>
        ) : !data || data.brands.length === 0 ? (
          <>
            {/* v1.9.2 — still show the chemistry header on empty results
                so the farmer sees what's being searched for. */}
            {chemistryLine && (
              <div className="mt-4 bg-white rounded-2xl border border-emerald-200 shadow-sm px-4 py-3">
                <p className="text-base font-bold text-[#6B3F1F]">{chemistryLine}</p>
              </div>
            )}
            <div className="mt-6 text-center py-8">
              <p className="text-[#7A8C7E] text-sm">{t('empty')}</p>
            </div>
          </>
        ) : (
          <>
            {chemistryLine && (
              <div className="mt-4 bg-white rounded-2xl border border-emerald-200 shadow-sm px-4 py-3">
                <p className="text-base font-bold text-[#6B3F1F]">{chemistryLine}</p>
              </div>
            )}
            {/* v2 Checkbox 3 follow-up (2026-09-22) — surface the SE's
                recommended brand (if any) at the top with an explicit
                "may substitute" note. Distinguished from the brand-
                locked treatment (v1.12): recommended is guidance, not
                a requirement. */}
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
            <p className="text-xs text-[#7A8C7E] uppercase tracking-wider font-medium mt-5">
              {isLocked ? t('lockedHeader') : t('header')}
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
