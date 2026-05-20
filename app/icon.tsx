import { ImageResponse } from 'next/og'

export const size = { width: 192, height: 192 }
export const contentType = 'image/png'

// PWA install icon — Crop Green tile with a white sapling mark
// matching components/AppMark.tsx. Next.js ImageResponse renders
// inline SVG natively, so we paste the same path geometry. White-
// on-green for the install tile (icon sits on the OS home screen,
// not on a coloured chrome).
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%', height: '100%',
        background: '#3A7D44',
        borderRadius: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <svg width="128" height="128" viewBox="0 0 48 48" fill="none">
        <path d="M24 22 V 30" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
        <path d="M24 22 C 17 22 13 17 11 9 C 19 9 24 14 24 22 Z" fill="white"/>
        <path d="M24 22 C 31 22 35 17 37 9 C 29 9 24 14 24 22 Z" fill="white"/>
        <path d="M9 30 H 39" stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.6"/>
        <path d="M24 30 Q 22 34 18 39" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        <path d="M24 30 V 41" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        <path d="M24 30 Q 26 34 30 39" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      </svg>
    </div>,
    { ...size }
  )
}
