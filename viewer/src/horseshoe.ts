/** Straight-wall circular-arch horseshoe matching docs/巷道设计断面.png (shape, not the millimetre numbers). */

export interface HorseshoeParams {
  width: number
  wallHeight: number
  archRadius: number
  centerU: number
  invertV: number
}

export interface OverbreakStats {
  maxOver: number
  meanOver: number
  maxUnder: number
  meanUnder: number
  overArea: number
  underArea: number
  nOver: number
  nUnder: number
}

export interface PolarSample {
  angle: number
  designR: number
  measR: number
  delta: number
  u: number
  v: number
}

/** Drawing proportions: wall 2800 / width 5000, R 3322 / width 5000. */
export const DESIGN_WALL_BY_WIDTH = 2800 / 5000
export const DESIGN_RADIUS_BY_WIDTH = 3322 / 5000

export const DEFAULT_HORSESHOE: HorseshoeParams = {
  width: 3.0,
  wallHeight: 3.0 * DESIGN_WALL_BY_WIDTH,
  archRadius: 3.0 * DESIGN_RADIUS_BY_WIDTH,
  centerU: 0,
  invertV: 0,
}

/** v2: the display frame's 0 moved onto the measured floor, so invertV is now relative to it. */
const STORAGE_KEY = 'tunnel-horseshoe-v2'

export function clampHorseshoe(raw: Partial<HorseshoeParams>): HorseshoeParams {
  const width = clamp(Number(raw.width) || DEFAULT_HORSESHOE.width, 0.6, 12)
  const wallHeight = clamp(Number(raw.wallHeight) || width * DESIGN_WALL_BY_WIDTH, 0.2, 8)
  const archRadius = clamp(Number(raw.archRadius) || width * DESIGN_RADIUS_BY_WIDTH, width * 0.5 + 0.02, 16)
  return {
    width,
    wallHeight,
    archRadius,
    centerU: clamp(Number(raw.centerU) || 0, -8, 8),
    invertV: clamp(Number.isFinite(Number(raw.invertV)) ? Number(raw.invertV) : DEFAULT_HORSESHOE.invertV, -8, 8),
  }
}

export function loadHorseshoe(): HorseshoeParams {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_HORSESHOE }
    return clampHorseshoe(JSON.parse(raw) as Partial<HorseshoeParams>)
  } catch {
    return { ...DEFAULT_HORSESHOE }
  }
}

export function saveHorseshoe(params: HorseshoeParams): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(params))
}

export function archGeometry(p: HorseshoeParams): { radius: number; cu: number; cv: number; rise: number; alpha: number } {
  const half = p.width * 0.5
  const radius = Math.max(p.archRadius, half + 1e-4)
  const drop = Math.sqrt(Math.max(0, radius * radius - half * half))
  const rise = radius - drop
  const alpha = Math.atan2(drop, half)
  return {
    radius,
    cu: p.centerU,
    cv: p.invertV + p.wallHeight - drop,
    rise,
    alpha,
  }
}

export function horseshoeHeight(p: HorseshoeParams): number {
  return p.wallHeight + archGeometry(p).rise
}

export function horseshoePolyline(p: HorseshoeParams, arcSteps = 72): number[][] {
  const half = p.width * 0.5
  const left = p.centerU - half
  const right = p.centerU + half
  const floor = p.invertV
  const spring = p.invertV + p.wallHeight
  const { radius, cu, cv, alpha } = archGeometry(p)
  const pts: number[][] = [[left, floor], [right, floor], [right, spring]]
  const span = Math.PI - 2 * alpha
  for (let i = 1; i < arcSteps; i += 1) {
    const ang = alpha + (span * i) / arcSteps
    pts.push([cu + radius * Math.cos(ang), cv + radius * Math.sin(ang)])
  }
  pts.push([left, spring], [left, floor])
  return pts
}

export function polygonArea(points: number[][]): number {
  if (points.length < 3) return 0
  let acc = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    acc += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(acc) * 0.5
}

export function pointInPolygon(u: number, v: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const ui = ring[i][0]
    const vi = ring[i][1]
    const uj = ring[j][0]
    const vj = ring[j][1]
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi + 1e-18) + ui) inside = !inside
  }
  return inside
}

/** Signed distance: outside (overbreak) > 0, inside (underbreak) < 0. */
export function signedDistance(u: number, v: number, ring: number[][]): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const d = distToSegment(u, v, a[0], a[1], b[0], b[1])
    if (d < best) best = d
  }
  if (!Number.isFinite(best)) return 0
  return pointInPolygon(u, v, ring) ? -best : best
}

export function overbreakStats(contour: number[][], design: number[][]): OverbreakStats {
  const empty: OverbreakStats = {
    maxOver: 0,
    meanOver: 0,
    maxUnder: 0,
    meanUnder: 0,
    overArea: 0,
    underArea: 0,
    nOver: 0,
    nUnder: 0,
  }
  if (contour.length < 3 || design.length < 3) return empty
  let overSum = 0
  let underSum = 0
  let nOver = 0
  let nUnder = 0
  let maxOver = 0
  let maxUnder = 0
  for (const p of contour) {
    const d = signedDistance(p[0], p[1], design)
    if (d > 0) {
      nOver += 1
      overSum += d
      if (d > maxOver) maxOver = d
    } else if (d < 0) {
      nUnder += 1
      underSum += -d
      if (-d > maxUnder) maxUnder = -d
    }
  }
  const polar = polarSamples(contour, design, 180)
  let overArea = 0
  let underArea = 0
  if (polar.length > 1) {
    for (let i = 0; i < polar.length; i += 1) {
      const a = polar[i]
      const b = polar[(i + 1) % polar.length]
      const dtheta = Math.abs(b.angle - a.angle)
      const step = dtheta > Math.PI ? 2 * Math.PI - dtheta : dtheta
      const slice = 0.5 * (a.measR * a.measR - a.designR * a.designR) * step
      if (slice > 0) overArea += slice
      else underArea += -slice
    }
  }
  return {
    maxOver,
    meanOver: nOver ? overSum / nOver : 0,
    maxUnder,
    meanUnder: nUnder ? underSum / nUnder : 0,
    overArea,
    underArea,
    nOver,
    nUnder,
  }
}

export function polarSamples(contour: number[][], design: number[][], bins = 36): PolarSample[] {
  if (design.length < 3) return []
  const origin = interiorPoint(design)
  const out: PolarSample[] = []
  for (let i = 0; i < bins; i += 1) {
    const angle = (i / bins) * Math.PI * 2 - Math.PI
    const du = Math.cos(angle)
    const dv = Math.sin(angle)
    const designR = rayHit(origin[0], origin[1], du, dv, design)
    const measR = contour.length >= 3 ? rayHit(origin[0], origin[1], du, dv, contour) : NaN
    if (!Number.isFinite(designR) || designR <= 0) continue
    const meas = Number.isFinite(measR) && measR > 0 ? measR : designR
    out.push({
      angle,
      designR,
      measR: meas,
      delta: meas - designR,
      u: origin[0] + meas * du,
      v: origin[1] + meas * dv,
    })
  }
  return out
}

/** Fit the design profile to a measured contour; the invert lands on the frame's 0, i.e. the floor datum. */
export function alignToContour(contour: number[][], previous?: HorseshoeParams): HorseshoeParams {
  if (contour.length < 3) return clampHorseshoe(previous ?? DEFAULT_HORSESHOE)
  let minU = Infinity
  let maxU = -Infinity
  for (const p of contour) {
    if (p[0] < minU) minU = p[0]
    if (p[0] > maxU) maxU = p[0]
  }
  const width = clamp(maxU - minU, 0.8, 12)
  return clampHorseshoe({
    width,
    wallHeight: width * DESIGN_WALL_BY_WIDTH,
    archRadius: width * DESIGN_RADIUS_BY_WIDTH,
    centerU: 0.5 * (minU + maxU),
    invertV: 0,
  })
}

export function applyDrawingRatios(width: number, centerU: number, invertV: number): HorseshoeParams {
  return clampHorseshoe({
    width,
    wallHeight: width * DESIGN_WALL_BY_WIDTH,
    archRadius: width * DESIGN_RADIUS_BY_WIDTH,
    centerU,
    invertV,
  })
}

function interiorPoint(ring: number[][]): [number, number] {
  let su = 0
  let sv = 0
  for (const p of ring) {
    su += p[0]
    sv += p[1]
  }
  return [su / ring.length, sv / ring.length]
}

function rayHit(ou: number, ov: number, du: number, dv: number, ring: number[][]): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i += 1) {
    const ax = ring[i][0]
    const ay = ring[i][1]
    const bx = ring[(i + 1) % ring.length][0]
    const by = ring[(i + 1) % ring.length][1]
    const t = raySegment(ou, ov, du, dv, ax, ay, bx, by)
    if (t > 1e-6 && t < best) best = t
  }
  return best
}

function raySegment(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const ex = bx - ax
  const ey = by - ay
  const den = dx * ey - dy * ex
  if (Math.abs(den) < 1e-12) return Infinity
  const t = ((ax - ox) * ey - (ay - oy) * ex) / den
  const u = ((ax - ox) * dy - (ay - oy) * dx) / den
  if (t > 0 && u >= 0 && u <= 1) return t
  return Infinity
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax
  const ey = by - ay
  const len2 = ex * ex + ey * ey
  if (len2 < 1e-18) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * ex + (py - ay) * ey) / len2
  t = Math.min(1, Math.max(0, t))
  return Math.hypot(px - (ax + t * ex), py - (ay + t * ey))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
