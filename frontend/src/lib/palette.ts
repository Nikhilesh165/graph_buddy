import type { ThemeMode } from './themeContext'

// Colors for canvas rendering (graph/engine.ts). Canvas drawing can't read
// CSS custom properties per frame, so these are concrete hex per light/dark
// mode. CATEGORICAL is the dataviz skill's validated default palette
// (light/dark pairs pre-cleared for CVD-safety and contrast) -- see that
// skill's references/palette.md. Do not add/reorder slots without
// re-running its validator.

export type { ThemeMode }

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

const MUTED: Record<ThemeMode, string> = {
  light: '#898781',
  dark: '#898781',
}

function categoricalColor(mode: ThemeMode, slotIndex: number): string {
  const slots = CATEGORICAL[mode]
  return slotIndex >= 0 && slotIndex < slots.length ? slots[slotIndex] : MUTED[mode]
}

/** Stable color for an entity type: its slot in ontology definition order,
 * or MUTED for types the ontology doesn't (or no longer) defines. */
export function typeColor(mode: ThemeMode, entityTypeOrder: readonly string[], type: string): string {
  return categoricalColor(mode, entityTypeOrder.indexOf(type))
}

/** Everything the graph canvas paints that isn't an entity-type color.
 * Mirrors index.css's Obsidian-style tokens (Obsidian's own graph view uses
 * base-35 for lines, text-muted for nodes, and the accent for focus). */
export type GraphTheme = {
  background: string
  /** Node fill when "color by type" is off -- the classic monochrome look. */
  node: string
  /** Base link color; per-link alpha carries confidence on top of it. */
  link: string
  /** Hover / selection accent for links, rings, and focus glow. */
  accent: string
  label: string
  labelMuted: string
  /** Halo stroked behind label text so it stays legible over links. */
  labelHalo: string
}

export const GRAPH_THEME: Record<ThemeMode, GraphTheme> = {
  light: {
    background: '#ffffff',
    node: '#8f8f8f',
    link: '#a9a9a9',
    accent: '#6d4ee6',
    label: '#222222',
    labelMuted: '#5c5c5c',
    labelHalo: 'rgba(255,255,255,0.92)',
  },
  dark: {
    background: '#1e1e1e',
    node: '#a8a8a8',
    link: '#6a6a6a',
    accent: '#8a6cef',
    label: '#dadada',
    labelMuted: '#9a9a9a',
    labelHalo: 'rgba(30,30,30,0.92)',
  },
}
