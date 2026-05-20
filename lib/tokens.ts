// RootsTalk design tokens — values from LoYaRo_RootsTalk_UI_Design_
// System.docx (Part Two). Import as a single C object so every site
// reads from one source. JS-side only; Tailwind classes are not
// auto-generated for these.
//
// Usage:
//   import { C } from '@/lib/tokens'
//   <div style={{ background: C.background, color: C.textPrimary }} />
//
// Add new keys here, not inline, when a new shade is needed.
export const C = {
  primary:     '#3A7D44',  // Crop Green — buttons, headings, logo, active
  primarySoft: '#3A7D441A', // Crop Green @ 10% — chip backgrounds
  accent:      '#C8960C',  // Harvest Gold — accent, badges
  secondary:   '#4A7FA5',  // Sky Blue — expert connect, info, trust
  alert:       '#D4682E',  // Sunrise — alerts, sign-out, urgent
  rainBlue:    '#2C5F7A',  // Rain Blue — water / irrigation

  background:  '#F5F0E8',  // Field Cream — page background
  cardBg:      '#FFFFFF',  // Cards / surfaces above background
  textPrimary: '#6B3F1F',  // Soil Brown — primary text
  textSecond:  '#7A8C7E',  // Mist Grey — labels, captions
  divider:     '#DDD0B8',  // Warm divider — borders/separators
} as const

// Tap-target and font minimums per design doc. Keep alongside the
// colour tokens so designers see the full system in one file.
export const SIZES = {
  minTap: 48,
  bodyMin: 15,
  labelMin: 12,
} as const
