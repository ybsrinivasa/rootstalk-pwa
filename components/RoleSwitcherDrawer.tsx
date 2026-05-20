'use client'
import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getUser, getActiveRoles, logout } from '@/lib/auth'

interface Props {
  open: boolean
  onClose: () => void
  onSwitch: (role: string) => void
  activeRole?: string
}

// RootsTalk design tokens (from LoYaRo_RootsTalk_UI_Design_System.docx,
// Part Two). Keep these inline rather than importing — V1 has no
// shared token module yet.
const C = {
  primary:     '#3A7D44',  // Crop Green
  textPrimary: '#6B3F1F',  // Soil Brown
  textSecond:  '#7A8C7E',  // Mist Grey
  background:  '#F5F0E8',  // Field Cream
  divider:     '#DDD0B8',  // Warm divider
  alert:       '#D4682E',  // Sunrise — sign-out, urgent
  accent:      '#C8960C',  // Harvest Gold
}

const ROLE_ORDER = ['FARMER', 'DEALER', 'FACILITATOR', 'FARM_PUNDIT'] as const

function getActiveRoleFromPath(pathname: string): string {
  if (pathname.startsWith('/dealer')) return 'DEALER'
  if (pathname.startsWith('/facilitator')) return 'FACILITATOR'
  if (pathname.startsWith('/pundit')) return 'FARM_PUNDIT'
  return 'FARMER'
}

const ACTIVE_LABEL: Record<string, string> = {
  FARMER: 'Farmer',
  DEALER: 'My Shop',
  FACILITATOR: 'Facilitator',
  FARM_PUNDIT: 'Expert',
}

const SWITCH_LABEL: Record<string, string> = {
  FARMER: 'Switch to Farmer',
  DEALER: 'Switch to my Shop',
  FACILITATOR: 'Switch to Facilitator',
  FARM_PUNDIT: 'Switch to Expert',
}

const SETUP_LABEL: Record<string, string> = {
  DEALER: 'Open my Shop',
  FACILITATOR: 'Help as Facilitator',
  FARM_PUNDIT: 'Become an Expert',
}

// Lucide-style outline icons inline — keeping the drawer self-contained
// (no icon library dependency yet). Stroke width 1.75, 20×20 for menu rows.
function Icon({ children, color = C.textPrimary }: { children: React.ReactNode; color?: string }) {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke={color} strokeWidth={1.75} viewBox="0 0 24 24">
      {children}
    </svg>
  )
}

// ── Menu row ──────────────────────────────────────────────────────────────
function MenuRow({
  icon, label, onClick, trailing, color = C.textPrimary,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  trailing?: React.ReactNode
  color?: string
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-black/[0.03] transition-colors"
      style={{ minHeight: 48 }}>
      <Icon color={color}>{icon}</Icon>
      <span className="flex-1 text-[15px] font-medium" style={{ color }}>{label}</span>
      {trailing}
    </button>
  )
}

export default function RoleSwitcherDrawer({ open, onClose, onSwitch, activeRole: propActiveRole }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const user = getUser()
  const userRoles = getActiveRoles(user)
  const [showAbout, setShowAbout] = useState(false)

  const activeRole = propActiveRole ?? getActiveRoleFromPath(pathname)
  const activeRoleLabel = ACTIVE_LABEL[activeRole] || 'Farmer'

  function go(href: string) {
    router.push(href)
    onClose()
  }

  function handleRoleClick(role: string) {
    const roleIsSetUp = role === 'FARMER' || userRoles.includes(role)
    if (!roleIsSetUp) {
      if (role === 'DEALER') router.push('/become-dealer')
      else if (role === 'FACILITATOR') router.push('/become-facilitator')
      else if (role === 'FARM_PUNDIT') router.push('/pundit/register')
      onClose()
      return
    }
    if (role === activeRole) { onClose(); return }
    onSwitch(role)
    if (role === 'DEALER')           router.replace('/dealer/home')
    else if (role === 'FACILITATOR') router.replace('/facilitator/home')
    else if (role === 'FARM_PUNDIT') router.replace('/pundit/home')
    else                             router.replace('/home')
    onClose()
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 bg-black/40 transition-opacity"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}
        onClick={onClose}
      />

      {/* Panel — Field Cream background per design tokens */}
      <div
        className="fixed right-0 top-0 bottom-0 w-80 max-w-[85vw] shadow-2xl flex flex-col z-50 transition-transform duration-300"
        style={{ transform: open ? 'translateX(0)' : 'translateX(100%)', background: C.background }}>

        {/* ── Header: rootsTALK.in wordmark + current role ── */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4">
          <div>
            <p className="leading-none">
              <span className="font-light text-[22px]" style={{ color: C.textPrimary + 'CC' }}>roots</span>
              <span className="font-black text-[22px]" style={{ color: C.textPrimary }}>TALK</span>
              <span className="font-light text-[18px]" style={{ color: C.primary }}>.in</span>
            </p>
            <p className="text-[13px] mt-1" style={{ color: C.textSecond }}>{activeRoleLabel}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full flex items-center justify-center -mt-1 -mr-1 hover:bg-black/[0.04] transition-colors"
            style={{ color: C.textSecond }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="h-px mx-5" style={{ background: C.divider }} />

        {/* ── Primary navigation ── */}
        <div className="py-2">
          <MenuRow
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.12a7.5 7.5 0 0115 0A17.93 17.93 0 0112 21.75c-2.68 0-5.22-.58-7.5-1.63z"/>
            }
            label="My Details"
            onClick={() => go('/profile')}
          />
          <MenuRow
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.27-.63 2.39-1.59 3.07a3.75 3.75 0 01-1.04 3.3 3.75 3.75 0 01-3.3 1.04A3.75 3.75 0 0112 21c-1.27 0-2.39-.63-3.07-1.59a3.75 3.75 0 01-3.3-1.04 3.75 3.75 0 01-1.04-3.3A3.75 3.75 0 013 12c0-1.27.63-2.39 1.59-3.07a3.75 3.75 0 011.04-3.3 3.75 3.75 0 013.3-1.04A3.75 3.75 0 0112 3c1.27 0 2.39.63 3.07 1.59a3.75 3.75 0 013.3 1.04 3.75 3.75 0 011.04 3.3A3.75 3.75 0 0121 12z"/>
            }
            label="My Subscriptions"
            onClick={() => go('/my-subscriptions')}
          />
          <MenuRow
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.95-8.95a1.5 1.5 0 012.12 0L21.75 12M4.5 9.75v9.75a1.5 1.5 0 001.5 1.5h3.75v-6h4.5v6H18a1.5 1.5 0 001.5-1.5V9.75"/>
            }
            label="Crops & Companies"
            onClick={() => go('/home')}
          />
          <MenuRow
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.12 2.99 2.71 3.22.39.06.78.1 1.17.15.21.02.41.16.5.36l1.34 2.68a.45.45 0 00.81 0l1.34-2.68a.6.6 0 01.5-.36c.39-.05.78-.09 1.17-.15a3.26 3.26 0 002.71-3.22V6.74c0-1.6-1.12-2.98-2.7-3.21A48.39 48.39 0 0012 3.36c-2.4 0-4.78.18-7.13.55-1.6.23-2.72 1.6-2.72 3.21v6z"/>
            }
            label="Message RootsTalk"
            onClick={() => window.location.href = 'mailto:support@eywa.farm?subject=RootsTalk%20support'}
          />
        </div>

        <div className="h-px mx-5" style={{ background: C.divider }} />

        {/* ── Roles section ── */}
        <p className="text-[11px] font-semibold uppercase tracking-widest px-5 pt-4 pb-1.5"
          style={{ color: C.textSecond }}>Roles</p>

        {ROLE_ORDER.map(role => {
          const isActive = role === activeRole
          const roleIsSetUp = role === 'FARMER' || userRoles.includes(role)
          let label: string
          if (isActive) label = ACTIVE_LABEL[role]
          else if (roleIsSetUp) label = SWITCH_LABEL[role]
          else label = SETUP_LABEL[role] || SWITCH_LABEL[role]

          // Each role gets a simple monochrome plant/shop/cart-style
          // glyph — keep visual weight even, no per-role brand colour
          // in the icon (matches LoYaRo drawer pattern).
          const iconPath = role === 'FARMER'
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M12 21V10m0 0c2.5-2.5 5-2 5-5 0 3-2.5 2.5-5 5zm0 0c-2.5-2.5-5-2-5-5 0 3 2.5 2.5 5 5z"/>
            : role === 'DEALER'
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18l-2 13H5L3 6zm4 0V4a2 2 0 012-2h6a2 2 0 012 2v2"/>
            : role === 'FACILITATOR'
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 17a2 2 0 104 0 2 2 0 00-4 0zm10 0a2 2 0 104 0 2 2 0 00-4 0zm-9-3V8h7v6m0 0h6.5l-2-5H13"/>
            : <path strokeLinecap="round" strokeLinejoin="round" d="M12 6a3 3 0 110 6 3 3 0 010-6zm0 8c-3 0-7 1.5-7 4.5V20h14v-1.5c0-3-4-4.5-7-4.5zm5-9l2 2-2 2m-12-2l2 2-2 2"/>

          return (
            <MenuRow
              key={role}
              icon={iconPath}
              label={label}
              color={isActive ? C.primary : C.textPrimary}
              onClick={() => handleRoleClick(role)}
              trailing={isActive ? (
                <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: C.primary + '1A', color: C.primary }}>
                  Active
                </span>
              ) : !roleIsSetUp ? (
                <span className="text-[12px]" style={{ color: C.textSecond }}>Set up →</span>
              ) : (
                <span style={{ color: C.textSecond }}>›</span>
              )}
            />
          )
        })}

        {/* ── Push secondary nav + sign-out to the bottom ── */}
        <div className="flex-1" />

        <div className="h-px mx-5" style={{ background: C.divider }} />

        <div className="py-2">
          <MenuRow
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.66 17h4.68m-2.34 3v-3m0-14a7 7 0 014.95 11.95l-.7.7c-.6.6-1.21 1.18-1.69 1.86-.4.56-.66 1.19-.66 1.99H9.78c0-.8-.26-1.43-.66-2-.48-.67-1.09-1.25-1.69-1.85l-.7-.7A7 7 0 0112 3z"/>
            }
            label="Help & Tips"
            onClick={() => go('/privacy-policy')}
          />
          <MenuRow
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.04-.02a.75.75 0 011.06.85l-.7 2.84a.75.75 0 001.06.85l.04-.02M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.01v.01H12V8.25z"/>
            }
            label="About RootsTalk"
            onClick={() => setShowAbout(true)}
          />
          <MenuRow
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 16l-4-4m0 0l4-4m-4 4h12m-6 4v1a3 3 0 003 3h2a3 3 0 003-3V7a3 3 0 00-3-3h-2a3 3 0 00-3 3v1"/>
            }
            label="Sign out"
            color={C.alert}
            onClick={() => logout()}
          />
        </div>

        <div style={{ height: 'env(safe-area-inset-bottom)' }} />
      </div>

      {/* About bottom sheet — keep existing content, just retoned */}
      {showAbout && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end" onClick={() => setShowAbout(false)}>
          <div className="rounded-t-3xl w-full pb-10 px-5 pt-3"
            style={{ background: C.background }}
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pb-3">
              <div className="w-10 h-1 rounded-full" style={{ background: C.divider }} />
            </div>
            <div className="flex flex-col items-center text-center gap-2 pb-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mb-2"
                style={{ background: C.primary + '1A', border: `1px solid ${C.primary}33` }}>
                <svg width="28" height="28" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="5"   fill={C.primary}/>
                  <circle cx="8"  cy="12" r="3.5" fill={C.primary} opacity="0.7"/>
                  <circle cx="40" cy="36" r="3.5" fill={C.primary} opacity="0.7"/>
                  <circle cx="8"  cy="36" r="3.5" fill={C.primary} opacity="0.5"/>
                  <circle cx="40" cy="12" r="3.5" fill={C.primary} opacity="0.5"/>
                  <line x1="24" y1="24" x2="8"  y2="12" stroke={C.primary} strokeWidth="1.5" opacity="0.6"/>
                  <line x1="24" y1="24" x2="40" y2="36" stroke={C.primary} strokeWidth="1.5" opacity="0.6"/>
                  <line x1="24" y1="24" x2="8"  y2="36" stroke={C.primary} strokeWidth="1"   opacity="0.35"/>
                  <line x1="24" y1="24" x2="40" y2="12" stroke={C.primary} strokeWidth="1"   opacity="0.35"/>
                </svg>
              </div>
              <p className="font-bold text-lg" style={{ color: C.textPrimary }}>rootsTALK.in</p>
              <p className="text-sm" style={{ color: C.textSecond }}>Your agricultural advisory network</p>
              <p className="text-xs" style={{ color: C.textSecond }}>by Neytiri Eywafarm Agritech</p>
              <p className="text-xs mt-1" style={{ color: C.textSecond, opacity: 0.7 }}>Version 2.0</p>
              <button
                onClick={() => window.open('https://eywa.farm', '_blank')}
                className="mt-3 px-6 py-2.5 rounded-xl text-white text-sm font-bold"
                style={{ background: C.primary }}>
                Visit eywa.farm →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
