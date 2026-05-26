'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

interface Variety {
  id: string; name: string; crop_cosh_id: string; variety_type: string
  description_points: string[]; photos: string[]; dus_characters: Record<string, string> | null
}

interface NearbyDealer { id: string; name: string; phone: string | null; distance_km?: number }

export default function SeedVarietiesPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const router = useRouter()
  const [varieties, setVarieties] = useState<Variety[]>([])
  const [selected, setSelected] = useState<Variety | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(true)
  const [ordering, setOrdering] = useState(false)
  const [showDUS, setShowDUS] = useState(false)
  const [activePhoto, setActivePhoto] = useState(0)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<Variety[]>(`/farmer/subscriptions/${subscriptionId}/seed-varieties`)
      .then(r => setVarieties(r.data))
      .finally(() => setLoading(false))
  }, [subscriptionId])

  async function placeOrder() {
    if (!selected) return
    setOrdering(true)
    try {
      await api.post('/farmer/seed-orders', {
        subscription_id: subscriptionId,
        variety_id: selected.id,
      })
      router.replace('/orders')
    } catch { setOrdering(false) }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#085041] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (selected && !confirming) {
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title={selected.name} activeRole="FARMER" back={{ onClick: () => setSelected(null) }} />
        <div className="pt-16 pb-24">
          {/* Photo carousel */}
          {selected.photos.length > 0 ? (
            <div className="relative">
              <img src={selected.photos[activePhoto]} alt={selected.name}
                className="w-full h-64 object-cover" />
              {selected.photos.length > 1 && (
                <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
                  {selected.photos.map((_, i) => (
                    <button key={i} onClick={() => setActivePhoto(i)}
                      className={`w-2 h-2 rounded-full transition-colors ${i === activePhoto ? 'bg-white' : 'bg-white/50'}`} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="w-full h-40 bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center">
              <span className="text-6xl">🌾</span>
            </div>
          )}

          <div className="px-4 py-5 space-y-4">
            <div>
              <h2 className="text-xl font-bold text-[#6B3F1F]">{selected.name}</h2>
              <p className="text-sm text-[#7A8C7E] mt-0.5">{selected.variety_type} · {cropDisplayName(selected.crop_cosh_id)}</p>
            </div>

            {selected.description_points.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4">
                <p className="text-sm font-semibold text-[#6B3F1F] mb-2">About this variety</p>
                <ul className="space-y-1.5">
                  {selected.description_points.map((pt, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-[#6B3F1F]">
                      <span className="text-green-500 mt-0.5 shrink-0">•</span>{pt}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selected.dus_characters && Object.keys(selected.dus_characters).length > 0 && (
              <div>
                <button onClick={() => setShowDUS(!showDUS)}
                  className="w-full flex items-center justify-between bg-white rounded-2xl border border-[#DDD0B8] p-4">
                  <span className="text-sm font-semibold text-[#6B3F1F]">Technical Details (DUS)</span>
                  <span className="text-[#7A8C7E]">{showDUS ? '▲' : '▼'}</span>
                </button>
                {showDUS && (
                  <div className="bg-white rounded-b-2xl border border-t-0 border-[#DDD0B8] px-4 pb-4">
                    <table className="w-full text-xs">
                      <tbody>
                        {Object.entries(selected.dus_characters).map(([k, v]) => (
                          <tr key={k} className="border-b border-[#DDD0B8]">
                            <td className="py-1.5 text-[#7A8C7E] w-1/2">{k}</td>
                            <td className="py-1.5 text-[#6B3F1F] font-medium">{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
              <p className="text-sm text-amber-700">
                <strong>Note:</strong> Price and quantity will be confirmed by the seller. No amount is shown until the seller responds.
              </p>
            </div>
          </div>

          <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-[#DDD0B8] max-w-lg mx-auto">
            <div className="flex gap-3">
              <button onClick={() => setSelected(null)}
                className="flex-1 py-3.5 rounded-2xl border-2 border-[#DDD0B8] text-[#6B3F1F] font-semibold text-sm">
                ← Back
              </button>
              <button onClick={() => setConfirming(true)}
                className="flex-1 py-3.5 rounded-2xl text-white font-semibold text-sm"
                style={{ background: 'linear-gradient(135deg, #054a3a, #085041)' }}>
                Select this variety
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (confirming && selected) {
    return (
      <div className="min-h-screen bg-[#F5F0E8] flex flex-col items-center justify-center px-6">
        <div className="bg-white rounded-2xl border border-[#DDD0B8] p-6 text-center max-w-sm w-full space-y-4">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
            <span className="text-3xl">🌾</span>
          </div>
          <div>
            <h2 className="font-bold text-[#6B3F1F] text-lg">Confirm Selection</h2>
            <p className="text-[#7A8C7E] text-sm mt-1">
              You are selecting <strong className="text-[#6B3F1F]">{selected.name}</strong> for your crop.
            </p>
            <p className="text-amber-600 text-xs mt-2 font-medium">
              This cannot be changed once you place the order.
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setConfirming(false)}
              className="flex-1 py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium">
              Cancel
            </button>
            <button onClick={placeOrder} disabled={ordering}
              className="flex-1 py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #054a3a, #085041)' }}>
              {ordering ? 'Placing…' : 'Confirm & Order'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      <PWAHeader title="Select a Variety" activeRole="FARMER" back />
      <div className="pt-16 pb-24 px-4 max-w-lg mx-auto">
        <p className="text-xs text-[#7A8C7E] mt-4 mb-4 leading-relaxed">
          Browse and select one variety for your crop. Tap a card to see full details.
          You can only select one variety per season.
        </p>
        {varieties.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-4xl mb-3">🌱</p>
            <p className="text-[#7A8C7E] font-medium">No varieties available yet</p>
            <p className="text-xs text-[#7A8C7E] mt-1">Your company has not added seed varieties for this crop</p>
          </div>
        ) : (
          <div className="space-y-4">
            {varieties.map(v => (
              <button key={v.id}
                onClick={() => { setSelected(v); setActivePhoto(0); setShowDUS(false) }}
                className="w-full bg-white rounded-2xl border border-[#DDD0B8] shadow-sm overflow-hidden text-left active:scale-98 transition-transform">
                {v.photos.length > 0 && (
                  <img src={v.photos[0]} alt={v.name} className="w-full h-44 object-cover" />
                )}
                {v.photos.length === 0 && (
                  <div className="w-full h-32 bg-gradient-to-br from-green-50 to-emerald-50 flex items-center justify-center">
                    <span className="text-5xl">🌾</span>
                  </div>
                )}
                <div className="p-4">
                  <h3 className="font-bold text-[#6B3F1F]">{v.name}</h3>
                  <p className="text-xs text-[#7A8C7E] mt-0.5">{v.variety_type}</p>
                  {v.description_points.length > 0 && (
                    <p className="text-xs text-[#6B3F1F] mt-2 line-clamp-2">{v.description_points[0]}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
