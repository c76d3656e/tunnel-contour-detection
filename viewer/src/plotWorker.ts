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

def _usv(u, v, s):
    """Display frame as matplotlib XYZ: X=u, Y=s (along the tunnel), Z=v (up)."""
    u = np.asarray(u, dtype=float)
    v = np.asarray(v, dtype=float)
    if np.isscalar(s):
        s = np.full(len(u), float(s))
    else:
        s = np.asarray(s, dtype=float)
    if len(u) == 0:
        return np.empty((0, 3), dtype=float)
    return np.column_stack((u, s, v))


def _uvs_to_usv(uvs):
    points = np.asarray(uvs, dtype=float)
    if len(points) == 0:
        return np.empty((0, 3), dtype=float)
    return np.column_stack((points[:, 0], points[:, 2], points[:, 1]))


def render_figures(kinds, thickness, station, fit, methods):
    u = _f8("/tmp/u.bin")
    v = _f8("/tmp/v.bin")
    contour = _xy("/tmp/contour.bin")
    s_pts = _f8("/tmp/z.bin")
    overview = _uvs_to_usv(_xyz("/tmp/overview.bin"))
    design = _xy("/tmp/design.bin")
    stations = _f8("/tmp/stations.bin")
    areas = _f8("/tmp/areas.bin")
    volumes = _f8("/tmp/volumes.bin")
    samples = _xyz("/tmp/samples.bin")
    stats = json.loads(Path("/tmp/stats.json").read_text() or "null")
    slab = _usv(u, v, s_pts)
    contour_xyz = _usv(contour[:, 0], contour[:, 1], station) if len(contour) else np.empty((0, 3))
    axis = np.array([0.0, 1.0, 0.0])
    files = {}
    if "section2d" in kinds:
        path = Path("/tmp/section_2d.png")
        save_section_plot(path, u, v, contour, fit, station=station)
        files["section2d"] = str(path)
    if "liveSection" in kinds:
        path = Path("/tmp/live_section.png")
        save_live_section_plot(path, u, v, contour, fit, design, station=station,
                               thickness=thickness, stats=stats)
        files["liveSection"] = str(path)
    if "section3d" in kinds:
        path = Path("/tmp/section_3d.png")
        save_section_3d_plot(path, slab, contour_xyz, axis, thickness, station=station)
        files["section3d"] = str(path)
    if "tunnel3d" in kinds:
        path = Path("/tmp/tunnel_3d.png")
        center = contour_xyz.mean(axis=0) if len(contour_xyz) else np.array([0.0, station, 0.0])
        save_tunnel_3d_plot(path, overview, contour_xyz, axis, thickness, center, station=station)
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
    if "overbreak" in kinds:
        path = Path("/tmp/overbreak.png")
        save_overbreak_plot(path, contour, design, samples, stats, station=station)
        files["overbreak"] = str(path)
    if "areaDepth" in kinds:
        path = Path("/tmp/area_depth.png")
        save_area_depth_plot(path, stations, areas)
        files["areaDepth"] = str(path)
    if "volumeDepth" in kinds:
        path = Path("/tmp/volume_depth.png")
        save_volume_depth_plot(path, stations, volumes)
        files["volumeDepth"] = str(path)
    if "gallery" in kinds or "stack" in kinds:
        n = int(Path("/tmp/gallery_n.txt").read_text() or "0")
        sections = []
        rings = []
        for i in range(n):
            s_i = float(Path(f"/tmp/gallery_{i}_s.txt").read_text())
            c_i = _xy(f"/tmp/gallery_{i}.bin")
            sections.append((s_i, c_i, design))
            if len(c_i):
                ring = np.column_stack((c_i[:, 0], np.full(len(c_i), s_i), c_i[:, 1]))
                rings.append(ring)
        if "gallery" in kinds:
            path = Path("/tmp/gallery.png")
            save_contour_gallery(path, sections, station=station)
            files["gallery"] = str(path)
        if "stack" in kinds:
            path = Path("/tmp/stack.png")
            save_contour_stack_plot(path, rings)
            files["stack"] = str(path)
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
    // SciencePlots ships a pure-Python wheel, so micropip can install it here.
    // plotting.py falls back to plain matplotlib when this is unavailable.
    try {
      postProgress('正在装入 SciencePlots 样式')
      await runtime.loadPackage('micropip')
      runtime.runPython('import micropip')
      const micropip = runtime.globals.get('micropip') as {
        install: (target: string) => Promise<unknown>
        destroy?: () => void
      }
      await micropip.install('SciencePlots')
      micropip.destroy?.()
    } catch (error) {
      postProgress(
        `SciencePlots 装入失败，改用 matplotlib 默认样式：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
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
    writeF64(runtime, '/tmp/z.bin', pack.z)
    writeF64(runtime, '/tmp/contour.bin', pack.contour)
    writeF64(runtime, '/tmp/overview.bin', pack.overview)
    writeF64(runtime, '/tmp/design.bin', pack.design)
    writeF64(runtime, '/tmp/stations.bin', pack.stations)
    writeF64(runtime, '/tmp/areas.bin', pack.areas)
    writeF64(runtime, '/tmp/volumes.bin', pack.volumes)
    writeF64(runtime, '/tmp/samples.bin', pack.samples)
    runtime.FS.writeFile(
      '/tmp/stats.json',
      pack.stats
        ? JSON.stringify({
            max_over: pack.stats.maxOver,
            mean_over: pack.stats.meanOver,
            max_under: pack.stats.maxUnder,
            mean_under: pack.stats.meanUnder,
            over_area: pack.stats.overArea,
            under_area: pack.stats.underArea,
          })
        : 'null',
    )
    runtime.FS.writeFile('/tmp/gallery_n.txt', String(pack.gallery.length))
    pack.gallery.forEach((item, index) => {
      writeF64(runtime, `/tmp/gallery_${index}.bin`, item.contour)
      runtime.FS.writeFile(`/tmp/gallery_${index}_s.txt`, String(item.s))
    })
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
