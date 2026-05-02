'use client'
import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getUser, getActiveRoles, logout, ROLE_COLOURS } from '@/lib/auth'

interface Props {
  open: boolean
  onClose: () => void
  onSwitch: (role: string) => void
  activeRole?: string
}

const ROLE_ORDER = ['FARMER', 'DEALER', 'FACILITATOR', 'FARM_PUNDIT'] as const

function getActiveRoleFromPath(pathname: string): string {
  if (pathname.startsWith('/dealer')) return 'DEALER'
  if (pathname.startsWith('/facilitator')) return 'FACILITATOR'
  if (pathname.startsWith('/pundit')) return 'FARM_PUNDIT'
  return 'FARMER'
}

// Active-state chip text shown when the role matches the current path
const ACTIVE_LABEL: Record<string, string> = {
  FARMER: 'Farmer',
  DEALER: 'My Shop',
  FACILITATOR: 'Facilitator',
  FARM_PUNDIT: 'Expert',
}

// Action label when the user already has this role set up (in pwa_roles)
const SWITCH_LABEL: Record<string, string> = {
  FARMER: 'Switch to Farmer',
  DEALER: 'Switch to my Shop',
  FACILITATOR: 'Switch to Facilitator',
  FARM_PUNDIT: 'Switch to Expert',
}

// Action label when the role is NOT set up yet — invites the user to set it up
const SETUP_LABEL: Record<string, string> = {
  DEALER: 'Open my Shop',
  FACILITATOR: 'Help as Facilitator',
  FARM_PUNDIT: 'Become an Expert',
}

export default function RoleSwitcherDrawer({ open, onClose, onSwitch, activeRole: propActiveRole }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const user = getUser()
  const userRoles = getActiveRoles(user)
  const [showAbout, setShowAbout] = useState(false)

  // Derive active role from URL path; fall back to prop if provided
  const activeRole = propActiveRole ?? getActiveRoleFromPath(pathname)

  function handleRoleClick(role: string) {
    const roleIsSetUp = role === 'FARMER' || userRoles.includes(role)

    if (!roleIsSetUp) {
      // Not yet set up — route to info/registration page
      if (role === 'DEALER') {
        router.push('/become-dealer')
      } else if (role === 'FACILITATOR') {
        router.push('/become-facilitator')
      } else if (role === 'FARM_PUNDIT') {
        router.push('/pundit/register')
      }
      onClose()
      return
    }

    // Role is set up — switch to it (or just close if already active)
    if (role === activeRole) {
      onClose()
      return
    }
    onSwitch(role)
    if (role === 'DEALER')            router.replace('/dealer/home')
    else if (role === 'FACILITATOR')  router.replace('/facilitator/home')
    else if (role === 'FARM_PUNDIT')  router.replace('/pundit/home')
    else                              router.replace('/home')
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

      {/* Panel */}
      <div
        className="fixed right-0 top-0 bottom-0 w-80 max-w-[85vw] bg-white shadow-2xl flex flex-col z-50 transition-transform duration-300"
        style={{ transform: open ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {/* Close button — top right */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:bg-stone-50 hover:text-stone-600 transition-colors z-10">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="flex-1 overflow-y-auto pt-12 pb-4">
          {/* User identity section */}
          <div className="px-5 pb-5">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg mb-3"
              style={{ background: '#1A5C2A' }}>
              {(user?.name || user?.phone || '?')[0].toUpperCase()}
            </div>
            <p className="font-semibold text-stone-800 text-base">
              {user?.name || 'Farmer'}
            </p>
            <p className="text-stone-400 text-xs mt-0.5">
              Active: {ACTIVE_LABEL[activeRole] || 'Farmer'}
            </p>
          </div>

          <div className="h-px bg-stone-100 my-1" />

          {/* Profile row */}
          <button
            onClick={() => { router.push('/profile'); onClose() }}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition-colors">
            <div className="flex items-center gap-3">
              <svg className="w-4 h-4 text-stone-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>
              </svg>
              <span className="text-sm font-medium text-stone-800">My Profile</span>
            </div>
            <span className="text-stone-300">›</span>
          </button>

          <div className="h-px bg-stone-100 my-1" />

          {/* ROLES section */}
          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest px-4 pt-3 pb-1">ROLES</p>

          {ROLE_ORDER.map(role => {
            const isActive = role === activeRole
            const roleIsSetUp = role === 'FARMER' || userRoles.includes(role)
            const colour = ROLE_COLOURS[role] || '#1A5C2A'

            // Determine label
            let label: string
            if (isActive) {
              label = ACTIVE_LABEL[role]
            } else if (roleIsSetUp) {
              label = SWITCH_LABEL[role]
            } else {
              label = SETUP_LABEL[role] || SWITCH_LABEL[role]
            }

            return (
              <button key={role}
                onClick={() => handleRoleClick(role)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full" style={{ background: colour }} />
                  <span className="text-sm font-medium text-stone-800">{label}</span>
                </div>
                {isActive ? (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: colour + '20', color: colour }}>
                    Active
                  </span>
                ) : roleIsSetUp ? (
                  <span className="text-stone-300">›</span>
                ) : (
                  <span className="text-xs text-stone-400">Set up →</span>
                )}
              </button>
            )
          })}

          <div className="h-px bg-stone-100 my-1" />

          {/* About + Privacy */}
          <button
            onClick={() => setShowAbout(true)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition-colors">
            <div className="flex items-center gap-3">
              <svg className="w-4 h-4 text-stone-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/>
              </svg>
              <span className="text-sm font-medium text-stone-800">About rootsTALK.in</span>
            </div>
            <span className="text-stone-300">›</span>
          </button>

          <button
            onClick={() => { router.push('/privacy-policy'); onClose() }}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition-colors">
            <div className="flex items-center gap-3">
              <svg className="w-4 h-4 text-stone-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"/>
              </svg>
              <span className="text-sm font-medium text-stone-800">Privacy Policy</span>
            </div>
            <span className="text-stone-300">›</span>
          </button>

          <div className="h-px bg-stone-100 my-1" />

          {/* Sign Out */}
          <button onClick={() => { logout() }}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-50 transition-colors">
            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
            </svg>
            <span className="text-sm font-medium text-red-600">Sign Out</span>
          </button>
        </div>
      </div>

      {/* About bottom sheet */}
      {showAbout && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end" onClick={() => setShowAbout(false)}>
          <div className="bg-white rounded-t-3xl w-full pb-10 px-5 pt-3" onClick={e => e.stopPropagation()}>
            {/* Close handle at top */}
            <div className="flex justify-center pb-3">
              <div className="w-10 h-1 rounded-full bg-stone-200" />
            </div>
            <div className="flex flex-col items-center text-center gap-2 pb-4">
              {/* Node mark — 40px green */}
              <div className="w-12 h-12 rounded-full flex items-center justify-center mb-2"
                style={{ background: 'rgba(26,92,42,0.10)', border: '1px solid rgba(26,92,42,0.15)' }}>
                <svg width="28" height="28" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="5"   fill="#1A5C2A"/>
                  <circle cx="8"  cy="12" r="3.5" fill="#1A5C2A" opacity="0.7"/>
                  <circle cx="40" cy="36" r="3.5" fill="#1A5C2A" opacity="0.7"/>
                  <circle cx="8"  cy="36" r="3.5" fill="#1A5C2A" opacity="0.5"/>
                  <circle cx="40" cy="12" r="3.5" fill="#1A5C2A" opacity="0.5"/>
                  <line x1="24" y1="24" x2="8"  y2="12" stroke="#1A5C2A" strokeWidth="1.5" opacity="0.6"/>
                  <line x1="24" y1="24" x2="40" y2="36" stroke="#1A5C2A" strokeWidth="1.5" opacity="0.6"/>
                  <line x1="24" y1="24" x2="8"  y2="36" stroke="#1A5C2A" strokeWidth="1"   opacity="0.35"/>
                  <line x1="24" y1="24" x2="40" y2="12" stroke="#1A5C2A" strokeWidth="1"   opacity="0.35"/>
                </svg>
              </div>
              <p className="font-bold text-slate-900 text-lg">rootsTALK.in</p>
              <p className="text-slate-500 text-sm">Your agricultural advisory network</p>
              <p className="text-slate-400 text-xs">by Neytiri Eywafarm Agritech</p>
              <p className="text-slate-300 text-xs mt-1">Version 2.0</p>
              <button
                onClick={() => window.open('https://eywa.farm', '_blank')}
                className="mt-3 px-6 py-2.5 rounded-xl text-white text-sm font-medium"
                style={{ background: '#1A5C2A' }}>
                Visit eywa.farm →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
