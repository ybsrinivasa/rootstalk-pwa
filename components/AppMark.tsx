// AppMark — the RootsTalk brand mark. A sprout/sapling with two
// leaves above the soil line and roots below it. Plays on the
// "roots" in the product name: visible growth on top, grounded
// foundation underneath. Replaces the older abstract node-graph
// mark on 2026-05-20 per user request.
//
// Use this in three contexts:
//   • duo  — Crop Green leaves + Soil Brown roots, on Field
//            Cream or white backgrounds.
//   • mono — single colour (typically white) on coloured chrome
//            like the header or landing hero.
//   • Override colours via `colour` (mono fill) and/or `rootColour`
//     (duo soil/roots) when a specific context demands it.

type Props = {
  size?: number
  tone?: 'duo' | 'mono'
  colour?: string       // leaves + stem (and roots in mono)
  rootColour?: string   // roots + soil line (duo only)
  className?: string
}

const CROP_GREEN = '#3A7D44'
const SOIL_BROWN = '#6B3F1F'

export default function AppMark({
  size = 48,
  tone = 'duo',
  colour,
  rootColour,
  className,
}: Props) {
  const leafC = colour ?? (tone === 'mono' ? 'white' : CROP_GREEN)
  const rootC = tone === 'mono' ? leafC : (rootColour ?? SOIL_BROWN)

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      role="img">
      {/* Stem — runs straight from the soil line into the leaf
          notch. Same stroke as the leaf outlines for visual unity. */}
      <path d="M24 22 V 30" stroke={leafC} strokeWidth="2.5" strokeLinecap="round"/>

      {/* Two leaves — symmetric teardrop shapes leaning gently
          outward from a shared notch at (24, 22). Solid fills for
          legibility at small sizes (app-icon, 24×24 in chrome). */}
      <path d="M24 22 C 17 22 13 17 11 9 C 19 9 24 14 24 22 Z"
        fill={leafC}/>
      <path d="M24 22 C 31 22 35 17 37 9 C 29 9 24 14 24 22 Z"
        fill={leafC}/>

      {/* Soil baseline — slightly thinner than the stem, with an
          opacity dial when in duo tone so it reads as the
          horizon rather than competing with the leaves. */}
      <path d="M9 30 H 39" stroke={rootC} strokeWidth="1.8" strokeLinecap="round"
        opacity={tone === 'mono' ? 0.55 : 0.75}/>

      {/* Roots — three diverging strokes. Centre root goes
          straight down; the side roots curl gently outward to
          suggest natural branching. */}
      <path d="M24 30 Q 22 34 18 39" stroke={rootC} strokeWidth="1.5"
        strokeLinecap="round" fill="none"/>
      <path d="M24 30 V 41" stroke={rootC} strokeWidth="1.5"
        strokeLinecap="round" fill="none"/>
      <path d="M24 30 Q 26 34 30 39" stroke={rootC} strokeWidth="1.5"
        strokeLinecap="round" fill="none"/>
    </svg>
  )
}
