'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import api from '@/lib/api'

interface SubLite {
  id: string
  client_id: string
  crop_cosh_id?: string | null
  crop_name?: string | null
  package_name?: string | null
  client_display_name?: string | null
  client_logo_url?: string | null
  client_primary_colour?: string | null
  client_is_training?: boolean
}

const cache: { ts: number; rows: SubLite[] } = { ts: 0, rows: [] }
const TTL_MS = 30_000

async function loadSubs(): Promise<SubLite[]> {
  const now = Date.now()
  if (cache.rows.length && now - cache.ts < TTL_MS) return cache.rows
  const r = await api.get<SubLite[]>('/farmer/my-subscriptions')
  cache.ts = now
  cache.rows = r.data
  return r.data
}

interface Props {
  subscriptionId: string
  showCrop?: boolean
}

export default function ClientCropChip({ subscriptionId, showCrop = true }: Props) {
  const router = useRouter()
  const tTrain = useTranslations('training')
  const [sub, setSub] = useState<SubLite | null>(null)

  useEffect(() => {
    let cancelled = false
    loadSubs()
      .then(rows => {
        if (cancelled) return
        const found = rows.find(s => s.id === subscriptionId)
        if (found) setSub(found)
      })
      .catch(() => { /* silently degrade — chip just won't render */ })
    return () => { cancelled = true }
  }, [subscriptionId])

  if (!sub) return null

  const rawName = sub.client_display_name || 'Company'
  // Strip the backend-baked " · Training" suffix; the amber chip
  // beside the name already communicates the training-sandbox state
  // in the caller's language (see training_router.py).
  const name = sub.client_is_training
    ? rawName.replace(/\s*[·\-]\s*Training\s*$/i, '')
    : rawName
  const colour = sub.client_primary_colour || '#3A7D44'
  const initials = name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
  const crop = sub.crop_name || sub.package_name || ''

  return (
    <button
      onClick={() => router.push(`/home/${sub.client_id}`)}
      className="w-full bg-white border-b border-[#DDD0B8] px-4 py-2 flex items-center gap-3 active:bg-[#F5F0E8]">
      {sub.client_logo_url ? (
        <img src={sub.client_logo_url} alt={name}
          className="w-8 h-8 rounded-full object-contain p-0.5 shrink-0"
          style={{ background: '#F5F0E8' }} />
      ) : (
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-[11px] font-bold"
          style={{ background: colour }}>
          {initials}
        </div>
      )}
      <div className="flex-1 min-w-0 text-left leading-tight">
        <p className="text-[11px] text-[#7A8C7E] truncate">
          {name}
          {sub.client_is_training && (
            <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-300 text-amber-900 align-middle">
              {tTrain('chip')}
            </span>
          )}
        </p>
        {showCrop && crop && (
          <p className="text-[13px] font-semibold text-[#6B3F1F] truncate">{crop}</p>
        )}
      </div>
      <span className="text-[#DDD0B8] text-base shrink-0">›</span>
    </button>
  )
}
