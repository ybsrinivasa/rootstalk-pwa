import { ImageResponse } from 'next/og'

export const size = { width: 192, height: 192 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%', height: '100%',
        background: '#1A5C2A',
        borderRadius: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Node mark — centre dot */}
      <div style={{ position: 'relative', width: 110, height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Lines (approximated with rotated bars) */}
        <div style={{ position: 'absolute', width: 70, height: 2, background: 'rgba(255,255,255,0.55)', transform: 'rotate(-38deg)', transformOrigin: 'center' }} />
        <div style={{ position: 'absolute', width: 70, height: 2, background: 'rgba(255,255,255,0.55)', transform: 'rotate(142deg)', transformOrigin: 'center' }} />
        <div style={{ position: 'absolute', width: 70, height: 2, background: 'rgba(255,255,255,0.3)', transform: 'rotate(38deg)', transformOrigin: 'center' }} />
        <div style={{ position: 'absolute', width: 70, height: 2, background: 'rgba(255,255,255,0.3)', transform: 'rotate(-142deg)', transformOrigin: 'center' }} />
        {/* Outer dots */}
        <div style={{ position: 'absolute', top: 8, left: 10, width: 14, height: 14, borderRadius: '50%', background: 'rgba(255,255,255,0.7)' }} />
        <div style={{ position: 'absolute', bottom: 8, right: 10, width: 14, height: 14, borderRadius: '50%', background: 'rgba(255,255,255,0.7)' }} />
        <div style={{ position: 'absolute', top: 8, right: 10, width: 11, height: 11, borderRadius: '50%', background: 'rgba(255,255,255,0.45)' }} />
        <div style={{ position: 'absolute', bottom: 8, left: 10, width: 11, height: 11, borderRadius: '50%', background: 'rgba(255,255,255,0.45)' }} />
        {/* Centre dot */}
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'white', zIndex: 2 }} />
      </div>
    </div>,
    { ...size }
  )
}
