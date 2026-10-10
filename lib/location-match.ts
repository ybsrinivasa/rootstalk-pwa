// Bilingual filter for Cosh state/district pickers. The backend
// emits `name` (localised to the farmer's language_code) and
// `name_en` (always English) side by side; this helper lets the
// typeahead match either, so a Kannada-UI farmer using an English
// keyboard can type "Mandya" and still find "ಮಂಡ್ಯ" (and vice versa).
export function locationMatches(
  query: string,
  name: string | null | undefined,
  nameEn: string | null | undefined,
): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  return (
    (name || '').toLowerCase().includes(needle) ||
    (nameEn || '').toLowerCase().includes(needle)
  )
}
