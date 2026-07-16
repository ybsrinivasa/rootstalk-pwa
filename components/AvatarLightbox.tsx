'use client'
import { useState, useEffect } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'

// Avatar that opens to a fullscreen lightbox on tap — WhatsApp-style.
// Used on dealer surfaces (list + detail) so the dealer can confirm
// who they're talking to before accepting / calling. When `photoUrl`
// is null, renders an initials badge that does NOT open a lightbox.
//
// Pinch-zoom via react-zoom-pan-pinch (already a project dep for the
// seed-variety photo lightbox); body scroll locked while open so a
// pinch gesture doesn't bleed through to the page beneath.

interface Props {
  photoUrl: string | null | undefined
  name: string | null | undefined
  size?: number          // px — default 48
  ringColor?: string     // border colour when photo present
  bgColor?: string       // fallback initials-badge background
  textColor?: string     // fallback initials-badge text colour
  // 'cover' (default) crops the image square — right for people
  // photos. 'contain' preserves the whole image inside the circle
  // with whitespace around — right for company logos that would
  // otherwise get their text/marks cut off. Only affects the small
  // avatar chip; the enlarged lightbox already uses object-contain.
  objectFit?: 'cover' | 'contain'
}

function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

export default function AvatarLightbox({
  photoUrl, name,
  size = 48,
  ringColor = '#DDD0B8',
  bgColor = 'rgba(8, 80, 65, 0.1)',
  textColor = '#085041',
  objectFit = 'cover',
}: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const avatarSize = `${size}px`

  if (!photoUrl) {
    return (
      <div
        className="rounded-full shrink-0 flex items-center justify-center"
        style={{
          width: avatarSize, height: avatarSize,
          background: bgColor, borderColor: ringColor,
          borderWidth: '1px', borderStyle: 'solid',
        }}>
        <span className="font-bold text-xs" style={{ color: textColor }}>
          {initials(name)}
        </span>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full shrink-0 overflow-hidden block"
        style={{
          width: avatarSize, height: avatarSize,
          borderColor: ringColor, borderWidth: '1px', borderStyle: 'solid',
        }}
        aria-label={name ? `View ${name}'s photo` : 'View photo'}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt=""
          className={`w-full h-full ${objectFit === 'contain' ? 'object-contain p-1' : 'object-cover'}`} />
      </button>

      {open && (
        // WhatsApp-style centered preview. Semi-transparent backdrop
        // (not full black) so the user knows they're still on the
        // dealer screen; tap-outside dismisses. Inner card is rounded
        // and sized to a comfortable preview (~85vw × 80vh max) so
        // portrait photos don't go edge-to-edge.
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
          onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-2xl shadow-2xl overflow-hidden"
            style={{
              maxWidth: 'min(90vw, 480px)',
              maxHeight: '80vh',
            }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-2 right-2 z-10 text-white bg-black/40 backdrop-blur-sm rounded-full w-8 h-8 flex items-center justify-center text-base"
              aria-label="Close">
              ✕
            </button>
            <TransformWrapper
              minScale={1} maxScale={5} initialScale={1}
              centerOnInit
              doubleClick={{ mode: 'toggle', step: 2 }}
              wheel={{ step: 0.2 }}
              pinch={{ step: 5 }}
              panning={{ velocityDisabled: true }}>
              <TransformComponent
                wrapperStyle={{ width: 'auto', maxWidth: 'min(90vw, 480px)', maxHeight: '70vh' }}
                contentStyle={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl}
                  alt={name || ''}
                  className="select-none block"
                  style={{
                    maxWidth: 'min(90vw, 480px)',
                    maxHeight: '70vh',
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                  }}
                  draggable={false} />
              </TransformComponent>
            </TransformWrapper>
            {name && (
              <div className="px-4 py-2.5 bg-white border-t border-[#DDD0B8]">
                <p className="text-sm font-semibold text-[#6B3F1F] truncate">{name}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
