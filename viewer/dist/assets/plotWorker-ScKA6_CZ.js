import{loadPyodide as g}from"https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs";var x=`from pathlib import Path\r
import numpy as np\r
\r
DPI = 300\r
\r
# "science" alone turns on text.usetex, so every figure is rendered with\r
# "no-latex" appended to keep it working where LaTeX is absent (Pyodide).\r
STYLE = ["science", "no-latex"]\r
\r
\r
def _sample(x, y, limit=12000):\r
    if len(x) <= limit:\r
        return x, y\r
    indexes = np.linspace(0, len(x) - 1, limit, dtype=int)\r
    return x[indexes], y[indexes]\r
\r
\r
def _style():\r
    """SciencePlots rc context, degrading to plain matplotlib if it is unavailable."""\r
    import matplotlib\r
    matplotlib.use("Agg")\r
    import matplotlib.pyplot as plt\r
\r
    try:\r
        import scienceplots  # noqa: F401\r
    except ImportError:\r
        return plt.style.context("default")\r
    return plt.style.context(STYLE)\r
\r
def save_section_plot(path: Path, x, y, contour, fit=None, show_points=True, station=None):\r
    import matplotlib.pyplot as plt\r
\r
    with _style():\r
        sx, sy = _sample(np.asarray(x), np.asarray(y))\r
        figure, axis = plt.subplots(figsize=(7, 7), dpi=DPI)\r
        if station is not None:\r
            axis.set_title(f"s = {station:.2f} m", fontsize=11)\r
        if show_points and len(x):\r
            axis.scatter(sx, sy, s=1, alpha=0.25, label="section points")\r
        if len(contour):\r
            closed = np.vstack((contour, contour[0]))\r
            axis.plot(closed[:, 0], closed[:, 1], "r.-", ms=2, lw=1, label="wall contour")\r
        if fit and fit.get("radius", 0) > 0:\r
            angles = np.linspace(0, 2 * np.pi, 360)\r
            axis.plot(fit["center_x"] + fit["radius"] * np.cos(angles),\r
                      fit["center_y"] + fit["radius"] * np.sin(angles), "k--", lw=1,\r
                      label=f"circle r={fit['radius']:.3f} m")\r
        axis.set_aspect("equal", adjustable="box")\r
        axis.set_xlabel("section u (m)")\r
        axis.set_ylabel("section v (m)")\r
        axis.grid(alpha=0.2)\r
        axis.legend(loc="best", fontsize=8)\r
        figure.tight_layout()\r
        figure.savefig(path, dpi=DPI)\r
        plt.close(figure)\r
\r
\r
def save_live_section_plot(path: Path, x, y, contour, fit=None, design=None, station=None,\r
                           thickness=None, stats=None):\r
    """The live inset's section, redrawn: slice points, contour, fit circle and design profile."""\r
    import matplotlib.pyplot as plt\r
\r
    with _style():\r
        figure, axis = plt.subplots(figsize=(7, 7), dpi=DPI)\r
        sx, sy = _sample(np.asarray(x), np.asarray(y))\r
        if len(sx):\r
            axis.scatter(sx, sy, s=1, alpha=0.25, label="section points")\r
        if len(contour):\r
            contour = np.asarray(contour, dtype=float)\r
            closed = np.vstack((contour, contour[0]))\r
            axis.plot(closed[:, 0], closed[:, 1], "r.-", ms=2, lw=1, label="wall contour")\r
        if design is not None and len(design) > 2:\r
            design = np.asarray(design, dtype=float)\r
            closed = np.vstack((design, design[0]))\r
            axis.plot(closed[:, 0], closed[:, 1], color="royalblue", lw=1.5,\r
                      label="design horseshoe")\r
        if fit and fit.get("radius", 0) > 0:\r
            angles = np.linspace(0, 2 * np.pi, 360)\r
            axis.plot(fit["center_x"] + fit["radius"] * np.cos(angles),\r
                      fit["center_y"] + fit["radius"] * np.sin(angles), "k--", lw=1,\r
                      label=f"circle r={fit['radius']:.3f} m")\r
        axis.set_aspect("equal", adjustable="box")\r
        axis.set_xlabel("section u (m)")\r
        axis.set_ylabel("section v (m)")\r
        title = "Tunnel section"\r
        if station is not None:\r
            title += f",  s = {station:.2f} m"\r
        if thickness is not None:\r
            title += f",  thickness = {thickness:g} m"\r
        if stats:\r
            title += (f"\\nover max {stats.get('max_over', 0):.3f}, mean {stats.get('mean_over', 0):.3f}; "\r
                      f"under max {stats.get('max_under', 0):.3f}, mean {stats.get('mean_under', 0):.3f}")\r
        axis.set_title(title, fontsize=10)\r
        axis.grid(alpha=0.2)\r
        axis.legend(loc="best", fontsize=8)\r
        figure.tight_layout()\r
        figure.savefig(path, dpi=DPI)\r
        plt.close(figure)\r
\r
\r
def save_contour_comparison(path: Path, x, y, results):\r
    import matplotlib.pyplot as plt\r
\r
    with _style():\r
        columns = 3\r
        rows = int(np.ceil(len(results) / columns))\r
        figure, axes = plt.subplots(rows, columns, figsize=(14, 4 * rows), dpi=DPI)\r
        axes = np.atleast_1d(axes).ravel()\r
        sx, sy = _sample(np.asarray(x), np.asarray(y), limit=7000)\r
        for axis, (method, result) in zip(axes.flat, results.items()):\r
            contour = result[0] if result is not None else np.empty((0, 2))\r
            axis.scatter(sx, sy, s=1, alpha=0.12, color="steelblue")\r
            if len(contour):\r
                closed = np.vstack((contour, contour[0]))\r
                axis.plot(closed[:, 0], closed[:, 1], color="crimson", lw=1)\r
            title = method if result is None else f"{method}\\nN={len(contour)}, coverage={result[1]:.2f}"\r
            axis.set_title(title, fontsize=9)\r
            axis.set_aspect("equal", adjustable="box")\r
            axis.grid(alpha=0.15)\r
        for axis in axes[len(results):]:\r
            axis.axis("off")\r
        figure.tight_layout()\r
        figure.savefig(path, dpi=DPI)\r
        plt.close(figure)\r
\r
\r
def _view_along_axis(axis_vector, yaw_offset=45.0, elev=30.0):\r
    """Look along the plotted Y axis of a horizontal tunnel, then yaw for isometric.\r
\r
    3D figures use the display frame packed as (u, s, v), so matplotlib's Z is\r
    gravity-up and the tunnel runs along Y. World-frame callers pass the tunnel\r
    axis in XYZ and get the same kind of oblique view.\r
    """\r
    axis = np.asarray(axis_vector, dtype=float)\r
    heading = float(np.degrees(np.arctan2(axis[1], axis[0])))\r
    return elev, heading + 180.0 + yaw_offset\r
\r
\r
def _set_axes_3d(axis, points, equal=True, pad=0.12):\r
    points = np.asarray(points, dtype=float)\r
    if len(points) == 0:\r
        return\r
    low, high = points.min(axis=0), points.max(axis=0)\r
    span = np.maximum(high - low, 1e-3)\r
    if equal:\r
        center = (low + high) / 2\r
        radius = max(float(np.max(span)) / 2, 1e-6)\r
        axis.set_xlim(center[0] - radius, center[0] + radius)\r
        axis.set_ylim(center[1] - radius, center[1] + radius)\r
        axis.set_zlim(center[2] - radius, center[2] + radius)\r
        return\r
    extra = span * pad\r
    axis.set_xlim(low[0] - extra[0], high[0] + extra[0])\r
    axis.set_ylim(low[1] - extra[1], high[1] + extra[1])\r
    axis.set_zlim(low[2] - extra[2], high[2] + extra[2])\r
    try:\r
        axis.set_box_aspect(tuple(span))\r
    except (AttributeError, ValueError):\r
        pass\r
\r
\r
def save_section_3d_plot(path: Path, points, contour, axis_vector, thickness, station=None):\r
    """Slice in the display frame: points are (u, s, v) so matplotlib Z is up."""\r
    import matplotlib.pyplot as plt\r
\r
    points = np.asarray(points, dtype=float)\r
    contour = np.asarray(contour, dtype=float)\r
    sampled, _ = _sample(points[:, 0], points[:, 1]) if len(points) else ([], [])\r
    if len(points) > len(sampled):\r
        sampled = points[np.linspace(0, len(points) - 1, len(sampled), dtype=int)]\r
    elif len(points):\r
        sampled = points\r
    with _style():\r
        figure = plt.figure(figsize=(9, 7), dpi=DPI)\r
        axis = figure.add_subplot(111, projection="3d")\r
        if len(sampled):\r
            axis.scatter(sampled[:, 0], sampled[:, 1], sampled[:, 2], s=1, alpha=0.22, label="slice points")\r
        if len(contour) >= 3:\r
            closed = np.vstack((contour, contour[0]))\r
            axis.plot(closed[:, 0], closed[:, 1], closed[:, 2], color="crimson", lw=1.8, label="inner contour")\r
        axis.set_xlabel("u (m)")\r
        axis.set_ylabel("s (m)")\r
        axis.set_zlabel("v (m)")\r
        title = f"Tunnel section, thickness={thickness:g}"\r
        if station is not None:\r
            title += f",  s = {station:.2f} m"\r
        axis.set_title(title)\r
        elev, azim = _view_along_axis(axis_vector)\r
        axis.view_init(elev=elev, azim=azim)\r
        _set_axes_3d(axis, np.vstack((points, contour)) if len(contour) else points, equal=True)\r
        axis.legend(loc="best", fontsize=8)\r
        figure.tight_layout()\r
        figure.savefig(path, dpi=DPI)\r
        plt.close(figure)\r
\r
\r
def save_tunnel_3d_plot(path: Path, points, contour, axis_vector, thickness, section_center,\r
                        station=None):\r
    """Overview in the display frame: points are (u, s, v) so matplotlib Z is up."""\r
    import matplotlib.pyplot as plt\r
\r
    points = np.asarray(points, dtype=float)\r
    contour = np.asarray(contour, dtype=float)\r
    with _style():\r
        figure = plt.figure(figsize=(11, 8), dpi=DPI)\r
        axis = figure.add_subplot(111, projection="3d")\r
        if len(points):\r
            sampled = points[np.linspace(0, len(points) - 1, min(len(points), 120000), dtype=int)]\r
            axis.scatter(sampled[:, 0], sampled[:, 1], sampled[:, 2], s=0.8, alpha=0.18,\r
                         color="steelblue", label="tunnel points")\r
        if len(contour) >= 3:\r
            closed = np.vstack((contour, contour[0]))\r
            axis.plot(closed[:, 0], closed[:, 1], closed[:, 2], color="crimson", lw=1.6, label="selected contour")\r
        center = np.asarray(section_center, dtype=float)\r
        axis.scatter([center[0]], [center[1]], [center[2]], color="black", s=22, label="slice center")\r
        axis.set_xlabel("u (m)")\r
        axis.set_ylabel("s (m)")\r
        axis.set_zlabel("v (m)")\r
        title = f"Tunnel overview, thickness={thickness:g}"\r
        if station is not None:\r
            title += f",  s = {station:.2f} m"\r
        axis.set_title(title)\r
        elev, azim = _view_along_axis(axis_vector)\r
        axis.view_init(elev=elev, azim=azim)\r
        frame_pts = points if len(points) else np.reshape(center, (1, 3))\r
        _set_axes_3d(axis, frame_pts, equal=False, pad=0.08)\r
        axis.legend(loc="best", fontsize=8)\r
        figure.tight_layout()\r
        figure.savefig(path, dpi=DPI)\r
        plt.close(figure)\r
\r
\r
def save_area_depth_plot(path: Path, stations, areas):\r
    import matplotlib.pyplot as plt\r
\r
    stations = np.asarray(stations, dtype=float)\r
    areas = np.asarray(areas, dtype=float)\r
    with _style():\r
        figure, axis = plt.subplots(figsize=(8, 5), dpi=DPI)\r
        if len(stations):\r
            axis.plot(stations, areas, "s-", color="crimson", lw=1.4, ms=5, label="section area")\r
        axis.set_xlabel("s (m)")\r
        axis.set_ylabel("S (m$^2$)")\r
        axis.set_title("Section area along station")\r
        axis.grid(alpha=0.25)\r
        axis.legend(loc="best", fontsize=8)\r
        figure.tight_layout()\r
        figure.savefig(path, dpi=DPI)\r
        plt.close(figure)\r
\r
\r
def save_volume_depth_plot(path: Path, stations, volumes):\r
    import matplotlib.pyplot as plt\r
\r
    stations = np.asarray(stations, dtype=float)\r
    volumes = np.asarray(volumes, dtype=float)\r
    with _style():\r
        figure, axis = plt.subplots(figsize=(8, 5), dpi=DPI)\r
        if len(stations):\r
            axis.plot(stations, volumes, "o-", color="steelblue", lw=1.4, ms=5, label="cumulative volume")\r
        axis.set_xlabel("s (m)")\r
        axis.set_ylabel("V (m$^3$)")\r
        axis.set_title("Contour volume from first station")\r
        axis.grid(alpha=0.25)\r
        axis.legend(loc="best", fontsize=8)\r
        figure.tight_layout()\r
        figure.savefig(path, dpi=DPI)\r
        plt.close(figure)\r
\r
\r
def save_contour_gallery(path: Path, sections, station=None):\r
    import matplotlib.pyplot as plt\r
\r
    n = max(1, len(sections))\r
    columns = min(5, n)\r
    rows = int(np.ceil(n / columns))\r
    with _style():\r
        figure, axes = plt.subplots(rows, columns, figsize=(2.8 * columns, 2.8 * rows), dpi=DPI)\r
        axes = np.atleast_1d(axes).ravel()\r
        for axis, item in zip(axes, sections):\r
            panel_s, contour, design = item\r
            contour = np.asarray(contour, dtype=float)\r
            design = np.asarray(design, dtype=float)\r
            if len(design) > 2:\r
                closed = np.vstack((design, design[0]))\r
                axis.plot(closed[:, 0], closed[:, 1], color="0.35", lw=1.0)\r
            if len(contour) > 2:\r
                closed = np.vstack((contour, contour[0]))\r
                axis.plot(closed[:, 0], closed[:, 1], color="crimson", lw=1.1)\r
            axis.set_title(f"{panel_s:.2f} m", fontsize=8)\r
            axis.set_aspect("equal", adjustable="box")\r
            axis.tick_params(labelsize=7)\r
            axis.grid(alpha=0.15)\r
        for axis in axes[len(sections):]:\r
            axis.axis("off")\r
        if station is not None:\r
            figure.suptitle(f"sections along the tunnel,  current s = {station:.2f} m", fontsize=10)\r
        figure.tight_layout()\r
        figure.savefig(path, dpi=DPI)\r
        plt.close(figure)\r
\r
\r
def save_contour_stack_plot(path: Path, rings):\r
    import matplotlib.pyplot as plt\r
\r
    with _style():\r
        figure = plt.figure(figsize=(9, 6), dpi=DPI)\r
        axis = figure.add_subplot(111, projection="3d")\r
        for ring in rings:\r
            pts = np.asarray(ring, dtype=float)\r
            if len(pts) < 2:\r
                continue\r
            closed = np.vstack((pts, pts[0]))\r
            axis.plot(closed[:, 0], closed[:, 2], closed[:, 1], color="0.25", lw=0.9)\r
        axis.set_xlabel("u (m)")\r
        axis.set_ylabel("s (m)")\r
        axis.set_zlabel("v (m)")\r
        axis.set_title("Stacked section contours")\r
        axis.view_init(elev=18, azim=-70)\r
        figure.tight_layout()\r
        figure.savefig(path, dpi=DPI)\r
        plt.close(figure)\r
\r
\r
def save_overbreak_plot(path: Path, contour, design, samples, stats=None, station=None):\r
    import matplotlib.pyplot as plt\r
\r
    contour = np.asarray(contour, dtype=float)\r
    design = np.asarray(design, dtype=float)\r
    samples = np.asarray(samples, dtype=float)\r
    with _style():\r
        figure, axis = plt.subplots(figsize=(7, 7), dpi=DPI)\r
        if len(design) > 2:\r
            closed = np.vstack((design, design[0]))\r
            axis.plot(closed[:, 0], closed[:, 1], color="royalblue", lw=1.6, label="design horseshoe")\r
        if len(contour) > 2:\r
            closed = np.vstack((contour, contour[0]))\r
            axis.plot(closed[:, 0], closed[:, 1], color="crimson", lw=1.3, label="measured contour")\r
        if len(samples):\r
            for row in samples:\r
                u, v, delta = row[:3]\r
                color = "seagreen" if delta >= 0 else "darkorange"\r
                axis.scatter([u], [v], s=12, color=color, zorder=3)\r
                axis.annotate(f"{delta:+.3f}", (u, v), textcoords="offset points", xytext=(3, 3),\r
                              fontsize=6, color=color)\r
        axis.set_aspect("equal", adjustable="box")\r
        axis.set_xlabel("section u (m)")\r
        axis.set_ylabel("section v (m)")\r
        title = "Over / under break  $\\\\Delta d$ (m)"\r
        if station is not None:\r
            title += f"   (s = {station:.2f} m)"\r
        if stats:\r
            title += (f"\\nover max {stats.get('max_over', 0):.3f}, mean {stats.get('mean_over', 0):.3f}; "\r
                      f"under max {stats.get('max_under', 0):.3f}, mean {stats.get('mean_under', 0):.3f}")\r
        axis.set_title(title, fontsize=10)\r
        axis.grid(alpha=0.2)\r
        axis.legend(loc="best", fontsize=8)\r
        figure.tight_layout()\r
        figure.savefig(path, dpi=DPI)\r
        plt.close(figure)\r
`;const y="https://cdn.jsdelivr.net/pyodide/v0.27.7/full/",h=`
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
`;let l=null,i=null;function a(n){self.postMessage({type:"progress",message:n})}function s(n,e,t){n.FS.writeFile(e,new Uint8Array(t.buffer,t.byteOffset,t.byteLength))}async function f(){if(l)return l;if(i)return i;i=(async()=>{a("正在加载 Python WASM（首次较慢）");const n=await g({indexURL:y});a("正在装入 numpy / matplotlib"),await n.loadPackage(["numpy","matplotlib"],{messageCallback:e=>a(String(e))}),n.runPython(`
import os
os.makedirs("/tmp/mplconfig", exist_ok=True)
os.environ["MPLCONFIGDIR"] = "/tmp/mplconfig"
os.environ["MPLBACKEND"] = "Agg"
`);try{a("正在装入 SciencePlots 样式"),await n.loadPackage("micropip"),n.runPython("import micropip");const e=n.globals.get("micropip");await e.install("SciencePlots"),e.destroy?.()}catch(e){a(`SciencePlots 装入失败，改用 matplotlib 默认样式：${e instanceof Error?e.message:String(e)}`)}return n.runPython(x),n.runPython(h),l=n,a("matplotlib 已在本机就绪"),n})();try{return await i}catch(n){throw i=null,n}}self.onmessage=async n=>{try{if(n.data.type==="init"){await f(),self.postMessage({type:"ready"});return}const e=await f(),t=n.data.pack;a("正在用 matplotlib 出图"),s(e,"/tmp/u.bin",t.u),s(e,"/tmp/v.bin",t.v),s(e,"/tmp/z.bin",t.z),s(e,"/tmp/contour.bin",t.contour),s(e,"/tmp/overview.bin",t.overview),s(e,"/tmp/design.bin",t.design),s(e,"/tmp/stations.bin",t.stations),s(e,"/tmp/areas.bin",t.areas),s(e,"/tmp/volumes.bin",t.volumes),s(e,"/tmp/samples.bin",t.samples),e.FS.writeFile("/tmp/stats.json",t.stats?JSON.stringify({max_over:t.stats.maxOver,mean_over:t.stats.meanOver,max_under:t.stats.maxUnder,mean_under:t.stats.meanUnder,over_area:t.stats.overArea,under_area:t.stats.underArea}):"null"),e.FS.writeFile("/tmp/gallery_n.txt",String(t.gallery.length)),t.gallery.forEach((r,o)=>{s(e,`/tmp/gallery_${o}.bin`,r.contour),e.FS.writeFile(`/tmp/gallery_${o}_s.txt`,String(r.s))});for(const r of t.compare)s(e,`/tmp/contour_${r.method}.bin`,r.contour),e.FS.writeFile(`/tmp/cov_${r.method}.txt`,String(r.coverage));const u=t.fit?JSON.stringify({center_x:t.fit.center_x,center_y:t.fit.center_y,radius:t.fit.radius}):"null";e.runPython(`
files = render_figures(
    json.loads(${JSON.stringify(JSON.stringify(t.kinds))}),
    ${t.thickness},
    ${t.s},
    json.loads(${JSON.stringify(u)}),
    json.loads(${JSON.stringify(JSON.stringify(t.compare.map(r=>r.method)))}),
)
`);const p=e.globals.get("files"),d=p.toJs({dict_converter:Object.fromEntries});p.destroy?.();const c={};for(const[r,o]of Object.entries(d)){const _=e.FS.readFile(o);c[r]=new Blob([_.slice()],{type:"image/png"})}const m=new Date().toISOString().replace(/[-:T]/g,"").slice(0,15);self.postMessage({type:"plotted",stamp:m,blobs:c})}catch(e){const t=e instanceof Error?e.message:"matplotlib 出图失败";self.postMessage({type:"error",message:t})}};
