'use client'
import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import api from '@/lib/api'

// 2026-07-05 (Phase 7) — Full-brand public verify landing.
//
// Reached in two ways:
//   1. Farmer scanning the QR with a generic camera / QR app /
//      Google Lens — browser opens the URL, lands here.
//   2. Farmer inside the PWA — the app scanner intercepts the URL,
//      posts to /farmer/qr/scan (scoped verify) instead of navigating
//      here. So this page is really for the out-of-app case.
//
// Landing is intentionally company-first:
//   - Product name (largest text)
//   - Company logo + name (client brand colours)
//   - Company contact block (website / phone / address)
//   - Mfr / Exp / Batch metadata
//   - Cultivation notes (seed products, when SA/CA has authored)
//   - rootsTALK.in hero block with value prop + CTA
//
// The client's `primary_colour` drives the hero card + accent
// treatment. Fallback tokens match the rest of the PWA when the
// client hasn't set a brand colour.

interface CompanyBlock {
  name: string | null
  tagline: string | null
  logo_url: string | null
  primary_colour: string | null
  secondary_colour: string | null
  hq_address: string | null
  website: string | null
  support_phone: string | null
  office_phone: string | null
}

interface DusRow {
  part_name?: string | null
  character_name?: string | null
  descriptor_name?: string | null
  // legacy free-text (pre-Batch W)
  part?: string | null
  character?: string | null
  descriptor?: string | null
}

interface VerifyResponse {
  verified: boolean
  reason: string | null
  status: 'ACTIVE' | 'INACTIVE'
  product_display_name: string
  product_type: string
  batch_lot_number: string
  manufacture_date: string
  expiry_date: string
  company: CompanyBlock
  cultivation_notes: string | null
  description_points: string[]
  photos: string[]
  dus_characters: DusRow[]
}

function formatDate(iso: string, locale: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(locale, {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

/** Return the given colour if it looks like a valid hex, else the
 *  Crop Green fallback. Guards against a malformed primary_colour
 *  from an older client row. */
function safeColour(c: string | null, fallback: string): string {
  if (!c) return fallback
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback
}

/** Render a website URL as-shown vs full URL for href. */
function displayHost(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.host.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : '')
  } catch {
    return url
  }
}

function ensureHttps(url: string): string {
  return url.startsWith('http') ? url : `https://${url}`
}

export default function PublicVerifyPage() {
  const { qrId } = useParams<{ qrId: string }>()
  const t = useTranslations('publicVerify')
  const locale = useLocale()
  const [record, setRecord] = useState<VerifyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [invalidCode, setInvalidCode] = useState(false)

  useEffect(() => {
    // Phase T-4: pass locale so the backend can serve description
    // points in the farmer's language (falls back to English when
    // no translation exists).
    api.get<VerifyResponse>(`/public/qr-verify/${qrId}?lang=${encodeURIComponent(locale)}`)
      .then(r => setRecord(r.data))
      .catch(err => {
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status === 404) setInvalidCode(true)
        else setInvalidCode(true)
      })
      .finally(() => setLoading(false))
  }, [qrId, locale])

  const brand = useMemo(() => {
    if (!record?.company) return { primary: '#3A7D44', secondary: '#085041' }
    return {
      primary: safeColour(record.company.primary_colour, '#3A7D44'),
      secondary: safeColour(record.company.secondary_colour, '#085041'),
    }
  }, [record])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F0E8]">
        <div className="w-8 h-8 border-2 border-[#3A7D44] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (invalidCode || !record) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F0E8] px-6">
        <img src="/logos/eywa-logo-notext-square.png" alt="" className="w-16 h-16 mb-4" />
        <p className="text-lg font-bold text-[#6B3F1F] mb-2">{t('invalidTitle')}</p>
        <p className="text-sm text-[#7A8C7E] text-center mb-6">{t('invalidBody')}</p>
        <Link href="/" className="px-5 py-2.5 bg-[#3A7D44] text-white text-sm font-semibold rounded-xl">
          {t('goToApp')}
        </Link>
      </div>
    )
  }

  const isVerified = record.verified
  const isSeed = record.product_type === 'SEED'
  const company = record.company

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <div className="max-w-md mx-auto px-4 pt-4 pb-10">
        {/* Slim rootsTALK badge at the very top — quiet, so the
            client brand can command the fold. Verify page context
            comes from the "Product Authentication" mini-line. */}
        <div className="flex items-center justify-between mb-3 px-1">
          <Link href="/" className="flex items-center gap-2">
            <img src="/logos/eywa-logo-notext-square.png" alt="" className="w-6 h-6" />
            <p className="text-[13px] leading-none">
              <span className="text-[#6B3F1F] font-light">roots</span>
              <span className="text-[#6B3F1F] font-black">TALK</span>
              <span className="text-[#7A8C7E] font-light text-[11px]">.in</span>
            </p>
          </Link>
          <span className="text-[10px] uppercase tracking-wider text-[#7A8C7E]">
            {t('productAuthentication')}
          </span>
        </div>

        {/* Hero — company card in their brand colour. Product name
            comes first (biggest thing on the page), then verified
            verdict, then company logo + name. */}
        <div
          className="rounded-2xl p-5 mb-3 text-white shadow-lg"
          style={{
            background: `linear-gradient(135deg, ${brand.primary}, ${brand.secondary})`,
          }}>
          <p className="text-[11px] uppercase tracking-widest opacity-80 mb-1">
            {isSeed ? t('varietyLabel') : t('productLabel')}
          </p>
          <p className="text-3xl font-black leading-tight">{record.product_display_name}</p>
          <p className="text-xs opacity-80 mt-1">{record.product_type}</p>

          <div className="mt-4 pt-4 border-t border-white/25 flex items-center gap-3">
            {company.logo_url ? (
              <img src={company.logo_url} alt={company.name || ''}
                className="w-12 h-12 rounded-lg object-contain bg-white/95 p-1.5" />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-white/20 flex items-center justify-center text-white text-lg font-black">
                {(company.name || '?').slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-bold truncate">{company.name || t('theManufacturer')}</p>
              {company.tagline && (
                <p className="text-xs opacity-90 truncate">{company.tagline}</p>
              )}
            </div>
            {isVerified ? (
              <span className="text-[11px] font-bold bg-white/95 text-emerald-700 px-2 py-0.5 rounded-full shrink-0">
                ✓ {t('verifiedShort')}
              </span>
            ) : (
              <span className="text-[11px] font-bold bg-white/95 text-amber-700 px-2 py-0.5 rounded-full shrink-0">
                {t('notActiveShort')}
              </span>
            )}
          </div>
        </div>

        {/* Not-active reason banner — only for INACTIVE codes */}
        {!isVerified && record.reason && (
          <div className="rounded-2xl p-4 mb-3 bg-amber-50 border border-amber-200">
            <p className="text-sm text-amber-800">{record.reason}</p>
          </div>
        )}

        {/* Batch + dates */}
        <div className="bg-white rounded-2xl p-4 mb-3 border border-[#DDD0B8] grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] text-[#7A8C7E] uppercase tracking-wider">{t('batchLot')}</p>
            <p className="text-sm font-semibold text-[#6B3F1F]">{record.batch_lot_number}</p>
          </div>
          <div>
            <p className="text-[10px] text-[#7A8C7E] uppercase tracking-wider">{t('manufactured')}</p>
            <p className="text-sm font-semibold text-[#6B3F1F]">
              {formatDate(record.manufacture_date, locale)}
            </p>
          </div>
          <div className="col-span-2">
            <p className="text-[10px] text-[#7A8C7E] uppercase tracking-wider">{t('expiryDate')}</p>
            <p className="text-sm font-semibold" style={{ color: brand.secondary }}>
              {formatDate(record.expiry_date, locale)}
            </p>
          </div>
        </div>

        {/* Seed-only content sections. Order matters — photos come
            first because they're the biggest attention-getter,
            followed by the summary bullets, then structured DUS
            data for serious growers, then the cultivation write-up
            for how-to-grow. */}

        {/* Photos gallery — horizontal scroll strip. Keeps thumbnail
            heights consistent; users swipe to see the rest. */}
        {isSeed && record.photos.length > 0 && (
          <div className="bg-white rounded-2xl p-4 mb-3 border border-[#DDD0B8]">
            <p className="text-[10px] text-[#7A8C7E] uppercase tracking-wider mb-3">
              {t('photosLabel')}
            </p>
            <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
              {record.photos.map((url, i) => (
                <img key={i} src={url} alt=""
                  className="h-40 w-40 object-cover rounded-xl shrink-0 snap-start border border-[#DDD0B8]" />
              ))}
            </div>
          </div>
        )}

        {/* Description points — bullet list of the variety's key
            claims. Comes from the CA at variety creation time. */}
        {isSeed && record.description_points.length > 0 && (
          <div className="bg-white rounded-2xl p-4 mb-3 border border-[#DDD0B8]">
            <p className="text-[10px] text-[#7A8C7E] uppercase tracking-wider mb-2">
              {t('descriptionLabel')}
            </p>
            <ul className="space-y-1.5">
              {record.description_points.map((pt, i) => (
                <li key={i} className="flex gap-2 text-sm text-[#6B3F1F]">
                  <span aria-hidden style={{ color: brand.secondary }} className="mt-1 shrink-0">•</span>
                  <span>{pt}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* DUS characters — structured Distinctness/Uniformity/
            Stability data. Grouped by part for readability. */}
        {isSeed && record.dus_characters.length > 0 && (
          <div className="bg-white rounded-2xl p-4 mb-3 border border-[#DDD0B8]">
            <p className="text-[10px] text-[#7A8C7E] uppercase tracking-wider mb-3">
              {t('dusCharactersLabel')}
            </p>
            <div className="space-y-2">
              {record.dus_characters.map((row, i) => {
                const part = row.part_name || row.part || '—'
                const character = row.character_name || row.character || '—'
                const descriptor = row.descriptor_name || row.descriptor || '—'
                return (
                  <div key={i} className="flex justify-between gap-3 py-1.5 border-b border-[#F0E6D2] last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-[#7A8C7E]">{part}</p>
                      <p className="text-sm font-medium text-[#6B3F1F]">{character}</p>
                    </div>
                    <p className="text-sm font-semibold shrink-0 text-right"
                      style={{ color: brand.secondary }}>
                      {descriptor}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Cultivation write-up. Kept last of the seed-only stack —
            it's usually the longest block so putting it after the
            visually-heavier photos + DUS keeps the page rhythm. */}
        {isSeed && record.cultivation_notes && (
          <div className="bg-white rounded-2xl p-4 mb-3 border border-[#DDD0B8]">
            <p className="text-[10px] text-[#7A8C7E] uppercase tracking-wider mb-2">
              {t('cultivationNotes')}
            </p>
            <p className="text-sm text-[#6B3F1F] whitespace-pre-line leading-relaxed">
              {record.cultivation_notes}
            </p>
          </div>
        )}

        {/* Company contact block */}
        {(company.website || company.support_phone || company.office_phone || company.hq_address) && (
          <div className="bg-white rounded-2xl p-4 mb-3 border border-[#DDD0B8] space-y-3">
            <p className="text-[10px] text-[#7A8C7E] uppercase tracking-wider">{t('contactCompany')}</p>
            {company.website && (
              <a href={ensureHttps(company.website)} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm hover:underline"
                style={{ color: brand.secondary }}>
                <span aria-hidden>🌐</span>
                <span className="truncate">{displayHost(company.website)}</span>
              </a>
            )}
            {(company.support_phone || company.office_phone) && (
              <div className="flex items-center gap-2 text-sm text-[#6B3F1F]">
                <span aria-hidden>📞</span>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {company.support_phone && (
                    <a href={`tel:${company.support_phone}`}
                      className="hover:underline" style={{ color: brand.secondary }}>
                      {company.support_phone}
                    </a>
                  )}
                  {company.office_phone && company.office_phone !== company.support_phone && (
                    <a href={`tel:${company.office_phone}`}
                      className="hover:underline" style={{ color: brand.secondary }}>
                      {company.office_phone}
                    </a>
                  )}
                </div>
              </div>
            )}
            {company.hq_address && (
              <div className="flex items-start gap-2 text-sm text-[#6B3F1F]">
                <span aria-hidden className="mt-0.5">📍</span>
                <p className="whitespace-pre-line leading-relaxed">{company.hq_address}</p>
              </div>
            )}
          </div>
        )}

        {/* rootsTALK value-prop card. Positioned after the client
            payload so the client's brand owns the fold; this reads
            as "how to link this to your farming".  Uses our
            colours, not the client's, so the brand handoff is
            visually clear. */}
        <div className="rounded-2xl p-5 mb-3"
          style={{ background: 'linear-gradient(135deg, #085041, #3A7D44)' }}>
          <div className="flex items-center gap-3 mb-3">
            <img src="/logos/eywa-logo-white.png" alt="" className="w-10 h-10" />
            <div>
              <p className="text-white text-lg leading-none">
                <span className="font-light">roots</span>
                <span className="font-black">TALK</span>
                <span className="font-light opacity-85 text-sm">.in</span>
              </p>
              <p className="text-white/75 text-[11px] mt-1">{t('rootstalkTagline')}</p>
            </div>
          </div>
          <p className="text-white/95 text-sm leading-relaxed mb-4">
            {t('rootstalkValueProp')}
          </p>
          <a href="/" className="block w-full text-center py-2.5 bg-white text-sm font-bold rounded-xl"
            style={{ color: brand.secondary }}>
            {t('openApp')}
          </a>
        </div>

        <p className="text-[10px] text-[#7A8C7E] text-center mt-4 leading-relaxed">
          {t('publicVerifyFootnote')}
        </p>
      </div>
    </div>
  )
}
