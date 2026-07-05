// AppMark — the RootsTalk / eywa brand mark. 2026-07-05: switched
// from the hand-drawn sapling SVG to the eywa willow-tree logo so
// the mark on the QR (product authentication) reads as the same
// mark the farmer sees on their app icon, header, and dashboard.
//
// Two tones:
//   • mono — cream / white variant on dark chrome (header on
//            branded background, dark hero cards)
//   • duo  — the full-colour logo (green willow in gold circle)
//            on light chrome (dashboards, Cream backgrounds)

/* eslint-disable @next/next/no-img-element */

type Props = {
  size?: number
  tone?: 'duo' | 'mono'
  /** @deprecated retained for backwards-compat; logo colours are
   *  baked into the two source PNGs, not tinted per-call. */
  colour?: string
  /** @deprecated same as `colour`. */
  rootColour?: string
  className?: string
}

const SRC_MONO = '/logos/eywa-logo-white.png'
const SRC_DUO = '/logos/eywa-logo-notext-square.png'

export default function AppMark({
  size = 48,
  tone = 'duo',
  colour: _colour,
  rootColour: _rootColour,
  className,
}: Props) {
  void _colour; void _rootColour
  const src = tone === 'mono' ? SRC_MONO : SRC_DUO
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      className={className}
      style={{ display: 'block', objectFit: 'contain' }}
      aria-hidden="true"
    />
  )
}
