import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
import {
  LocalCloud,
} from './localCloud'
import {
  type ExportKind,
  type Health,
  type Meta,
} from './types'
import { LiveSlicer, type PreviewFrame } from './liveSlice'
import {
  applyThemeClass,
  defaultAppearance,
  loadAppearance,
  saveAppearance,
  THEME_DEFAULTS,
  type Appearance,
  type ThemeId,
} from './appearance'
import {
  alignToContour,
  applyDrawingRatios,
  archGeometry,
  clampHorseshoe,
  horseshoeHeight,
  horseshoePolyline,
  loadHorseshoe,
  overbreakStats,
  polarSamples,
  polygonArea,
  saveHorseshoe,
  type HorseshoeParams,
  type PolarSample,
} from './horseshoe'

const THICK_MIN = 0.05
const THICK_MAX = 1
const DEFAULT_THICKNESS = 0.2
const DEFAULT_BINS = 180
const DEFAULT_SMOOTH = 9
const INSET_SPAN_MIN = 0.2
const INSET_SPAN_MAX = 15
/** A drag ending closer than this to the click that follows still counts as a click. */
const INSET_DRAG_SLOP_MS = 350
const INSET_SIZE_MIN = 140
const INSET_SIZE_MAX = 1200
const INSET_MARGIN = 8
const INSET_BOX_KEY = 'tunnel-inset-box-v1'

/** null x/y keeps the CSS default corner until the box is dragged for the first time. */
interface InsetBoxState {
  x: number | null
  y: number | null
  size: number
}

function defaultInsetSize(): number {
  return window.innerWidth < 900 ? 156 : 200
}

function clampBoxToStage(
  x: number,
  y: number,
  width: number,
  height: number,
  stageW: number,
  stageH: number,
): { x: number; y: number } {
  return {
    x: clamp(x, INSET_MARGIN, Math.max(INSET_MARGIN, stageW - width - INSET_MARGIN)),
    y: clamp(y, INSET_MARGIN, Math.max(INSET_MARGIN, stageH - height - INSET_MARGIN)),
  }
}

function loadInsetBox(): InsetBoxState {
  const fallback: InsetBoxState = { x: null, y: null, size: defaultInsetSize() }
  try {
    const raw = localStorage.getItem(INSET_BOX_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<InsetBoxState>
    const size = Number(parsed.size)
    const coord = (value: unknown): number | null =>
      value === null || value === undefined || !Number.isFinite(Number(value))
        ? null
        : Number(value)
    return {
      x: coord(parsed.x),
      y: coord(parsed.y),
      size: Number.isFinite(size) ? clamp(size, INSET_SIZE_MIN, INSET_SIZE_MAX) : fallback.size,
    }
  } catch {
    return fallback
  }
}

function saveInsetBox(box: InsetBoxState): void {
  localStorage.setItem(INSET_BOX_KEY, JSON.stringify(box))
}

const METHOD_HINT: Record<string, string> = {
  legacy: '极角包络',
  statistical: '统计滤波',
  radius: '半径滤波',
  hampel: '圆周去突刺',
  robust: '组合稳健',
  spline: '周期样条',
}

const EXPORT_OPTIONS: { id: ExportKind; label: string }[] = [
  { id: 'section2d', label: '二维断面' },
  { id: 'section3d', label: '三维断面' },
  { id: 'tunnel3d', label: '隧道总览' },
  { id: 'compare', label: '算法对比' },
  { id: 'overbreak', label: '超欠挖对比' },
  { id: 'areaDepth', label: '桩号–面积' },
  { id: 'volumeDepth', label: '桩号–体积' },
  { id: 'gallery', label: '多断面轮廓' },
  { id: 'stack', label: '轮廓叠置' },
]

interface HudState {
  s: number
  pointCount: number
  coverage: number
  radius: number | null
  maxOver: number | null
  meanOver: number | null
  maxUnder: number | null
  meanUnder: number | null
  overArea: number | null
  underArea: number | null
}

interface OverlayState {
  slab: boolean
  contour: boolean
  fit: boolean
  horseshoe: boolean
  inset: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function oddWindow(value: number): number {
  const rounded = Math.round(value)
  const bounded = Math.max(5, rounded)
  return bounded % 2 === 0 ? bounded + 1 : bounded
}

function formatMeters(value: number, digits = 2): string {
  return `${value.toFixed(digits)} m`
}

function defaultStation(meta: Meta): number {
  const lo = meta.dense_s_min ?? meta.s_min
  const hi = meta.dense_s_max ?? meta.s_max
  return lo + (hi - lo) * 0.55
}

function defaultWorkingRange(meta: Meta): { lo: number; hi: number } {
  return {
    lo: meta.dense_s_min ?? meta.s_min,
    hi: meta.dense_s_max ?? meta.s_max,
  }
}

function rangeMinWidth(meta: Meta): number {
  return Math.min(0.5, Math.max(0.05, (meta.s_max - meta.s_min) * 0.02))
}

function insetView(slice: PreviewFrame | null, uvExtent: number): { u0: number; v0: number; span: number } {
  const fallback = Math.max(0.8, uvExtent * 0.42)
  if (!slice) return { u0: 0, v0: 0, span: fallback }
  if (slice.fit && slice.fit.radius > 0) {
    let reach = slice.fit.radius
    for (const p of slice.contour_uv) {
      reach = Math.max(reach, Math.hypot(p[0] - slice.fit.center_x, p[1] - slice.fit.center_y))
    }
    return {
      u0: slice.fit.center_x,
      v0: slice.fit.center_y,
      span: Math.max(0.6, reach * 1.18),
    }
  }
  const pts = slice.contour_uv.length ? slice.contour_uv : slice.slab
  if (!pts.length) return { u0: 0, v0: 0, span: fallback }
  let su = 0
  let sv = 0
  for (const p of pts) {
    su += p[0]
    sv += p[1]
  }
  const u0 = su / pts.length
  const v0 = sv / pts.length
  let reach = 0
  for (const p of pts) reach = Math.max(reach, Math.hypot(p[0] - u0, p[1] - v0))
  return { u0, v0, span: Math.max(0.6, reach * 1.18) }
}

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = Math.max(1e-6, max - min)
  const raw = span / Math.max(1, count - 1)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag
  const start = Math.ceil((min - 1e-12) / step) * step
  const ticks: number[] = []
  for (let value = start; value <= max + 1e-9; value += step) ticks.push(value)
  return ticks.length ? ticks : [0]
}

function formatTick(value: number, step: number): string {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2
  const rounded = Number(value.toFixed(digits))
  if (Math.abs(rounded) < 10 ** -(digits + 1)) return '0'
  return rounded.toFixed(digits)
}

interface InsetViewBox {
  u0: number
  v0: number
  span: number
}

interface InsetLayout {
  scale: number
  cx: number
  cy: number
}

/** Keep the canvas backing store in step with its on-screen size so text stays crisp. */
function syncCanvasBacking(canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect()
  const cssSize = rect.width > 0 ? rect.width : canvas.clientWidth
  if (!(cssSize > 0)) return
  const target = Math.round(clamp(cssSize * (window.devicePixelRatio || 1), 200, 1600))
  if (canvas.width !== target || canvas.height !== target) {
    canvas.width = target
    canvas.height = target
  }
}

/** Plot-box layout shared by the drawing code and the zoom/pan handlers. */
function insetLayout(canvas: HTMLCanvasElement, view: InsetViewBox): InsetLayout {
  const width = canvas.width
  const height = canvas.height
  const unit = width / 360
  const left = 44 * unit
  const right = width - 14 * unit
  const top = 28 * unit
  const bottom = height - 36 * unit
  return {
    scale: Math.min((right - left) / (view.span * 2), (bottom - top) / (view.span * 2)),
    cx: (left + right) * 0.5,
    cy: (top + bottom) * 0.5,
  }
}

function drawUvInset(
  canvas: HTMLCanvasElement,
  slice: PreviewFrame | null,
  look: Appearance,
  view: InsetViewBox,
  design?: { poly: number[][]; polar: PolarSample[]; show: boolean },
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const width = canvas.width
  const height = canvas.height
  const unit = width / 360
  const left = 44 * unit
  const right = width - 14 * unit
  const top = 28 * unit
  const bottom = height - 36 * unit
  const { scale, cx, cy } = insetLayout(canvas, view)
  const xOf = (u: number) => cx + (u - view.u0) * scale
  const yOf = (v: number) => cy - (v - view.v0) * scale
  const tickCount = width >= 540 ? 7 : 5
  const uTicks = niceTicks(view.u0 - view.span, view.u0 + view.span, tickCount)
  const vTicks = niceTicks(view.v0 - view.span, view.v0 + view.span, tickCount)
  const uStep = uTicks.length > 1 ? uTicks[1] - uTicks[0] : 1
  const vStep = vTicks.length > 1 ? vTicks[1] - vTicks[0] : 1

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.beginPath()
  ctx.rect(left, top, right - left, bottom - top)
  ctx.clip()

  ctx.strokeStyle = 'rgba(0,0,0,0.12)'
  ctx.lineWidth = unit
  ctx.setLineDash([])
  for (const tick of uTicks) {
    const x = xOf(tick)
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.stroke()
  }
  for (const tick of vTicks) {
    const y = yOf(tick)
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()
  }

  if (slice?.slab.length) {
    ctx.fillStyle = look.slice
    ctx.globalAlpha = 0.55
    const dot = Math.max(1.2, 1.8 * unit)
    for (let i = 0; i < slice.slab.length; i += 1) {
      const p = slice.slab[i]
      ctx.fillRect(xOf(p[0]) - dot * 0.5, yOf(p[1]) - dot * 0.5, dot, dot)
    }
    ctx.globalAlpha = 1
  }

  if (slice?.fit) {
    ctx.strokeStyle = look.fit
    ctx.lineWidth = 1.35 * unit
    ctx.setLineDash([5 * unit, 3.5 * unit])
    ctx.beginPath()
    ctx.arc(
      xOf(slice.fit.center_x),
      yOf(slice.fit.center_y),
      slice.fit.radius * scale,
      0,
      Math.PI * 2,
    )
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (slice && slice.contour_uv.length > 1) {
    ctx.strokeStyle = look.contour
    ctx.lineWidth = 1.7 * unit
    ctx.beginPath()
    ctx.moveTo(xOf(slice.contour_uv[0][0]), yOf(slice.contour_uv[0][1]))
    for (let i = 1; i < slice.contour_uv.length; i += 1) {
      ctx.lineTo(xOf(slice.contour_uv[i][0]), yOf(slice.contour_uv[i][1]))
    }
    ctx.closePath()
    ctx.stroke()
  }

  if (design?.show && design.poly.length > 1) {
    ctx.strokeStyle = look.design
    ctx.lineWidth = 1.55 * unit
    ctx.setLineDash([6 * unit, 4 * unit])
    ctx.beginPath()
    ctx.moveTo(xOf(design.poly[0][0]), yOf(design.poly[0][1]))
    for (let i = 1; i < design.poly.length; i += 1) {
      ctx.lineTo(xOf(design.poly[i][0]), yOf(design.poly[i][1]))
    }
    ctx.stroke()
    ctx.setLineDash([])
    if (width >= 540 && design.polar.length) {
      ctx.font = `${9 * unit}px "IBM Plex Sans", "Noto Sans SC", sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      const step = Math.max(1, Math.round(design.polar.length / 16))
      for (let i = 0; i < design.polar.length; i += step) {
        const sample = design.polar[i]
        ctx.fillStyle = sample.delta >= 0 ? '#15803d' : '#c2410c'
        ctx.fillText(`${sample.delta >= 0 ? '+' : ''}${sample.delta.toFixed(3)}`, xOf(sample.u) + 3 * unit, yOf(sample.v) - 2 * unit)
      }
    }
  }
  ctx.restore()

  ctx.strokeStyle = '#333333'
  ctx.lineWidth = 1.15 * unit
  ctx.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1)

  ctx.fillStyle = '#222222'
  ctx.strokeStyle = '#333333'
  ctx.font = `${11 * unit}px "IBM Plex Sans", "Noto Sans SC", sans-serif`
  ctx.textBaseline = 'middle'
  for (const tick of uTicks) {
    const x = xOf(tick)
    if (x < left - 1 || x > right + 1) continue
    ctx.beginPath()
    ctx.moveTo(x, bottom)
    ctx.lineTo(x, bottom + 5 * unit)
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.fillText(formatTick(tick, uStep), x, bottom + 14 * unit)
  }
  for (const tick of vTicks) {
    const y = yOf(tick)
    if (y < top - 1 || y > bottom + 1) continue
    ctx.beginPath()
    ctx.moveTo(left - 5 * unit, y)
    ctx.lineTo(left, y)
    ctx.stroke()
    ctx.textAlign = 'right'
    ctx.fillText(formatTick(tick, vStep), left - 8 * unit, y)
  }

  ctx.fillStyle = '#222222'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `600 ${13 * unit}px "IBM Plex Sans", "Noto Sans SC", sans-serif`
  ctx.fillText(slice ? `s = ${slice.s.toFixed(2)} m` : 's = —', (left + right) * 0.5, 18 * unit)
  ctx.font = `${11 * unit}px "IBM Plex Sans", "Noto Sans SC", sans-serif`
  ctx.fillText('u (m)', (left + right) * 0.5, height - 8 * unit)
  ctx.save()
  ctx.translate(14 * unit, (top + bottom) * 0.5)
  ctx.rotate(-Math.PI / 2)
  ctx.textBaseline = 'middle'
  ctx.fillText('v (m)', 0, 0)
  ctx.restore()
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const insetRef = useRef<HTMLCanvasElement>(null)
  const insetLargeRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<InstanceType<typeof import('./viewer/TunnelViewer').TunnelViewer> | null>(null)
  const sRef = useRef(0)
  const thicknessRef = useRef(DEFAULT_THICKNESS)
  const methodRef = useRef('hampel')
  const binsRef = useRef(DEFAULT_BINS)
  const smoothRef = useRef(DEFAULT_SMOOTH)
  const metaRef = useRef<Meta | null>(null)
  const rangeLoRef = useRef(0)
  const rangeHiRef = useRef(0)
  const sSliderRef = useRef<HTMLInputElement>(null)
  const thickSliderRef = useRef<HTMLInputElement>(null)
  const thickLiveRef = useRef<HTMLSpanElement>(null)
  const paintRaf = useRef(0)
  const slicerRef = useRef<LiveSlicer | null>(null)
  const lastFrameRef = useRef<PreviewFrame | null>(null)
  const lookRef = useRef<Appearance>(loadAppearance())
  const horseshoeRef = useRef<HorseshoeParams>(loadHorseshoe())
  const overlaysRef = useRef<OverlayState>({
    slab: true,
    contour: true,
    fit: true,
    horseshoe: true,
    inset: true,
  })

  const [health, setHealth] = useState<Health>({ status: 'idle', message: '打开一卷 LAS 点云' })
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [swapBusy, setSwapBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cloudRef = useRef(new LocalCloud())
  const [look, setLook] = useState<Appearance>(() => lookRef.current)
  const [method, setMethod] = useState('hampel')
  const [bins, setBins] = useState(DEFAULT_BINS)
  const [smooth, setSmooth] = useState(DEFAULT_SMOOTH)
  const [overlays, setOverlays] = useState<OverlayState>({
    slab: true,
    contour: true,
    fit: true,
    horseshoe: true,
    inset: true,
  })
  const [horseshoe, setHorseshoe] = useState<HorseshoeParams>(() => horseshoeRef.current)
  const [hud, setHud] = useState<HudState | null>(null)
  const [range, setRange] = useState<{ lo: number; hi: number } | null>(null)
  const [kinds, setKinds] = useState<Record<ExportKind, boolean>>({
    section2d: true,
    section3d: true,
    tunnel3d: true,
    compare: false,
    overbreak: true,
    areaDepth: false,
    volumeDepth: false,
    gallery: false,
    stack: false,
    // The live inset has its own 下载 button; it is not part of the batch export.
    liveSection: false,
  })
  const [exporting, setExporting] = useState(false)
  const [exportHint, setExportHint] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportUrls, setExportUrls] = useState<Partial<Record<ExportKind, string>> | null>(null)
  const [insetOpen, setInsetOpen] = useState(false)
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null)
  const insetViewRef = useRef<InsetViewBox | null>(null)
  const insetDragEndRef = useRef(0)
  const [insetManual, setInsetManual] = useState(false)
  const stageRef = useRef<HTMLElement>(null)
  const insetBoxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<InsetBoxState>(loadInsetBox)
  const [boxDragging, setBoxDragging] = useState(false)
  const [liveExporting, setLiveExporting] = useState(false)
  // Mirrored so the drag listeners stay attached across renders without going stale.
  const boxStateRef = useRef(box)
  boxStateRef.current = box

  const redrawInsets = (frame: PreviewFrame | null, lookNow: Appearance) => {
    const currentMeta = metaRef.current
    if (!currentMeta || !frame) return
    const poly = horseshoePolyline(horseshoeRef.current)
    const design = {
      poly,
      polar: polarSamples(frame.contour_uv, poly, 36),
      show: overlaysRef.current.horseshoe,
    }
    const view = insetViewRef.current ?? insetView(frame, currentMeta.uv_extent)
    if (insetRef.current) {
      syncCanvasBacking(insetRef.current)
      drawUvInset(insetRef.current, frame, lookNow, view, design)
    }
    if (insetLargeRef.current) {
      drawUvInset(insetLargeRef.current, frame, lookNow, view, design)
    }
  }

  const autoInsetView = (frame: PreviewFrame | null): InsetViewBox =>
    insetView(frame, metaRef.current?.uv_extent ?? 2)

  const resetInsetView = () => {
    insetViewRef.current = null
    setInsetManual(false)
    redrawInsets(lastFrameRef.current, lookRef.current)
  }

  /**
   * Wheel zooms about the cursor and both canvases share one view box. Only the
   * enlarged dialog pans by dragging; in the small box a drag moves the box itself.
   */
  const attachInsetControls = (canvas: HTMLCanvasElement, pan: boolean): (() => void) => {
    const viewNow = () => insetViewRef.current ?? autoInsetView(lastFrameRef.current)

    const canvasPoint = (clientX: number, clientY: number): [number, number] | null => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      return [
        ((clientX - rect.left) / rect.width) * canvas.width,
        ((clientY - rect.top) / rect.height) * canvas.height,
      ]
    }

    const applyInsetView = (next: InsetViewBox) => {
      if (!lastFrameRef.current) return
      insetViewRef.current = next
      setInsetManual(true)
      redrawInsets(lastFrameRef.current, lookRef.current)
    }

    const onWheel = (event: WheelEvent) => {
      const point = canvasPoint(event.clientX, event.clientY)
      if (!point) return
      const view = viewNow()
      const layout = insetLayout(canvas, view)
      if (!(layout.scale > 0)) return
      event.preventDefault()
      const anchorU = view.u0 + (point[0] - layout.cx) / layout.scale
      const anchorV = view.v0 - (point[1] - layout.cy) / layout.scale
      const span = clamp(
        view.span * Math.exp(event.deltaY * 0.0015),
        INSET_SPAN_MIN,
        INSET_SPAN_MAX,
      )
      const ratio = span / view.span
      applyInsetView({
        u0: anchorU - (anchorU - view.u0) * ratio,
        v0: anchorV - (anchorV - view.v0) * ratio,
        span,
      })
    }

    let drag: { id: number; startX: number; startY: number; view: InsetViewBox; moved: boolean } | null =
      null

    /** Capture is best-effort: it throws for a pointer that is no longer active. */
    const capture = (pointerId: number, on: boolean) => {
      try {
        if (on) canvas.setPointerCapture(pointerId)
        else if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId)
      } catch {
        /* the drag still tracks through move events without capture */
      }
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!pan) return
      if (event.pointerType === 'mouse' && event.button !== 0) return
      drag = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        view: viewNow(),
        moved: false,
      }
      capture(event.pointerId, true)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return
      const from = canvasPoint(drag.startX, drag.startY)
      const to = canvasPoint(event.clientX, event.clientY)
      if (!from || !to) return
      const dx = to[0] - from[0]
      const dy = to[1] - from[1]
      if (!drag.moved && Math.hypot(dx, dy) < 3) return
      const layout = insetLayout(canvas, drag.view)
      if (!(layout.scale > 0)) return
      drag.moved = true
      canvas.classList.add('is-dragging')
      applyInsetView({
        u0: drag.view.u0 - dx / layout.scale,
        v0: drag.view.v0 + dy / layout.scale,
        span: drag.view.span,
      })
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return
      const moved = drag.moved
      drag = null
      canvas.classList.remove('is-dragging')
      capture(event.pointerId, false)
      if (moved) insetDragEndRef.current = performance.now()
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.classList.remove('is-dragging')
    }
  }

  /** Dragging the frame moves the whole box; the corner grip resizes it. */
  const attachBoxDrag = (
    handle: HTMLElement,
    mode: 'move' | 'resize',
  ): (() => void) => {
    const stageNow = () => stageRef.current?.getBoundingClientRect() ?? null

    let active: {
      id: number
      startX: number
      startY: number
      box: InsetBoxState
      originX: number
      originY: number
      barHeight: number
    } | null = null

    const measureBarHeight = () => {
      const rect = insetBoxRef.current?.getBoundingClientRect()
      const refSize = boxStateRef.current.size
      return rect && refSize > 0 ? Math.max(0, rect.height - refSize) : 0
    }

    /** The largest size whose frame still fits inside the stage, grip included. */
    const maxSizeFor = (stage: DOMRect) => {
      const bar = measureBarHeight()
      return Math.max(
        INSET_SIZE_MIN,
        Math.min(
          INSET_SIZE_MAX,
          stage.width - INSET_MARGIN * 2,
          stage.height - INSET_MARGIN * 2 - bar,
        ),
      )
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const el = event.target as HTMLElement | null
      // Bar buttons always keep their own click.
      if (el?.closest('button')) return
      // In move mode the grip belongs to the resize gesture, not to moving.
      if (mode === 'move' && el?.closest('.inset-grip')) return
      const stage = stageNow()
      const rect = insetBoxRef.current?.getBoundingClientRect()
      if (!stage || !rect) return
      event.preventDefault()
      event.stopPropagation()
      active = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        box: boxStateRef.current,
        originX: rect.left - stage.left,
        originY: rect.top - stage.top,
        barHeight: Math.max(0, rect.height - boxStateRef.current.size),
      }
      setBoxDragging(true)
      // Listen on the window so the gesture survives leaving the box or the grip.
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!active || event.pointerId !== active.id) return
      const stage = stageNow()
      if (!stage) return
      event.preventDefault()
      const dx = event.clientX - active.startX
      const dy = event.clientY - active.startY
      if (mode === 'move') {
        const rect = insetBoxRef.current?.getBoundingClientRect()
        const next = clampBoxToStage(
          active.originX + dx,
          active.originY + dy,
          rect?.width ?? active.box.size,
          rect?.height ?? active.box.size,
          stage.width,
          stage.height,
        )
        setBox({ ...active.box, x: next.x, y: next.y })
      } else {
        const size = clamp(
          Math.round(active.box.size + Math.max(dx, dy)),
          INSET_SIZE_MIN,
          maxSizeFor(stage),
        )
        // Growing must not push the frame past the stage edge it is already near.
        const next = clampBoxToStage(
          active.originX,
          active.originY,
          size,
          size + active.barHeight,
          stage.width,
          stage.height,
        )
        setBox({ ...active.box, size, x: next.x, y: next.y })
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!active || event.pointerId !== active.id) return
      active = null
      setBoxDragging(false)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }

    handle.addEventListener('pointerdown', onPointerDown)
    return () => {
      handle.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }

  const paintPreview = () => {
    const currentMeta = metaRef.current
    const viewer = viewerRef.current
    const slicer = slicerRef.current
    if (!currentMeta || !viewer || !slicer) return
    const frame = slicer.sample({
      s: sRef.current,
      thickness: thicknessRef.current,
      method: methodRef.current,
      bins: binsRef.current,
      smoothWindow: smoothRef.current,
    })
    lastFrameRef.current = frame
    const poly = horseshoePolyline(horseshoeRef.current)
    const stats = overbreakStats(frame.contour_uv, poly)
    viewer.applyPreview({ ...frame, horseshoe_uv: poly })
    redrawInsets(frame, lookRef.current)
    startTransition(() => {
      setHud({
        s: frame.s,
        pointCount: frame.pointCount,
        coverage: frame.coverage,
        radius: frame.fit ? frame.fit.radius : null,
        maxOver: stats.nOver ? stats.maxOver : null,
        meanOver: stats.nOver ? stats.meanOver : null,
        maxUnder: stats.nUnder ? stats.maxUnder : null,
        meanUnder: stats.nUnder ? stats.meanUnder : null,
        overArea: stats.overArea,
        underArea: stats.underArea,
      })
    })
  }

  const schedulePaint = () => {
    if (paintRaf.current) return
    paintRaf.current = window.requestAnimationFrame(() => {
      paintRaf.current = 0
      paintPreview()
    })
  }

  const applyStation = (value: number) => {
    const current = metaRef.current
    if (!current) return
    const next = clamp(value, rangeLoRef.current, rangeHiRef.current)
    sRef.current = next
    if (sSliderRef.current) sSliderRef.current.value = String(next)
    viewerRef.current?.setStation(next)
    schedulePaint()
  }

  const applyRange = (lo: number, hi: number) => {
    const current = metaRef.current
    if (!current) return
    const minW = rangeMinWidth(current)
    const nextLo = clamp(lo, current.s_min, current.s_max - minW)
    const nextHi = clamp(hi, nextLo + minW, current.s_max)
    rangeLoRef.current = nextLo
    rangeHiRef.current = nextHi
    setRange({ lo: nextLo, hi: nextHi })
    viewerRef.current?.setWorkingRange(nextLo, nextHi)
    if (sRef.current < nextLo || sRef.current > nextHi) applyStation(sRef.current)
  }

  const applyThickness = (value: number, fromSlider: boolean) => {
    const next = clamp(value, THICK_MIN, THICK_MAX)
    thicknessRef.current = next
    if (!fromSlider && thickSliderRef.current) thickSliderRef.current.value = String(next)
    if (thickLiveRef.current) thickLiveRef.current.textContent = formatMeters(next)
    viewerRef.current?.setThickness(next)
    schedulePaint()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let viewer: InstanceType<typeof import('./viewer/TunnelViewer').TunnelViewer> | null = null

    ;(async () => {
      const { TunnelViewer } = await import('./viewer/TunnelViewer')
      if (cancelled) return
      viewer = new TunnelViewer(canvas)
      viewerRef.current = viewer
      viewer.setAppearance(lookRef.current)
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : '无法创建三维视口')
    })

    return () => {
      cancelled = true
      if (paintRaf.current) window.cancelAnimationFrame(paintRaf.current)
      viewer?.dispose()
      viewerRef.current = null
      cloudRef.current.dispose()
    }
  }, [])

  useEffect(() => {
    lookRef.current = look
    applyThemeClass(look.theme)
    saveAppearance(look)
    viewerRef.current?.setAppearance(look)
    redrawInsets(lastFrameRef.current, look)
  }, [look, overlays.inset])

  useEffect(() => {
    overlaysRef.current = overlays
    viewerRef.current?.setOverlays(overlays)
    if (!overlays.inset) setInsetOpen(false)
    redrawInsets(lastFrameRef.current, lookRef.current)
  }, [overlays])

  useEffect(() => {
    if (!insetOpen) return
    const id = window.requestAnimationFrame(() => {
      redrawInsets(lastFrameRef.current, lookRef.current)
    })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setInsetOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.cancelAnimationFrame(id)
      window.removeEventListener('keydown', onKey)
    }
  }, [insetOpen])

  useEffect(() => {
    const disposers: (() => void)[] = []
    if (overlays.inset) {
      if (insetRef.current) disposers.push(attachInsetControls(insetRef.current, false))
      if (insetOpen && insetLargeRef.current) {
        disposers.push(attachInsetControls(insetLargeRef.current, true))
      }
    }
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [insetOpen, overlays.inset])

  useEffect(() => {
    const handle = insetBoxRef.current
    if (!handle || !overlays.inset) return
    const disposers = [attachBoxDrag(handle, 'move')]
    const grip = handle.querySelector<HTMLElement>('.inset-grip')
    if (grip) disposers.push(attachBoxDrag(grip, 'resize'))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [overlays.inset])

  useEffect(() => {
    saveInsetBox(box)
  }, [box])

  // The canvas CSS size changed, so its bitmap has to be re-rendered at the new scale.
  useEffect(() => {
    redrawInsets(lastFrameRef.current, lookRef.current)
  }, [box.size])

  useEffect(() => {
    const fitToStage = () => {
      const stage = stageRef.current?.getBoundingClientRect()
      const rect = insetBoxRef.current?.getBoundingClientRect()
      if (!stage || !rect) return
      setBox((prev) => {
        const bar = Math.max(0, rect.height - prev.size)
        const size = Math.min(
          prev.size,
          Math.max(
            INSET_SIZE_MIN,
            Math.min(stage.width - INSET_MARGIN * 2, stage.height - INSET_MARGIN * 2 - bar),
          ),
        )
        if (prev.x === null || prev.y === null) {
          return size === prev.size ? prev : { ...prev, size }
        }
        const next = clampBoxToStage(
          prev.x,
          prev.y,
          size,
          size + bar,
          stage.width,
          stage.height,
        )
        if (size === prev.size && next.x === prev.x && next.y === prev.y) return prev
        return { ...prev, size, ...next }
      })
    }
    fitToStage()
    window.addEventListener('resize', fitToStage)
    return () => window.removeEventListener('resize', fitToStage)
  }, [])

  useEffect(() => {
    if (!preview) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setPreview(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      if (event.key === 'r' || event.key === 'R') {
        if (typing && target instanceof HTMLInputElement && target.type === 'number') return
        event.preventDefault()
        viewerRef.current?.resetCamera()
        return
      }
      if (typing) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        applyStation(sRef.current - 0.05)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        applyStation(sRef.current + 0.05)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onTheme = (theme: ThemeId) => {
    setLook({ theme, ...THEME_DEFAULTS[theme] })
  }

  const onTint = (key: 'cloud' | 'slice' | 'contour' | 'fit' | 'design', value: string) => {
    setLook((prev) => ({ ...prev, [key]: value }))
  }

  const onBrightness = (value: number) => {
    setLook((prev) => ({ ...prev, brightness: clamp(value, 0.28, 1) }))
  }

  const onResetLook = () => {
    setLook(defaultAppearance(look.theme))
  }

  const applyHorseshoe = (next: HorseshoeParams) => {
    const clamped = clampHorseshoe(next)
    horseshoeRef.current = clamped
    setHorseshoe(clamped)
    saveHorseshoe(clamped)
    schedulePaint()
  }

  /** Re-draw the current station as a standalone 300 dpi figure, then download it. */
  const onDownloadLiveSection = async () => {
    if (!metaRef.current || liveExporting) return
    setLiveExporting(true)
    setError(null)
    try {
      const url = await cloudRef.current.exportLiveSection(
        currentSliceParams(),
        horseshoeRef.current,
        setExportHint,
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `section_${sRef.current.toFixed(2)}m.png`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      // Give the browser a moment to start the download before revoking.
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '断面图出图失败')
    } finally {
      setLiveExporting(false)
      setExportHint(null)
    }
  }

  const currentSliceParams = () => ({
    s: sRef.current,
    thickness: thicknessRef.current,
    method: methodRef.current,
    contour_bins: binsRef.current,
    smooth_window: smoothRef.current,
    range_lo: rangeLoRef.current,
    range_hi: rangeHiRef.current,
  })

  const onStationInput = (event: ChangeEvent<HTMLInputElement>) => {
    applyStation(Number(event.currentTarget.value))
  }

  const onThickInput = (event: ChangeEvent<HTMLInputElement>) => {
    applyThickness(Number(event.currentTarget.value), true)
  }

  const onMethod = (event: ChangeEvent<HTMLSelectElement>) => {
    methodRef.current = event.target.value
    setMethod(event.target.value)
    schedulePaint()
  }

  const onBins = (event: ChangeEvent<HTMLInputElement>) => {
    const value = clamp(Math.round(Number(event.target.value) || DEFAULT_BINS), 12, 720)
    binsRef.current = value
    setBins(value)
    schedulePaint()
  }

  const onSmooth = (event: ChangeEvent<HTMLInputElement>) => {
    const value = oddWindow(Number(event.target.value) || DEFAULT_SMOOTH)
    smoothRef.current = value
    setSmooth(value)
    schedulePaint()
  }

  const onPickFile = async (file: File) => {
    setSwapBusy(true)
    setError(null)
    setExportError(null)
    setHealth({ status: 'loading', message: `正在读入 ${file.name}`, source_name: file.name })
    try {
      const loaded = await cloudRef.current.open(file, setHealth)
      const nextMeta = loaded.meta
      const methodName = nextMeta.default_method || methodRef.current || 'hampel'
      methodRef.current = methodName
      const station = defaultStation(nextMeta)
      const window = defaultWorkingRange(nextMeta)
      metaRef.current = nextMeta
      sRef.current = station
      rangeLoRef.current = window.lo
      rangeHiRef.current = window.hi
      slicerRef.current = new LiveSlicer(loaded.viz)
      lastFrameRef.current = null
      insetViewRef.current = null
      setInsetManual(false)
      setMeta(nextMeta)
      setRange(window)
      setMethod(methodName)
      setExportUrls((prev) => {
        if (prev) for (const url of Object.values(prev)) URL.revokeObjectURL(url)
        return null
      })
      setHealth({ status: 'ready', message: 'ready', source_name: nextMeta.source_name })
      const currentViewer = viewerRef.current
      if (!currentViewer) throw new Error('三维视口还没准备好')
      await currentViewer.loadCloud(loaded.viz, nextMeta, station)
      currentViewer.setAppearance(lookRef.current)
      currentViewer.setThickness(thicknessRef.current)
      currentViewer.setWorkingRange(window.lo, window.hi)
      if (thickLiveRef.current) thickLiveRef.current.textContent = formatMeters(thicknessRef.current)
      // The frame's 0 now sits on the measured floor, so re-seat the design profile on it.
      const frameNow = slicerRef.current.sample({
        s: station,
        thickness: thicknessRef.current,
        method: methodName,
        bins: binsRef.current,
        smoothWindow: smoothRef.current,
      })
      lastFrameRef.current = frameNow
      if (frameNow.contour_uv.length >= 3) {
        applyHorseshoe(alignToContour(frameNow.contour_uv, horseshoeRef.current))
      } else {
        applyHorseshoe({ ...horseshoeRef.current, invertV: 0 })
      }
      paintPreview()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '无法装入点云')
      setHealth((prev) => ({ ...prev, status: 'error' }))
    } finally {
      setSwapBusy(false)
    }
  }

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) void onPickFile(file)
  }

  const onExport = async () => {
    const selected = EXPORT_OPTIONS.filter((item) => kinds[item.id]).map((item) => item.id)
    if (selected.length === 0) {
      setExportError('至少勾选一张图')
      return
    }
    setExporting(true)
    setExportError(null)
    setExportHint('正在准备剖面')
    try {
      const result = await cloudRef.current.export(
        currentSliceParams(),
        selected,
        horseshoeRef.current,
        (message) => setExportHint(message),
      )
      setExportUrls((prev) => {
        if (prev) for (const url of Object.values(prev)) URL.revokeObjectURL(url)
        return result.urls
      })
      setPreview(null)
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
      setExportHint(null)
    }
  }

  const showCurtain = Boolean(error) || swapBusy || !meta
  const canPick = !swapBusy && health.status !== 'loading'
  const sourceName = meta?.source_name ?? health.source_name ?? null
  const statusText = error
    ? error
    : swapBusy || health.status === 'loading'
      ? `正在准备：${health.message}`
      : health.status === 'idle'
        ? '打开一卷 LAS。解码、放平、切片和出图都在这台电脑上完成。'
        : health.message

  return (
    <div className="shell">
      <input
        id="las-file"
        ref={fileInputRef}
        className="file-input"
        type="file"
        accept=".las,.laz,application/octet-stream"
        disabled={swapBusy}
        aria-hidden="true"
        tabIndex={-1}
        onChange={onFileInput}
      />
      <InstrumentRail
        meta={meta}
        sourceName={sourceName}
        uploading={swapBusy}
        look={look}
        method={method}
        bins={bins}
        smooth={smooth}
        overlays={overlays}
        horseshoe={horseshoe}
        kinds={kinds}
        exporting={exporting}
        exportHint={exportHint}
        exportError={exportError}
        exportUrls={exportUrls}
        thickSliderRef={thickSliderRef}
        thickLiveRef={thickLiveRef}
        onThickInput={onThickInput}
        onMethod={onMethod}
        onBins={onBins}
        onSmooth={onSmooth}
        onTheme={onTheme}
        onTint={onTint}
        onBrightness={onBrightness}
        onResetLook={onResetLook}
        onOverlays={setOverlays}
        onHorseshoe={applyHorseshoe}
        onAlignHorseshoe={() => {
          const frame = lastFrameRef.current
          if (!frame?.contour_uv.length) return
          applyHorseshoe(alignToContour(frame.contour_uv, horseshoeRef.current))
        }}
        onKinds={setKinds}
        onExport={onExport}
        onPreview={(item) => setPreview(item)}
        onOpenPicker={() => fileInputRef.current?.click()}
      />
      <main className="stage" ref={stageRef}>
        <canvas ref={canvasRef} className="gl" />
        <ViewportHud hud={hud} />
        <div className="stage-tr">
          <button type="button" className="home" onClick={() => viewerRef.current?.resetCamera()}>
            归位
          </button>
        </div>
        {overlays.inset ? (
          <div
            ref={insetBoxRef}
            className={`inset-box${boxDragging ? ' is-dragging' : ''}`}
            style={{
              width: box.size,
              ...(box.x === null || box.y === null
                ? {}
                : { left: box.x, top: box.y, right: 'auto' }),
            }}
          >
            <div
              className="inset-bar"
              title="按住拖动这个框"
            >
              <span className="inset-title">断面图</span>
              <span className="inset-bar-tools">
                {insetManual ? (
                  <button
                    type="button"
                    className="inset-tool"
                    onClick={resetInsetView}
                    title="回到自动取景"
                  >
                    适应
                  </button>
                ) : null}
                <button
                  type="button"
                  className="inset-tool"
                  onClick={onDownloadLiveSection}
                  disabled={!meta || liveExporting}
                  title="按当前桩号重画一张 300 dpi 的断面图"
                >
                  {liveExporting ? '出图…' : '下载'}
                </button>
                <button
                  type="button"
                  className="inset-tool"
                  onClick={() => setInsetOpen(true)}
                  title="放大"
                >
                  放大
                </button>
                {box.x === null ? null : (
                  <button
                    type="button"
                    className="inset-tool"
                    onClick={() => setBox((prev) => ({ ...prev, x: null, y: null }))}
                    title="停靠回右上角"
                  >
                    停靠
                  </button>
                )}
              </span>
            </div>
            <canvas
              ref={insetRef}
              className="inset"
              width={360}
              height={360}
              style={{ width: box.size, height: box.size }}
              onDoubleClick={() => {
                if (performance.now() - insetDragEndRef.current < INSET_DRAG_SLOP_MS) return
                setInsetOpen(true)
              }}
            />
            <span className="inset-grip" title="拖动改大小" />
          </div>
        ) : null}
        {insetOpen && overlays.inset ? (
          <div
            className="inset-lightbox"
            onClick={() => setInsetOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="断面图"
          >
            <canvas
              ref={insetLargeRef}
              className="inset inset-large"
              width={1400}
              height={1400}
              onClick={(event) => {
                event.stopPropagation()
                if (performance.now() - insetDragEndRef.current < INSET_DRAG_SLOP_MS) return
                // A plain click re-frames on the measured profile.
                resetInsetView()
              }}
            />
            <p className="inset-hint">滚轮缩放 · 拖动平移 · 点击图面适应断面 · 点击空白处或按 Esc 关闭</p>
          </div>
        ) : null}
        {preview ? (
          <div
            className="inset-lightbox export-lightbox"
            onClick={() => setPreview(null)}
            role="dialog"
            aria-modal="true"
            aria-label={preview.label}
          >
            <img
              className="export-large"
              src={preview.url}
              alt={preview.label}
              onClick={(event) => event.stopPropagation()}
            />
            <p className="inset-hint">
              {preview.label} · 点击空白处或按 Esc 关闭 ·{' '}
              <a className="inset-download" href={preview.url} download={`${preview.label}.png`}>
                下载 PNG
              </a>
            </p>
          </div>
        ) : null}
        {meta ? (
          <StationFilm
            key={`${meta.source_name ?? ''}-${meta.s_min}-${meta.s_max}`}
            meta={meta}
            rangeLo={(range ?? defaultWorkingRange(meta)).lo}
            rangeHi={(range ?? defaultWorkingRange(meta)).hi}
            sliderRef={sSliderRef}
            onInput={onStationInput}
            onRange={applyRange}
            onResetRange={() => applyRange(defaultWorkingRange(meta).lo, defaultWorkingRange(meta).hi)}
          />
        ) : null}
        {showCurtain ? (
          <div className={`curtain${error ? ' is-error' : ''}${canPick ? ' is-pick' : ''}`}>
            <div className="curtain-copy">
              <p>{statusText}</p>
              {canPick ? (
                <button
                  type="button"
                  className="file-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  打开 LAS
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}

function InstrumentRail(props: {
  meta: Meta | null
  sourceName: string | null
  uploading: boolean
  look: Appearance
  method: string
  bins: number
  smooth: number
  overlays: OverlayState
  horseshoe: HorseshoeParams
  kinds: Record<ExportKind, boolean>
  exporting: boolean
  exportHint: string | null
  exportError: string | null
  exportUrls: Partial<Record<ExportKind, string>> | null
  thickSliderRef: RefObject<HTMLInputElement | null>
  thickLiveRef: RefObject<HTMLSpanElement | null>
  onThickInput: (event: ChangeEvent<HTMLInputElement>) => void
  onMethod: (event: ChangeEvent<HTMLSelectElement>) => void
  onBins: (event: ChangeEvent<HTMLInputElement>) => void
  onSmooth: (event: ChangeEvent<HTMLInputElement>) => void
  onTheme: (theme: ThemeId) => void
  onTint: (key: 'cloud' | 'slice' | 'contour' | 'fit' | 'design', value: string) => void
  onBrightness: (value: number) => void
  onResetLook: () => void
  onOverlays: Dispatch<SetStateAction<OverlayState>>
  onHorseshoe: (next: HorseshoeParams) => void
  onAlignHorseshoe: () => void
  onKinds: Dispatch<SetStateAction<Record<ExportKind, boolean>>>
  onExport: () => void
  onPreview: (item: { url: string; label: string }) => void
  onOpenPicker: () => void
}) {
  const methods = props.meta?.methods ?? ['hampel']
  return (
    <aside className="rail">
      <header className="rail-head">
        <p className="mark">巷道内壁</p>
        <h1>沿桩号切开隧道，检查内轮廓。</h1>
        {props.meta ? (
          <p className="census">
            {props.sourceName ? `${props.sourceName} · ` : ''}
            全云 {props.meta.point_count.toLocaleString()} 点，屏幕上画 {props.meta.viz_count.toLocaleString()} 点
          </p>
        ) : (
          <p className="census">等待点云铺进视野</p>
        )}
      </header>

      <section className="block">
        <p className="block-title">点云卷</p>
        <p className="docket-name">{props.sourceName ?? '还没有装入'}</p>
        <button
          type="button"
          className={`file-btn${props.uploading ? ' is-wait' : ''}`}
          disabled={props.uploading}
          onClick={props.onOpenPicker}
        >
          {props.uploading ? '正在读入…' : props.sourceName ? '换一卷 LAS' : '打开 LAS'}
        </button>
        <p className="hint">文件只在这台电脑的浏览器里解码，不会传到网上。换卷后按新文件估计轴线。</p>
      </section>

      <section className="block">
        <p className="block-title">主题</p>
        <div className="theme-pair">
          <button
            type="button"
            className={props.look.theme === 'dark' ? 'is-on' : ''}
            onClick={() => props.onTheme('dark')}
          >
            暗色
          </button>
          <button
            type="button"
            className={props.look.theme === 'light' ? 'is-on' : ''}
            onClick={() => props.onTheme('light')}
          >
            亮色
          </button>
        </div>
      </section>

      <section className="block">
        <div className="block-head">
          <label htmlFor="thickness">切片厚度</label>
          <span ref={props.thickLiveRef} className="readout">
            {formatMeters(DEFAULT_THICKNESS)}
          </span>
        </div>
        <input
          id="thickness"
          ref={props.thickSliderRef}
          className="slider"
          type="range"
          min={THICK_MIN}
          max={THICK_MAX}
          step={0.01}
          defaultValue={DEFAULT_THICKNESS}
          onChange={props.onThickInput}
        />
        <p className="hint">0.05–1.0 m。拖动时切面带和轮廓一起即时更新。</p>
      </section>

      <section className="block">
        <label htmlFor="method">轮廓算法</label>
        <select id="method" value={props.method} onChange={props.onMethod}>
          {methods.map((name) => (
            <option key={name} value={name}>
              {name} {METHOD_HINT[name] ?? ''}
            </option>
          ))}
        </select>
      </section>

      <details className="block advanced">
        <summary>高级</summary>
        <label htmlFor="bins">
          分桶
          <input
            id="bins"
            type="number"
            min={12}
            max={720}
            step={1}
            value={props.bins}
            onChange={props.onBins}
          />
        </label>
        <label htmlFor="smooth">
          平滑窗（奇数）
          <input
            id="smooth"
            type="number"
            min={5}
            max={51}
            step={2}
            value={props.smooth}
            onChange={props.onSmooth}
          />
        </label>
      </details>

      <section className="block">
        <p className="block-title">叠显</p>
        <OverlayToggles look={props.look} overlays={props.overlays} onChange={props.onOverlays} />
      </section>

      <HorseshoePanel
        params={props.horseshoe}
        disabled={!props.meta}
        onChange={props.onHorseshoe}
        onAlign={props.onAlignHorseshoe}
      />

      <details className="block advanced">
        <summary>颜色</summary>
        <div className="tints">
          {(
            [
              ['cloud', '点云灰'],
              ['slice', '切片点'],
              ['contour', '轮廓线'],
              ['fit', '拟合圆'],
              ['design', '设计马蹄'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="tint" htmlFor={`tint-${key}`}>
              {label}
              <input
                id={`tint-${key}`}
                type="color"
                value={props.look[key]}
                onChange={(event) => props.onTint(key, event.target.value)}
              />
            </label>
          ))}
        </div>
        <label className="tint" htmlFor="cloud-bright">
          点云明暗
          <span className="readout">{Math.round(props.look.brightness * 100)}%</span>
        </label>
        <input
          id="cloud-bright"
          className="slider"
          type="range"
          min={0.28}
          max={1}
          step={0.02}
          value={props.look.brightness}
          onChange={(event) => props.onBrightness(Number(event.target.value))}
        />
        <button type="button" className="reset-look" onClick={props.onResetLook}>
          恢复当前主题默认色
        </button>
      </details>

      <ExportPanel
        kinds={props.kinds}
        exporting={props.exporting}
        exportHint={props.exportHint}
        disabled={props.uploading || !props.meta}
        exportError={props.exportError}
        exportUrls={props.exportUrls}
        onKinds={props.onKinds}
        onExport={props.onExport}
        onPreview={props.onPreview}
      />
    </aside>
  )
}

function HorseshoePanel(props: {
  params: HorseshoeParams
  disabled: boolean
  onChange: (next: HorseshoeParams) => void
  onAlign: () => void
}) {
  const geom = archGeometry(props.params)
  const area = polygonArea(horseshoePolyline(props.params))
  const height = horseshoeHeight(props.params)
  const set = (patch: Partial<HorseshoeParams>) => props.onChange({ ...props.params, ...patch })
  return (
    <details className="block advanced" open>
      <summary>设计马蹄形</summary>
      <p className="hint">直墙 + 圆弧拱，形状对齐 docs 断面图。数值可改，用于超欠挖 Δd。</p>
      <label htmlFor="hs-width">
        全宽
        <input
          id="hs-width"
          type="number"
          min={0.6}
          max={12}
          step={0.05}
          disabled={props.disabled}
          value={props.params.width.toFixed(2)}
          onChange={(event) => set({ width: Number(event.target.value) })}
        />
      </label>
      <label htmlFor="hs-wall">
        直墙高
        <input
          id="hs-wall"
          type="number"
          min={0.2}
          max={8}
          step={0.05}
          disabled={props.disabled}
          value={props.params.wallHeight.toFixed(2)}
          onChange={(event) => set({ wallHeight: Number(event.target.value) })}
        />
      </label>
      <label htmlFor="hs-radius">
        拱半径
        <input
          id="hs-radius"
          type="number"
          min={0.4}
          max={16}
          step={0.05}
          disabled={props.disabled}
          value={props.params.archRadius.toFixed(2)}
          onChange={(event) => set({ archRadius: Number(event.target.value) })}
        />
      </label>
      <label htmlFor="hs-u">
        横向偏移 u
        <input
          id="hs-u"
          type="number"
          min={-8}
          max={8}
          step={0.02}
          disabled={props.disabled}
          value={props.params.centerU.toFixed(2)}
          onChange={(event) => set({ centerU: Number(event.target.value) })}
        />
      </label>
      <label htmlFor="hs-v">
        底板高（0 = 实测底面）
        <input
          id="hs-v"
          type="number"
          min={-8}
          max={8}
          step={0.02}
          disabled={props.disabled}
          value={props.params.invertV.toFixed(2)}
          onChange={(event) => set({ invertV: Number(event.target.value) })}
        />
      </label>
      <p className="hint">
        底面基准取实测底板的平均值（v=0），装入点云后按当前断面自动对齐。总高{' '}
        {height.toFixed(2)} m，拱矢 {geom.rise.toFixed(2)} m，设计面积 {area.toFixed(2)} m²
      </p>
      <div className="hs-actions">
        <button type="button" className="reset-look" disabled={props.disabled} onClick={props.onAlign}>
          按当前轮廓对齐
        </button>
        <button
          type="button"
          className="reset-look"
          disabled={props.disabled}
          onClick={() =>
            props.onChange(
              applyDrawingRatios(props.params.width, props.params.centerU, props.params.invertV),
            )
          }
        >
          按图纸比例
        </button>
      </div>
    </details>
  )
}

function OverlayToggles(props: {
  look: Appearance
  overlays: OverlayState
  onChange: Dispatch<SetStateAction<OverlayState>>
}) {
  const items: { key: keyof OverlayState; label: string; swatch?: string }[] = [
    { key: 'slab', label: '切片点', swatch: props.look.slice },
    { key: 'contour', label: '内壁轮廓', swatch: props.look.contour },
    { key: 'fit', label: '拟合圆', swatch: props.look.fit },
    { key: 'horseshoe', label: '设计马蹄', swatch: props.look.design },
    { key: 'inset', label: '断面图' },
  ]
  return (
    <div className="checks">
      {items.map((item) => (
        <label key={item.key} className="check">
          <input
            type="checkbox"
            checked={props.overlays[item.key]}
            onChange={(event) => {
              const on = event.target.checked
              props.onChange((prev) => ({ ...prev, [item.key]: on }))
            }}
          />
          {item.swatch ? <span className="swatch" style={{ background: item.swatch }} /> : null}
          {item.label}
        </label>
      ))}
    </div>
  )
}

function ExportPanel(props: {
  kinds: Record<ExportKind, boolean>
  exporting: boolean
  exportHint: string | null
  disabled: boolean
  exportError: string | null
  exportUrls: Partial<Record<ExportKind, string>> | null
  onKinds: Dispatch<SetStateAction<Record<ExportKind, boolean>>>
  onExport: () => void
  onPreview: (item: { url: string; label: string }) => void
}) {
  return (
    <section className="block export">
      <p className="block-title">导出</p>
      <div className="checks">
        {EXPORT_OPTIONS.map((item) => (
          <label key={item.id} className="check">
            <input
              type="checkbox"
              checked={props.kinds[item.id]}
              onChange={(event) => {
                const on = event.target.checked
                props.onKinds((prev) => ({ ...prev, [item.id]: on }))
              }}
            />
            {item.label}
          </label>
        ))}
      </div>
      <button
        type="button"
        className="export-btn"
        onClick={props.onExport}
        disabled={props.exporting || props.disabled}
      >
        {props.exporting ? props.exportHint || '正在出图…' : '导出当前剖面'}
      </button>
      {props.exporting && props.exportHint ? <p className="hint">{props.exportHint}</p> : null}
      {!props.exporting ? (
        <p className="hint">
          本机 matplotlib 出图。多断面、面积、体积、总览用底部两端游标圈出的区间。
        </p>
      ) : null}
      {props.exportError ? <p className="fail">{props.exportError}</p> : null}
      {props.exportUrls ? (
        <div className="thumbs">
          {EXPORT_OPTIONS.map((item) => {
            const url = props.exportUrls?.[item.id]
            if (!url) return null
            return (
              <button
                key={item.id}
                type="button"
                className="thumb"
                onClick={() => props.onPreview({ url, label: item.label })}
                title="点击放大"
              >
                <img src={url} alt={item.label} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

function StationFilm(props: {
  meta: Meta
  rangeLo: number
  rangeHi: number
  sliderRef: RefObject<HTMLInputElement | null>
  onInput: (event: ChangeEvent<HTMLInputElement>) => void
  onRange: (lo: number, hi: number) => void
  onResetRange: () => void
}) {
  const start = defaultStation(props.meta)
  const trackRef = useRef<HTMLDivElement>(null)
  const loRef = useRef(props.rangeLo)
  const hiRef = useRef(props.rangeHi)
  const [drag, setDrag] = useState<'lo' | 'hi' | null>(null)
  loRef.current = props.rangeLo
  hiRef.current = props.rangeHi
  const sMin = props.meta.s_min
  const sMax = props.meta.s_max
  const span = Math.max(1e-9, sMax - sMin)
  const pct = (s: number) => ((s - sMin) / span) * 100
  const minW = rangeMinWidth(props.meta)
  const loPct = pct(props.rangeLo)
  const hiPct = pct(props.rangeHi)
  const seeded = defaultWorkingRange(props.meta)
  const atSeed =
    Math.abs(props.rangeLo - seeded.lo) < 1e-4 && Math.abs(props.rangeHi - seeded.hi) < 1e-4

  const onTrimDown = (which: 'lo' | 'hi') => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const button = event.currentTarget
    button.setPointerCapture(event.pointerId)
    setDrag(which)
    const track = trackRef.current
    const move = (ev: PointerEvent) => {
      if (!track) return
      const rect = track.getBoundingClientRect()
      const t = clamp((ev.clientX - rect.left) / Math.max(rect.width, 1), 0, 1)
      const s = sMin + t * (sMax - sMin)
      if (which === 'lo') props.onRange(Math.min(s, hiRef.current - minW), hiRef.current)
      else props.onRange(loRef.current, Math.max(s, loRef.current + minW))
    }
    const up = () => {
      setDrag(null)
      button.removeEventListener('pointermove', move)
      button.removeEventListener('pointerup', up)
      button.removeEventListener('pointercancel', up)
    }
    button.addEventListener('pointermove', move)
    button.addEventListener('pointerup', up)
    button.addEventListener('pointercancel', up)
  }

  return (
    <div className="film">
      <div className="sprockets" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((i) => (
          <span key={i} />
        ))}
      </div>
      <div className="film-row">
        <span className="film-label">桩号</span>
        <span className="film-window">
          {formatMeters(props.rangeLo)} – {formatMeters(props.rangeHi)}
        </span>
        <button
          type="button"
          className="film-reset"
          disabled={atSeed}
          onClick={props.onResetRange}
          title="回到自动圈出的密实段"
        >
          复位
        </button>
      </div>
      <div
        ref={trackRef}
        className={`film-stage${drag ? ' is-dragging' : ''}`}
        title="两端游标：限制可拖的桩号，以及多断面、面积、体积、总览的出图范围"
      >
        <div className="film-rail" aria-hidden="true" />
        <div
          className="film-span"
          style={{ left: `${loPct}%`, width: `${Math.max(0, hiPct - loPct)}%` }}
        />
        <button
          type="button"
          className={`film-trim is-in${drag === 'lo' ? ' is-drag' : ''}`}
          style={{ left: `${loPct}%` }}
          aria-label="区间起点"
          title="拖动设定可用 / 出图起点"
          onPointerDown={onTrimDown('lo')}
          onDoubleClick={() => props.onRange(sMin, props.rangeHi)}
        >
          <span className="film-trim-flag" />
          {drag === 'lo' ? <span className="film-trim-tip">{formatMeters(props.rangeLo)}</span> : null}
        </button>
        <button
          type="button"
          className={`film-trim is-out${drag === 'hi' ? ' is-drag' : ''}`}
          style={{ left: `${hiPct}%` }}
          aria-label="区间终点"
          title="拖动设定可用 / 出图终点"
          onPointerDown={onTrimDown('hi')}
          onDoubleClick={() => props.onRange(props.rangeLo, sMax)}
        >
          <span className="film-trim-flag" />
          {drag === 'hi' ? <span className="film-trim-tip">{formatMeters(props.rangeHi)}</span> : null}
        </button>
        <input
          ref={props.sliderRef}
          className="slider film-slider"
          type="range"
          min={sMin}
          max={sMax}
          step={0.01}
          defaultValue={start}
          aria-label="桩号"
          onChange={props.onInput}
        />
      </div>
      <div className="chainage">
        <span>{formatMeters(sMin)}</span>
        <span>{formatMeters((sMin + sMax) * 0.5)}</span>
        <span>{formatMeters(sMax)}</span>
      </div>
    </div>
  )
}

function ViewportHud(props: { hud: HudState | null }) {
  if (!props.hud) return null
  return (
    <dl className="hud">
      <div>
        <dt>桩号</dt>
        <dd>{formatMeters(props.hud.s)}</dd>
      </div>
      <div>
        <dt>切片点数</dt>
        <dd>{props.hud.pointCount.toLocaleString()}</dd>
      </div>
      <div>
        <dt>角度覆盖</dt>
        <dd>{(props.hud.coverage * 100).toFixed(0)}%</dd>
      </div>
      <div>
        <dt>拟合半径</dt>
        <dd>{props.hud.radius === null ? '—' : formatMeters(props.hud.radius)}</dd>
      </div>
      <div>
        <dt>最大超挖</dt>
        <dd>{props.hud.maxOver === null ? '—' : formatMeters(props.hud.maxOver, 3)}</dd>
      </div>
      <div>
        <dt>平均超挖</dt>
        <dd>{props.hud.meanOver === null ? '—' : formatMeters(props.hud.meanOver, 3)}</dd>
      </div>
      <div>
        <dt>最大欠挖</dt>
        <dd>{props.hud.maxUnder === null ? '—' : formatMeters(props.hud.maxUnder, 3)}</dd>
      </div>
      <div>
        <dt>平均欠挖</dt>
        <dd>{props.hud.meanUnder === null ? '—' : formatMeters(props.hud.meanUnder, 3)}</dd>
      </div>
      <div>
        <dt>超挖面积</dt>
        <dd>{props.hud.overArea === null ? '—' : `${props.hud.overArea.toFixed(3)} m²`}</dd>
      </div>
      <div>
        <dt>欠挖面积</dt>
        <dd>{props.hud.underArea === null ? '—' : `${props.hud.underArea.toFixed(3)} m²`}</dd>
      </div>
    </dl>
  )
}
