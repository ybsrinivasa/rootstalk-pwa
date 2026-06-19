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
          className="w-full h-full object-cover" />
      </button>

      {open && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col"
          onClick={() => setOpen(false)}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false) }}
            className="absolute top-3 right-3 z-20 text-white bg-white/10 backdrop-blur-sm rounded-full w-10 h-10 flex items-center justify-center text-xl"
            aria-label="Close">
            ✕
          </button>

          {name && (
            <div className="absolute top-3 left-3 z-20 text-white text-sm font-semibold bg-black/30 backdrop-blur-sm rounded-full px-3 py-1.5 max-w-[60%] truncate">
              {name}
            </div>
          )}

          <div onClick={(e) => e.stopPropagation()} className="flex-1 flex items-center justify-center">
            <TransformWrapper
              minScale={1} maxScale={5} initialScale={1}
              centerOnInit
              doubleClick={{ mode: 'toggle', step: 2 }}
              wheel={{ step: 0.2 }}
              pinch={{ step: 5 }}
              panning={{ velocityDisabled: true }}>
              <TransformComponent
                wrapperStyle={{ width: '100%', height: '100%' }}
                contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl}
                  alt={name || ''}
                  className="max-w-full max-h-full object-contain select-none"
                  draggable={false} />
              </TransformComponent>
            </TransformWrapper>
          </div>
        </div>
      )}
    </>
  )
}
