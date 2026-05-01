'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Role = 'FARMER' | 'DEALER' | 'FACILITATOR'

const TABS: Record<Role, { href: string; label: string; icon: string }[]> = {
  FARMER: [
    { href: '/home',    label: 'Home',    icon: '⬡' },
    { href: '/orders',  label: 'Orders',  icon: '📦' },
    { href: '/history', label: 'History', icon: '📋' },
    { href: '/profile', label: 'Profile', icon: '👤' },
  ],
  DEALER: [
    { href: '/dealer/orders',   label: 'Orders',   icon: '📦' },
    { href: '/dealer/payments', label: 'Payments', icon: '💳' },
    { href: '/profile',         label: 'Profile',  icon: '👤' },
  ],
  FACILITATOR: [
    { href: '/facilitator/orders', label: 'Orders',  icon: '📦' },
    { href: '/profile',            label: 'Profile', icon: '👤' },
  ],
}

export default function BottomNav({ color = '#1A5C2A', activeRole = 'FARMER' }: { color?: string; activeRole?: Role }) {
  const path = usePathname()
  const tabs = TABS[activeRole] || TABS.FARMER

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 flex z-50 safe-area-bottom">
      {tabs.map(tab => {
        const active = path === tab.href || path.startsWith(tab.href + '/')
        return (
          <Link key={tab.href} href={tab.href}
            className="flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors"
            style={{ color: active ? color : '#94a3b8' }}>
            <span className="text-xl leading-none">{tab.icon}</span>
            <span className="text-xs font-medium">{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
