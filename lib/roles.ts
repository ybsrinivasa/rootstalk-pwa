// Role helper — derive the farmer/dealer/facilitator/pundit role
// from the current pathname. Duplicated inline previously in
// RoleSwitcherDrawer; extracted here (2026-11-22) so routes that
// render the same page for multiple roles (e.g. /messages,
// /dealer/messages, /facilitator/messages) can set BottomNav's
// activeRole from one source of truth.

export type PWARole = 'FARMER' | 'DEALER' | 'FACILITATOR' | 'FARM_PUNDIT'

export function getActiveRoleFromPath(pathname: string): PWARole {
  if (pathname.startsWith('/dealer')) return 'DEALER'
  if (pathname.startsWith('/facilitator')) return 'FACILITATOR'
  if (pathname.startsWith('/pundit')) return 'FARM_PUNDIT'
  return 'FARMER'
}
