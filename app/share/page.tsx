'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import QRCode from 'qrcode'
import PWAHeader from '@/components/layout/PWAHeader'
import { getUser } from '@/lib/auth'

// One-tap "help a farmer install rootsTALK.in" surface. Accessible
// from every role's header (the QR icon between the app title and
// the language chip). Renders a QR that encodes the PWA URL with
// the eywa tree logo overlaid in the middle, plus Web Share +
// Save Image actions. Encoding is client-side so there's no
// server round-trip and no auth question — the URL never changes.
//
// The composited PNG on the hidden canvas is the artifact used by
// BOTH Share and Save — same bytes, so what the farmer's contact
// receives matches what would be saved to Photos.

const PWA_URL = 'https://rootstalk.in'
const LOGO_PATH = '/logos/eywa-logo-notext-square.png'
const MISSED_CALL_NUMBER = '9187952956'

// 2026-11-15 — canvas rewritten from a square QR-only composition
// to a portrait poster. Top band: "RootsTalk" title. Middle: QR
// code (unchanged). Bottom band: URL + missed-call call-out so the
// facilitator-promoter can print a single sheet to paste in a
// shop — every piece a farmer needs to join is on one page.
const CANVAS_W = 720
const CANVAS_H = 1200           // taller than square to fit header + footer text blocks
const QR_PX = 560               // QR module area — kept at previous size for scan reliability
const LOGO_FRACTION = 0.20      // logo occupies 20% of QR width; ECC-H absorbs the obscured modules

export default function SharePage() {
  const t = useTranslations('shareQr')
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const user = getUser()
  const activeRole =
    (typeof window !== 'undefined' ? localStorage.getItem('rt_active_role') : null) ||
    user?.pwa_roles?.[0] ||
    'FARMER'

  useEffect(() => {
    let cancelled = false
    async function render() {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = CANVAS_W
      canvas.height = CANVAS_H
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Background — warm cream matches the PWA's palette; prints
      // readably on standard inkjet A4 without eating too much ink.
      ctx.fillStyle = '#F7F0E0'
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

      // Top band — "rootsTALK.in" wordmark + short tagline. Sits
      // above the QR so a printed poster reads top-down.
      ctx.textAlign = 'center'
      ctx.fillStyle = '#0F2A0F'
      ctx.font = 'bold 64px system-ui, -apple-system, sans-serif'
      ctx.fillText('rootsTALK.in', CANVAS_W / 2, 90)
      ctx.font = '26px system-ui, -apple-system, sans-serif'
      ctx.fillStyle = '#6B3F1F'
      ctx.fillText('Your crop advisory network', CANVAS_W / 2, 135)

      // QR card — white rounded panel that visually separates the
      // QR from the cream bg and mirrors the on-screen card.
      const qrCardPad = 24
      const qrCardSize = QR_PX + qrCardPad * 2
      const qrCardX = Math.round((CANVAS_W - qrCardSize) / 2)
      const qrCardY = 175
      ctx.fillStyle = '#FFFFFF'
      roundRect(ctx, qrCardX, qrCardY, qrCardSize, qrCardSize, 20)
      ctx.fill()

      const qrOffscreen = document.createElement('canvas')
      await QRCode.toCanvas(qrOffscreen, PWA_URL, {
        errorCorrectionLevel: 'H',    // H = 30% redundancy; safe under the logo overlay
        width: QR_PX,
        margin: 1,
        color: { dark: '#0F2A0F', light: '#FFFFFF' },   // dark forest green on white
      })
      const qrX = qrCardX + qrCardPad
      const qrY = qrCardY + qrCardPad
      ctx.drawImage(qrOffscreen, qrX, qrY)

      // Logo centered in the QR. Sits on a white rounded card so
      // the modules under it stay visually distinct from the logo.
      try {
        const logo = await loadImage(LOGO_PATH)
        const logoSize = Math.round(QR_PX * LOGO_FRACTION)
        const pad = Math.round(logoSize * 0.14)
        const cardSize = logoSize + pad * 2
        const cx = qrX + Math.round(QR_PX / 2)
        const cy = qrY + Math.round(QR_PX / 2)
        ctx.fillStyle = '#FFFFFF'
        roundRect(ctx, cx - cardSize / 2, cy - cardSize / 2, cardSize, cardSize, 12)
        ctx.fill()
        ctx.drawImage(logo, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize)
      } catch {
        // Logo failed to load — QR itself still scans, ship without it.
      }

      // Bottom band — URL line + missed-call call-out. Baked into
      // the image so a printed poster is fully self-contained:
      // farmer can scan OR type the URL OR give a missed call.
      const belowQrY = qrCardY + qrCardSize + 40

      // "Scan the QR" cue first, then the URL as the second route.
      ctx.fillStyle = '#6B3F1F'
      ctx.font = '22px system-ui, -apple-system, sans-serif'
      ctx.fillText('Scan the QR, or visit:', CANVAS_W / 2, belowQrY)

      ctx.fillStyle = '#0F2A0F'
      ctx.font = 'bold 40px system-ui, -apple-system, sans-serif'
      ctx.fillText('rootstalk.in', CANVAS_W / 2, belowQrY + 50)

      // Missed-call call-out — bordered rounded block to visually
      // distinguish it as a THIRD route (no camera, no typing).
      const callBlockY = belowQrY + 90
      const callBlockH = 130
      const callBlockPad = 40
      ctx.fillStyle = '#FFFFFF'
      ctx.strokeStyle = '#DDD0B8'
      ctx.lineWidth = 2
      roundRect(
        ctx, callBlockPad, callBlockY,
        CANVAS_W - callBlockPad * 2, callBlockH, 16,
      )
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#6B3F1F'
      ctx.font = '22px system-ui, -apple-system, sans-serif'
      ctx.fillText(
        "Can't scan? Give a missed call to",
        CANVAS_W / 2, callBlockY + 42,
      )
      ctx.fillStyle = '#0F2A0F'
      ctx.font = 'bold 44px system-ui, -apple-system, sans-serif'
      ctx.fillText(MISSED_CALL_NUMBER, CANVAS_W / 2, callBlockY + 92)

      if (!cancelled) {
        setPreviewUrl(canvas.toDataURL('image/png'))
      }
    }
    void render()
    return () => { cancelled = true }
  }, [])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  async function shareAction() {
    const canvas = canvasRef.current
    if (!canvas) return
    setBusy(true)
    try {
      const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/png'))
      if (!blob) return
      const file = new File([blob], 'rootstalk-in.png', { type: 'image/png' })
      const shareData: ShareData = {
        title: 'rootsTALK.in',
        text: `${t('shareTagline')}\n\n${PWA_URL}`,
        files: [file],
      }
      // Some devices can share text but not files — fall back to
      // text-only if canShare rejects the files.
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
      if (nav.share && (!nav.canShare || nav.canShare(shareData))) {
        await nav.share(shareData)
      } else if (nav.share) {
        await nav.share({ title: shareData.title, text: shareData.text })
      } else {
        showToast(t('shareUnavailable'))
      }
    } catch {
      // User cancelled the share sheet — silent.
    } finally {
      setBusy(false)
    }
  }

  function saveAction() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'rootstalk-in.png'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast(t('savedToast'))
    }, 'image/png')
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(PWA_URL)
      showToast(t('copiedToast'))
    } catch {
      // Clipboard blocked — silent.
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F0E0] pb-8" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 60px)' }}>
      <PWAHeader activeRole={activeRole} back={{ onClick: () => router.back() }} />

      <div className="max-w-md mx-auto px-4">
        <h1 className="text-lg font-bold text-[#6B3F1F] text-center mt-4">
          {t('pageTitle')}
        </h1>
        <p className="text-sm text-[#7A8C7E] text-center mt-2 mb-5">
          {t('scanHint')}
        </p>

        <div className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm p-4">
          {previewUrl ? (
            <img src={previewUrl} alt="rootsTALK.in QR" className="w-full h-auto rounded-lg" />
          ) : (
            <div className="w-full aspect-square rounded-lg bg-[#F7F0E0] animate-pulse" />
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* URL line — now explicit about the copy affordance so the
            promoter isn't guessing whether it's tappable. */}
        <button
          onClick={copyLink}
          className="w-full mt-3 flex items-center justify-center gap-2 text-sm text-[#3A7D44] font-medium py-2 rounded-lg active:bg-white/60">
          <span>📋</span>
          <span>{t('urlLine')}</span>
          <span className="text-xs text-[#7A8C7E]">· {t('urlTapToCopy')}</span>
        </button>

        {/* Missed-call call-out — third route for farmers who can't
            scan (no camera) or can't type (low-tech phone). Number
            is a tel: link so the promoter can tap to dial from
            their own device if they want to verify it. */}
        <div className="mt-3 bg-white border border-[#DDD0B8] rounded-xl p-4 text-center">
          <p className="text-xs text-[#6B3F1F]">
            {t('missedCallHint')}
          </p>
          <a
            href={`tel:${MISSED_CALL_NUMBER}`}
            className="block mt-1 text-2xl font-bold text-[#0F2A0F] tracking-wider active:text-[#3A7D44]">
            {MISSED_CALL_NUMBER}
          </a>
          <p className="text-[11px] text-[#7A8C7E] mt-1">
            {t('missedCallSubtitle')}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-5">
          <button
            onClick={shareAction}
            disabled={busy || !previewUrl}
            className="py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
            style={{ background: '#3A7D44' }}>
            {t('shareBtn')}
          </button>
          <button
            onClick={saveAction}
            disabled={!previewUrl}
            className="py-3 rounded-xl text-sm font-semibold border border-[#DDD0B8] text-[#6B3F1F] bg-white disabled:opacity-40">
            {t('saveBtn')}
          </button>
        </div>

        <p className="text-xs text-[#7A8C7E] text-center mt-5 leading-relaxed">
          {t('shareTagline')}
        </p>
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-[#6B3F1F] text-white text-sm px-4 py-2 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
