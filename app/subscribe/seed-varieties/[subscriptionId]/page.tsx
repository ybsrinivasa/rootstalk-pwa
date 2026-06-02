'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'

interface DusCharacterRow {
  part_cosh_id?: string; part_name_en?: string
  character_cosh_id?: string; character_name_en?: string
  descriptor_cosh_id?: string; descriptor_name_en?: string
}
interface Variety {
  id: string; name: string; crop_cosh_id: string; variety_type: string
  description_points: string[]; photos: string[]
  // Backend ships an array of {part, character, descriptor} rows
  // (Cosh `dus_characters_descriptors` Connect). Was previously
  // typed as Record<string,string> which led to a runtime render
  // error when the PWA tried Object.entries it; fixed 2026-06-02.
  dus_characters: DusCharacterRow[] | null
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
  // 2026-06-02 — Lightbox state. Variety sale depends heavily on the
  // seed-company photos; we want them readable in detail. null = closed.
  const [lightboxAt, setLightboxAt] = useState<number | null>(null)

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
      // Land on the per-package Orders Manage tab where the new
      // seed order shows up (fix 2026-06-02 per user report).
      router.replace(`/crop-detail/${subscriptionId}/orders?tab=manage`)
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
          {/* 2026-06-02 — Photo carousel. Swipeable horizontal scroll
              with snap; each card is 4:3 so seed-company photos
              render at a flattering aspect. Tap any image to open
              the pinch-zoom lightbox (a variety's sale appeal lives
              in these images). */}
          {selected.photos.length > 0 ? (
            <PhotoCarousel
              photos={selected.photos}
              alt={selected.name}
              activeIndex={activePhoto}
              onActiveChange={setActivePhoto}
              onOpen={i => setLightboxAt(i)}
            />
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

            {Array.isArray(selected.dus_characters) && selected.dus_characters.length > 0 && (
              <div>
                <button onClick={() => setShowDUS(!showDUS)}
                  className="w-full flex items-center justify-between bg-white rounded-2xl border border-[#DDD0B8] p-4">
                  <span className="text-sm font-semibold text-[#6B3F1F]">Technical Details (DUS)</span>
                  <span className="text-[#7A8C7E]">{showDUS ? '▲' : '▼'}</span>
                </button>
                {showDUS && (
                  <div className="bg-white rounded-b-2xl border border-t-0 border-[#DDD0B8] px-4 pb-4">
                    {/* Fix 2026-06-02 — dus_characters is an ARRAY of
                        {part_name_en, character_name_en, descriptor_name_en}
                        rows (per `dus_characters_descriptors` Cosh
                        Connect), not a flat object. Group by Part →
                        Character → [descriptors] so the table reads
                        as "WHOLE PLANT · Resistance: Mi, Fusarium". */}
                    {(() => {
                      const rows = selected.dus_characters || []
                      const grouped: Record<string, Record<string, string[]>> = {}
                      for (const r of rows) {
                        const part = r.part_name_en || '—'
                        const char = r.character_name_en || '—'
                        const desc = r.descriptor_name_en || ''
                        grouped[part] = grouped[part] || {}
                        grouped[part][char] = grouped[part][char] || []
                        if (desc) grouped[part][char].push(desc)
                      }
                      return Object.entries(grouped).map(([part, chars]) => (
                        <div key={part} className="pt-3">
                          <p className="text-[10px] font-semibold text-[#7A8C7E] uppercase tracking-wider">{part}</p>
                          {Object.entries(chars).map(([char, descs]) => (
                            <div key={char} className="flex gap-2 text-xs py-1">
                              <span className="text-[#7A8C7E] w-1/3 shrink-0">{char}</span>
                              <span className="text-[#6B3F1F] font-medium">{descs.join(', ')}</span>
                            </div>
                          ))}
                        </div>
                      ))
                    })()}
                  </div>
                )}
              </div>
            )}
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

        {/* Pinch-zoom lightbox — opens when farmer taps any carousel
            photo. Renders OUTSIDE the scrollable parent so its fixed
            positioning fills the viewport. */}
        {lightboxAt !== null && (
          <PhotoLightbox
            photos={selected.photos}
            startIndex={lightboxAt}
            alt={selected.name}
            onClose={() => setLightboxAt(null)}
          />
        )}
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
      <PWAHeader title="Select a Variety" activeRole="FARMER" back={`/crop-detail/${subscriptionId}/orders`} />
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


// ── Photo carousel ──────────────────────────────────────────────────────────
//
// Horizontal CSS scroll-snap carousel — gives native swipe between
// photos without any JS gesture handling. Tap any photo to open the
// pinch-zoom lightbox. Dot indicators sync to whichever photo is
// currently snapped in view.

function PhotoCarousel({
  photos, alt, activeIndex, onActiveChange, onOpen,
}: {
  photos: string[]; alt: string
  activeIndex: number
  onActiveChange: (i: number) => void
  onOpen: (i: number) => void
}) {
  return (
    <div className="relative bg-black">
      <div
        className="flex overflow-x-auto snap-x snap-mandatory"
        style={{ scrollbarWidth: 'none' }}
        onScroll={e => {
          const w = e.currentTarget.clientWidth
          const i = Math.round(e.currentTarget.scrollLeft / w)
          if (i !== activeIndex) onActiveChange(i)
        }}>
        {photos.map((src, i) => (
          <button key={i}
            onClick={() => onOpen(i)}
            className="w-full shrink-0 snap-start aspect-[4/3] focus:outline-none">
            <img src={src} alt={`${alt} — photo ${i + 1}`}
              className="w-full h-full object-cover pointer-events-none" />
          </button>
        ))}
      </div>
      {photos.length > 1 && (
        <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 pointer-events-none">
          {photos.map((_, i) => (
            <div key={i}
              className={`w-2 h-2 rounded-full transition-colors ${i === activeIndex ? 'bg-white' : 'bg-white/40'}`} />
          ))}
        </div>
      )}
      <div className="absolute top-3 right-3 bg-black/40 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm pointer-events-none">
        Tap to zoom
      </div>
    </div>
  )
}


// ── Pinch-zoom lightbox ─────────────────────────────────────────────────────
//
// Full-viewport modal showing one photo at a time. `touch-action:
// pinch-zoom` on the image container lets the browser handle pinch
// natively (no gesture library); a wrapping scroll lets the farmer
// pan a zoomed image. Left/right buttons + dot indicators navigate
// between photos. Body scroll locked while open.

import { useRef as _useRef, useEffect as _useEffect } from 'react'

function PhotoLightbox({
  photos, startIndex, alt, onClose,
}: {
  photos: string[]
  startIndex: number
  alt: string
  onClose: () => void
}) {
  const [index, setIndex] = useState(startIndex)
  const wrap = _useRef<HTMLDivElement>(null)

  _useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Reset zoom by remounting the image on index change (cleanest way
  // to drop the browser's accumulated pinch state).
  const photo = photos[index]
  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col" ref={wrap}>
      <button onClick={onClose}
        className="absolute top-3 right-3 z-20 text-white bg-white/10 backdrop-blur-sm rounded-full w-10 h-10 flex items-center justify-center text-xl">
        ✕
      </button>

      <div className="flex-1 overflow-auto flex items-center justify-center"
        style={{ touchAction: 'pinch-zoom' }}>
        <img key={index}
          src={photo}
          alt={`${alt} — photo ${index + 1}`}
          className="max-w-full max-h-full object-contain select-none"
          draggable={false} />
      </div>

      {photos.length > 1 && (
        <>
          <button onClick={() => setIndex(i => Math.max(0, i - 1))}
            disabled={index === 0}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-white bg-white/10 backdrop-blur-sm rounded-full w-10 h-10 flex items-center justify-center text-xl disabled:opacity-30">
            ‹
          </button>
          <button onClick={() => setIndex(i => Math.min(photos.length - 1, i + 1))}
            disabled={index === photos.length - 1}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-white bg-white/10 backdrop-blur-sm rounded-full w-10 h-10 flex items-center justify-center text-xl disabled:opacity-30">
            ›
          </button>

          <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-2 pointer-events-none">
            <p className="text-white/80 text-xs">{index + 1} / {photos.length}</p>
            <div className="flex gap-1.5">
              {photos.map((_, i) => (
                <div key={i}
                  className={`w-2 h-2 rounded-full ${i === index ? 'bg-white' : 'bg-white/40'}`} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
