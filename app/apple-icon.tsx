import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%', height: '100%',
        background: '#1A5C2A',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ position: 'relative', width: 104, height: 104, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', width: 66, height: 2, background: 'rgba(255,255,255,0.55)', transform: 'rotate(-38deg)' }} />
        <div style={{ position: 'absolute', width: 66, height: 2, background: 'rgba(255,255,255,0.55)', transform: 'rotate(142deg)' }} />
        <div style={{ position: 'absolute', width: 66, height: 2, background: 'rgba(255,255,255,0.3)', transform: 'rotate(38deg)' }} />
        <div style={{ position: 'absolute', width: 66, height: 2, background: 'rgba(255,255,255,0.3)', transform: 'rotate(-142deg)' }} />
        <div style={{ position: 'absolute', top: 8, left: 8, width: 13, height: 13, borderRadius: '50%', background: 'rgba(255,255,255,0.7)' }} />
        <div style={{ position: 'absolute', bottom: 8, right: 8, width: 13, height: 13, borderRadius: '50%', background: 'rgba(255,255,255,0.7)' }} />
        <div style={{ position: 'absolute', top: 8, right: 8, width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,255,255,0.45)' }} />
        <div style={{ position: 'absolute', bottom: 8, left: 8, width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,255,255,0.45)' }} />
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'white', zIndex: 2 }} />
      </div>
    </div>,
    { ...size }
  )
}
