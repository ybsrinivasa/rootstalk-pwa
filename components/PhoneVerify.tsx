'use client'
import { useEffect, useState } from 'react'
import api from '@/lib/api'

interface LookupResult {
  found: boolean
  user_id?: string
  phone?: string
  name?: string | null
  photo_url?: string | null
  roles?: string[]
}

const ROLE_LABEL: Record<string, string> = {
  FARMER: 'Farmer',
  DEALER: 'Dealer',
  FACILITATOR: 'Facilitator',
  FARM_PUNDIT: 'Farm Pundit',
  CONTENT_MANAGER: 'Content Manager',
  RELATIONSHIP_MANAGER: 'Relationship Manager',
  BUSINESS_MANAGER: 'Business Manager',
}

function humanizeRoles(roles: string[] | undefined): string {
  if (!roles || roles.length === 0) return 'Registered user'
  // Show the most farmer-meaningful roles first.
  const preferred = ['DEALER', 'FACILITATOR', 'FARM_PUNDIT', 'FARMER']
  const sorted = [...roles].sort((a, b) => {
    const ai = preferred.indexOf(a); const bi = preferred.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
  return sorted.map(r => ROLE_LABEL[r] || r).join(' · ')
}

/** Inline verify chip that sits below a phone-number input.
 *
 * Pass the live `phone` value (any format — the backend strips
 * non-digits and takes the last 10). Renders a verification card
 * once the input looks like a complete Indian phone (>=10 digits).
 *
 * onResolve fires whenever the lookup result changes — the parent
 * can use it to capture the user_id, the resolved name, or to
 * block the Save button until the recipient is verified.
 */
export default function PhoneVerify({
  phone,
  onResolve,
}: {
  phone: string
  onResolve?: (r: LookupResult | null) => void
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'result'>('idle')
  const [result, setResult] = useState<LookupResult | null>(null)

  useEffect(() => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) {
      setState('idle'); setResult(null); onResolve?.(null)
      return
    }
    // Debounce so we don't fire per-keystroke once the field is full.
    setState('loading')
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get<LookupResult>(
          `/platform/lookup-user-by-phone?phone=${encodeURIComponent('+91' + digits.slice(-10))}`,
        )
        setResult(data); setState('result'); onResolve?.(data)
      } catch {
        // Network or auth failure — fall back to "unknown" so the
        // user isn't blocked. Parent decides whether to allow save.
        setResult(null); setState('idle'); onResolve?.(null)
      }
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone])

  if (state === 'idle') return null

  if (state === 'loading') {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-[#7A8C7E]">
        <div className="w-3 h-3 border-2 border-[#DDD0B8] border-t-[#3A7D44] rounded-full animate-spin" />
        Checking…
      </div>
    )
  }

  // state === 'result'
  if (!result || !result.found) {
    return (
      <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
        <span className="font-bold">!</span>
        <span>
          Not a registered RootsTalk user. They won&apos;t see in-app alerts —
          you can still save this number for your reference.
        </span>
      </div>
    )
  }

  const initials = (result.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="mt-2 flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
      {result.photo_url ? (
        <img
          src={result.photo_url} alt={result.name || ''}
          className="w-10 h-10 rounded-full object-cover shrink-0 bg-white"
        />
      ) : (
        <div className="w-10 h-10 rounded-full bg-white border border-green-200 flex items-center justify-center shrink-0">
          <span className="text-green-700 font-bold text-sm">{initials}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#6B3F1F] truncate">
          {result.name || 'Registered user'}
        </p>
        <p className="text-xs text-[#7A8C7E] truncate">{humanizeRoles(result.roles)}</p>
      </div>
      <span className="text-green-700 text-sm shrink-0">✓</span>
    </div>
  )
}
