import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

// Apple touch icon — same sapling mark as app/icon.tsx, slightly
// different canvas (180px, no corner radius; iOS applies its own
// rounded mask on the home screen).
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%', height: '100%',
        background: '#3A7D44',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <svg width="120" height="120" viewBox="0 0 48 48" fill="none">
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
