import type { Fit } from './api'

const CIRCLE_SEGS = 96
const SLAB_CAP = 16000
const INSET_CAP = 1800
const QUANTILE = 0.9
const MIN_BIN_POINTS = 2

export interface PreviewFrame {
  s: number
  pointCount: number
  coverage: number
  contour_uv: number[][]
  fit: Fit | null
  fit_line: number[][]
  slab: number[][]
}

export interface SliceOptions {
  s: number
  thickness: number
  method: string
  bins: number
  smoothWindow: number
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function medianSorted(values: number[]): number {
  const n = values.length
  if (n === 0) return NaN
  const mid = n >> 1
  return n % 2 === 1 ? values[mid] : 0.5 * (values[mid - 1] + values[mid])
}

function quantileSorted(values: number[], q: number): number {
  const n = values.length
  if (n === 0) return NaN
  if (n === 1) return values[0]
  const pos = (n - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return values[lo]
  return values[lo] + (values[hi] - values[lo]) * (pos - lo)
}

function lowerBoundZ(xyz: Float32Array, z: number): number {
  const n = (xyz.length / 3) | 0
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (xyz[mid * 3 + 2] < z) lo = mid + 1
    else hi = mid
  }
  return lo
}

function upperBoundZ(xyz: Float32Array, z: number): number {
  const n = (xyz.length / 3) | 0
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (xyz[mid * 3 + 2] <= z) lo = mid + 1
    else hi = mid
  }
  return lo
}

function wrapIndex(index: number, n: number): number {
  let i = index % n
  if (i < 0) i += n
  return i
}

function interpPeriodic(radial: Float64Array, bins: number): void {
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < bins; i += 1) {
    if (!finite(radial[i])) continue
    xs.push(i)
    ys.push(radial[i])
  }
  if (xs.length < 3) return
  const px: number[] = []
  const py: number[] = []
  for (let k = 0; k < xs.length; k += 1) {
    px.push(xs[k] - bins)
    py.push(ys[k])
  }
  for (let k = 0; k < xs.length; k += 1) {
    px.push(xs[k])
    py.push(ys[k])
  }
  for (let k = 0; k < xs.length; k += 1) {
    px.push(xs[k] + bins)
    py.push(ys[k])
  }
  for (let i = 0; i < bins; i += 1) {
    radial[i] = interp1(i, px, py)
  }
}

function interp1(x: number, xs: number[], ys: number[]): number {
  let lo = 0
  let hi = xs.length - 1
  if (x <= xs[0]) return ys[0]
  if (x >= xs[hi]) return ys[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1
    if (xs[mid] <= x) lo = mid
    else hi = mid
  }
  const span = xs[hi] - xs[lo]
  if (span === 0) return ys[lo]
  return ys[lo] + ((x - xs[lo]) / span) * (ys[hi] - ys[lo])
}

function circularHampel(radial: Float64Array, bins: number, window: number): void {
  const size = Math.max(5, (window >> 1) * 2 + 1)
  const half = (size / 2) | 0
  const scratch: number[] = []
  const next = new Float64Array(bins)
  for (let i = 0; i < bins; i += 1) {
    scratch.length = 0
    for (let k = -half; k <= half; k += 1) scratch.push(radial[wrapIndex(i + k, bins)])
    scratch.sort((a, b) => a - b)
    const localMedian = medianSorted(scratch)
    scratch.length = 0
    for (let k = -half; k <= half; k += 1) {
      scratch.push(Math.abs(radial[wrapIndex(i + k, bins)] - localMedian))
    }
    scratch.sort((a, b) => a - b)
    const scale = Math.max(0.015, 1.4826 * medianSorted(scratch))
    const value = radial[i]
    next[i] = Math.abs(value - localMedian) > 3 * scale ? localMedian : value
  }
  radial.set(next)
}

function wrapMedian(radial: Float64Array, bins: number, window: number): void {
  const size = Math.max(3, (window >> 1) * 2 + 1)
  const half = (size / 2) | 0
  const scratch: number[] = []
  const next = new Float64Array(bins)
  for (let i = 0; i < bins; i += 1) {
    scratch.length = 0
    for (let k = -half; k <= half; k += 1) scratch.push(radial[wrapIndex(i + k, bins)])
    scratch.sort((a, b) => a - b)
    next[i] = medianSorted(scratch)
  }
  radial.set(next)
}

function radiusKeep(u: Float64Array, v: Float64Array, n: number): number {
  const radius = 0.08
  const minNeighbors = 3
  const inv = 1 / radius
  const r2 = radius * radius
  const buckets = new Map<number, number[]>()
  for (let i = 0; i < n; i += 1) {
    const ix = Math.floor(u[i] * inv)
    const iy = Math.floor(v[i] * inv)
    const key = ix * 73856093 + iy * 19349663
    const list = buckets.get(key)
    if (list) list.push(i)
    else buckets.set(key, [i])
  }
  const keep = new Uint8Array(n)
  let kept = 0
  for (let i = 0; i < n; i += 1) {
    const ix = Math.floor(u[i] * inv)
    const iy = Math.floor(v[i] * inv)
    let count = 0
    outer: for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const neigh = buckets.get((ix + dx) * 73856093 + (iy + dy) * 19349663)
        if (!neigh) continue
        for (let k = 0; k < neigh.length; k += 1) {
          const j = neigh[k]
          const du = u[i] - u[j]
          const dv = v[i] - v[j]
          if (du * du + dv * dv <= r2) {
            count += 1
            if (count >= minNeighbors) break outer
          }
        }
      }
    }
    if (count >= minNeighbors) {
      keep[i] = 1
      kept += 1
    }
  }
  if (kept < Math.max(20, (n * 0.25) | 0)) return n
  let w = 0
  for (let i = 0; i < n; i += 1) {
    if (!keep[i]) continue
    u[w] = u[i]
    v[w] = v[i]
    w += 1
  }
  return w
}

function fitCircle(us: Float64Array, vs: Float64Array, n: number): Fit | null {
  if (n < 3) return null
  const xs = Array.from(us.subarray(0, n)).sort((a, b) => a - b)
  const ys = Array.from(vs.subarray(0, n)).sort((a, b) => a - b)
  let cx = medianSorted(xs)
  let cy = medianSorted(ys)
  const radii: number[] = []
  for (let i = 0; i < n; i += 1) radii.push(Math.hypot(us[i] - cx, vs[i] - cy))
  radii.sort((a, b) => a - b)
  let r = medianSorted(radii)
  if (!finite(cx) || !finite(cy) || !finite(r) || r < 1e-4) return null

  for (let iter = 0; iter < 8; iter += 1) {
    let j00 = 0
    let j01 = 0
    let j02 = 0
    let j11 = 0
    let j12 = 0
    let j22 = 0
    let b0 = 0
    let b1 = 0
    let b2 = 0
    for (let i = 0; i < n; i += 1) {
      const du = us[i] - cx
      const dv = vs[i] - cy
      const dist = Math.hypot(du, dv) || 1e-9
      const err = dist - r
      const jx = -du / dist
      const jy = -dv / dist
      const jr = -1
      j00 += jx * jx
      j01 += jx * jy
      j02 += jx * jr
      j11 += jy * jy
      j12 += jy * jr
      j22 += jr * jr
      b0 -= jx * err
      b1 -= jy * err
      b2 -= jr * err
    }
    const det =
      j00 * (j11 * j22 - j12 * j12) -
      j01 * (j01 * j22 - j12 * j02) +
      j02 * (j01 * j12 - j11 * j02)
    if (Math.abs(det) < 1e-12) break
    const inv00 = (j11 * j22 - j12 * j12) / det
    const inv01 = (j02 * j12 - j01 * j22) / det
    const inv02 = (j01 * j12 - j02 * j11) / det
    const inv11 = (j00 * j22 - j02 * j02) / det
    const inv12 = (j01 * j02 - j00 * j12) / det
    const inv22 = (j00 * j11 - j01 * j01) / det
    cx += inv00 * b0 + inv01 * b1 + inv02 * b2
    cy += inv01 * b0 + inv11 * b1 + inv12 * b2
    r += inv02 * b0 + inv12 * b1 + inv22 * b2
  }
  r = Math.abs(r)
  let sse = 0
  let maxErr = 0
  for (let i = 0; i < n; i += 1) {
    const err = Math.hypot(us[i] - cx, vs[i] - cy) - r
    sse += err * err
    const abs = Math.abs(err)
    if (abs > maxErr) maxErr = abs
  }
  return {
    center_x: cx,
    center_y: cy,
    radius: r,
    rmse: Math.sqrt(sse / n),
    max_error: maxErr,
  }
}

export class LiveSlicer {
  private xyz: Float32Array
  private u = new Float64Array(SLAB_CAP)
  private v = new Float64Array(SLAB_CAP)
  private radial = new Float64Array(720)
  private buckets: number[][] = Array.from({ length: 720 }, () => [])
  private contourScratch: number[][] = Array.from({ length: 720 }, () => [0, 0])
  private fitScratch: number[][] = Array.from({ length: CIRCLE_SEGS + 1 }, () => [0, 0])
  private slabScratch: number[][] = Array.from({ length: INSET_CAP }, () => [0, 0])
  private empty: PreviewFrame = {
    s: 0,
    pointCount: 0,
    coverage: 0,
    contour_uv: [],
    fit: null,
    fit_line: [],
    slab: [],
  }

  constructor(xyz: Float32Array) {
    this.xyz = xyz
  }

  sample(opts: SliceOptions): PreviewFrame {
    const half = Math.max(0.01, opts.thickness * 0.5)
    const i0 = lowerBoundZ(this.xyz, opts.s - half)
    const i1 = upperBoundZ(this.xyz, opts.s + half)
    const rawCount = i1 - i0
    if (rawCount <= 0) return { ...this.empty, s: opts.s }

    const stride = rawCount > SLAB_CAP ? Math.ceil(rawCount / SLAB_CAP) : 1
    let n = 0
    for (let i = i0; i < i1 && n < SLAB_CAP; i += stride) {
      this.u[n] = this.xyz[i * 3]
      this.v[n] = this.xyz[i * 3 + 1]
      n += 1
    }

    if (opts.method === 'radius' || opts.method === 'robust' || opts.method === 'spline') {
      n = radiusKeep(this.u, this.v, n)
    }

    const bins = Math.max(12, Math.min(720, opts.bins | 0))
    const contour = this.polarEnvelope(n, bins, opts.method, opts.smoothWindow)
    const fit = contour.length >= 3 ? this.fitFromContour(contour) : null
    return {
      s: opts.s,
      pointCount: rawCount,
      coverage: this.lastCoverage,
      contour_uv: contour,
      fit,
      fit_line: fit ? this.circleLine(fit) : [],
      slab: this.insetSlab(n),
    }
  }

  private lastCoverage = 0

  private polarEnvelope(n: number, bins: number, method: string, smoothWindow: number): number[][] {
    if (n === 0) {
      this.lastCoverage = 0
      return []
    }
    const us: number[] = []
    const vs: number[] = []
    for (let i = 0; i < n; i += 1) {
      us.push(this.u[i])
      vs.push(this.v[i])
    }
    us.sort((a, b) => a - b)
    vs.sort((a, b) => a - b)
    const ox = medianSorted(us)
    const oy = medianSorted(vs)
    for (let b = 0; b < bins; b += 1) this.buckets[b].length = 0
    const scale = bins / (Math.PI * 2)
    for (let i = 0; i < n; i += 1) {
      const du = this.u[i] - ox
      const dv = this.v[i] - oy
      const radius = Math.hypot(du, dv)
      let angle = Math.atan2(dv, du)
      let bin = Math.floor((angle + Math.PI) * scale)
      if (bin >= bins) bin = bins - 1
      if (bin < 0) bin = 0
      this.buckets[bin].push(radius)
    }

    const radial = this.radial
    let valid = 0
    for (let b = 0; b < bins; b += 1) {
      const bucket = this.buckets[b]
      if (bucket.length < MIN_BIN_POINTS) {
        radial[b] = Number.NaN
        continue
      }
      bucket.sort((a, c) => a - c)
      radial[b] = quantileSorted(bucket, QUANTILE)
      valid += 1
    }
    this.lastCoverage = valid / bins
    if (valid < 3) return []
    interpPeriodic(radial, bins)

    const smooth =
      method === 'hampel' ? 'hampel' : method === 'robust' || method === 'spline' ? 'robust' : null
    if (smooth === 'hampel' || smooth === 'robust') {
      circularHampel(radial, bins, Math.max(15, smoothWindow))
    }
    if (smooth === 'robust') {
      wrapMedian(radial, bins, Math.max(3, (smoothWindow >> 1) * 2 + 1))
    }

    const out = this.contourScratch
    const step = (Math.PI * 2) / bins
    for (let b = 0; b < bins; b += 1) {
      const angle = -Math.PI + (b + 0.5) * step
      out[b][0] = ox + radial[b] * Math.cos(angle)
      out[b][1] = oy + radial[b] * Math.sin(angle)
    }
    return out.slice(0, bins)
  }

  private fitFromContour(contour: number[][]): Fit | null {
    const n = contour.length
    const us = new Float64Array(n)
    const vs = new Float64Array(n)
    for (let i = 0; i < n; i += 1) {
      us[i] = contour[i][0]
      vs[i] = contour[i][1]
    }
    return fitCircle(us, vs, n)
  }

  private circleLine(fit: Fit): number[][] {
    const out = this.fitScratch
    for (let i = 0; i <= CIRCLE_SEGS; i += 1) {
      const angle = (i / CIRCLE_SEGS) * Math.PI * 2
      out[i][0] = fit.center_x + fit.radius * Math.cos(angle)
      out[i][1] = fit.center_y + fit.radius * Math.sin(angle)
    }
    return out
  }

  private insetSlab(n: number): number[][] {
    if (n === 0) return []
    const stride = Math.max(1, Math.ceil(n / INSET_CAP))
    const out = this.slabScratch
    let used = 0
    for (let i = 0; i < n && used < INSET_CAP; i += stride) {
      out[used][0] = this.u[i]
      out[used][1] = this.v[i]
      used += 1
    }
    return out.slice(0, used)
  }
}
