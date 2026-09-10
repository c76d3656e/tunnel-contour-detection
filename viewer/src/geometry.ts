/** Display-frame helpers ported from tunnel_pc/geometry.py. */

export interface Frame {
  origin: [number, number, number]
  axis: [number, number, number]
  u: [number, number, number]
  vUp: [number, number, number]
}

function median(values: Float64Array): number {
  const copy = Float64Array.from(values)
  copy.sort()
  const n = copy.length
  const mid = n >> 1
  return n % 2 === 1 ? copy[mid] : 0.5 * (copy[mid - 1] + copy[mid])
}

function subsampleCount(n: number): number {
  return Math.min(n, 250000)
}

function subsampleStride(n: number): number {
  return Math.max(1, Math.ceil(n / subsampleCount(n)))
}

function largestEigenvec(xx: number, xy: number, xz: number, yy: number, yz: number, zz: number): [number, number, number] {
  let x = 1
  let y = 0.2
  let z = 0.1
  for (let i = 0; i < 24; i += 1) {
    const nx = xx * x + xy * y + xz * z
    const ny = xy * x + yy * y + yz * z
    const nz = xz * x + yz * y + zz * z
    const norm = Math.hypot(nx, ny, nz) || 1
    x = nx / norm
    y = ny / norm
    z = nz / norm
  }
  return [x, y, z]
}

export function principalAxis(xyz: Float32Array): { origin: [number, number, number]; axis: [number, number, number] } {
  const n = (xyz.length / 3) | 0
  if (n < 3) throw new Error('点数太少，无法估计轴线')
  const stride = subsampleStride(n)
  const count = Math.floor((n + stride - 1) / stride)
  const xs = new Float64Array(count)
  const ys = new Float64Array(count)
  const zs = new Float64Array(count)
  let w = 0
  for (let i = 0; i < n; i += stride) {
    xs[w] = xyz[i * 3]
    ys[w] = xyz[i * 3 + 1]
    zs[w] = xyz[i * 3 + 2]
    w += 1
  }
  const origin: [number, number, number] = [median(xs.subarray(0, w)), median(ys.subarray(0, w)), median(zs.subarray(0, w))]
  let xx = 0
  let xy = 0
  let xz = 0
  let yy = 0
  let yz = 0
  let zz = 0
  for (let i = 0; i < w; i += 1) {
    const dx = xs[i] - origin[0]
    const dy = ys[i] - origin[1]
    const dz = zs[i] - origin[2]
    xx += dx * dx
    xy += dx * dy
    xz += dx * dz
    yy += dy * dy
    yz += dy * dz
    zz += dz * dz
  }
  let axis = largestEigenvec(xx, xy, xz, yy, yz, zz)
  let best = 0
  if (Math.abs(axis[1]) > Math.abs(axis[best])) best = 1
  if (Math.abs(axis[2]) > Math.abs(axis[best])) best = 2
  if (axis[best] < 0) axis = [-axis[0], -axis[1], -axis[2]]
  return { origin, axis }
}

export function frame(axis: [number, number, number], up: [number, number, number] = [0, 0, 1]): {
  u: [number, number, number]
  vUp: [number, number, number]
} {
  const ref: [number, number, number] =
    Math.abs(axis[0] * up[0] + axis[1] * up[1] + axis[2] * up[2]) < 0.9 ? up : [1, 0, 0]
  let u: [number, number, number] = [
    axis[1] * ref[2] - axis[2] * ref[1],
    axis[2] * ref[0] - axis[0] * ref[2],
    axis[0] * ref[1] - axis[1] * ref[0],
  ]
  const uNorm = Math.hypot(u[0], u[1], u[2]) || 1
  u = [u[0] / uNorm, u[1] / uNorm, u[2] / uNorm]
  let vUp: [number, number, number] = [
    axis[1] * u[2] - axis[2] * u[1],
    axis[2] * u[0] - axis[0] * u[2],
    axis[0] * u[1] - axis[1] * u[0],
  ]
  if (vUp[0] * up[0] + vUp[1] * up[1] + vUp[2] * up[2] < 0) {
    u = [-u[0], -u[1], -u[2]]
    vUp = [-vUp[0], -vUp[1], -vUp[2]]
  }
  return { u, vUp }
}

export function denseStationRange(s: Float32Array, bins = 64): [number, number] {
  const n = s.length
  if (n < 50) return [s[0], s[n - 1]]
  const lo = s[0]
  const hi = s[n - 1]
  const span = hi - lo || 1
  const counts = new Float64Array(bins)
  for (let i = 0; i < n; i += 1) {
    let b = Math.floor(((s[i] - lo) / span) * bins)
    if (b >= bins) b = bins - 1
    if (b < 0) b = 0
    counts[b] += 1
  }
  let peak = 0
  for (let i = 0; i < bins; i += 1) if (counts[i] > peak) peak = counts[i]
  const thresh = Math.max(peak * 0.003, 800)
  let first = -1
  let last = -1
  for (let i = 0; i < bins; i += 1) {
    if (counts[i] < thresh) continue
    if (first < 0) first = i
    last = i
  }
  if (first < 0) {
    const i2 = Math.floor(n * 0.02)
    const i995 = Math.min(n - 1, Math.floor(n * 0.995))
    return [s[i2], s[i995]]
  }
  return [lo + (first / bins) * span, lo + ((last + 1) / bins) * span]
}

export function percentileAbs(values: Float64Array, q: number): number {
  const copy = Float64Array.from(values)
  copy.sort()
  const pos = (copy.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return copy[lo]
  return copy[lo] + (copy[hi] - copy[lo]) * (pos - lo)
}
