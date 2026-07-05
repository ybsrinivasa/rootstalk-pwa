'use client'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Html5Qrcode } from 'html5-qrcode'
import api from '@/lib/api'

// 2026-07-05 — QR Product Authentication scanner. Reusable across:
//   - /orders (Received items tab) for pesticide/fertilizer OrderItem
//   - /seed-orders/[orderId] for SeedOrderFull
// Caller supplies exactly one of orderItemId / seedOrderId. The
// backend enforces the XOR guard too.
//
// Result semantics — the /farmer/qr/scan endpoint returns:
//   MATCH         → close, refresh parent (parent decides how)
//   MISMATCH      → in-modal error banner; if retry:true, offer another try
//   INACTIVE_CODE → in-modal error banner; no retry (dealer's problem)

interface Props {
  orderItemId?: string
  seedOrderId?: string
  onClose: () => void
  onVerified: () => void
}

type ScanResult =
  | { status: 'MATCH'; message: string }
  | { status: 'MISMATCH'; message: string; retry: boolean }
  | { status: 'INACTIVE_CODE'; message: string }

const READER_ID = 'qr-scanner-reader'

export default function QRScannerModal({ orderItemId, seedOrderId, onClose, onVerified }: Props) {
  const t = useTranslations('qrScan')
  const [starting, setStarting] = useState(true)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const stoppedRef = useRef(false)

  async function stopScanner() {
    if (stoppedRef.current) return
    stoppedRef.current = true
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      if (scanner.isScanning) await scanner.stop()
      await scanner.clear()
    } catch {
      // Ignore — camera was closing anyway.
    }
  }

  async function handleDecoded(text: string) {
    if (submitting || result) return
    setSubmitting(true)
    await stopScanner()
    try {
      const { data } = await api.post<ScanResult>('/farmer/qr/scan', {
        qr_payload: text,
        order_item_id: orderItemId,
        seed_order_id: seedOrderId,
      })
      // Type narrowing: backend returns match_status
      const raw = data as unknown as {
        match_status: 'MATCH' | 'MISMATCH' | 'INACTIVE_CODE'
        message: string
        retry?: boolean
      }
      if (raw.match_status === 'MATCH') {
        setResult({ status: 'MATCH', message: raw.message })
        // Give the farmer a moment to see the success, then close.
        setTimeout(() => { onVerified(); onClose() }, 1200)
      } else if (raw.match_status === 'MISMATCH') {
        setResult({ status: 'MISMATCH', message: raw.message, retry: !!raw.retry })
      } else {
        setResult({ status: 'INACTIVE_CODE', message: raw.message })
      }
    } catch {
      setResult({ status: 'MISMATCH', message: t('resultMismatchBody'), retry: true })
    } finally {
      setSubmitting(false)
    }
  }

  async function startScanner() {
    setCameraError(null)
    setResult(null)
    stoppedRef.current = false
    setStarting(true)
    try {
      const scanner = new Html5Qrcode(READER_ID)
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => { handleDecoded(decodedText) },
        () => { /* per-frame decode failures are noise */ },
      )
      setStarting(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setCameraError(msg || t('cameraDenied'))
      setStarting(false)
    }
  }

  useEffect(() => {
    startScanner()
    return () => { stopScanner() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleRetry() {
    setResult(null)
    await stopScanner()
    startScanner()
  }

  async function handleClose() {
    await stopScanner()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-black text-white">
        <div>
          <p className="text-sm font-semibold">{t('modalTitle')}</p>
          <p className="text-xs text-white/70 mt-0.5">{t('modalSubtitle')}</p>
        </div>
        <button onClick={handleClose}
          className="text-sm font-medium px-3 py-1.5 rounded-full bg-white/10 text-white">
          {t('cancel')}
        </button>
      </div>

      <div className="flex-1 relative bg-black flex items-center justify-center">
        <div id={READER_ID} className="w-full max-w-md" />
        {starting && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-white/80 text-sm">{t('cameraStarting')}</p>
          </div>
        )}
        {cameraError && (
          <div className="absolute inset-0 bg-black/90 flex items-center justify-center p-6">
            <div className="bg-white rounded-2xl p-5 max-w-sm">
              <p className="text-sm text-[#6B3F1F] font-semibold mb-2">{t('cameraDenied')}</p>
              <p className="text-xs text-[#7A8C7E] mb-4 break-words">{cameraError}</p>
              <div className="flex gap-2">
                <button onClick={handleRetry}
                  className="flex-1 py-2 bg-[#3A7D44] text-white text-sm rounded-xl">
                  {t('retry')}
                </button>
                <button onClick={handleClose}
                  className="px-4 py-2 border border-[#DDD0B8] text-[#6B3F1F] text-sm rounded-xl">
                  {t('close')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {result && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-6 z-10">
          <div className={`bg-white rounded-2xl p-5 max-w-sm shadow-xl border-2 ${
            result.status === 'MATCH' ? 'border-emerald-400' :
            result.status === 'MISMATCH' ? 'border-rose-400' :
            'border-amber-400'
          }`}>
            <p className={`text-base font-bold mb-2 ${
              result.status === 'MATCH' ? 'text-emerald-700' :
              result.status === 'MISMATCH' ? 'text-rose-700' :
              'text-amber-700'
            }`}>
              {result.status === 'MATCH' ? t('resultMatchTitle') :
               result.status === 'MISMATCH' ? t('resultMismatchTitle') :
               t('resultInactiveTitle')}
            </p>
            <p className="text-sm text-[#6B3F1F]">{result.message}</p>
            {result.status === 'MATCH' && (
              <p className="text-xs text-emerald-600 mt-3">✓</p>
            )}
            {result.status === 'MISMATCH' && result.retry && (
              <div className="flex gap-2 mt-4">
                <button onClick={handleRetry}
                  className="flex-1 py-2 bg-[#3A7D44] text-white text-sm rounded-xl">
                  {t('retry')}
                </button>
                <button onClick={handleClose}
                  className="px-4 py-2 border border-[#DDD0B8] text-[#6B3F1F] text-sm rounded-xl">
                  {t('close')}
                </button>
              </div>
            )}
            {(result.status === 'INACTIVE_CODE' || (result.status === 'MISMATCH' && !result.retry)) && (
              <button onClick={handleClose}
                className="w-full mt-4 py-2 border border-[#DDD0B8] text-[#6B3F1F] text-sm rounded-xl">
                {t('close')}
              </button>
            )}
          </div>
        </div>
      )}

      {submitting && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 pointer-events-none">
          <p className="text-white/90 text-sm bg-black/70 px-4 py-2 rounded-full">…</p>
        </div>
      )}
    </div>
  )
}
