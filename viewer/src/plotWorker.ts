import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs'
import plottingSrc from '../../tunnel_pc/plotting.py?raw'
import type { ExportKind } from './types'
import type { PackedExport } from './exportPack'

const INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/'

const BOOTSTRAP = `
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401

def _f8(path):
    data = Path(path).read_bytes()
    if not data:
        return np.empty((0,), dtype=np.float64)
    return np.frombuffer(data, dtype="<f8")

def _xy(path):
    raw = _f8(path)
    if raw.size == 0:
        return np.empty((0, 2), dtype=np.float64)
    return raw.reshape(-1, 2)

def _xyz(path):
    raw = _f8(path)
    if raw.size == 0:
        return np.empty((0, 3), dtype=np.float64)
    return raw.reshape(-1, 3)

def render_figures(kinds, thickness, station, fit, methods):
    u = _f8("/tmp/u.bin")
    v = _f8("/tmp/v.bin")
    contour = _xy("/tmp/contour.bin")
    slab = _xyz("/tmp/slab_xyz.bin")
    contour_xyz = _xyz("/tmp/contour_xyz.bin")
    overview = _xyz("/tmp/overview.bin")
    origin = _f8("/tmp/origin.bin")
    axis = _f8("/tmp/axis.bin")
    files = {}
    if "section2d" in kinds:
        path = Path("/tmp/section_2d.png")
        save_section_plot(path, u, v, contour, fit)
        files["section2d"] = str(path)
    if "section3d" in kinds:
        path = Path("/tmp/section_3d.png")
        save_section_3d_plot(path, slab, contour_xyz, axis, thickness)
        files["section3d"] = str(path)
    if "tunnel3d" in kinds:
        path = Path("/tmp/tunnel_3d.png")
        center = origin + station * axis
        save_tunnel_3d_plot(path, overview, contour_xyz, axis, thickness, center)
        files["tunnel3d"] = str(path)
    if "compare" in kinds:
        results = {}
        for name in methods:
            raw = _xy(f"/tmp/contour_{name}.bin")
            cov_path = Path(f"/tmp/cov_{name}.txt")
            if cov_path.exists() and raw.size:
                coverage = float(cov_path.read_text())
                results[name] = (raw, coverage)
            else:
                results[name] = None
        path = Path("/tmp/methods.png")
        save_contour_comparison(path, u, v, results)
        files["compare"] = str(path)
    return files
`

type PyodideRuntime = Awaited<ReturnType<typeof loadPyodide>>

type PyDict = {
  toJs: (opts: { dict_converter: typeof Object.fromEntries }) => Record<string, string>
  destroy?: () => void
}

let pyodide: PyodideRuntime | null = null
let booting: Promise<PyodideRuntime> | null = null

function postProgress(message: string): void {
  self.postMessage({ type: 'progress', message })
}

function writeF64(runtime: PyodideRuntime, path: string, data: Float64Array): void {
  runtime.FS.writeFile(path, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
}

async function ensurePyodide(): Promise<PyodideRuntime> {
  if (pyodide) return pyodide
  if (booting) return booting
  booting = (async () => {
    postProgress('正在加载 Python WASM（首次较慢）')
    const runtime = await loadPyodide({ indexURL: INDEX_URL })
    postProgress('正在装入 numpy / matplotlib')
    await runtime.loadPackage(['numpy', 'matplotlib'], {
      messageCallback: (msg) => postProgress(String(msg)),
    })
    runtime.runPython(`
import os
os.makedirs("/tmp/mplconfig", exist_ok=True)
os.environ["MPLCONFIGDIR"] = "/tmp/mplconfig"
os.environ["MPLBACKEND"] = "Agg"
`)
    runtime.runPython(plottingSrc)
    runtime.runPython(BOOTSTRAP)
    pyodide = runtime
    postProgress('matplotlib 已在本机就绪')
    return runtime
  })()
  try {
    return await booting
  } catch (error) {
    booting = null
    throw error
  }
}

self.onmessage = async (event: MessageEvent<{ type: 'init' } | { type: 'plot'; pack: PackedExport }>) => {
  try {
    if (event.data.type === 'init') {
      await ensurePyodide()
      self.postMessage({ type: 'ready' })
      return
    }
    const runtime = await ensurePyodide()
    const pack = event.data.pack
    postProgress('正在用 matplotlib 出图')
    writeF64(runtime, '/tmp/u.bin', pack.u)
    writeF64(runtime, '/tmp/v.bin', pack.v)
    writeF64(runtime, '/tmp/contour.bin', pack.contour)
    writeF64(runtime, '/tmp/slab_xyz.bin', worldFromPack(pack))
    writeF64(runtime, '/tmp/contour_xyz.bin', contourWorld(pack))
    writeF64(runtime, '/tmp/overview.bin', pack.overview)
    writeF64(runtime, '/tmp/origin.bin', pack.origin)
    writeF64(runtime, '/tmp/axis.bin', pack.axis)
    for (const item of pack.compare) {
      writeF64(runtime, `/tmp/contour_${item.method}.bin`, item.contour)
      runtime.FS.writeFile(`/tmp/cov_${item.method}.txt`, String(item.coverage))
    }
    const fitJson = pack.fit
      ? JSON.stringify({
          center_x: pack.fit.center_x,
          center_y: pack.fit.center_y,
          radius: pack.fit.radius,
        })
      : 'null'
    runtime.runPython(`
files = render_figures(
    json.loads(${JSON.stringify(JSON.stringify(pack.kinds))}),
    ${pack.thickness},
    ${pack.s},
    json.loads(${JSON.stringify(fitJson)}),
    json.loads(${JSON.stringify(JSON.stringify(pack.compare.map((item) => item.method)))}),
)
`)
    const files = runtime.globals.get('files') as PyDict
    const mapping = files.toJs({ dict_converter: Object.fromEntries })
    files.destroy?.()
    const blobs: Partial<Record<ExportKind, Blob>> = {}
    for (const [kind, path] of Object.entries(mapping)) {
      const bytes = runtime.FS.readFile(path)
      blobs[kind as ExportKind] = new Blob([bytes.slice()], { type: 'image/png' })
    }
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
    self.postMessage({ type: 'plotted', stamp, blobs })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'matplotlib 出图失败'
    self.postMessage({ type: 'error', message })
  }
}

function worldFromPack(pack: PackedExport): Float64Array {
  const n = pack.u.length
  const out = new Float64Array(n * 3)
  const origin = pack.origin
  const axis = pack.axis
  const uAxis = pack.uAxis
  const vAxis = pack.vAxis
  for (let i = 0; i < n; i += 1) {
    const uu = pack.u[i]
    const vv = pack.v[i]
    const ss = pack.z[i]
    out[i * 3] = origin[0] + uu * uAxis[0] + vv * vAxis[0] + ss * axis[0]
    out[i * 3 + 1] = origin[1] + uu * uAxis[1] + vv * vAxis[1] + ss * axis[1]
    out[i * 3 + 2] = origin[2] + uu * uAxis[2] + vv * vAxis[2] + ss * axis[2]
  }
  return out
}

function contourWorld(pack: PackedExport): Float64Array {
  const n = (pack.contour.length / 2) | 0
  const u = new Float64Array(n)
  const v = new Float64Array(n)
  const s = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    u[i] = pack.contour[i * 2]
    v[i] = pack.contour[i * 2 + 1]
    s[i] = pack.s
  }
  const out = new Float64Array(n * 3)
  for (let i = 0; i < n; i += 1) {
    out[i * 3] = pack.origin[0] + u[i] * pack.uAxis[0] + v[i] * pack.vAxis[0] + s[i] * pack.axis[0]
    out[i * 3 + 1] = pack.origin[1] + u[i] * pack.uAxis[1] + v[i] * pack.vAxis[1] + s[i] * pack.axis[1]
    out[i * 3 + 2] = pack.origin[2] + u[i] * pack.uAxis[2] + v[i] * pack.vAxis[2] + s[i] * pack.axis[2]
  }
  return out
}
