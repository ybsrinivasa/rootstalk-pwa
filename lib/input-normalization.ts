// Shared input-normalisation helpers for numeric + name fields.
//
// Language policy (2026-08-28):
//   • Numbers: accept ANY Unicode script's digits, normalise to ASCII
//     0-9 before validation / storage. A farmer on a Kannada keyboard
//     typing "೯೦೧೪೮೮೩೨೪೦" should be treated as "9014883240".
//   • Names: must be ASCII/Latin. Surface a live hint when non-ASCII
//     characters are typed rather than rejecting silently.
//   • Queries + responses: free-form Unicode, no restriction.
//
// The digit-strip pattern `.replace(/\D/g, '')` used across the PWA
// only recognises ASCII 0-9 — it silently erases Devanagari, Kannada,
// Tamil, etc. digit characters. Every numeric input should route the
// value through `normalizeDigits()` BEFORE the `\D` strip so those
// characters map to their ASCII equivalents first.

// One entry per Indic / Arabic-Indic script whose "0" starts the
// contiguous 0-9 decimal digit block. Value = codepoint of that
// script's "0"; digits 1-9 follow at +1 through +9.
const DIGIT_BLOCK_BASES: number[] = [
  0x0660, // Arabic-Indic (Urdu overlaps here + 0x06F0)
  0x06F0, // Extended Arabic-Indic (Urdu / Persian)
  0x0966, // Devanagari (Hindi, Marathi, Sanskrit)
  0x09E6, // Bengali (also used by Assamese)
  0x0A66, // Gurmukhi (Punjabi)
  0x0AE6, // Gujarati
  0x0B66, // Oriya
  0x0BE6, // Tamil
  0x0C66, // Telugu
  0x0CE6, // Kannada
  0x0D66, // Malayalam
]

/**
 * Convert any Unicode-script decimal digits in `input` to their ASCII
 * `0`-`9` equivalents. Non-digit characters are passed through
 * unchanged, so this is safe to run on mixed-content strings.
 *
 * Cover the 11 digit blocks that matter for RootsTalk's language set.
 * Any script we haven't listed here falls through with its digits
 * untouched — worth extending the list if a new locale is enabled.
 */
export function normalizeDigits(input: string): string {
  if (!input) return input
  let out = ''
  for (const ch of input) {
    const cp = ch.codePointAt(0)!
    let mapped = ch
    for (const base of DIGIT_BLOCK_BASES) {
      if (cp >= base && cp <= base + 9) {
        mapped = String.fromCharCode(0x30 + (cp - base))
        break
      }
    }
    out += mapped
  }
  return out
}

/**
 * Common composed handler for numeric-only inputs — normalise Unicode
 * digits first, then strip everything that isn't ASCII 0-9. Optional
 * `maxLength` mirrors the `.slice(0, N)` many call-sites already do.
 *
 * ```
 * onChange={e => setPhone(digitsOnly(e.target.value, 10))}
 * ```
 */
export function digitsOnly(input: string, maxLength?: number): string {
  const stripped = normalizeDigits(input).replace(/\D/g, '')
  return maxLength ? stripped.slice(0, maxLength) : stripped
}

/**
 * `true` when the string carries any non-ASCII character. Drives the
 * live "please switch to English keyboard" hint on name fields —
 * we don't want to reject the character (that would eat the keystroke
 * and confuse the farmer); we let them type, show the hint, and
 * only block Save if the string still contains non-ASCII when they
 * try to submit.
 */
export function hasNonAscii(input: string): boolean {
  // Trim so trailing whitespace / punctuation doesn't cause false
  // positives, but check the middle for any codepoint > 0x7F.
  return /[^\x00-\x7F]/.test(input)
}

/**
 * `true` if `input` is a valid ASCII-latin name — allows letters,
 * spaces, dots (for initials), apostrophes, hyphens. Empty string
 * is treated as "not yet valid" so callers can gate a Save button.
 */
export function isAsciiName(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false
  return /^[A-Za-z][A-Za-z\s.'-]*$/.test(trimmed)
}
