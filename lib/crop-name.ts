// Crop display name resolver. Cosh ships crop ids as UUIDs (real
// 36-char strings) — there's no human-readable substring to fall
// back on. Prefer the resolved `name` from the backend; if a
// legacy slug-style id ("crop_paddy") leaks through, de-slug it;
// otherwise show a neutral placeholder so the UI NEVER renders a
// raw 36-char UUID. 2026-05-20.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function cropDisplayName(
  coshId: string | null | undefined,
  resolvedName?: string | null,
): string {
  if (resolvedName && resolvedName.trim()) return resolvedName
  if (!coshId) return 'Crop'
  if (UUID_RE.test(coshId)) return 'Crop'
  // Legacy slug — "crop_paddy" → "Paddy", "crop_red_chilli" → "Red Chilli".
  return coshId
    .replace(/^crop[_:]/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim() || 'Crop'
}
