import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type ForceCollide,
  type ForceLink,
  type ForceManyBody,
  type ForceX,
  type ForceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import type { GraphTheme } from '../lib/palette'
import { DEFAULT_GRAPH_SETTINGS, FORCE_KEYS, type GraphSettings } from './settings'

// A small, framework-agnostic force-graph renderer modeled on Obsidian's
// graph view. It replaces react-force-graph-2d, whose fixed rendering
// pipeline couldn't do what makes Obsidian's graph feel calm:
//
//  - physics and drawing share one requestAnimationFrame loop (d3's own
//    timer is stopped; we tick the simulation ourselves), and the loop goes
//    fully idle once the layout, camera, and every transition have settled;
//  - every visual state change -- hover dimming, selection rings, nodes
//    entering/leaving on a filter change, labels fading in with zoom -- is
//    an eased per-element value, never a hard swap;
//  - the camera eases toward its target (wheel zoom, fit, fly-to) and
//    glides with inertia after a pan;
//  - filter changes merge into the running layout (existing nodes keep their
//    positions; new ones spawn beside a neighbor) instead of re-exploding it;
//  - node labels are placed greedily by priority so they never overlap, and
//    get a background-colored halo instead of a box.
//
// Everything is drawn in screen space (positions projected once per frame),
// so text and hairlines stay crisp at any zoom and DPR.

export type EngineNodeInput = { id: string; name: string; type: string }
export type EngineLinkInput = {
  id: string
  source: string
  target: string
  name: string
  confidence: number | null
}

export type HoverTarget = { kind: 'node'; id: string } | { kind: 'link'; id: string } | null

export type EngineCallbacks = {
  onNodeClick?: (id: string) => void
  onNodeDoubleClick?: (id: string) => void
  onLinkClick?: (id: string) => void
  onBackgroundClick?: () => void
  onHoverChange?: (target: HoverTarget) => void
}

export type Insets = { top: number; right: number; bottom: number; left: number }

type Node = SimulationNodeDatum & {
  id: string
  name: string
  type: string
  color: string
  degree: number
  radius: number
  leaving: boolean
  // eased state (value + target)
  appear: number
  fade: number
  fadeT: number
  emph: number
  emphT: number
  ring: number
  ringT: number
  label: number
  labelT: number
  // per-frame projection
  sx: number
  sy: number
  sr: number
  // cached label metrics at 12px (scaled linearly for other sizes)
  labelText: string
  labelW: number
  labelWBold: number
}

type Link = SimulationLinkDatum<Node> & {
  id: string
  source: Node
  target: Node
  name: string
  text: string
  confidence: number | null
  curvature: number
  leaving: boolean
  appear: number
  fade: number
  fadeT: number
  emph: number
  emphT: number
  labelW: number
  label: number
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'press-node'; node: Node; pointerId: number; startX: number; startY: number }
  | { kind: 'drag-node'; node: Node; pointerId: number; offsetX: number; offsetY: number }
  | { kind: 'press-bg'; pointerId: number; startX: number; startY: number; link: Link | null }
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number; samples: { t: number; x: number; y: number }[] }
  | { kind: 'pinch'; startDist: number; startK: number; worldX: number; worldY: number }

type Camera = { x: number; y: number; k: number }

const K_MIN = 0.04
const K_MAX = 8
const FIT_MAX_K = 2.4
const LABEL_FONT_PX = 12
const EDGE_FONT_PX = 10.5
const LABEL_MAX_CHARS = 30
const DRAG_THRESHOLD_PX = 4

// Easing time-constants (ms) for the exponential approach used everywhere.
const TAU_FADE = 110
const TAU_APPEAR = 240
const TAU_LABEL = 130
const TAU_ZOOM = 70
const TAU_FOLLOW = 260
const TAU_INERTIA = 260

const FONT_STACK = `'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif`

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function approach(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target
  const next = current + (target - current) * (1 - Math.exp(-dt / tau))
  return Math.abs(next - target) < 0.002 ? target : next
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

function easeOutBack(t: number): number {
  const c1 = 1.2
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

const rgbCache = new Map<string, [number, number, number]>()
function toRgb(color: string): [number, number, number] {
  let rgb = rgbCache.get(color)
  if (!rgb) {
    const hex = color.startsWith('#') ? color.slice(1) : '888888'
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex
    const n = parseInt(full.slice(0, 6), 16)
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    rgbCache.set(color, rgb)
  }
  return rgb
}

function mix(a: string, b: string, t: number): string {
  if (t <= 0.001) return a
  if (t >= 0.999) return b
  const [r1, g1, b1] = toRgb(a)
  const [r2, g2, b2] = toRgb(b)
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** Uniform grid for screen-space label collision checks. */
class LabelGrid {
  private cells = new Map<number, [number, number, number, number][]>()
  private size = 96

  clear() {
    this.cells.clear()
  }

  private keys(x: number, y: number, w: number, h: number): number[] {
    const out: number[] = []
    const x0 = Math.floor(x / this.size)
    const x1 = Math.floor((x + w) / this.size)
    const y0 = Math.floor(y / this.size)
    const y1 = Math.floor((y + h) / this.size)
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) out.push(gx * 73856093 + gy * 19349663)
    return out
  }

  /** Place the rect if it doesn't overlap anything placed so far. */
  tryPlace(x: number, y: number, w: number, h: number): boolean {
    const keys = this.keys(x, y, w, h)
    for (const key of keys) {
      for (const [rx, ry, rw, rh] of this.cells.get(key) ?? []) {
        if (x < rx + rw && x + w > rx && y < ry + rh && y + h > ry) return false
      }
    }
    const rect: [number, number, number, number] = [x, y, w, h]
    for (const key of keys) {
      const list = this.cells.get(key)
      if (list) list.push(rect)
      else this.cells.set(key, [rect])
    }
    return true
  }
}

export class GraphEngine {
  private readonly container: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly callbacks: EngineCallbacks
  private readonly resizeObserver: ResizeObserver
  private readonly sim: Simulation<Node, Link>
  private readonly forceCharge: ForceManyBody<Node>
  private readonly forceLinks: ForceLink<Node, Link>
  private readonly forceCenterX: ForceX<Node>
  private readonly forceCenterY: ForceY<Node>
  private readonly forceCollision: ForceCollide<Node>
  private readonly labelGrid = new LabelGrid()
  private readonly reducedMotion: boolean

  private width = 0
  private height = 0
  private dpr = 1
  private nodes: Node[] = []
  private links: Link[] = []
  private nodeById = new Map<string, Node>()
  private linkById = new Map<string, Link>()
  private adjacency = new Map<string, Set<string>>()
  /** Last resting place of nodes that left the view (a filter, local
   * graph), so they come back where the viewer last saw them instead of
   * re-seeding -- toggling a filter shouldn't reshuffle the mental map. */
  private remembered = new Map<string, { x: number; y: number }>()

  private settings: GraphSettings = DEFAULT_GRAPH_SETTINGS
  private theme: GraphTheme
  private colorFor: (type: string) => string = () => '#888888'
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

  private cam: Camera = { x: 0, y: 0, k: 1 }
  private camTarget: Camera = { x: 0, y: 0, k: 1 }
  private flight: { from: Camera; to: Camera; start: number; duration: number } | null = null
  private follow: { ids: Set<string> | null; until: number } | null = null
  private velocity: { x: number; y: number } | null = null

  private hover: HoverTarget = null
  private selectedNodeId: string | null = null
  private selectedLinkId: string | null = null
  private focusLinkId: string | null = null
  private highlight: Set<string> | null = null

  private gesture: Gesture = { kind: 'none' }
  private pointers = new Map<number, { x: number; y: number }>()
  /** Last mouse position over the canvas, for re-checking hover when the
   * camera moves under a stationary cursor (fit, fly-to, inertia). */
  private pointerPos: { x: number; y: number } | null = null
  private cameraWasMoving = false

  private raf = 0
  private lastTime = 0
  private destroyed = false

  constructor(container: HTMLElement, theme: GraphTheme, callbacks: EngineCallbacks = {}) {
    this.container = container
    this.theme = theme
    this.callbacks = callbacks
    this.reducedMotion = prefersReducedMotion()

    this.canvas = document.createElement('canvas')
    this.canvas.style.position = 'absolute'
    this.canvas.style.inset = '0'
    this.canvas.style.touchAction = 'none'
    this.canvas.style.cursor = 'grab'
    this.canvas.setAttribute('aria-hidden', 'true')
    container.appendChild(this.canvas)
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable')
    this.ctx = ctx

    this.forceCharge = forceManyBody<Node>().theta(0.9).distanceMax(900)
    this.forceLinks = forceLink<Node, Link>().id((n) => n.id)
    this.forceCenterX = forceX<Node>(0)
    this.forceCenterY = forceY<Node>(0)
    this.forceCollision = forceCollide<Node>().iterations(1).strength(0.75)
    this.sim = forceSimulation<Node, Link>([])
      .force('charge', this.forceCharge)
      .force('link', this.forceLinks)
      .force('x', this.forceCenterX)
      .force('y', this.forceCenterY)
      .force('collide', this.forceCollision)
      .velocityDecay(0.36)
      .alphaDecay(0.0228)
      .stop() // ticked manually from the render loop
    this.applyForces()

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerCancel)
    this.canvas.addEventListener('pointerleave', this.onPointerLeave)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.canvas.addEventListener('dblclick', this.onDoubleClick)

    // Label widths measured before the web font finished loading are
    // fallback-font widths; re-measure once it's in.
    document.fonts?.ready.then(() => {
      if (this.destroyed) return
      for (const node of this.nodes) this.measureNodeLabel(node)
      for (const link of this.links) this.setLinkName(link, link.name)
      this.wake()
    })
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('dblclick', this.onDoubleClick)
    this.canvas.remove()
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  /** Merge a new node/link set into the running layout. Nodes that persist
   * keep their position and velocity; new nodes spawn next to an existing
   * neighbor and scale in; removed ones fade out where they stand. */
  setData(inputNodes: EngineNodeInput[], inputLinks: EngineLinkInput[]) {
    // A true first load blooms from nothing; returning to remembered nodes
    // (after a filter emptied the view) restores them in place instead.
    const firstLoad = this.nodes.every((n) => n.leaving) && !inputNodes.some((n) => this.remembered.has(n.id))
    const seen = new Set<string>()
    const nextNodes: Node[] = []
    let added = 0
    let changed = 0 // anything entering or leaving; zero means a no-op refresh

    for (const input of inputNodes) {
      if (seen.has(input.id)) continue
      seen.add(input.id)
      let node = this.nodeById.get(input.id)
      if (node) {
        if (node.leaving) changed++
        node.leaving = false
        node.fx = null
        node.fy = null
        if (node.name !== input.name) {
          node.name = input.name
          this.measureNodeLabel(node)
        }
        node.type = input.type
      } else {
        node = this.createNode(input)
        this.nodeById.set(node.id, node)
        added++
      }
      node.color = this.colorFor(node.type)
      nextNodes.push(node)
    }

    // Removed nodes stay in the draw list, frozen in place, until faded out.
    for (const node of this.nodes) {
      if (!seen.has(node.id) && !node.leaving) {
        changed++
        node.leaving = true
        node.fx = node.x
        node.fy = node.y
      }
      if (node.leaving && node.appear > 0.01) nextNodes.push(node)
    }
    this.nodes = nextNodes

    const nextLinks: Link[] = []
    const seenLinks = new Set<string>()
    for (const input of inputLinks) {
      const source = this.nodeById.get(input.source)
      const target = this.nodeById.get(input.target)
      if (!source || !target || source.leaving || target.leaving || seenLinks.has(input.id)) continue
      seenLinks.add(input.id)
      let link = this.linkById.get(input.id)
      if (link) {
        if (link.leaving) changed++
        link.leaving = false
        link.source = source
        link.target = target
        link.confidence = input.confidence
        if (link.name !== input.name) this.setLinkName(link, input.name)
      } else {
        link = {
          id: input.id,
          source,
          target,
          name: '',
          text: '',
          confidence: input.confidence,
          curvature: 0,
          leaving: false,
          appear: this.reducedMotion ? 1 : 0,
          fade: 0,
          fadeT: 0,
          emph: 0,
          emphT: 0,
          labelW: 0,
          label: 0,
        }
        this.setLinkName(link, input.name)
        this.linkById.set(link.id, link)
        changed++
      }
      nextLinks.push(link)
    }
    for (const link of this.links) {
      if (!seenLinks.has(link.id) && !link.leaving) {
        link.leaving = true
        changed++
      }
      if (link.leaving && link.appear > 0.01) nextLinks.push(link)
    }
    this.links = nextLinks

    // Drop fully-faded leftovers from the lookup maps.
    const liveNodes = new Set(this.nodes)
    const liveLinks = new Set(this.links)
    for (const [id, node] of this.nodeById) if (!liveNodes.has(node)) this.nodeById.delete(id)
    for (const [id, link] of this.linkById) if (!liveLinks.has(link)) this.linkById.delete(id)

    this.rebuildTopology()
    this.seedNewNodePositions(firstLoad)

    const activeNodes = this.nodes.filter((n) => !n.leaving)
    this.sim.nodes(activeNodes)
    this.forceLinks.links(this.links.filter((l) => !l.leaving))
    this.applyForces()

    if (firstLoad) {
      this.sim.alpha(1)
      // Silent warm-up ticks take the edge off the very first frames, where
      // forces are strongest and the bloom would read as an explosion; the
      // camera then eases out with the layout as it finishes opening up.
      const warmup = activeNodes.length > 400 ? 25 : 40
      for (let i = 0; i < warmup; i++) this.sim.tick()
      if (this.reducedMotion) this.settleNow()
      this.startFollow(null, 2600)
      this.snapCameraToFit(1.6)
    } else if (added + changed > 0) {
      const ratio = activeNodes.length === 0 ? 0 : (added + changed) / activeNodes.length
      this.sim.alpha(Math.max(this.sim.alpha(), clamp(0.18 + ratio * 0.9, 0.18, 0.8)))
      if (this.reducedMotion) this.settleNow()
    }

    // Hover/selection pointing at a node that just left would dim the
    // whole graph around nothing.
    const hover = this.hover
    if (hover && !(hover.kind === 'node' ? this.hasNode(hover.id) : this.hasLink(hover.id))) this.setHover(null)

    this.updateFocus()
    this.wake()
  }

  setTheme(theme: GraphTheme) {
    this.theme = theme
    this.wake()
  }

  setColorFunction(colorFor: (type: string) => string) {
    this.colorFor = colorFor
    for (const node of this.nodes) node.color = colorFor(node.type)
    this.wake()
  }

  setSettings(settings: GraphSettings) {
    const prev = this.settings
    this.settings = settings
    if (prev.nodeSize !== settings.nodeSize) this.updateRadii()
    if (FORCE_KEYS.some((key) => prev[key] !== settings[key]) || prev.nodeSize !== settings.nodeSize) {
      this.applyForces()
      this.sim.alpha(Math.max(this.sim.alpha(), 0.3))
    }
    this.wake()
  }

  setSelection(nodeId: string | null, linkId: string | null = null) {
    if (nodeId === this.selectedNodeId && linkId === this.selectedLinkId) return
    this.selectedNodeId = nodeId
    this.selectedLinkId = linkId
    this.updateFocus()
    this.wake()
  }

  /** Emphasize one link and its endpoints, dimming everything else -- the
   * Retrieval Inspector's "step through the trace" view. */
  setFocusLink(linkId: string | null) {
    if (linkId === this.focusLinkId) return
    this.focusLinkId = linkId
    this.updateFocus()
    this.wake()
  }

  /** Emphasize a set of nodes (e.g. every node of a hovered legend type). */
  setHighlight(ids: Set<string> | null) {
    this.highlight = ids && ids.size > 0 ? ids : null
    this.updateFocus()
    this.wake()
  }

  /** Screen-space padding covered by overlays (an open inspector panel),
   * so fit / center-on target the visible part of the canvas. */
  setInsets(insets: Partial<Insets>) {
    this.insets = { ...this.insets, ...insets }
  }

  zoomBy(factor: number) {
    this.stopCameraMotion()
    const k = clamp(this.camTarget.k * factor, K_MIN, K_MAX)
    this.flyTo({ x: this.camTarget.x, y: this.camTarget.y, k }, 260)
  }

  /** Frame every node (or just `ids`). While the layout is still settling
   * the camera keeps tracking it until it cools or the user takes over. */
  fit(ids?: Iterable<string>, durationMs = 650) {
    const set = ids ? new Set(ids) : null
    const target = this.computeFit(set)
    if (!target) return
    this.stopCameraMotion()
    this.flyTo(target, durationMs)
    if (this.sim.alpha() > 0.05) this.startFollow(set, durationMs + 1600)
  }

  centerOn(id: string, zoom?: number) {
    const node = this.nodeById.get(id)
    if (!node || node.x === undefined || node.y === undefined) return
    this.stopCameraMotion()
    const k = clamp(zoom ?? Math.max(this.camTarget.k, 1.4), K_MIN, K_MAX)
    this.flyTo(this.cameraFor(node.x, node.y, k), 700)
  }

  /** Pan (keeping zoom) just enough to bring a node out from under an
   * overlay or back on screen. No-op if it's already comfortably visible. */
  ensureVisible(id: string) {
    const node = this.nodeById.get(id)
    if (!node || node.leaving || node.x === undefined || node.y === undefined) return
    const { top, right, bottom, left } = this.insets
    const margin = 48
    const visible =
      node.sx >= left + margin &&
      node.sx <= this.width - right - margin &&
      node.sy >= top + margin &&
      node.sy <= this.height - bottom - margin
    if (visible) return
    this.stopCameraMotion()
    this.flyTo(this.cameraFor(node.x, node.y, this.camTarget.k), 550)
  }

  /** Keep the camera framing the whole graph for a while without a
   * scripted flight -- used while the graph grows (replay). */
  followFit(durationMs = 1500) {
    this.stopCameraMotion()
    this.startFollow(null, durationMs)
    this.wake()
  }

  hasNode(id: string): boolean {
    const node = this.nodeById.get(id)
    return !!node && !node.leaving
  }

  hasLink(id: string): boolean {
    const link = this.linkById.get(id)
    return !!link && !link.leaving
  }

  /** Kick the layout back to life (Obsidian's "animate" feel). */
  reheat(alpha = 0.8) {
    this.sim.alpha(alpha)
    this.wake()
  }

  // ---------------------------------------------------------------------
  // Topology & forces
  // ---------------------------------------------------------------------

  private createNode(input: EngineNodeInput): Node {
    const node: Node = {
      id: input.id,
      name: input.name,
      type: input.type,
      color: '#888888',
      degree: 0,
      radius: 4,
      leaving: false,
      appear: this.reducedMotion ? 1 : 0,
      fade: 0,
      fadeT: 0,
      emph: 0,
      emphT: 0,
      ring: 0,
      ringT: 0,
      label: 0,
      labelT: 0,
      sx: 0,
      sy: 0,
      sr: 0,
      labelText: '',
      labelW: 0,
      labelWBold: 0,
    }
    this.measureNodeLabel(node)
    return node
  }

  private measureNodeLabel(node: Node) {
    node.labelText = truncate(node.name, LABEL_MAX_CHARS)
    this.ctx.font = `500 ${LABEL_FONT_PX}px ${FONT_STACK}`
    node.labelW = this.ctx.measureText(node.labelText).width
    this.ctx.font = `600 ${LABEL_FONT_PX}px ${FONT_STACK}`
    node.labelWBold = this.ctx.measureText(node.labelText).width
  }

  private setLinkName(link: Link, name: string) {
    link.name = name
    link.text = name.toLowerCase().replace(/_/g, ' ')
    this.ctx.font = `500 ${EDGE_FONT_PX}px ${FONT_STACK}`
    link.labelW = this.ctx.measureText(link.text).width
  }

  private rebuildTopology() {
    this.adjacency.clear()
    for (const node of this.nodes) {
      node.degree = 0
      if (!node.leaving) this.adjacency.set(node.id, new Set())
    }
    const pairs = new Map<string, Link[]>()
    for (const link of this.links) {
      if (link.leaving) continue
      link.source.degree++
      link.target.degree++
      this.adjacency.get(link.source.id)?.add(link.target.id)
      this.adjacency.get(link.target.id)?.add(link.source.id)
      const key = link.source.id < link.target.id ? `${link.source.id}|${link.target.id}` : `${link.target.id}|${link.source.id}`
      const group = pairs.get(key)
      if (group) group.push(link)
      else pairs.set(key, [link])
    }
    // Parallel facts between the same two nodes bow apart symmetrically
    // (in the pair's canonical orientation) so each stays visible.
    for (const group of pairs.values()) {
      group.forEach((link, i) => {
        link.curvature = group.length === 1 ? 0 : (i - (group.length - 1) / 2) * 0.32
      })
    }
    this.updateRadii()
  }

  private updateRadii() {
    const base = 3.6 * this.settings.nodeSize
    for (const node of this.nodes) {
      node.radius = base * (1 + Math.min(2.6, 0.38 * Math.sqrt(node.degree)))
    }
  }

  private seedNewNodePositions(firstLoad: boolean) {
    if (firstLoad) return // d3's phyllotaxis seeding gives the initial bloom
    let cx = 0
    let cy = 0
    let count = 0
    for (const node of this.nodes) {
      if (node.x !== undefined && !node.leaving) {
        cx += node.x
        cy += node.y ?? 0
        count++
      }
    }
    if (count > 0) {
      cx /= count
      cy /= count
    }
    for (const node of this.nodes) {
      if (node.x !== undefined || node.leaving) continue
      const memory = this.remembered.get(node.id)
      if (memory) {
        node.x = memory.x
        node.y = memory.y
        node.vx = 0
        node.vy = 0
        continue
      }
      // Spawn beside an already-placed neighbor so the node grows out of
      // its cluster instead of flying in from the origin.
      let anchor: Node | undefined
      for (const id of this.adjacency.get(node.id) ?? []) {
        const candidate = this.nodeById.get(id)
        if (candidate?.x !== undefined) {
          anchor = candidate
          break
        }
      }
      const spread = anchor ? 24 : 160
      node.x = (anchor?.x ?? cx) + (Math.random() - 0.5) * spread
      node.y = (anchor?.y ?? cy) + (Math.random() - 0.5) * spread
      node.vx = 0
      node.vy = 0
    }
  }

  private applyForces() {
    const s = this.settings
    this.forceCharge.strength((n) => -s.repelForce * 22 * (1 + 0.12 * Math.sqrt(n.degree)))
    this.forceLinks
      .distance((l) => s.linkDistance + (l.source.radius + l.target.radius) * 0.8)
      .strength((l) => (s.linkForce * 1.6) / Math.max(1, Math.min(l.source.degree, l.target.degree)))
    this.forceCenterX.strength(s.centerForce * 0.11)
    this.forceCenterY.strength(s.centerForce * 0.11)
    this.forceCollision.radius((n) => n.radius + 3)
  }

  /** Run the layout to rest synchronously (reduced-motion users get a
   * finished layout rather than a moving one). */
  private settleNow() {
    for (let i = 0; i < 300 && this.sim.alpha() > 0.02; i++) this.sim.tick()
    this.sim.alpha(0)
  }

  // ---------------------------------------------------------------------
  // Focus / emphasis targets
  // ---------------------------------------------------------------------

  private updateFocus() {
    for (const node of this.nodes) {
      node.fadeT = 0
      node.emphT = 0
      node.ringT = node.id === this.selectedNodeId ? 1 : 0
    }
    for (const link of this.links) {
      link.fadeT = 0
      link.emphT = link.id === this.selectedLinkId ? 1 : 0
    }

    const hover = this.hover
    let focusNode: string | null = null
    let focusLink: string | null = null
    let set: Set<string> | null = null
    let dim = 1

    if (hover?.kind === 'node') focusNode = hover.id
    else if (hover?.kind === 'link') focusLink = hover.id
    else if (this.highlight) set = this.highlight
    else if (this.focusLinkId) {
      focusLink = this.focusLinkId
      dim = 0.55 // keep the rest of a trace legible as context
    } else if (this.selectedNodeId && this.hasNode(this.selectedNodeId)) {
      focusNode = this.selectedNodeId
      dim = 0.72 // a persistent selection dims more gently than a hover
    } else if (this.selectedLinkId && this.hasLink(this.selectedLinkId)) {
      focusLink = this.selectedLinkId
      dim = 0.72
    }

    if (focusNode) {
      const neighbors = this.adjacency.get(focusNode) ?? new Set<string>()
      for (const node of this.nodes) {
        if (node.id === focusNode) node.emphT = 1
        else if (neighbors.has(node.id)) node.emphT = 0.5
        else node.fadeT = dim
      }
      for (const link of this.links) {
        if (link.source.id === focusNode || link.target.id === focusNode) link.emphT = 1
        else link.fadeT = dim
      }
    } else if (focusLink) {
      const link = this.linkById.get(focusLink)
      for (const node of this.nodes) {
        if (link && (node === link.source || node === link.target)) node.emphT = 0.75
        else node.fadeT = dim
      }
      for (const other of this.links) {
        if (other.id === focusLink) other.emphT = 1
        else other.fadeT = dim
      }
    } else if (set) {
      for (const node of this.nodes) {
        if (set.has(node.id)) node.emphT = 0.5
        else node.fadeT = 1
      }
      for (const link of this.links) {
        const inside = set.has(link.source.id) && set.has(link.target.id)
        if (inside) link.emphT = 0.35
        else link.fadeT = set.has(link.source.id) || set.has(link.target.id) ? 0.7 : 1
      }
    }
  }

  private setHover(target: HoverTarget) {
    const same =
      target === this.hover ||
      (target !== null && this.hover !== null && target.kind === this.hover.kind && target.id === this.hover.id)
    if (same) return
    this.hover = target
    this.canvas.style.cursor = target ? 'pointer' : 'grab'
    this.updateFocus()
    this.callbacks.onHoverChange?.(target)
    this.wake()
  }

  // ---------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------

  private cameraFor(worldX: number, worldY: number, k: number): Camera {
    // Center the point inside the inset-adjusted viewport, not the canvas.
    const { top, right, bottom, left } = this.insets
    const offsetX = (left - right) / 2
    const offsetY = (top - bottom) / 2
    return { x: worldX - offsetX / k, y: worldY - offsetY / k, k }
  }

  private computeFit(ids: Set<string> | null): Camera | null {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of this.nodes) {
      if (node.leaving || node.x === undefined || node.y === undefined) continue
      if (ids && !ids.has(node.id)) continue
      minX = Math.min(minX, node.x - node.radius)
      minY = Math.min(minY, node.y - node.radius)
      maxX = Math.max(maxX, node.x + node.radius)
      maxY = Math.max(maxY, node.y + node.radius)
    }
    if (!Number.isFinite(minX) || this.width === 0) return null
    const pad = Math.min(72, Math.max(28, Math.min(this.width, this.height) * 0.08))
    const availW = Math.max(40, this.width - this.insets.left - this.insets.right - pad * 2)
    const availH = Math.max(40, this.height - this.insets.top - this.insets.bottom - pad * 2 - 18)
    const k = clamp(Math.min(availW / Math.max(1, maxX - minX), availH / Math.max(1, maxY - minY)), K_MIN, FIT_MAX_K)
    return this.cameraFor((minX + maxX) / 2, (minY + maxY) / 2, k)
  }

  private snapCameraToFit(maxK = FIT_MAX_K) {
    const fit = this.computeFit(null)
    if (!fit) return
    const target = fit.k > maxK ? { ...fit, k: maxK } : fit
    this.cam = { ...target }
    this.camTarget = { ...target }
  }

  private startFollow(ids: Set<string> | null, durationMs: number) {
    this.follow = { ids, until: performance.now() + durationMs }
  }

  private flyTo(to: Camera, duration: number) {
    if (this.reducedMotion || duration <= 0) {
      this.cam = { ...to }
      this.camTarget = { ...to }
      this.flight = null
    } else {
      this.flight = { from: { ...this.cam }, to, start: performance.now(), duration }
      this.camTarget = { ...to }
    }
    this.wake()
  }

  private stopCameraMotion() {
    this.velocity = null
    this.flight = null
    this.follow = null
  }

  /** Advance the camera one frame. Returns true while it's still moving. */
  private stepCamera(dt: number, now: number): boolean {
    if (this.flight) {
      const { from, to, start, duration } = this.flight
      const t = clamp((now - start) / duration, 0, 1)
      const e = easeInOutCubic(t)
      this.cam = {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        k: Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e),
      }
      if (t >= 1) this.flight = null
      else return true
    }

    if (this.follow) {
      if (now > this.follow.until && this.sim.alpha() < 0.04) this.follow = null
      else {
        const target = this.computeFit(this.follow.ids)
        if (target) this.camTarget = target
      }
    }

    if (this.velocity) {
      this.cam.x += this.velocity.x * dt
      this.cam.y += this.velocity.y * dt
      this.camTarget = { ...this.cam }
      const decay = Math.exp(-dt / TAU_INERTIA)
      this.velocity.x *= decay
      this.velocity.y *= decay
      if (Math.hypot(this.velocity.x, this.velocity.y) * this.cam.k < 0.015) this.velocity = null
      return true
    }

    const tau = this.reducedMotion ? 0 : this.follow ? TAU_FOLLOW : TAU_ZOOM
    const { x, y, k } = this.camTarget
    const logK = approach(Math.log(this.cam.k), Math.log(k), dt, tau)
    this.cam = {
      x: approach(this.cam.x, x, dt, tau),
      y: approach(this.cam.y, y, dt, tau),
      k: Math.abs(logK - Math.log(k)) < 0.0005 ? k : Math.exp(logK),
    }
    const moving =
      Math.abs(this.cam.x - x) * this.cam.k > 0.05 ||
      Math.abs(this.cam.y - y) * this.cam.k > 0.05 ||
      Math.abs(this.cam.k - k) / k > 0.0005
    if (!moving) this.cam = { ...this.camTarget }
    return moving || this.follow !== null
  }

  private screenToWorld(sx: number, sy: number, cam: Camera = this.cam): { x: number; y: number } {
    return { x: (sx - this.width / 2) / cam.k + cam.x, y: (sy - this.height / 2) / cam.k + cam.y }
  }

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------

  private localPoint(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private nodeAt(x: number, y: number): Node | null {
    let best: Node | null = null
    let bestScore = Infinity
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i]
      if (node.leaving) continue
      const d = Math.hypot(node.sx - x, node.sy - y)
      const score = d - node.sr
      if (d <= node.sr + 5 && score < bestScore) {
        best = node
        bestScore = score
      }
    }
    return best
  }

  private linkAt(x: number, y: number): Link | null {
    let best: Link | null = null
    let bestD = 5
    for (const link of this.links) {
      if (link.leaving || link.appear < 0.5 || link.fade > 0.9) continue
      const a = link.source
      const b = link.target
      let d: number
      if (a === b) {
        const r = Math.max(6, a.sr * 0.9)
        d = Math.abs(Math.hypot(x - a.sx, y - (a.sy - a.sr - r)) - r)
      } else if (link.curvature === 0) {
        d = distToSegment(x, y, a.sx, a.sy, b.sx, b.sy)
      } else {
        const [cx, cy] = this.controlPoint(link)
        d = Infinity
        let px = a.sx
        let py = a.sy
        for (let i = 1; i <= 12; i++) {
          const t = i / 12
          const u = 1 - t
          const qx = u * u * a.sx + 2 * u * t * cx + t * t * b.sx
          const qy = u * u * a.sy + 2 * u * t * cy + t * t * b.sy
          d = Math.min(d, distToSegment(x, y, px, py, qx, qy))
          px = qx
          py = qy
        }
      }
      // Ignore hits buried inside an endpoint's circle -- that's the node.
      if (d < bestD && Math.hypot(x - a.sx, y - a.sy) > a.sr && Math.hypot(x - b.sx, y - b.sy) > b.sr) {
        best = link
        bestD = d
      }
    }
    return best
  }

  private hitTest(x: number, y: number): HoverTarget {
    const node = this.nodeAt(x, y)
    if (node) return { kind: 'node', id: node.id }
    const link = this.linkAt(x, y)
    return link ? { kind: 'link', id: link.id } : null
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const p = this.localPoint(e)
    this.pointers.set(e.pointerId, p)
    this.canvas.setPointerCapture?.(e.pointerId)
    this.velocity = null

    if (this.pointers.size === 2) {
      this.releaseDraggedNode()
      const [a, b] = [...this.pointers.values()]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const world = this.screenToWorld(mid.x, mid.y)
      this.stopCameraMotion()
      this.gesture = {
        kind: 'pinch',
        startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        startK: this.cam.k,
        worldX: world.x,
        worldY: world.y,
      }
      return
    }
    if (this.pointers.size > 2) return

    const node = this.nodeAt(p.x, p.y)
    if (node) {
      this.gesture = { kind: 'press-node', node, pointerId: e.pointerId, startX: p.x, startY: p.y }
    } else {
      this.gesture = { kind: 'press-bg', pointerId: e.pointerId, startX: p.x, startY: p.y, link: this.linkAt(p.x, p.y) }
    }
  }

  private readonly onPointerMove = (e: PointerEvent) => {
    const p = this.localPoint(e)
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p)
    const g = this.gesture

    if (e.pointerType !== 'touch') this.pointerPos = p
    switch (g.kind) {
      case 'none':
        if (e.pointerType !== 'touch') this.setHover(this.hitTest(p.x, p.y))
        return
      case 'press-node': {
        if (e.pointerId !== g.pointerId) return
        if (Math.hypot(p.x - g.startX, p.y - g.startY) < DRAG_THRESHOLD_PX) return
        const world = this.screenToWorld(p.x, p.y)
        this.gesture = {
          kind: 'drag-node',
          node: g.node,
          pointerId: g.pointerId,
          offsetX: (g.node.x ?? 0) - world.x,
          offsetY: (g.node.y ?? 0) - world.y,
        }
        g.node.fx = g.node.x
        g.node.fy = g.node.y
        this.sim.alphaTarget(0.25)
        this.sim.alpha(Math.max(this.sim.alpha(), 0.12))
        this.follow = null
        this.canvas.style.cursor = 'grabbing'
        this.setHover({ kind: 'node', id: g.node.id })
        this.wake()
        return
      }
      case 'drag-node': {
        if (e.pointerId !== g.pointerId) return
        const world = this.screenToWorld(p.x, p.y)
        g.node.fx = world.x + g.offsetX
        g.node.fy = world.y + g.offsetY
        this.wake()
        return
      }
      case 'press-bg': {
        if (e.pointerId !== g.pointerId) return
        if (Math.hypot(p.x - g.startX, p.y - g.startY) < DRAG_THRESHOLD_PX) return
        this.stopCameraMotion()
        this.setHover(null)
        this.canvas.style.cursor = 'grabbing'
        this.gesture = { kind: 'pan', pointerId: g.pointerId, lastX: p.x, lastY: p.y, samples: [] }
        this.panBy(p.x - g.startX, p.y - g.startY)
        return
      }
      case 'pan': {
        if (e.pointerId !== g.pointerId) return
        this.panBy(p.x - g.lastX, p.y - g.lastY)
        g.lastX = p.x
        g.lastY = p.y
        const now = performance.now()
        g.samples.push({ t: now, x: p.x, y: p.y })
        while (g.samples.length > 2 && now - g.samples[0].t > 90) g.samples.shift()
        return
      }
      case 'pinch': {
        if (this.pointers.size < 2) return
        const [a, b] = [...this.pointers.values()]
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const k = clamp((g.startK * dist) / g.startDist, K_MIN, K_MAX)
        // Keep the world point that started under the fingers under them.
        this.cam = {
          k,
          x: g.worldX - (mid.x - this.width / 2) / k,
          y: g.worldY - (mid.y - this.height / 2) / k,
        }
        this.camTarget = { ...this.cam }
        this.wake()
        return
      }
    }
  }

  private panBy(dx: number, dy: number) {
    this.cam.x -= dx / this.cam.k
    this.cam.y -= dy / this.cam.k
    this.camTarget = { ...this.cam }
    this.wake()
  }

  private releaseDraggedNode() {
    const g = this.gesture
    if (g.kind === 'drag-node') {
      g.node.fx = null
      g.node.fy = null
      this.sim.alphaTarget(0)
    }
  }

  private readonly onPointerUp = (e: PointerEvent) => {
    const g = this.gesture
    const p = this.localPoint(e)
    this.pointers.delete(e.pointerId)
    this.canvas.releasePointerCapture?.(e.pointerId)

    if (g.kind === 'pinch') {
      if (this.pointers.size === 0) this.gesture = { kind: 'none' }
      return
    }
    if ('pointerId' in g && g.pointerId !== e.pointerId) return

    switch (g.kind) {
      case 'press-node':
        this.callbacks.onNodeClick?.(g.node.id)
        break
      case 'drag-node':
        this.releaseDraggedNode()
        break
      case 'press-bg':
        if (g.link) this.callbacks.onLinkClick?.(g.link.id)
        else this.callbacks.onBackgroundClick?.()
        break
      case 'pan': {
        // Fling: carry the release velocity into an eased glide.
        const samples = g.samples
        if (!this.reducedMotion && samples.length >= 2) {
          const first = samples[0]
          const last = samples[samples.length - 1]
          const dt = last.t - first.t
          if (dt > 0 && performance.now() - last.t < 60) {
            const vx = -(last.x - first.x) / dt / this.cam.k
            const vy = -(last.y - first.y) / dt / this.cam.k
            if (Math.hypot(vx, vy) * this.cam.k > 0.08) this.velocity = { x: vx, y: vy }
          }
        }
        break
      }
    }
    this.gesture = { kind: 'none' }
    if (e.pointerType !== 'touch') this.setHover(this.hitTest(p.x, p.y))
    this.canvas.style.cursor = this.hover ? 'pointer' : 'grab'
    this.wake()
  }

  private readonly onPointerCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId)
    this.releaseDraggedNode()
    this.gesture = { kind: 'none' }
    this.canvas.style.cursor = 'grab'
  }

  private readonly onPointerLeave = () => {
    this.pointerPos = null
    if (this.gesture.kind === 'none') this.setHover(null)
  }

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.velocity = null
    this.flight = null
    this.follow = null
    const p = this.localPoint(e)
    let delta = e.deltaY
    if (e.deltaMode === 1) delta *= 16
    else if (e.deltaMode === 2) delta *= this.height
    // Trackpad pinch arrives as ctrl+wheel with small deltas.
    const sensitivity = e.ctrlKey ? 0.0085 : 0.0016
    const factor = Math.exp(-clamp(delta, -120, 120) * sensitivity)
    // Anchor on the *target* camera so rapid wheel ticks compose smoothly.
    const anchor = this.screenToWorld(p.x, p.y, this.camTarget)
    const k = clamp(this.camTarget.k * factor, K_MIN, K_MAX)
    this.camTarget = {
      k,
      x: anchor.x - (p.x - this.width / 2) / k,
      y: anchor.y - (p.y - this.height / 2) / k,
    }
    this.wake()
  }

  private readonly onDoubleClick = (e: MouseEvent) => {
    const p = this.localPoint(e)
    const node = this.nodeAt(p.x, p.y)
    if (node) this.callbacks.onNodeDoubleClick?.(node.id)
  }

  // ---------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------

  private resize() {
    const rect = this.container.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    if (width === this.width && height === this.height && dpr === this.dpr) return
    const wasEmpty = this.width <= 1
    this.width = width
    this.height = height
    this.dpr = dpr
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    if (wasEmpty && this.follow) this.snapCameraToFit()
    this.wake()
  }

  private wake() {
    if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame(this.frame)
  }

  private readonly frame = (time: number) => {
    this.raf = 0
    if (this.destroyed) return
    const dt = this.lastTime ? clamp(time - this.lastTime, 1, 64) : 16
    this.lastTime = time

    let active = false
    const dragging = this.gesture.kind === 'drag-node'
    if (this.sim.alpha() >= this.sim.alphaMin() || dragging) {
      this.sim.tick()
      active = true
    }
    const cameraMoving = this.stepCamera(dt, time)
    if (cameraMoving) active = true
    if (this.stepTransitions(dt)) active = true
    if (this.draw(dt)) active = true
    // Things slid under a still cursor: hover follows what's under it now
    // (including one last check on the frame the camera comes to rest).
    if ((cameraMoving || this.cameraWasMoving) && this.pointerPos && this.gesture.kind === 'none') {
      this.setHover(this.hitTest(this.pointerPos.x, this.pointerPos.y))
    }
    this.cameraWasMoving = cameraMoving

    if (active) this.raf = requestAnimationFrame(this.frame)
    else this.lastTime = 0
  }

  private stepTransitions(dt: number): boolean {
    const tauFade = this.reducedMotion ? 0 : TAU_FADE
    const tauAppear = this.reducedMotion ? 0 : TAU_APPEAR
    let active = false
    let pruned = false

    for (const node of this.nodes) {
      const appearT = node.leaving ? 0 : 1
      node.appear = approach(node.appear, appearT, dt, node.leaving ? tauAppear * 0.6 : tauAppear)
      node.fade = approach(node.fade, node.fadeT, dt, tauFade)
      node.emph = approach(node.emph, node.emphT, dt, tauFade)
      node.ring = approach(node.ring, node.ringT, dt, tauFade)
      if (node.appear !== appearT || node.fade !== node.fadeT || node.emph !== node.emphT || node.ring !== node.ringT) {
        active = true
      }
      if (node.leaving && node.appear <= 0.01) pruned = true
    }
    for (const link of this.links) {
      const appearT = link.leaving ? 0 : 1
      link.appear = approach(link.appear, appearT, dt, link.leaving ? tauAppear * 0.6 : tauAppear)
      link.fade = approach(link.fade, link.fadeT, dt, tauFade)
      link.emph = approach(link.emph, link.emphT, dt, tauFade)
      if (link.appear !== appearT || link.fade !== link.fadeT || link.emph !== link.emphT) active = true
      if (link.leaving && link.appear <= 0.01) pruned = true
    }

    if (pruned) {
      for (const node of this.nodes) {
        if (node.leaving && node.appear <= 0.01 && node.x !== undefined && node.y !== undefined) {
          this.remembered.delete(node.id) // re-insert to keep Map order = recency
          this.remembered.set(node.id, { x: node.x, y: node.y })
        }
      }
      while (this.remembered.size > 5000) this.remembered.delete(this.remembered.keys().next().value!)
      this.nodes = this.nodes.filter((n) => !(n.leaving && n.appear <= 0.01))
      this.links = this.links.filter((l) => !(l.leaving && l.appear <= 0.01))
      for (const [id, node] of this.nodeById) if (node.leaving && node.appear <= 0.01) this.nodeById.delete(id)
      for (const [id, link] of this.linkById) if (link.leaving && link.appear <= 0.01) this.linkById.delete(id)
    }
    return active
  }

  // ---------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------

  private controlPoint(link: Link): [number, number] {
    const a = link.source
    const b = link.target
    // Canonical orientation so A->B and B->A in one pair bow to opposite
    // sides consistently.
    const [p, q] = a.id < b.id ? [a, b] : [b, a]
    const mx = (a.sx + b.sx) / 2
    const my = (a.sy + b.sy) / 2
    const dx = q.sx - p.sx
    const dy = q.sy - p.sy
    return [mx - dy * link.curvature, my + dx * link.curvature]
  }

  private linkAlpha(link: Link): number {
    const s = this.settings
    let alpha = s.confidenceOpacity ? (link.confidence === null ? 0.42 : 0.2 + 0.62 * link.confidence) : 0.5
    alpha *= 1 - 0.9 * link.fade
    alpha += (0.95 - alpha) * link.emph
    return alpha * clamp(link.appear, 0, 1)
  }

  /** Draw one frame. Returns true while labels are still fading. */
  private draw(dt: number): boolean {
    const { ctx, width: w, height: h, dpr, cam, theme, settings } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (this.nodes.length === 0) return false

    const k = cam.k
    const radiusScale = Math.pow(k, 0.82)
    const halfW = w / 2
    const halfH = h / 2
    for (const node of this.nodes) {
      node.sx = ((node.x ?? 0) - cam.x) * k + halfW
      node.sy = ((node.y ?? 0) - cam.y) * k + halfH
      const grow = this.reducedMotion ? 1 : node.leaving ? node.appear : easeOutBack(node.appear)
      node.sr = Math.max(1.6, node.radius * radiusScale) * Math.max(0, grow)
    }

    const margin = 40
    const offscreen = (x: number, y: number) => x < -margin || y < -margin || x > w + margin || y > h + margin

    // --- links ---------------------------------------------------------
    const baseWidth = settings.linkThickness * clamp(Math.sqrt(k), 0.55, 1.5)
    const arrowLen = (3.2 + 1.6 * settings.linkThickness) * clamp(Math.sqrt(k), 0.75, 1.35)
    ctx.lineCap = 'round'
    for (let pass = 0; pass < 2; pass++) {
      for (const link of this.links) {
        const emphasized = link.emph > 0.01
        if ((pass === 1) !== emphasized) continue
        const a = link.source
        const b = link.target
        if (offscreen(a.sx, a.sy) && offscreen(b.sx, b.sy)) {
          const minX = Math.min(a.sx, b.sx)
          const maxX = Math.max(a.sx, b.sx)
          const minY = Math.min(a.sy, b.sy)
          const maxY = Math.max(a.sy, b.sy)
          if (maxX < -margin || minX > w + margin || maxY < -margin || minY > h + margin) continue
        }
        const alpha = this.linkAlpha(link) * Math.min(a.appear, b.appear, 1)
        if (alpha < 0.01) continue

        const color = mix(theme.link, theme.accent, link.emph)
        ctx.globalAlpha = alpha
        ctx.strokeStyle = color
        ctx.lineWidth = baseWidth * (1 + 0.7 * link.emph)
        ctx.setLineDash(settings.confidenceOpacity && link.confidence === null ? [4, 3] : [])

        ctx.beginPath()
        if (a === b) {
          const r = Math.max(6, a.sr * 0.9)
          ctx.arc(a.sx, a.sy - a.sr - r, r, 0, Math.PI * 2)
          ctx.stroke()
          continue
        }
        ctx.moveTo(a.sx, a.sy)
        let tx: number
        let ty: number
        if (link.curvature === 0) {
          ctx.lineTo(b.sx, b.sy)
          tx = b.sx - a.sx
          ty = b.sy - a.sy
        } else {
          const [cx, cy] = this.controlPoint(link)
          ctx.quadraticCurveTo(cx, cy, b.sx, b.sy)
          tx = b.sx - cx
          ty = b.sy - cy
        }
        ctx.stroke()

        // Arrowhead, sitting just outside the target's circle.
        if (settings.showArrows && k > 0.3) {
          const len = Math.hypot(tx, ty)
          const dist = Math.hypot(b.sx - a.sx, b.sy - a.sy)
          if (len > 0 && dist > a.sr + b.sr + arrowLen * 2) {
            const ux = tx / len
            const uy = ty / len
            const tipX = b.sx - ux * (b.sr + 1.5)
            const tipY = b.sy - uy * (b.sr + 1.5)
            const size = arrowLen * (1 + 0.25 * link.emph)
            ctx.setLineDash([])
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.moveTo(tipX, tipY)
            ctx.lineTo(tipX - ux * size - uy * size * 0.55, tipY - uy * size + ux * size * 0.55)
            ctx.lineTo(tipX - ux * size + uy * size * 0.55, tipY - uy * size - ux * size * 0.55)
            ctx.closePath()
            ctx.fill()
          }
        }
      }
    }
    ctx.setLineDash([])

    // --- nodes ---------------------------------------------------------
    for (let pass = 0; pass < 2; pass++) {
      for (const node of this.nodes) {
        const emphasized = node.emph > 0.01 || node.ring > 0.01
        if ((pass === 1) !== emphasized) continue
        if (offscreen(node.sx, node.sy) || node.sr <= 0) continue
        const alpha = clamp(node.appear, 0, 1) * (1 - 0.84 * node.fade)
        if (alpha < 0.01) continue
        const focus = Math.max(node.ring, smoothstep(0.5, 1, node.emph))

        if (focus > 0.01) {
          const glowR = node.sr + 5 + node.sr * 0.6
          const glow = ctx.createRadialGradient(node.sx, node.sy, node.sr * 0.6, node.sx, node.sy, glowR)
          const [ar, ag, ab] = toRgb(theme.accent)
          glow.addColorStop(0, theme.accent)
          glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`)
          ctx.globalAlpha = 0.32 * focus * alpha
          ctx.fillStyle = glow
          ctx.beginPath()
          ctx.arc(node.sx, node.sy, glowR, 0, Math.PI * 2)
          ctx.fill()
        }

        const base = settings.colorByType ? node.color : theme.node
        ctx.globalAlpha = alpha
        ctx.fillStyle = settings.colorByType ? base : mix(base, theme.accent, Math.max(focus, node.emph * 0.6))
        ctx.beginPath()
        ctx.arc(node.sx, node.sy, node.sr, 0, Math.PI * 2)
        ctx.fill()

        if (node.ring > 0.01) {
          ctx.globalAlpha = alpha * node.ring
          ctx.strokeStyle = theme.accent
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(node.sx, node.sy, node.sr + 3.5, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
    }

    // --- labels --------------------------------------------------------
    const labelsActive = this.drawLabels(dt)
    ctx.globalAlpha = 1
    return labelsActive
  }

  private drawLabels(dt: number): boolean {
    const { ctx, width: w, height: h, cam, theme, settings } = this
    const k = cam.k
    const grid = this.labelGrid
    grid.clear()
    const tau = this.reducedMotion ? 0 : TAU_LABEL
    // Text-fade threshold slider (0..1) -> zoom level where names appear.
    const threshold = Math.exp(Math.log(0.2) + (Math.log(3.2) - Math.log(0.2)) * settings.labelThreshold)
    const fontPx = clamp(11.5 + (k - 1) * 1.1, 11.5, 13.5)
    const scale = fontPx / LABEL_FONT_PX

    type Candidate = { node: Node; vis: number; priority: number }
    const candidates: Candidate[] = []
    for (const node of this.nodes) {
      node.labelT = 0
      if (node.leaving || node.sr <= 0) continue
      if (node.sx < -120 || node.sx > w + 120 || node.sy < -40 || node.sy > h + 40) continue
      const hubBoost = 1 + 0.32 * Math.sqrt(node.degree)
      let vis = smoothstep(0.82, 1.18, (k * hubBoost) / threshold)
      if (node.emphT > 0 || node.ringT > 0) vis = 1
      // Strong dims (hover, selection) hide names; the gentler trace-step
      // dim keeps them as context.
      if (node.fadeT > 0.6) vis = 0
      if (vis <= 0.01) continue
      const priority = node.ringT * 4 + node.emphT * 3 + vis + Math.sqrt(node.degree) * 0.08
      candidates.push({ node, vis, priority })
    }
    candidates.sort((a, b) => b.priority - a.priority)

    for (const { node, vis } of candidates) {
      const bold = node.emphT >= 1 || node.ringT > 0
      const textW = (bold ? node.labelWBold : node.labelW) * scale
      const x = node.sx - textW / 2 - 3
      const y = node.sy + node.sr + 2
      if (grid.tryPlace(x, y, textW + 6, fontPx + 4)) node.labelT = vis
    }

    let active = false

    // Relation names: always on emphasized links, on every link up close.
    const edgeLabels: { link: Link; alpha: number; x: number; y: number; angle: number }[] = []
    if (settings.edgeLabels) {
      const closeUp = settings.edgeLabelsAlways ? 1 : smoothstep(1.9, 2.6, k)
      for (const link of this.links) {
        if (link.leaving || link.source === link.target) continue
        const target = Math.max(link.emph > 0.3 ? link.emph : 0, closeUp * (1 - link.fade))
        link.label = approach(link.label, target, dt, tau)
        if (link.label !== target) active = true
        if (link.label < 0.02) continue
        const a = link.source
        const b = link.target
        let mx: number
        let my: number
        let tx: number
        let ty: number
        if (link.curvature === 0) {
          mx = (a.sx + b.sx) / 2
          my = (a.sy + b.sy) / 2
          tx = b.sx - a.sx
          ty = b.sy - a.sy
        } else {
          const [cx, cy] = this.controlPoint(link)
          mx = 0.25 * a.sx + 0.5 * cx + 0.25 * b.sx
          my = 0.25 * a.sy + 0.5 * cy + 0.25 * b.sy
          tx = b.sx - a.sx
          ty = b.sy - a.sy
        }
        if (mx < -60 || mx > w + 60 || my < -20 || my > h + 20) continue
        const len = Math.hypot(tx, ty)
        if (len < link.labelW + a.sr + b.sr + 16) continue
        let angle = Math.atan2(ty, tx)
        if (angle > Math.PI / 2) angle -= Math.PI
        else if (angle < -Math.PI / 2) angle += Math.PI
        const bw = Math.abs(link.labelW * Math.cos(angle)) + Math.abs(14 * Math.sin(angle))
        const bh = Math.abs(link.labelW * Math.sin(angle)) + Math.abs(14 * Math.cos(angle))
        if (!grid.tryPlace(mx - bw / 2, my - bh / 2, bw, bh)) continue
        edgeLabels.push({ link, alpha: link.label, x: mx, y: my, angle })
      }
    }

    ctx.lineJoin = 'round'
    ctx.textAlign = 'center'

    if (edgeLabels.length > 0) {
      ctx.font = `500 ${EDGE_FONT_PX}px ${FONT_STACK}`
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 3
      ctx.strokeStyle = theme.labelHalo
      for (const { link, alpha, x, y, angle } of edgeLabels) {
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(angle)
        ctx.globalAlpha = alpha
        ctx.strokeText(link.text, 0, 0)
        ctx.fillStyle = mix(theme.labelMuted, theme.accent, link.emph)
        ctx.fillText(link.text, 0, 0)
        ctx.restore()
      }
    }

    ctx.textBaseline = 'top'
    ctx.lineWidth = 3.5
    ctx.strokeStyle = theme.labelHalo
    for (const weight of [500, 600]) {
      ctx.font = `${weight} ${fontPx}px ${FONT_STACK}`
      for (const node of this.nodes) {
        const bold = node.emphT >= 1 || node.ringT > 0
        if ((weight === 600) !== bold) continue
        node.label = approach(node.label, node.labelT, dt, tau)
        if (node.label !== node.labelT) active = true
        if (node.label < 0.02 || node.sr <= 0) continue
        const alpha = node.label * clamp(node.appear, 0, 1) * (1 - 0.84 * node.fade)
        if (alpha < 0.02) continue
        const y = node.sy + node.sr + 3
        ctx.globalAlpha = alpha
        ctx.strokeText(node.labelText, node.sx, y)
        ctx.fillStyle = bold || node.emph > 0.3 ? theme.label : mix(theme.labelMuted, theme.label, 0.55)
        ctx.fillText(node.labelText, node.sx, y)
      }
    }
    return active
  }
}
