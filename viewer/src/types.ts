export type HealthStatus = 'loading' | 'ready' | 'error' | 'idle'

export interface Health {
  status: HealthStatus
  message: string
  source_name?: string | null
}

export interface Meta {
  point_count: number
  viz_count: number
  s_min: number
  s_max: number
  dense_s_min?: number
  dense_s_max?: number
  uv_extent: number
  /** Raw v of the measured floor before the frame was shifted; the frame's 0 now sits on it. */
  floor_v?: number
  methods: string[]
  default_method: string
  display_frame: string
  origin: number[]
  axis: number[]
  u: number[]
  v_up: number[]
  source_name?: string
  axes: { x: string; y: string; z: string }
}

export interface Fit {
  center_x: number
  center_y: number
  radius: number
  rmse: number
  max_error: number
}

export interface SliceParams {
  s: number
  thickness: number
  method: string
  contour_bins: number
  smooth_window: number
  /** Inclusive working window; gallery / area / volume / overview stay inside it. */
  range_lo?: number
  range_hi?: number
}

export type ExportKind =
  | 'section2d'
  | 'section3d'
  | 'tunnel3d'
  | 'compare'
  | 'areaDepth'
  | 'volumeDepth'
  | 'gallery'
  | 'stack'
  | 'overbreak'
  /** The live inset's section: points, contour, fit circle and design profile. */
  | 'liveSection'

export interface SliceResult {
  s: number
  thickness: number
  method: string
  point_count: number
  contour_point_count: number
  angular_coverage: number
  fit: Fit | null
  contour: number[][]
  contour_uv: number[][]
  fit_line: number[][]
  slab: number[][]
}

export interface ExportResult {
  stamp: string
  urls: Partial<Record<ExportKind, string>>
  zipUrl: string | null
  zipName: string
}

export const METHODS = ['legacy', 'statistical', 'radius', 'hampel', 'robust', 'spline'] as const
export const DEFAULT_METHOD = 'hampel'
export const DISPLAY_FRAME = 'uvs-v3'
