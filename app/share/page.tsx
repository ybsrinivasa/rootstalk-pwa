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
const CANVAS_PX = 720          // exported image size — plenty for print + share previews
const QR_PX = 560              // QR module area within the canvas — leaves room for text below
const LOGO_FRACTION = 0.20     // logo occupies 20% of QR width, ECC-H can absorb this

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
      canvas.width = CANVAS_PX
      canvas.height = CANVAS_PX
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX)

      const qrOffscreen = document.createElement('canvas')
      await QRCode.toCanvas(qrOffscreen, PWA_URL, {
        errorCorrectionLevel: 'H',    // H = 30% redundancy; safe under the logo overlay
        width: QR_PX,
        margin: 1,
        color: { dark: '#0F2A0F', light: '#FFFFFF' },   // dark forest green on white
      })

      const qrOffset = Math.round((CANVAS_PX - QR_PX) / 2) - 20   // slight upward bias — text sits below
      ctx.drawImage(qrOffscreen, qrOffset, qrOffset)

      // Logo in the middle of the QR. Sits on a white rounded card
      // so the modules under it stay visually distinct from the logo.
      try {
        const logo = await loadImage(LOGO_PATH)
        const logoSize = Math.round(QR_PX * LOGO_FRACTION)
        const pad = Math.round(logoSize * 0.14)
        const cardSize = logoSize + pad * 2
        const cx = qrOffset + Math.round(QR_PX / 2)
        const cy = qrOffset + Math.round(QR_PX / 2)
        ctx.fillStyle = '#FFFFFF'
        roundRect(ctx, cx - cardSize / 2, cy - cardSize / 2, cardSize, cardSize, 12)
        ctx.fill()
        ctx.drawImage(logo, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize)
      } catch {
        // Logo failed to load — QR itself still scans, ship without it.
      }

      // Wordmark under the QR. Two lines: "rootsTALK.in" then the URL.
      const wordmarkY = qrOffset + QR_PX + 30
      ctx.textAlign = 'center'
      ctx.fillStyle = '#0F2A0F'
      ctx.font = 'bold 44px system-ui, -apple-system, sans-serif'
      ctx.fillText('rootsTALK.in', CANVAS_PX / 2, wordmarkY + 40)

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

        <button
          onClick={copyLink}
          className="w-full mt-3 text-center text-sm text-[#3A7D44] font-medium py-2 rounded-lg active:bg-white/60">
          {t('urlLine')}
        </button>

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
