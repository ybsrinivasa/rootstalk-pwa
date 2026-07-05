'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import api from '@/lib/api'

// 2026-07-05 — Public product-verify landing.
//
// Route reached in two ways:
//   1. Farmer scanning the QR with a generic camera / QR app /
//      Google Lens — browser opens the URL, lands here.
//   2. Farmer inside the PWA — the app scanner intercepts the URL,
//      posts to /farmer/qr/scan (scoped verify) instead of navigating
//      here. So this page is really for the out-of-app case.
//
// This is the UNSCOPED verify: it confirms "yes, rootsTALK generated
// this QR for company X's product Y" — but does NOT compare against
// the scanner's order. Scoped verify happens inside the PWA.
//
// Page requires no auth; api client naturally skips the token header
// when there's no token, and /public/qr-verify accepts anonymous calls.

interface VerifyResponse {
  verified: boolean
  reason: string | null
  company_name: string | null
  product_display_name: string
  batch_lot_number: string
  product_type: string
  manufacture_date: string
  expiry_date: string
  status: 'ACTIVE' | 'INACTIVE'
}

function formatDate(iso: string, locale: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(locale, {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export default function PublicVerifyPage() {
  const { qrId } = useParams<{ qrId: string }>()
  const t = useTranslations('publicVerify')
  const locale = useLocale()
  const [record, setRecord] = useState<VerifyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [invalidCode, setInvalidCode] = useState(false)

  useEffect(() => {
    api.get<VerifyResponse>(`/public/qr-verify/${qrId}`)
      .then(r => setRecord(r.data))
      .catch(err => {
        // 404 → not a valid rootsTALK QR
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status === 404) setInvalidCode(true)
        else setInvalidCode(true)
      })
      .finally(() => setLoading(false))
  }, [qrId])

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
  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <div className="max-w-md mx-auto px-5 py-8">
        {/* Brand strip */}
        <div className="flex items-center gap-3 mb-6">
          <img src="/logos/eywa-logo-notext-square.png" alt="" className="w-12 h-12" />
          <div>
            <p className="text-lg leading-none">
              <span className="text-[#6B3F1F] font-light">roots</span>
              <span className="text-[#6B3F1F] font-black">TALK</span>
              <span className="text-[#7A8C7E] font-light text-base">.in</span>
            </p>
            <p className="text-[11px] text-[#7A8C7E] mt-1">{t('productAuthentication')}</p>
          </div>
        </div>

        {/* Verdict card */}
        <div className={`rounded-2xl p-5 mb-4 border-2 ${
          isVerified
            ? 'bg-emerald-50 border-emerald-300'
            : 'bg-amber-50 border-amber-300'
        }`}>
          <p className={`text-2xl font-black mb-1 ${
            isVerified ? 'text-emerald-800' : 'text-amber-800'
          }`}>
            {isVerified ? t('verifiedTitle') : t('notActiveTitle')}
          </p>
          <p className={`text-sm ${isVerified ? 'text-emerald-700' : 'text-amber-700'}`}>
            {isVerified ? t('verifiedSubtitle', { company: record.company_name || t('theManufacturer') }) : (record.reason || t('notActiveSubtitle'))}
          </p>
        </div>

        {/* Product detail block */}
        <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8] mb-4 space-y-3">
          <div>
            <p className="text-[11px] text-[#7A8C7E] uppercase tracking-wider">{t('company')}</p>
            <p className="text-base font-semibold text-[#6B3F1F]">{record.company_name || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] text-[#7A8C7E] uppercase tracking-wider">{t('product')}</p>
            <p className="text-base font-semibold text-[#6B3F1F]">{record.product_display_name}</p>
            <p className="text-xs text-[#7A8C7E] mt-0.5">{record.product_type}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] text-[#7A8C7E] uppercase tracking-wider">{t('batchLot')}</p>
              <p className="text-sm text-[#6B3F1F]">{record.batch_lot_number}</p>
            </div>
            <div>
              <p className="text-[11px] text-[#7A8C7E] uppercase tracking-wider">{t('dates')}</p>
              <p className="text-sm text-[#6B3F1F]">
                {formatDate(record.manufacture_date, locale)} → {formatDate(record.expiry_date, locale)}
              </p>
            </div>
          </div>
        </div>

        {/* Deep-link CTA */}
        <div className="bg-white rounded-2xl p-5 border border-[#DDD0B8]">
          <p className="text-sm text-[#6B3F1F] font-semibold mb-1">{t('installTitle')}</p>
          <p className="text-xs text-[#7A8C7E] mb-4 leading-relaxed">{t('installBody')}</p>
          <Link href="/" className="block w-full text-center py-3 bg-[#3A7D44] text-white text-sm font-semibold rounded-xl">
            {t('openApp')}
          </Link>
        </div>

        <p className="text-[10px] text-[#7A8C7E] text-center mt-6">
          {t('publicVerifyFootnote')}
        </p>
      </div>
    </div>
  )
}
