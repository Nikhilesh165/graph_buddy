// Viewer-tunable graph settings, grouped the way Obsidian's graph-view
// settings panel groups them (Display / Forces). Shared by the engine
// (graph/engine.ts), the settings panel, and anything that persists them.

export type GraphSettings = {
  // Display
  /** Fill nodes with their entity type's color; off = monochrome. */
  colorByType: boolean
  showArrows: boolean
  /** Encode each fact's confidence as link opacity (unscored = dashed). */
  confidenceOpacity: boolean
  /** Relation names along highlighted links, and every link up close. */
  edgeLabels: boolean
  /** Relation names on every link at any zoom (small graphs like the
   * ontology schema, where the names are the point). Not in the panel. */
  edgeLabelsAlways: boolean
  /** 0..1 -- how far you must zoom in before node names fade in. */
  labelThreshold: number
  nodeSize: number
  linkThickness: number

  // Forces
  centerForce: number
  repelForce: number
  linkForce: number
  linkDistance: number
}

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  colorByType: true,
  showArrows: true,
  confidenceOpacity: true,
  edgeLabels: true,
  edgeLabelsAlways: false,
  labelThreshold: 0.45,
  nodeSize: 1,
  linkThickness: 1,

  centerForce: 0.4,
  repelForce: 10,
  linkForce: 0.6,
  linkDistance: 70,
}

/** Slider bounds for the settings panel -- kept next to the defaults so the
 * two can't drift apart. */
export const SETTING_RANGES = {
  labelThreshold: { min: 0, max: 1, step: 0.01 },
  nodeSize: { min: 0.4, max: 2.5, step: 0.05 },
  linkThickness: { min: 0.3, max: 3, step: 0.05 },
  centerForce: { min: 0, max: 1, step: 0.01 },
  repelForce: { min: 0, max: 20, step: 0.1 },
  linkForce: { min: 0, max: 1, step: 0.01 },
  linkDistance: { min: 20, max: 250, step: 1 },
} as const

export const FORCE_KEYS = ['centerForce', 'repelForce', 'linkForce', 'linkDistance'] as const

/** Server-side filters the Filters section edits (see api/client.getGraph). */
export type GraphFilterState = {
  minConfidence: number
  limit: number
  entityTypes: string[]
  relationTypes: string[]
}

/** "Facts loaded" choices -- the backend caps `limit` at 1000. */
export const LIMIT_OPTIONS = [100, 300, 600, 1000] as const
