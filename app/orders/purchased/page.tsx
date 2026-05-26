'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'

interface PurchasedItem {
  id: string; practice_id: string; brand_name: string | null; given_volume: number | null
  volume_unit: string | null; price: number | null; scan_verified: boolean
  order?: { client_id: string; date_from: string }
}

export default function PurchasedItemsPage() {
  const router = useRouter()
  const [items, setItems] = useState<PurchasedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [scanningItem, setScanningItem] = useState<PurchasedItem | null>(null)
  const [scanResult, setScanResult] = useState<{ status: string; message: string } | null>(null)
  const [qrInput, setQrInput] = useState('')
  const [scanning, setScanning] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cameraActive, setCameraActive] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<PurchasedItem[]>('/farmer/purchased-items')
      .then(r => setItems(r.data))
      .finally(() => setLoading(false))
  }, [])

  async function startScan(item: PurchasedItem) {
    setScanningItem(item)
    setScanResult(null)
    setQrInput('')
  }

  async function submitQRPayload(payload: string, item: PurchasedItem) {
    setScanning(true)
    try {
      const { data } = await api.post('/farmer/qr/scan', {
        qr_payload: payload,
        order_item_id: item.id,
      })
      setScanResult({ status: data.match_status, message: data.message })
      if (data.match_status === 'MATCH') {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, scan_verified: true } : i))
      }
    } catch {
      setScanResult({ status: 'ERROR', message: 'Scan failed. Please try again.' })
    } finally { setScanning(false) }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-green-700 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Purchased Items" activeRole="FARMER" back="/orders" />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        {items.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-4xl mb-3">🛒</p>
            <p className="text-[#7A8C7E] font-medium">No purchased items yet</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {items.map(item => (
              <div key={item.id} className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {item.brand_name && (
                      <p className="font-bold text-[#6B3F1F]">{item.brand_name}</p>
                    )}
                    <p className="text-xs text-[#7A8C7E] font-mono mt-0.5 truncate">{item.practice_id}</p>
                    {item.given_volume && (
                      <p className="text-sm text-[#6B3F1F] mt-1">
                        {item.given_volume} {item.volume_unit}{item.price ? ` · ₹${item.price}` : ''}
                      </p>
                    )}
                  </div>
                  {item.scan_verified && (
                    <div className="bg-green-100 rounded-xl px-3 py-1.5 text-center shrink-0">
                      <p className="text-green-700 text-xs font-bold">✓ Verified</p>
                      <p className="text-green-500 text-xs">Genuine</p>
                    </div>
                  )}
                </div>

                {!item.scan_verified && (
                  <button onClick={() => startScan(item)}
                    className="mt-3 w-full py-2.5 rounded-xl border-2 border-dashed border-green-200 text-green-700 text-xs font-semibold hover:bg-green-50 transition-colors">
                    📷 Scan to Verify Product
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scan bottom sheet */}
      {scanningItem && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end">
          <div className="bg-white w-full max-w-lg mx-auto rounded-t-3xl p-6 pb-10 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-bold text-[#6B3F1F]">Scan QR Code</p>
              <button onClick={() => { setScanningItem(null); setScanResult(null) }}
                className="text-[#7A8C7E] text-xl">✕</button>
            </div>

            {!scanResult ? (
              <>
                <p className="text-sm text-[#7A8C7E]">
                  Point your camera at the QR code on the product pack, or paste the QR data below.
                </p>

                <div className="bg-[#F5F0E8] rounded-2xl p-4 text-center">
                  <p className="text-xs text-[#7A8C7E] mb-3">For testing: paste QR payload JSON</p>
                  <textarea value={qrInput}
                    onChange={e => setQrInput(e.target.value)}
                    rows={3} placeholder='{"rt_qr":true,"batch_lot":"BATCH001",...}'
                    className="w-full border border-[#DDD0B8] rounded-xl px-3 py-2 text-xs font-mono focus:outline-none resize-none" />
                </div>

                <button
                  onClick={() => qrInput.trim() && submitQRPayload(qrInput.trim(), scanningItem)}
                  disabled={scanning || !qrInput.trim()}
                  className="w-full py-3.5 rounded-2xl text-white font-semibold text-sm disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, #3A7D44, #22773a)' }}>
                  {scanning ? 'Verifying…' : 'Verify Product'}
                </button>
              </>
            ) : (
              <div className={`rounded-2xl p-6 text-center ${
                scanResult.status === 'MATCH' ? 'bg-green-50 border border-green-200' :
                scanResult.status === 'MISMATCH' ? 'bg-amber-50 border border-amber-200' :
                'bg-[#F5F0E8] border border-[#DDD0B8]'
              }`}>
                <p className="text-3xl mb-3">
                  {scanResult.status === 'MATCH' ? '✅' : scanResult.status === 'MISMATCH' ? '⚠️' : 'ℹ️'}
                </p>
                <p className={`font-bold text-lg mb-2 ${
                  scanResult.status === 'MATCH' ? 'text-green-800' :
                  scanResult.status === 'MISMATCH' ? 'text-amber-800' : 'text-[#6B3F1F]'
                }`}>
                  {scanResult.status === 'MATCH' ? 'Verified — Genuine Product' :
                   scanResult.status === 'MISMATCH' ? 'Product Mismatch' : 'Not Found'}
                </p>
                <p className={`text-sm ${
                  scanResult.status === 'MATCH' ? 'text-green-600' :
                  scanResult.status === 'MISMATCH' ? 'text-amber-600' : 'text-[#7A8C7E]'
                }`}>{scanResult.message}</p>
                <button onClick={() => { setScanningItem(null); setScanResult(null) }}
                  className="mt-4 px-6 py-2.5 rounded-xl bg-white border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium">
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
