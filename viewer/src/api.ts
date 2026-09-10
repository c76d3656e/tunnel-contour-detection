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
  methods: string[]
  default_method: string
  display_frame: string
  origin: number[]
  axis: number[]
  u: number[]
  v_up: number[]
  cloud_url: string
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

export interface SliceParams {
  s: number
  thickness: number
  method: string
  contour_bins: number
  smooth_window: number
}

export type ExportKind = 'section2d' | 'section3d' | 'tunnel3d' | 'compare'

export interface ExportResult {
  stamp: string
  urls: Partial<Record<ExportKind, string>>
  slice: {
    s: number
    point_count: number
    contour_point_count: number
    angular_coverage: number
    fit: Fit | null
    method: string
    thickness: number
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new Error(detail || `请求失败 ${response.status}`)
  }
  return response.json() as Promise<T>
}

export async function fetchHealth(): Promise<Health> {
  return readJson<Health>(await fetch('/api/health'))
}

export async function fetchMeta(): Promise<Meta> {
  return readJson<Meta>(await fetch('/api/meta'))
}

export async function fetchCloud(url = '/api/cloud.bin'): Promise<Float32Array> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('点云二进制读取失败')
  }
  return new Float32Array(await response.arrayBuffer())
}

export async function fetchSlice(params: SliceParams, signal: AbortSignal): Promise<SliceResult> {
  const response = await fetch('/api/slice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  })
  return readJson<SliceResult>(response)
}

export async function fetchExport(params: SliceParams & { kinds: ExportKind[] }): Promise<ExportResult> {
  const response = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return readJson<ExportResult>(response)
}

export async function uploadCloud(file: File): Promise<Health> {
  const body = new FormData()
  body.append('file', file)
  const response = await fetch('/api/open', { method: 'POST', body })
  return readJson<Health>(response)
}

export async function pollHealth(onTick: (health: Health) => void): Promise<Health> {
  for (;;) {
    const health = await fetchHealth()
    onTick(health)
    if (health.status === 'ready' || health.status === 'idle') return health
    if (health.status === 'error') {
      throw new Error(health.message || '点云准备失败')
    }
    await new Promise((resolve) => setTimeout(resolve, 450))
  }
}
