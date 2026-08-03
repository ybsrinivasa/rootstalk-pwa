'use client'
import { useEffect, useRef } from 'react'
import type * as LType from 'leaflet'

// Leaflet map for the recipient picker. Renders the farmer's origin
// pin + one pin per recipient. Tapping a pin fires onSelect(userId).
//
// Vanilla Leaflet (no react-leaflet) — the picker only mounts this
// map inside an already-controlled panel and we don't need JSX-per-
// marker. Keeps the bundle a touch smaller.
//
// SSR-safe: Leaflet touches window, so this file is 'use client' and
// the module import happens inside useEffect (dynamic import).

export interface MapPoint {
  user_id: string
  name: string | null
  shop_name?: string | null
  lat: number
  lng: number
  distance_km: number
}

export default function RecipientMap({
  origin,
  points,
  selectedUserId,
  onSelect,
}: {
  origin: { lat: number; lng: number }
  points: MapPoint[]
  selectedUserId: string | null
  onSelect: (userId: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LType.Map | null>(null)
  const markersRef = useRef<Record<string, LType.Marker>>({})
  const originMarkerRef = useRef<LType.Marker | null>(null)

  useEffect(() => {
    let cancelled = false
    async function mount() {
      const L = (await import('leaflet')).default
      if (cancelled || !containerRef.current) return
      if (mapRef.current) return  // already mounted

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([origin.lat, origin.lng], 13)
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map)

      // Farmer origin — larger amber circle so it stands out from shop pins.
      const originIcon = L.divIcon({
        html: '<div style="width:20px;height:20px;border-radius:50%;background:#E88C1A;border:3px solid white;box-shadow:0 0 0 2px #E88C1A;"></div>',
        className: '',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      })
      originMarkerRef.current = L.marker([origin.lat, origin.lng], { icon: originIcon }).addTo(map)

      // Shop pins.
      points.forEach(p => {
        const label = p.shop_name || p.name || '?'
        const icon = L.divIcon({
          html: `<div style="min-width:22px;height:28px;background:#3A7D44;color:white;border:2px solid white;border-radius:14px 14px 14px 2px;padding:2px 6px;font-size:11px;font-weight:700;line-height:22px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.3);white-space:nowrap;">${escapeHtml(label.slice(0, 18))}</div>`,
          className: '',
          iconSize: [1, 1],
          iconAnchor: [1, 28],
        })
        const marker = L.marker([p.lat, p.lng], { icon }).addTo(map)
        marker.on('click', () => onSelect(p.user_id))
        markersRef.current[p.user_id] = marker
      })

      // Fit bounds to include origin + all points, with padding so
      // the tallest shop-name pill isn't clipped at the frame.
      if (points.length > 0) {
        const bounds = L.latLngBounds([
          [origin.lat, origin.lng],
          ...points.map(p => [p.lat, p.lng] as [number, number]),
        ])
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
      }
    }
    void mount()
    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        markersRef.current = {}
        originMarkerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Highlight the selected pin — re-style each marker whenever the
  // parent's selection changes.
  useEffect(() => {
    (async () => {
      const L = (await import('leaflet')).default
      for (const [uid, marker] of Object.entries(markersRef.current)) {
        const isSel = uid === selectedUserId
        const p = points.find(x => x.user_id === uid)
        if (!p) continue
        const label = p.shop_name || p.name || '?'
        const bg = isSel ? '#0F2A0F' : '#3A7D44'
        const scale = isSel ? 'transform:scale(1.15);' : ''
        marker.setIcon(L.divIcon({
          html: `<div style="min-width:22px;height:28px;background:${bg};color:white;border:2px solid white;border-radius:14px 14px 14px 2px;padding:2px 6px;font-size:11px;font-weight:700;line-height:22px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.3);white-space:nowrap;${scale}">${escapeHtml(label.slice(0, 18))}</div>`,
          className: '',
          iconSize: [1, 1],
          iconAnchor: [1, 28],
        }))
      }
    })().catch(() => { /* leaflet not mounted yet */ })
  }, [selectedUserId, points])

  return (
    <div
      ref={containerRef}
      className="w-full h-64 rounded-xl overflow-hidden border border-[#DDD0B8] bg-[#F7F0E0]"
      style={{ zIndex: 0 }}
    />
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c] || c)
}
