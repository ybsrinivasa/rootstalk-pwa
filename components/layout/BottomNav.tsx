'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { C } from '@/lib/tokens'

type Role = 'FARMER' | 'DEALER' | 'FACILITATOR' | 'FARM_PUNDIT'
type NavKey = 'home' | 'orders' | 'queries' | 'subscriptions' | 'profile' | 'payments' | 'alerts' | 'pickup' | 'dashboard'

const HomeIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
const BoxIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
const HistoryIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
const ProfileIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
const PaymentIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
const QueriesIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
const BellIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
const PickupIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"/></svg>

// Label key resolves to nav.<key> in messages/<lang>.json at render time.
const TABS: Record<Role, { href: string; key: NavKey; Icon: React.ComponentType }[]> = {
  FARMER: [
    // 2026-06-18 — Queries removed from bottom nav. The pooled
    // /my-queries view dropped crop context per row and confused
    // multi-crop farmers ("which crop did this reply belong to?").
    // The per-sub Queries tile on every Crop Detail page covers
    // 95% of the use case; /my-queries route stays alive in case
    // we reintroduce the global view with per-row crop chips.
    // 2026-06-22 — Profile dropped from every role's bottom-nav.
    // Personal Details lives in the right drawer (consistent across
    // roles); role-specific sub-entries (Shop Details / Professional
    // Details) live there too. Frees the 4th tab for what the role
    // actually does most.
    { href: '/home',        key: 'home',    Icon: HomeIcon },
    { href: '/orders',      key: 'orders',  Icon: BoxIcon },
    { href: '/my-subscriptions', key: 'subscriptions', Icon: HistoryIcon },
  ],
  DEALER: [
    { href: '/dealer/orders',           key: 'orders',   Icon: BoxIcon },
    { href: '/dealer/payments',         key: 'payments', Icon: PaymentIcon },
    { href: '/dealer/alerts-incoming',  key: 'alerts',   Icon: BellIcon },
  ],
  FACILITATOR: [
    { href: '/facilitator/orders',           key: 'orders',   Icon: BoxIcon },
    { href: '/facilitator/pickup',           key: 'pickup',   Icon: PickupIcon },
    { href: '/facilitator/payments',         key: 'payments', Icon: PaymentIcon },
    { href: '/facilitator/alerts-incoming',  key: 'alerts',   Icon: BellIcon },
  ],
  FARM_PUNDIT: [
    { href: '/pundit/home',    key: 'dashboard', Icon: HomeIcon },
    { href: '/pundit/queries', key: 'queries',   Icon: QueriesIcon },
  ],
}

export default function BottomNav({ color = C.primary, activeRole = 'FARMER' }: { color?: string; activeRole?: Role }) {
  const path = usePathname()
  const t = useTranslations('nav')
  const tabs = TABS[activeRole] || TABS.FARMER

  return (
    <nav className="fixed bottom-0 left-0 right-0 flex z-50 safe-area-bottom"
      style={{ background: C.cardBg, borderTop: `1px solid ${C.divider}` }}>
      {tabs.map(tab => {
        const active = path === tab.href || path.startsWith(tab.href + '/')
        return (
          <Link key={tab.href} href={tab.href}
            className="flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors"
            style={{ color: active ? color : C.textSecond, minHeight: 56 }}>
            <tab.Icon />
            <span className="text-xs font-medium">{t(tab.key)}</span>
          </Link>
        )
      })}
    </nav>
  )
}
