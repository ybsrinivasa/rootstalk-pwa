'use client'
import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getUser, getActiveRoles, logout } from '@/lib/auth'
import AppMark from '@/components/AppMark'

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

const ROLE_LABEL_KEY: Record<string, 'farmer' | 'dealer' | 'facilitator' | 'pundit'> = {
  FARMER: 'farmer',
  DEALER: 'dealer',
  FACILITATOR: 'facilitator',
  FARM_PUNDIT: 'pundit',
}

const SWITCH_LABEL_KEY: Record<string, 'switchFarmer' | 'switchDealer' | 'switchFacilitator' | 'switchPundit'> = {
  FARMER: 'switchFarmer',
  DEALER: 'switchDealer',
  FACILITATOR: 'switchFacilitator',
  FARM_PUNDIT: 'switchPundit',
}

const SETUP_LABEL_KEY: Record<string, 'setupDealer' | 'setupFacilitator' | 'setupPundit'> = {
  DEALER: 'setupDealer',
  FACILITATOR: 'setupFacilitator',
  FARM_PUNDIT: 'setupPundit',
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
  icon, label, subLabel, onClick, trailing, color = C.textPrimary,
}: {
  icon: React.ReactNode
  label: string
  subLabel?: string
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
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-medium" style={{ color }}>{label}</span>
        {subLabel && (
          <span className="block text-[11px] mt-0.5" style={{ color: C.textSecond }}>{subLabel}</span>
        )}
      </span>
      {trailing}
    </button>
  )
}

export default function RoleSwitcherDrawer({ open, onClose, onSwitch, activeRole: propActiveRole }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('roleSwitcher')
  const tRole = useTranslations('role')
  const user = getUser()
  const userRoles = getActiveRoles(user)
  const [showAbout, setShowAbout] = useState(false)

  const activeRole = propActiveRole ?? getActiveRoleFromPath(pathname)
  const activeRoleLabel = ROLE_LABEL_KEY[activeRole] ? tRole(ROLE_LABEL_KEY[activeRole]) : t('activeRoleFallback')

  function go(href: string) {
    router.push(href)
    onClose()
  }

  // "Set up" status — UserRole grant alone isn't enough; the
  // role's setup page must also be completed.
  // - DEALER: user.dealer_profile_complete (all 7 shop fields)
  // - FACILITATOR: user.facilitator_declared_at != null
  // - FARM_PUNDIT: just role presence for now (no separate gate)
  function isRoleSetUp(role: string): boolean {
    if (role === 'FARMER') return true
    if (!userRoles.includes(role)) return false
    if (role === 'DEALER') return user?.dealer_profile_complete === true
    if (role === 'FACILITATOR') return !!user?.facilitator_declared_at
    return true
  }

  // 2026-06-23 — Dealer + Facilitator are mutually exclusive (conflict
  // of interest in the order-routing chain). All other combinations
  // are fine. Returns the role currently blocking the candidate, or
  // null if the candidate is allowed.
  //
  // "Effective role" widens past `userRoles` to catch legacy sessions
  // where the user is acting as a dealer/facilitator (via URL or
  // completed setup) but the UserRole/ClientPromoter row isn't in
  // `pwa_roles` for whatever reason. Without this, the lock didn't
  // render and the role read as "Set up →".
  const isEffectiveDealer =
    userRoles.includes('DEALER') ||
    activeRole === 'DEALER' ||
    user?.dealer_profile_complete === true
  const isEffectiveFacilitator =
    userRoles.includes('FACILITATOR') ||
    activeRole === 'FACILITATOR' ||
    !!user?.facilitator_declared_at

  function isBlockedByExclusivity(candidate: string): 'DEALER' | 'FACILITATOR' | null {
    // Coaching Sandbox bypass — students need to practise
    // cross-role scenarios (farmer sends order to their own
    // dealer / facilitator persona). The conflict-of-interest
    // concern doesn't apply inside an isolated coaching workspace.
    // Backend `/auth/me/claim-role` mirrors this bypass.
    if (user?.coaching_context) return null

    // "Already holds candidate role" bypass only applies when the
    // candidate role is FULLY SET UP. If it's granted (userRoles has
    // it) but not yet complete (facilitator_declared_at is null OR
    // dealer_profile_complete is false), the exclusivity block still
    // applies — otherwise a legacy dual-role user sees "Set up →"
    // for a role that conflicts with the one they already run.
    // The old strict check (userRoles.includes alone) let YB's case
    // through: DEALER complete + FACILITATOR user_role present but
    // facilitator_declared_at null → drawer nudged him to set up
    // Facilitator even though Dealer + Facilitator is disallowed.
    const candidateIsComplete =
      (candidate === 'FACILITATOR' && !!user?.facilitator_declared_at) ||
      (candidate === 'DEALER' && user?.dealer_profile_complete === true) ||
      (candidate === 'FARM_PUNDIT' && userRoles.includes('FARM_PUNDIT'))
    if (candidateIsComplete) return null
    // "Conflicting role exists" check is LENIENT — any signal of the
    // other role triggers the block, including the legacy signals.
    if (candidate === 'DEALER' && isEffectiveFacilitator) return 'FACILITATOR'
    if (candidate === 'FACILITATOR' && isEffectiveDealer) return 'DEALER'
    return null
  }

  function handleRoleClick(role: string) {
    // Dealer + Facilitator exclusivity: block the "Become a …" /
    // "Switch to …" tap with a clear explanation. Other roles
    // proceed normally.
    const blockedBy = isBlockedByExclusivity(role)
    if (blockedBy) {
      const otherRoleName = blockedBy === 'DEALER' ? tRole('dealer') : tRole('facilitator')
      const candidateName = role === 'DEALER' ? tRole('dealer') : tRole('facilitator')
      alert(t('exclusivityMessage', { currentRole: otherRoleName, candidateRole: candidateName }))
      onClose()
      return
    }
    const roleIsSetUp = isRoleSetUp(role)
    if (!roleIsSetUp) {
      // Two not-set-up paths:
      // (a) role never claimed → go to the "Become a …" intro page
      // (b) role claimed but setup not finished → go straight to
      //     the setup page; "Become" would try to re-claim.
      const hasRole = userRoles.includes(role)
      if (role === 'DEALER')           router.push(hasRole ? '/dealer/profile' : '/become-dealer')
      else if (role === 'FACILITATOR') router.push(hasRole ? '/facilitator/profile' : '/become-facilitator')
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
            aria-label={t('close')}
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
            label={t('personalDetails')}
            onClick={() => go(`/profile?role=${activeRole}`)}
          />
          {/* 2026-06-22 — Role-specific profile entries. The same
              person can hold multiple roles, so the common
              "Personal Details" label stays consistent everywhere
              (no "My Details" vs "Personal Details" divergence).
              Shop / Professional Details are role-specific
              sub-entries the drawer shows only when relevant. */}
          {activeRole === 'DEALER' && (
            <>
              <MenuRow
                icon={
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"/>
                }
                label={t('shopDetails')}
                onClick={() => go('/dealer/profile')}
              />
              <MenuRow
                icon={
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 3v18m16.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"/>
                }
                label={t('onboardedCompanies')}
                onClick={() => go('/dealer/onboarded-companies')}
              />
            </>
          )}
          {activeRole === 'FARM_PUNDIT' && (
            <MenuRow
              icon={
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5"/>
              }
              label={t('professionalDetails')}
              onClick={() => go('/pundit/profile')}
            />
          )}
          {activeRole === 'FACILITATOR' && (
            <MenuRow
              icon={
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 3v18m16.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"/>
              }
              label={t('onboardedCompanies')}
              onClick={() => go('/facilitator/onboarded-companies')}
            />
          )}
          <MenuRow
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.95-8.95a1.5 1.5 0 012.12 0L21.75 12M4.5 9.75v9.75a1.5 1.5 0 001.5 1.5h3.75v-6h4.5v6H18a1.5 1.5 0 001.5-1.5V9.75"/>
            }
            label={t('cropsAndCompanies')}
            onClick={() => go('/crops-and-companies')}
          />
          <MenuRow
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.12 2.99 2.71 3.22.39.06.78.1 1.17.15.21.02.41.16.5.36l1.34 2.68a.45.45 0 00.81 0l1.34-2.68a.6.6 0 01.5-.36c.39-.05.78-.09 1.17-.15a3.26 3.26 0 002.71-3.22V6.74c0-1.6-1.12-2.98-2.7-3.21A48.39 48.39 0 0012 3.36c-2.4 0-4.78.18-7.13.55-1.6.23-2.72 1.6-2.72 3.21v6z"/>
            }
            label={t('messageRootsTalk')}
            onClick={() => window.location.href = 'mailto:support@eywa.farm?subject=RootsTalk%20support'}
          />
        </div>

        <div className="h-px mx-5" style={{ background: C.divider }} />

        {/* ── Roles section ── */}
        <p className="text-[11px] font-semibold uppercase tracking-widest px-5 pt-4 pb-1.5"
          style={{ color: C.textSecond }}>{t('rolesHeader')}</p>

        {ROLE_ORDER.map(role => {
          const isActive = role === activeRole
          const roleIsSetUp = isRoleSetUp(role)
          const blockedBy = isBlockedByExclusivity(role)
          let label: string
          if (isActive) label = tRole(ROLE_LABEL_KEY[role])
          else if (roleIsSetUp) label = t(SWITCH_LABEL_KEY[role])
          else label = SETUP_LABEL_KEY[role] ? t(SETUP_LABEL_KEY[role]) : t(SWITCH_LABEL_KEY[role])

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
              color={isActive ? C.primary : (blockedBy ? C.textSecond : C.textPrimary)}
              subLabel={blockedBy ? t('exclusivityHint', {
                otherRole: blockedBy === 'DEALER' ? tRole('dealer') : tRole('facilitator'),
              }) : undefined}
              onClick={() => handleRoleClick(role)}
              trailing={isActive ? (
                <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: C.primary + '1A', color: C.primary }}>
                  {t('activeBadge')}
                </span>
              ) : blockedBy ? (
                <span className="text-[18px] font-light" style={{ color: C.textSecond }}>🔒</span>
              ) : !roleIsSetUp ? (
                <span className="text-[12px]" style={{ color: C.textSecond }}>{t('setupHint')}</span>
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
            label={t('helpAndTips')}
            onClick={() => go(`/help-tips?role=${activeRole}`)}
          />
          <MenuRow
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z"/>
            }
            label={t('privacyPolicy')}
            onClick={() => go(`/privacy-policy?role=${activeRole}`)}
          />
          <MenuRow
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.04-.02a.75.75 0 011.06.85l-.7 2.84a.75.75 0 001.06.85l.04-.02M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.01v.01H12V8.25z"/>
            }
            label={t('aboutRootsTalk')}
            onClick={() => setShowAbout(true)}
          />
          <MenuRow
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 16l-4-4m0 0l4-4m-4 4h12m-6 4v1a3 3 0 003 3h2a3 3 0 003-3V7a3 3 0 00-3-3h-2a3 3 0 00-3 3v1"/>
            }
            label={t('signOut')}
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
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-2"
                style={{ background: C.primary + '1A', border: `1px solid ${C.primary}33` }}>
                <AppMark size={34} tone="duo"/>
              </div>
              <p className="font-bold text-lg" style={{ color: C.textPrimary }}>rootsTALK.in</p>
              <p className="text-sm" style={{ color: C.textSecond }}>{t('about.tagline')}</p>
              <p className="text-xs" style={{ color: C.textSecond }}>{t('about.byOrg')}</p>
              <p className="text-xs mt-1" style={{ color: C.textSecond, opacity: 0.7 }}>{t('about.version')}</p>
              <button
                onClick={() => window.open('https://eywa.farm', '_blank')}
                className="mt-3 px-6 py-2.5 rounded-xl text-white text-sm font-bold"
                style={{ background: C.primary }}>
                {t('about.visit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
