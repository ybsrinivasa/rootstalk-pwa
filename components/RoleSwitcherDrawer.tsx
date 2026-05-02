'use client'
import { useRouter, usePathname } from 'next/navigation'
import { getUser, getActiveRoles, logout, ROLE_COLOURS, ROLE_LABELS } from '@/lib/auth'

interface Props {
  open: boolean
  onClose: () => void
  onSwitch: (role: string) => void
  activeRole?: string
}

const ROLE_ORDER = ['FARMER', 'DEALER', 'FACILITATOR', 'FARM_PUNDIT']

function getActiveRoleFromPath(pathname: string): string {
  if (pathname.startsWith('/dealer')) return 'DEALER'
  if (pathname.startsWith('/facilitator')) return 'FACILITATOR'
  if (pathname.startsWith('/pundit')) return 'FARM_PUNDIT'
  return 'FARMER'
}

export default function RoleSwitcherDrawer({ open, onClose, onSwitch, activeRole: propActiveRole }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const user = getUser()
  const userRoles = getActiveRoles(user)
  const pwaRoles = user?.pwa_roles || []

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

    // Role is set up — switch to it
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

  function getChipLabel(role: string): string {
    const isActive = role === activeRole
    if (isActive) return 'Active'
    const roleIsSetUp = role === 'FARMER' || userRoles.includes(role)
    if (roleIsSetUp) return 'Switch'
    return 'Set up →'
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
        className="fixed right-0 top-0 bottom-0 w-72 bg-white shadow-2xl flex flex-col z-50 transition-transform duration-300"
        style={{ transform: open ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {/* User section */}
        <div className="pt-12 px-5 pb-5 border-b border-stone-100">
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg mb-3"
            style={{ background: '#1A5C2A' }}>
            {user?.name?.[0]?.toUpperCase() || '?'}
          </div>
          <p className="font-semibold text-stone-800 text-base">
            {user?.name || 'Farmer'}
          </p>
          <p className="text-stone-400 text-xs mt-0.5">
            Currently: {ROLE_LABELS[activeRole] || 'Farmer'}
          </p>
        </div>

        {/* Role switcher */}
        <div className="flex-1 px-4 py-4 overflow-y-auto">
          <p className="text-xs text-stone-400 font-medium uppercase tracking-widest mb-3 px-1">
            Switch role
          </p>

          {ROLE_ORDER.map(role => {
            const isActive = role === activeRole
            const roleIsSetUp = role === 'FARMER' || userRoles.includes(role)
            const colour = ROLE_COLOURS[role] || '#1A5C2A'
            const label = ROLE_LABELS[role] || role
            const chipLabel = getChipLabel(role)

            return (
              <button key={role}
                onClick={() => handleRoleClick(role)}
                className="w-full bg-white border border-stone-200 rounded-xl px-4 py-3 flex items-center justify-between mb-2 active:scale-[0.98] transition-transform"
                style={isActive ? { borderColor: colour, background: `${colour}08` } : {}}>
                <div className="flex items-center gap-3">
                  <span className="text-base" style={{ color: colour }}>●</span>
                  <span className={`text-sm font-medium ${isActive ? 'text-stone-900' : 'text-stone-600'}`}>
                    {label}
                  </span>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  isActive
                    ? 'text-white'
                    : roleIsSetUp
                      ? 'text-stone-500 bg-stone-100'
                      : 'text-stone-400 bg-stone-50'
                }`}
                  style={isActive ? { background: colour } : {}}>
                  {chipLabel}
                </span>
              </button>
            )
          })}
        </div>

        {/* Sign out */}
        <div className="px-4 pb-8 border-t border-stone-100 pt-4">
          <button
            onClick={() => { logout() }}
            className="w-full text-left px-4 py-3 text-red-500 text-sm font-medium rounded-xl hover:bg-red-50 transition-colors">
            Sign out
          </button>
        </div>
      </div>
    </>
  )
}
