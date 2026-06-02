'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import PWAHeader from '@/components/layout/PWAHeader'
import api from '@/lib/api'
import { cropDisplayName } from '@/lib/crop-name'
// 2026-06-02 — pinch+pan via react-zoom-pan-pinch (no native
// `touch-action: pinch-zoom` for scoped containers; browser only
// pinch-zooms the viewport).
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'

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

interface Recipient {
  user_id: string; name: string | null; phone: string | null; distance_km: number
  is_promoter?: boolean
  shop_name?: string | null; shop_address?: string | null
}

export default function SeedVarietiesPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const router = useRouter()
  const [varieties, setVarieties] = useState<Variety[]>([])
  const [selected, setSelected] = useState<Variety | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showDUS, setShowDUS] = useState(false)
  const [activePhoto, setActivePhoto] = useState(0)
  // 2026-06-02 — Lightbox state. Variety sale depends heavily on the
  // seed-company photos; we want them readable in detail. null = closed.
  const [lightboxAt, setLightboxAt] = useState<number | null>(null)
  // 2026-06-02 — recipient picker step inserted between confirm and POST.
  // Seed orders were previously created with null dealer/facilitator, so
  // the Manage card had no recipient line and dealers never saw them.
  const [pickingRecipient, setPickingRecipient] = useState(false)
  const [dealers, setDealers] = useState<Recipient[]>([])
  const [facilitators, setFacilitators] = useState<Recipient[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [placing, setPlacing] = useState<string | null>(null)

  useEffect(() => {
    if (!getToken()) { router.replace('/register'); return }
    api.get<Variety[]>(`/farmer/subscriptions/${subscriptionId}/seed-varieties`)
      .then(r => setVarieties(r.data))
      .finally(() => setLoading(false))
  }, [subscriptionId])

  async function openPicker() {
    setConfirming(false)
    setPickingRecipient(true)
    setPickerLoading(true)
    try {
      const [d, f] = await Promise.allSettled([
        api.get<Recipient[]>(`/farmer/subscriptions/${subscriptionId}/nearby-dealers?order_type=SEED`),
        api.get<Recipient[]>(`/farmer/subscriptions/${subscriptionId}/nearby-facilitators`),
      ])
      setDealers(d.status === 'fulfilled' ? d.value.data : [])
      setFacilitators(f.status === 'fulfilled' ? f.value.data : [])
    } finally { setPickerLoading(false) }
  }

  async function sendOrder(recipient: Recipient, isDealer: boolean) {
    if (!selected) return
    setPlacing(recipient.user_id)
    try {
      await api.post('/farmer/seed-orders', {
        subscription_id: subscriptionId,
        variety_id: selected.id,
        ...(isDealer
          ? { dealer_user_id: recipient.user_id }
          : { facilitator_user_id: recipient.user_id }),
      })
      router.replace(`/crop-detail/${subscriptionId}/orders?tab=manage`)
    } catch { setPlacing(null) }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#085041] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (selected && !confirming && !pickingRecipient) {
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
            <p className="text-xs text-[#7A8C7E] mt-2">
              Next, you will choose the dealer or facilitator who fulfils this seed order.
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setConfirming(false)}
              className="flex-1 py-3 rounded-xl border border-[#DDD0B8] text-[#6B3F1F] text-sm font-medium">
              Cancel
            </button>
            <button onClick={openPicker}
              className="flex-1 py-3 rounded-xl text-white font-semibold text-sm"
              style={{ background: 'linear-gradient(135deg, #054a3a, #085041)' }}>
              Choose Recipient
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (pickingRecipient && selected) {
    const noOne = !pickerLoading && dealers.length === 0 && facilitators.length === 0
    return (
      <div className="min-h-screen bg-[#F5F0E8]">
        <PWAHeader title="Select Who Will Fulfil" activeRole="FARMER"
          back={`/crop-detail/${subscriptionId}/orders`} />
        <div className="pt-20 pb-24 px-4 max-w-lg mx-auto">
          <div className="bg-white rounded-2xl border border-[#DDD0B8] p-4 mb-4">
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">SEED</span>
            <p className="text-sm text-[#6B3F1F] mt-2">
              Sending order for <strong>{selected.name}</strong>
            </p>
          </div>
          {pickerLoading && (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 border-[#085041] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!pickerLoading && dealers.length > 0 && (
            <>
              <p className="text-xs uppercase tracking-wide text-[#7A8C7E] font-semibold mt-2 mb-2">Nearby Dealers</p>
              <div className="space-y-3 mb-4">
                {dealers.map(p => (
                  <RecipientCard key={p.user_id} person={p} isDealer
                    placing={placing} onSend={() => sendOrder(p, true)} />
                ))}
              </div>
            </>
          )}
          {!pickerLoading && facilitators.length > 0 && (
            <>
              <p className="text-xs uppercase tracking-wide text-[#7A8C7E] font-semibold mt-2 mb-2">Nearby Facilitators</p>
              <div className="space-y-3">
                {facilitators.map(p => (
                  <RecipientCard key={p.user_id} person={p} isDealer={false}
                    placing={placing} onSend={() => sendOrder(p, false)} />
                ))}
              </div>
            </>
          )}
          {noOne && (
            <div className="bg-white rounded-2xl border border-[#DDD0B8] p-6 text-center">
              <p className="text-3xl mb-2">🤷</p>
              <p className="text-sm text-[#6B3F1F] font-medium">No dealer or facilitator nearby</p>
              <p className="text-xs text-[#7A8C7E] mt-1">
                Ask your company to onboard a seed dealer or facilitator in your area.
              </p>
              <button onClick={() => { setPickingRecipient(false); setConfirming(true) }}
                className="mt-4 text-sm text-[#085041] font-medium underline">
                Back
              </button>
            </div>
          )}
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

function RecipientCard({
  person, isDealer, placing, onSend,
}: {
  person: Recipient; isDealer: boolean
  placing: string | null
  onSend: () => void
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#DDD0B8] shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-bold text-[#6B3F1F]">
              {(isDealer ? person.shop_name : null) || person.name || 'Unknown'}
            </p>
            {person.is_promoter && (
              <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Your Promoter</span>
            )}
          </div>
          {isDealer && person.name && person.shop_name && (
            <p className="text-xs text-[#7A8C7E]">{person.name}</p>
          )}
          <p className="text-xs text-[#7A8C7E] mt-0.5">{person.distance_km} km away</p>
          {isDealer && person.shop_address && (
            <p className="text-xs text-[#7A8C7E] truncate">{person.shop_address}</p>
          )}
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          {person.phone && (
            <a href={`tel:${person.phone}`}
              className="text-xs bg-slate-100 text-[#6B3F1F] px-3 py-1.5 rounded-lg text-center font-medium">
              📞 Call
            </a>
          )}
          <button onClick={onSend} disabled={placing === person.user_id}
            className="text-xs text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
            style={{ background: '#3A7D44' }}>
            {placing === person.user_id ? '…' : 'Send Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

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

function PhotoLightbox({
  photos, startIndex, alt, onClose,
}: {
  photos: string[]
  startIndex: number
  alt: string
  onClose: () => void
}) {
  const [index, setIndex] = useState(startIndex)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const photo = photos[index]
  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col" ref={wrap}>
      <button onClick={onClose}
        className="absolute top-3 right-3 z-20 text-white bg-white/10 backdrop-blur-sm rounded-full w-10 h-10 flex items-center justify-center text-xl">
        ✕
      </button>

      {/* Pinch + pan via react-zoom-pan-pinch (key={index} resets
          zoom whenever the farmer flips to the next photo so they
          don't carry a previous zoom level over). doubleClick zooms
          in, wheel works on desktop. */}
      <TransformWrapper key={index}
        minScale={1} maxScale={5} initialScale={1}
        centerOnInit
        doubleClick={{ mode: 'toggle', step: 2 }}
        wheel={{ step: 0.2 }}
        pinch={{ step: 5 }}
        panning={{ velocityDisabled: true }}>
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img
            src={photo}
            alt={`${alt} — photo ${index + 1}`}
            className="max-w-full max-h-full object-contain select-none"
            draggable={false} />
        </TransformComponent>
      </TransformWrapper>

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
