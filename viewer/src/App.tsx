import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
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

function drawUvInset(
  canvas: HTMLCanvasElement,
  slice: PreviewFrame | null,
  uvExtent: number,
  look: Appearance,
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
  const view = insetView(slice, uvExtent)
  const scale = Math.min((right - left) / (view.span * 2), (bottom - top) / (view.span * 2))
  const cx = (left + right) * 0.5
  const cy = (top + bottom) * 0.5
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
    ctx.arc(cx, cy, slice.fit.radius * scale, 0, Math.PI * 2)
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
  })
  const [exporting, setExporting] = useState(false)
  const [exportHint, setExportHint] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportUrls, setExportUrls] = useState<Partial<Record<ExportKind, string>> | null>(null)
  const [insetOpen, setInsetOpen] = useState(false)

  const redrawInsets = (frame: PreviewFrame | null, lookNow: Appearance) => {
    const currentMeta = metaRef.current
    if (!currentMeta || !frame) return
    const poly = horseshoePolyline(horseshoeRef.current)
    const design = {
      poly,
      polar: polarSamples(frame.contour_uv, poly, 36),
      show: overlaysRef.current.horseshoe,
    }
    if (insetRef.current) drawUvInset(insetRef.current, frame, currentMeta.uv_extent, lookNow, design)
    if (insetLargeRef.current) drawUvInset(insetLargeRef.current, frame, currentMeta.uv_extent, lookNow, design)
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

  const applyStation = (value: number, fromSlider: boolean) => {
    const current = metaRef.current
    if (!current) return
    const next = clamp(value, current.s_min, current.s_max)
    sRef.current = next
    if (!fromSlider && sSliderRef.current) sSliderRef.current.value = String(next)
    viewerRef.current?.setStation(next)
    schedulePaint()
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
        applyStation(sRef.current - 0.05, false)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        applyStation(sRef.current + 0.05, false)
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

  const onStationInput = (event: ChangeEvent<HTMLInputElement>) => {
    applyStation(Number(event.currentTarget.value), true)
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
      metaRef.current = nextMeta
      sRef.current = station
      slicerRef.current = new LiveSlicer(loaded.viz)
      lastFrameRef.current = null
      setMeta(nextMeta)
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
      if (thickLiveRef.current) thickLiveRef.current.textContent = formatMeters(thicknessRef.current)
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
        {
          s: sRef.current,
          thickness: thicknessRef.current,
          method: methodRef.current,
          contour_bins: binsRef.current,
          smooth_window: smoothRef.current,
        },
        selected,
        horseshoeRef.current,
        (message) => setExportHint(message),
      )
      setExportUrls((prev) => {
        if (prev) for (const url of Object.values(prev)) URL.revokeObjectURL(url)
        return result.urls
      })
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
        onOpenPicker={() => fileInputRef.current?.click()}
      />
      <main className="stage">
        <canvas ref={canvasRef} className="gl" />
        <ViewportHud hud={hud} />
        <div className="stage-tr">
          {overlays.inset ? (
            <button
              type="button"
              className="inset-btn"
              onClick={() => setInsetOpen(true)}
              title="点击放大"
              aria-label="放大断面图"
            >
              <canvas ref={insetRef} className="inset" width={360} height={360} />
            </button>
          ) : null}
          <button type="button" className="home" onClick={() => viewerRef.current?.resetCamera()}>
            归位
          </button>
        </div>
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
              width={720}
              height={720}
              onClick={(event) => event.stopPropagation()}
            />
            <p className="inset-hint">点击空白处或按 Esc 关闭</p>
          </div>
        ) : null}
        {meta ? (
          <StationFilm
            key={`${meta.source_name ?? ''}-${meta.s_min}-${meta.s_max}`}
            meta={meta}
            sliderRef={sSliderRef}
            onInput={onStationInput}
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
        底板高 v
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
        总高 {height.toFixed(2)} m，拱矢 {geom.rise.toFixed(2)} m，设计面积 {area.toFixed(2)} m²
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
        <p className="hint">本机 matplotlib（Pyodide Agg）出图，与 Python 同一套 plotting.py。首次需加载 WASM，会慢几秒到十几秒。</p>
      ) : null}
      {props.exportError ? <p className="fail">{props.exportError}</p> : null}
      {props.exportUrls ? (
        <div className="thumbs">
          {EXPORT_OPTIONS.map((item) => {
            const url = props.exportUrls?.[item.id]
            if (!url) return null
            return (
              <a key={item.id} href={url} target="_blank" rel="noreferrer" className="thumb">
                <img src={url} alt={item.label} />
                <span>{item.label}</span>
              </a>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

function StationFilm(props: {
  meta: Meta
  sliderRef: RefObject<HTMLInputElement | null>
  onInput: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  const start = defaultStation(props.meta)
  const mid = (props.meta.s_min + props.meta.s_max) * 0.5
  return (
    <div className="film">
      <div className="sprockets" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((i) => (
          <span key={i} />
        ))}
      </div>
      <div className="film-row">
        <span className="film-label">桩号</span>
      </div>
      <input
        ref={props.sliderRef}
        className="slider film-slider"
        type="range"
        min={props.meta.s_min}
        max={props.meta.s_max}
        step={0.01}
        defaultValue={start}
        aria-label="桩号"
        onChange={props.onInput}
      />
      <div className="chainage">
        <span>{formatMeters(props.meta.s_min)}</span>
        <span>{formatMeters(mid)}</span>
        <span>{formatMeters(props.meta.s_max)}</span>
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
