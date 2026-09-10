import { DEFAULT_METHOD, DISPLAY_FRAME, METHODS, type ExportKind, type Meta, type SliceParams } from './types'
import { flattenContour, packOverview, transferList, type PackedExport } from './exportPack'
import { denseStationRange, estimateFloorDatum, frame, percentileAbs, principalAxis } from './geometry'
import { horseshoePolyline, overbreakStats, polarSamples, polygonArea, type HorseshoeParams } from './horseshoe'
import { parseLas } from './lasParse'
import { LiveSlicer } from './liveSlice'

const VIZ_POINTS = 300000

type InMessage =
  | { type: 'open'; name: string; buffer: ArrayBuffer }
  | { type: 'export'; params: SliceParams; kinds: ExportKind[]; horseshoe: HorseshoeParams }

let full: Float32Array | null = null
let viz: Float32Array | null = null
let meta: Meta | null = null

function postProgress(message: string, sourceName?: string): void {
  self.postMessage({ type: 'progress', message, source_name: sourceName ?? meta?.source_name ?? null })
}

function buildDisplay(world: Float32Array, name: string): { display: Float32Array; vizCloud: Float32Array; nextMeta: Meta } {
  postProgress('正在估计轴线', name)
  const { origin, axis } = principalAxis(world)
  const { u, vUp } = frame(axis)
  const n = (world.length / 3) | 0
  const s = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const dx = world[i * 3] - origin[0]
    const dy = world[i * 3 + 1] - origin[1]
    const dz = world[i * 3 + 2] - origin[2]
    s[i] = dx * axis[0] + dy * axis[1] + dz * axis[2]
  }
  postProgress('正在沿桩号排序', name)
  const order = new Uint32Array(n)
  for (let i = 0; i < n; i += 1) order[i] = i
  order.sort((a, b) => s[a] - s[b])
  const display = new Float32Array(n * 3)
  const sortedS = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const src = order[i]
    const dx = world[src * 3] - origin[0]
    const dy = world[src * 3 + 1] - origin[1]
    const dz = world[src * 3 + 2] - origin[2]
    display[i * 3] = dx * u[0] + dy * u[1] + dz * u[2]
    display[i * 3 + 1] = dx * vUp[0] + dy * vUp[1] + dz * vUp[2]
    display[i * 3 + 2] = s[src]
    sortedS[i] = s[src]
  }
  const [denseLo, denseHi] = denseStationRange(sortedS)
  let i0 = 0
  while (i0 < n && sortedS[i0] < denseLo) i0 += 1
  let i1 = n
  while (i1 > i0 && sortedS[i1 - 1] > denseHi) i1 -= 1
  postProgress('正在估计底板', name)
  const floorV = estimateFloorDatum(display, sortedS, i0, i1)
  for (let i = 0; i < n; i += 1) display[i * 3 + 1] -= floorV
  const absU = new Float64Array(Math.min(n, 400000))
  const absV = new Float64Array(Math.min(n, 400000))
  const absStride = Math.max(1, Math.ceil(n / absU.length))
  let absN = 0
  for (let i = 0; i < n; i += absStride) {
    absU[absN] = Math.abs(display[i * 3])
    absV[absN] = Math.abs(display[i * 3 + 1])
    absN += 1
  }
  const denseCount = Math.max(1, i1 - i0)
  const stride = Math.max(1, Math.ceil(denseCount / VIZ_POINTS))
  const vizCount = Math.ceil(denseCount / stride)
  const vizCloud = new Float32Array(vizCount * 3)
  let w = 0
  for (let i = i0; i < i1; i += stride) {
    vizCloud[w * 3] = display[i * 3]
    vizCloud[w * 3 + 1] = display[i * 3 + 1]
    vizCloud[w * 3 + 2] = display[i * 3 + 2]
    w += 1
  }
  const uvExtent = Math.max(percentileAbs(absU.subarray(0, absN), 0.995), percentileAbs(absV.subarray(0, absN), 0.995), 1.5) * 2.4
  const shiftedOrigin: [number, number, number] = [
    origin[0] + floorV * vUp[0],
    origin[1] + floorV * vUp[1],
    origin[2] + floorV * vUp[2],
  ]
  const nextMeta: Meta = {
    point_count: n,
    viz_count: w,
    s_min: sortedS[0],
    s_max: sortedS[n - 1],
    dense_s_min: denseLo,
    dense_s_max: denseHi,
    uv_extent: uvExtent,
    methods: [...METHODS],
    default_method: DEFAULT_METHOD,
    display_frame: DISPLAY_FRAME,
    floor_v: floorV,
    origin: [...shiftedOrigin],
    axis: [...axis],
    u: [...u],
    v_up: [...vUp],
    source_name: name,
    axes: {
      x: 'u, horizontal across the tunnel',
      y: 'v_up, gravity-aligned up; invert/floor is negative Y',
      z: 's, station along the axis; the tunnel is laid horizontal along Z',
    },
  }
  return { display, vizCloud, nextMeta }
}

self.onmessage = async (event: MessageEvent<InMessage>) => {
  try {
    const data = event.data
    if (data.type === 'open') {
      postProgress(`正在解码 ${data.name}`, data.name)
      const world = parseLas(data.buffer, data.name)
      const built = buildDisplay(world, data.name)
      const vizKeep = built.vizCloud.slice()
      full = built.display
      viz = vizKeep
      meta = built.nextMeta
      self.postMessage({ type: 'ready', meta, viz: built.vizCloud }, { transfer: [built.vizCloud.buffer] })
      return
    }
    if (data.type === 'export') {
      if (!full || !viz || !meta) throw new Error('还没有装入点云')
      // Same cloud and cap as the live inset, so the exported wall contour is that outline.
      const slicer = new LiveSlicer(viz)
      const params = data.params
      const frame = slicer.sample({
        s: params.s,
        thickness: params.thickness,
        method: params.method,
        bins: params.contour_bins,
        smoothWindow: params.smooth_window,
      })
      const slab = slicer.takeSlab()
      const contour = flattenContour(frame.contour_uv)
      const fit = frame.fit
      const compare = data.kinds.includes('compare')
        ? METHODS.map((method) => {
            const item = slicer.sample({
              s: params.s,
              thickness: params.thickness,
              method,
              bins: params.contour_bins,
              smoothWindow: params.smooth_window,
            })
            return {
              method,
              coverage: item.coverage,
              contour: flattenContour(item.contour_uv),
            }
          })
        : []
      const designPoly = horseshoePolyline(data.horseshoe)
      const polar = polarSamples(frame.contour_uv, designPoly, 36)
      const samples = new Float64Array(polar.length * 3)
      for (let i = 0; i < polar.length; i += 1) {
        samples[i * 3] = polar[i].u
        samples[i * 3 + 1] = polar[i].v
        samples[i * 3 + 2] = polar[i].delta
      }
      const wantProfile = data.kinds.some((kind) =>
        kind === 'areaDepth' || kind === 'volumeDepth' || kind === 'gallery' || kind === 'stack',
      )
      const lo = params.range_lo ?? meta.dense_s_min ?? meta.s_min
      const hi = params.range_hi ?? meta.dense_s_max ?? meta.s_max
      const nProf = wantProfile ? 24 : 0
      const stations = new Float64Array(nProf)
      const areas = new Float64Array(nProf)
      const volumes = new Float64Array(nProf)
      const gallery: { s: number; contour: Float64Array }[] = []
      for (let i = 0; i < nProf; i += 1) {
        const s = nProf <= 1 ? lo : lo + (hi - lo) * (i / (nProf - 1))
        const item = slicer.sample({
          s,
          thickness: params.thickness,
          method: params.method,
          bins: params.contour_bins,
          smoothWindow: params.smooth_window,
        })
        stations[i] = s
        areas[i] = polygonArea(item.contour_uv)
        if (i === 0) volumes[i] = 0
        else volumes[i] = volumes[i - 1] + 0.5 * (areas[i] + areas[i - 1]) * (stations[i] - stations[i - 1])
        if (data.kinds.includes('gallery') || data.kinds.includes('stack')) {
          gallery.push({ s, contour: flattenContour(item.contour_uv) })
        }
      }
      const pack: PackedExport = {
        kinds: data.kinds,
        thickness: params.thickness,
        s: params.s,
        axis: Float64Array.from(meta.axis),
        origin: Float64Array.from(meta.origin),
        uAxis: Float64Array.from(meta.u),
        vAxis: Float64Array.from(meta.v_up),
        u: slab.u,
        v: slab.v,
        z: slab.z,
        contour,
        fit,
        overview: packOverview(viz, 120000, lo, hi),
        compare,
        design: flattenContour(designPoly),
        stations,
        areas,
        volumes,
        gallery,
        samples,
        stats: overbreakStats(frame.contour_uv, designPoly),
      }
      self.postMessage({ type: 'packed', pack }, { transfer: transferList(pack) })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '点云处理失败'
    self.postMessage({ type: 'error', message })
  }
}
