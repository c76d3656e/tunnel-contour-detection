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

/** Pack the live display cloud as (u, v, s). 3D figures swizzle this to (u, s, v). */
export function packOverview(
  viz: Float32Array,
  limit = 120000,
  lo?: number,
  hi?: number,
): Float64Array {
  const count = (viz.length / 3) | 0
  const clipped = lo !== undefined && hi !== undefined
  const picks: number[] = []
  for (let i = 0; i < count; i += 1) {
    if (clipped) {
      const s = viz[i * 3 + 2]
      if (s < lo || s > hi) continue
    }
    picks.push(i)
  }
  const n = picks.length
  const stride = Math.max(1, Math.ceil(n / limit))
  const kept = Math.ceil(n / stride)
  const out = new Float64Array(kept * 3)
  let w = 0
  for (let k = 0; k < n; k += stride) {
    const i = picks[k]
    out[w * 3] = viz[i * 3]
    out[w * 3 + 1] = viz[i * 3 + 1]
    out[w * 3 + 2] = viz[i * 3 + 2]
    w += 1
  }
  return out.subarray(0, w * 3)
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
