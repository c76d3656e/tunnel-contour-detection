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
  fetchCloud,
  fetchExport,
  fetchMeta,
  pollHealth,
  uploadCloud,
  type ExportKind,
  type Health,
  type Meta,
} from './api'
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
]

interface HudState {
  s: number
  pointCount: number
  coverage: number
  radius: number | null
}

interface OverlayState {
  slab: boolean
  contour: boolean
  fit: boolean
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

function drawUvInset(
  canvas: HTMLCanvasElement,
  slice: PreviewFrame | null,
  uvExtent: number,
  look: Appearance,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const width = canvas.width
  const height = canvas.height
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = look.theme === 'light' ? '#f7f1e6' : '#eadfcb'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = 'rgba(63,143,136,0.28)'
  ctx.lineWidth = 1
  for (let y = 22; y < height; y += 18) {
    ctx.beginPath()
    ctx.moveTo(8, y)
    ctx.lineTo(width - 8, y)
    ctx.stroke()
  }
  const pad = 22
  const size = Math.min(width, height) - pad * 2
  const cx = width * 0.5
  const cy = height * 0.52
  const span = Math.max(0.8, uvExtent * 0.42)
  const scale = size / (span * 2)
  const xOf = (u: number) => cx + u * scale
  const yOf = (v: number) => cy - v * scale

  ctx.strokeStyle = 'rgba(28,22,18,0.28)'
  ctx.beginPath()
  ctx.moveTo(pad, cy)
  ctx.lineTo(width - pad, cy)
  ctx.moveTo(cx, pad)
  ctx.lineTo(cx, height - 16)
  ctx.stroke()

  ctx.fillStyle = '#5c5348'
  ctx.font = '11px "IBM Plex Mono", monospace'
  ctx.fillText('u', width - 20, cy - 6)
  ctx.fillText('v', cx + 6, 16)

  if (!slice) return

  if (slice.slab.length > 0) {
    ctx.fillStyle = look.slice
    for (let i = 0; i < slice.slab.length; i += 1) {
      const p = slice.slab[i]
      ctx.fillRect(xOf(p[0]) - 0.8, yOf(p[1]) - 0.8, 1.6, 1.6)
    }
  }

  if (slice.fit) {
    ctx.strokeStyle = look.fit
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(xOf(slice.fit.center_x), yOf(slice.fit.center_y), slice.fit.radius * scale, 0, Math.PI * 2)
    ctx.stroke()
  }

  if (slice.contour_uv.length > 1) {
    ctx.strokeStyle = look.contour
    ctx.lineWidth = 1.8
    ctx.beginPath()
    const first = slice.contour_uv[0]
    ctx.moveTo(xOf(first[0]), yOf(first[1]))
    for (let i = 1; i < slice.contour_uv.length; i += 1) {
      const p = slice.contour_uv[i]
      ctx.lineTo(xOf(p[0]), yOf(p[1]))
    }
    ctx.closePath()
    ctx.stroke()
  }
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const insetRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<InstanceType<typeof import('./viewer/TunnelViewer').TunnelViewer> | null>(null)
  const sRef = useRef(0)
  const thicknessRef = useRef(DEFAULT_THICKNESS)
  const methodRef = useRef('hampel')
  const binsRef = useRef(DEFAULT_BINS)
  const smoothRef = useRef(DEFAULT_SMOOTH)
  const metaRef = useRef<Meta | null>(null)
  const sSliderRef = useRef<HTMLInputElement>(null)
  const thickSliderRef = useRef<HTMLInputElement>(null)
  const sLiveRef = useRef<HTMLSpanElement>(null)
  const thickLiveRef = useRef<HTMLSpanElement>(null)
  const paintRaf = useRef(0)
  const slicerRef = useRef<LiveSlicer | null>(null)
  const lastFrameRef = useRef<PreviewFrame | null>(null)
  const lookRef = useRef<Appearance>(loadAppearance())

  const [health, setHealth] = useState<Health>({ status: 'loading', message: '正在连接' })
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [swapBusy, setSwapBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const reloadRef = useRef<() => Promise<void>>(async () => {})
  const [look, setLook] = useState<Appearance>(() => lookRef.current)
  const [method, setMethod] = useState('hampel')
  const [bins, setBins] = useState(DEFAULT_BINS)
  const [smooth, setSmooth] = useState(DEFAULT_SMOOTH)
  const [overlays, setOverlays] = useState<OverlayState>({
    slab: true,
    contour: true,
    fit: true,
    inset: true,
  })
  const [hud, setHud] = useState<HudState | null>(null)
  const [kinds, setKinds] = useState<Record<ExportKind, boolean>>({
    section2d: true,
    section3d: true,
    tunnel3d: true,
    compare: false,
  })
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportUrls, setExportUrls] = useState<Partial<Record<ExportKind, string>> | null>(null)

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
    viewer.applyPreview(frame)
    if (insetRef.current) {
      drawUvInset(insetRef.current, frame, currentMeta.uv_extent, lookRef.current)
    }
    startTransition(() => {
      setHud({
        s: frame.s,
        pointCount: frame.pointCount,
        coverage: frame.coverage,
        radius: frame.fit ? frame.fit.radius : null,
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
    if (sLiveRef.current) sLiveRef.current.textContent = formatMeters(next)
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
    let generation = 0

    const reloadCloud = async () => {
      const gen = ++generation
      const healthNow = await pollHealth((next) => {
        if (!cancelled && gen === generation) setHealth(next)
      })
      if (cancelled || gen !== generation) return
      if (healthNow.status !== 'ready') {
        if (!metaRef.current) setMeta(null)
        return
      }
      const nextMeta = await fetchMeta()
      if (cancelled || gen !== generation) return
      const methodName = nextMeta.default_method || methodRef.current || 'hampel'
      methodRef.current = methodName
      const cloud = await fetchCloud(nextMeta.cloud_url)
      if (cancelled || gen !== generation) return
      const station = defaultStation(nextMeta)
      metaRef.current = nextMeta
      sRef.current = station
      slicerRef.current = new LiveSlicer(cloud)
      lastFrameRef.current = null
      setMeta(nextMeta)
      setMethod(methodName)
      setExportUrls(null)
      setError(null)
      const currentViewer = viewerRef.current
      if (!currentViewer) return
      await currentViewer.loadCloud(cloud, nextMeta, station)
      if (cancelled || gen !== generation) return
      currentViewer.setAppearance(lookRef.current)
      currentViewer.setThickness(thicknessRef.current)
      if (sLiveRef.current) sLiveRef.current.textContent = formatMeters(station)
      if (thickLiveRef.current) thickLiveRef.current.textContent = formatMeters(thicknessRef.current)
      paintPreview()
    }
    reloadRef.current = () =>
      reloadCloud().catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '无法装入点云')
      })

    ;(async () => {
      const { TunnelViewer } = await import('./viewer/TunnelViewer')
      if (cancelled) return
      viewer = new TunnelViewer(canvas)
      viewerRef.current = viewer
      await reloadCloud()
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : '无法装入点云')
    })

    return () => {
      cancelled = true
      if (paintRaf.current) window.cancelAnimationFrame(paintRaf.current)
      viewer?.dispose()
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    lookRef.current = look
    applyThemeClass(look.theme)
    saveAppearance(look)
    viewerRef.current?.setAppearance(look)
    if (overlays.inset && insetRef.current && lastFrameRef.current && metaRef.current) {
      drawUvInset(insetRef.current, lastFrameRef.current, metaRef.current.uv_extent, look)
    }
  }, [look, overlays.inset])

  useEffect(() => {
    viewerRef.current?.setOverlays(overlays)
    if (overlays.inset && insetRef.current && lastFrameRef.current && metaRef.current) {
      drawUvInset(insetRef.current, lastFrameRef.current, metaRef.current.uv_extent, lookRef.current)
    }
  }, [overlays])

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

  const onTint = (key: 'cloud' | 'slice' | 'contour' | 'fit', value: string) => {
    setLook((prev) => ({ ...prev, [key]: value }))
  }

  const onBrightness = (value: number) => {
    setLook((prev) => ({ ...prev, brightness: clamp(value, 0.28, 1) }))
  }

  const onResetLook = () => {
    setLook(defaultAppearance(look.theme))
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
    setHealth({ status: 'loading', message: `正在接收 ${file.name}`, source_name: file.name })
    try {
      await uploadCloud(file)
      await reloadRef.current()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '无法装入点云')
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
    try {
      const result = await fetchExport({
        s: sRef.current,
        thickness: thicknessRef.current,
        method: methodRef.current,
        contour_bins: binsRef.current,
        smooth_window: smoothRef.current,
        kinds: selected,
      })
      setExportUrls(result.urls)
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
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
        ? '打开一卷 LAS 或 LAZ 点云。'
        : health.message

  return (
    <div className="shell">
      <input
        id="las-file"
        ref={fileInputRef}
        className="file-input"
        type="file"
        accept=".las,.laz"
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
        kinds={kinds}
        exporting={exporting}
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
        onKinds={setKinds}
        onExport={onExport}
        onOpenPicker={() => fileInputRef.current?.click()}
      />
      <main className="stage">
        <canvas ref={canvasRef} className="gl" />
        <button type="button" className="home" onClick={() => viewerRef.current?.resetCamera()}>
          归位
        </button>
        <ViewportHud hud={hud} />
        {overlays.inset ? <canvas ref={insetRef} className="inset" width={220} height={220} /> : null}
        {meta ? (
          <StationFilm
            key={`${meta.source_name ?? ''}-${meta.s_min}-${meta.s_max}`}
            meta={meta}
            sliderRef={sSliderRef}
            liveRef={sLiveRef}
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
                  打开 LAS / LAZ
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
  kinds: Record<ExportKind, boolean>
  exporting: boolean
  exportError: string | null
  exportUrls: Partial<Record<ExportKind, string>> | null
  thickSliderRef: RefObject<HTMLInputElement | null>
  thickLiveRef: RefObject<HTMLSpanElement | null>
  onThickInput: (event: ChangeEvent<HTMLInputElement>) => void
  onMethod: (event: ChangeEvent<HTMLSelectElement>) => void
  onBins: (event: ChangeEvent<HTMLInputElement>) => void
  onSmooth: (event: ChangeEvent<HTMLInputElement>) => void
  onTheme: (theme: ThemeId) => void
  onTint: (key: 'cloud' | 'slice' | 'contour' | 'fit', value: string) => void
  onBrightness: (value: number) => void
  onResetLook: () => void
  onOverlays: Dispatch<SetStateAction<OverlayState>>
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
          {props.uploading ? '正在读入…' : props.sourceName ? '换一卷 LAS / LAZ' : '打开 LAS / LAZ'}
        </button>
        <p className="hint">换卷后按新文件估计轴线，不会沿用上一卷的姿态。</p>
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

      <details className="block advanced">
        <summary>颜色</summary>
        <div className="tints">
          {(
            [
              ['cloud', '点云灰'],
              ['slice', '切片点'],
              ['contour', '轮廓线'],
              ['fit', '拟合圆'],
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
        disabled={props.uploading || !props.meta}
        exportError={props.exportError}
        exportUrls={props.exportUrls}
        onKinds={props.onKinds}
        onExport={props.onExport}
      />
    </aside>
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
    { key: 'inset', label: '断面草图' },
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
        {props.exporting ? '正在出图…' : '导出当前剖面'}
      </button>
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
  liveRef: RefObject<HTMLSpanElement | null>
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
        <span ref={props.liveRef} className="readout film-readout">
          {formatMeters(start)}
        </span>
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
    </dl>
  )
}
