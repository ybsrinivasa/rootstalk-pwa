'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { C } from '@/lib/tokens'

type Role = 'FARMER' | 'DEALER' | 'FACILITATOR' | 'FARM_PUNDIT'

const HomeIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
const BoxIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
const HistoryIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
const ProfileIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
const PaymentIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
const QueriesIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>

const TABS: Record<Role, { href: string; label: string; Icon: React.ComponentType }[]> = {
  FARMER: [
    { href: '/home',    label: 'Home',    Icon: HomeIcon },
    { href: '/orders',  label: 'Orders',  Icon: BoxIcon },
    { href: '/history', label: 'History', Icon: HistoryIcon },
    { href: '/profile', label: 'Profile', Icon: ProfileIcon },
  ],
  DEALER: [
    { href: '/dealer/orders',   label: 'Orders',   Icon: BoxIcon },
    { href: '/dealer/payments', label: 'Payments', Icon: PaymentIcon },
    { href: '/profile',         label: 'Profile',  Icon: ProfileIcon },
  ],
  FACILITATOR: [
    { href: '/facilitator/orders', label: 'Orders',  Icon: BoxIcon },
    { href: '/profile',            label: 'Profile', Icon: ProfileIcon },
  ],
  FARM_PUNDIT: [
    { href: '/pundit/home',    label: 'Dashboard', Icon: HomeIcon },
    { href: '/pundit/queries', label: 'Queries',   Icon: QueriesIcon },
    { href: '/profile',        label: 'Profile',   Icon: ProfileIcon },
  ],
}

export default function BottomNav({ color = C.primary, activeRole = 'FARMER' }: { color?: string; activeRole?: Role }) {
  const path = usePathname()
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
            <span className="text-xs font-medium">{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
