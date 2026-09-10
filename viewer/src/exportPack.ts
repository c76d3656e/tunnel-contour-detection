import type { ExportKind, Fit } from './types'
import type { OverbreakStats } from './horseshoe'

export interface PackedCompare {
  method: string
  coverage: number
  contour: Float64Array
}

export interface PackedGallery {
  s: number
  contour: Float64Array
}

export interface PackedExport {
  kinds: ExportKind[]
  thickness: number
  s: number
  axis: Float64Array
  origin: Float64Array
  uAxis: Float64Array
  vAxis: Float64Array
  u: Float64Array
  v: Float64Array
  z: Float64Array
  contour: Float64Array
  fit: Fit | null
  overview: Float64Array
  compare: PackedCompare[]
  design: Float64Array
  stations: Float64Array
  areas: Float64Array
  volumes: Float64Array
  gallery: PackedGallery[]
  samples: Float64Array
  stats: OverbreakStats | null
}

export function flattenContour(contour: number[][]): Float64Array {
  const out = new Float64Array(contour.length * 2)
  for (let i = 0; i < contour.length; i += 1) {
    out[i * 2] = contour[i][0]
    out[i * 2 + 1] = contour[i][1]
  }
  return out
}

export function worldFromDisplay(
  u: Float64Array,
  v: Float64Array,
  s: Float64Array,
  origin: number[],
  axis: number[],
  uAxis: number[],
  vAxis: number[],
): Float64Array {
  const n = u.length
  const out = new Float64Array(n * 3)
  for (let i = 0; i < n; i += 1) {
    const uu = u[i]
    const vv = v[i]
    const ss = s[i]
    out[i * 3] = origin[0] + uu * uAxis[0] + vv * vAxis[0] + ss * axis[0]
    out[i * 3 + 1] = origin[1] + uu * uAxis[1] + vv * vAxis[1] + ss * axis[1]
    out[i * 3 + 2] = origin[2] + uu * uAxis[2] + vv * vAxis[2] + ss * axis[2]
  }
  return out
}

export function overviewWorld(
  viz: Float32Array,
  origin: number[],
  axis: number[],
  uAxis: number[],
  vAxis: number[],
  limit = 120000,
): Float64Array {
  const count = (viz.length / 3) | 0
  const stride = Math.max(1, Math.ceil(count / limit))
  const kept = Math.ceil(count / stride)
  const u = new Float64Array(kept)
  const v = new Float64Array(kept)
  const s = new Float64Array(kept)
  let w = 0
  for (let i = 0; i < count; i += stride) {
    u[w] = viz[i * 3]
    v[w] = viz[i * 3 + 1]
    s[w] = viz[i * 3 + 2]
    w += 1
  }
  return worldFromDisplay(u.subarray(0, w), v.subarray(0, w), s.subarray(0, w), origin, axis, uAxis, vAxis)
}

export function transferList(pack: PackedExport): Transferable[] {
  const seen = new Set<ArrayBuffer>()
  const buffers: Transferable[] = []
  const add = (data: Float64Array) => {
    const buf = data.buffer
    if (seen.has(buf)) return
    seen.add(buf)
    buffers.push(buf)
  }
  add(pack.axis)
  add(pack.origin)
  add(pack.uAxis)
  add(pack.vAxis)
  add(pack.u)
  add(pack.v)
  add(pack.z)
  add(pack.contour)
  add(pack.overview)
  add(pack.design)
  add(pack.stations)
  add(pack.areas)
  add(pack.volumes)
  add(pack.samples)
  for (const item of pack.compare) add(item.contour)
  for (const item of pack.gallery) add(item.contour)
  return buffers
}
