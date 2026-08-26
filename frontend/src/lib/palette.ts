import { useEffect, useState } from 'react'

// Colors for the Graph Explorer's canvas rendering (node/edge colors can't be
// CSS custom properties -- force-graph draws directly to a <canvas>, so
// these need to be concrete hex per light/dark mode). Values are the
// dataviz skill's validated default palette (light/dark pairs pre-cleared
// for CVD-safety and contrast) -- see that skill's references/palette.md.
// Do not add/reorder slots without re-running its validator.

export type ThemeMode = 'light' | 'dark'

// Categorical: one slot per entity type, assigned in a fixed order (the
// order types first appear in the ontology) -- never reassigned when the
// active filter changes, per the skill's "color follows the entity, never
// its rank" rule. Only the first 8 slots are distinct; anything past that
// folds into MUTED rather than generating a 9th hue.
const CATEGORICAL: Record<ThemeMode, string[]> = {
  light: [
    '#2a78d6', // 1 blue
    '#eb6834', // 2 orange
    '#1baf7a', // 3 aqua
    '#eda100', // 4 yellow
    '#e87ba4', // 5 magenta
    '#008300', // 6 green
    '#4a3aa7', // 7 violet
    '#e34948', // 8 red
  ],
  dark: [
    '#3987e5',
    '#d95926',
    '#199e70',
    '#c98500',
    '#d55181',
    '#008300',
    '#9085e9',
    '#e66767',
  ],
}

export const MUTED: Record<ThemeMode, string> = {
  light: '#898781',
  dark: '#898781',
}

export const INK: Record<ThemeMode, string> = {
  light: '#0b0b0b',
  dark: '#ffffff',
}

// Sequential (confidence, a magnitude): one hue (blue), low->high. The
// direction of the light->dark ramp is defined against a light surface;
// on a dark canvas we keep "more confident = more contrast from the
// background" by running lighter-to-brighter instead of light-to-navy, so
// high-confidence edges still read clearly against a near-black canvas.
const CONFIDENCE_RAMP: Record<ThemeMode, { low: string; high: string }> = {
  light: { low: '#cde2fb', high: '#0d366b' },
  dark: { low: '#1c3a63', high: '#86b6ef' },
}

export function categoricalColor(mode: ThemeMode, slotIndex: number): string {
  const slots = CATEGORICAL[mode]
  return slotIndex < slots.length ? slots[slotIndex] : MUTED[mode]
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

/** Confidence in [0, 1] -> a color along the sequential blue ramp. */
export function confidenceColor(mode: ThemeMode, confidence: number): string {
  const { low, high } = CONFIDENCE_RAMP[mode]
  const t = Math.max(0, Math.min(1, confidence))
  const [r1, g1, b1] = hexToRgb(low)
  const [r2, g2, b2] = hexToRgb(high)
  return `rgb(${lerp(r1, r2, t)}, ${lerp(g1, g2, t)}, ${lerp(b1, b2, t)})`
}

export function confidenceRampCss(mode: ThemeMode): string {
  const { low, high } = CONFIDENCE_RAMP[mode]
  return `linear-gradient(90deg, ${low}, ${high})`
}

/** Live-updating hook for the viewer's color scheme (system setting only --
 * this app has no explicit light/dark toggle to also account for). */
export function useThemeMode(): ThemeMode {
  const getMode = (): ThemeMode =>
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  const [mode, setMode] = useState(getMode)

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = () => setMode(getMode())
    mql.addEventListener('change', listener)
    return () => mql.removeEventListener('change', listener)
  }, [])

  return mode
}
