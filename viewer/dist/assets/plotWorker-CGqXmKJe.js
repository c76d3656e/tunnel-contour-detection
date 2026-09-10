import{loadPyodide as x}from"https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs";var _=`from pathlib import Path
import numpy as np

def _sample(x, y, limit=12000):
    if len(x) <= limit:
        return x, y
    indexes = np.linspace(0, len(x) - 1, limit, dtype=int)
    return x[indexes], y[indexes]

def save_section_plot(path: Path, x, y, contour, fit=None, show_points=True):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    sx, sy = _sample(np.asarray(x), np.asarray(y))
    figure, axis = plt.subplots(figsize=(7, 7), dpi=130)
    if show_points and len(x):
        axis.scatter(sx, sy, s=1, alpha=0.25, label="section points")
    if len(contour):
        closed = np.vstack((contour, contour[0]))
        axis.plot(closed[:, 0], closed[:, 1], "r.-", ms=2, lw=1, label="wall contour")
    if fit and fit.get("radius", 0) > 0:
        angles = np.linspace(0, 2 * np.pi, 360)
        axis.plot(fit["center_x"] + fit["radius"] * np.cos(angles),
                  fit["center_y"] + fit["radius"] * np.sin(angles), "k--", lw=1,
                  label=f"circle r={fit['radius']:.3f} m")
    axis.set_aspect("equal", adjustable="box")
    axis.set_xlabel("section u (m)")
    axis.set_ylabel("section v (m)")
    axis.grid(alpha=0.2)
    axis.legend(loc="best", fontsize=8)
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)


def save_contour_comparison(path: Path, x, y, results):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    columns = 3
    rows = int(np.ceil(len(results) / columns))
    figure, axes = plt.subplots(rows, columns, figsize=(14, 4 * rows), dpi=130)
    axes = np.atleast_1d(axes).ravel()
    sx, sy = _sample(np.asarray(x), np.asarray(y), limit=7000)
    for axis, (method, result) in zip(axes.flat, results.items()):
        contour = result[0] if result is not None else np.empty((0, 2))
        axis.scatter(sx, sy, s=1, alpha=0.12, color="steelblue")
        if len(contour):
            closed = np.vstack((contour, contour[0]))
            axis.plot(closed[:, 0], closed[:, 1], color="crimson", lw=1)
        title = method if result is None else f"{method}\\nN={len(contour)}, coverage={result[1]:.2f}"
        axis.set_title(title, fontsize=9)
        axis.set_aspect("equal", adjustable="box")
        axis.grid(alpha=0.15)
    for axis in axes[len(results):]:
        axis.axis("off")
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)


def _view_along_axis(axis_vector, yaw_offset=45.0, elev=30.0):
    """Look along the tunnel axis, then yaw for an isometric view of the slice."""
    axis = np.asarray(axis_vector, dtype=float)
    heading = float(np.degrees(np.arctan2(axis[1], axis[0])))
    return elev, heading + 180.0 + yaw_offset


def _set_axes_3d(axis, points, equal=True, pad=0.12):
    points = np.asarray(points, dtype=float)
    if len(points) == 0:
        return
    low, high = points.min(axis=0), points.max(axis=0)
    span = np.maximum(high - low, 1e-3)
    if equal:
        center = (low + high) / 2
        radius = max(float(np.max(span)) / 2, 1e-6)
        axis.set_xlim(center[0] - radius, center[0] + radius)
        axis.set_ylim(center[1] - radius, center[1] + radius)
        axis.set_zlim(center[2] - radius, center[2] + radius)
        return
    extra = span * pad
    axis.set_xlim(low[0] - extra[0], high[0] + extra[0])
    axis.set_ylim(low[1] - extra[1], high[1] + extra[1])
    axis.set_zlim(low[2] - extra[2], high[2] + extra[2])
    try:
        axis.set_box_aspect(tuple(span))
    except (AttributeError, ValueError):
        pass


def save_section_3d_plot(path: Path, points, contour, axis_vector, thickness):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    points = np.asarray(points, dtype=float)
    contour = np.asarray(contour, dtype=float)
    sampled, _ = _sample(points[:, 0], points[:, 1]) if len(points) else ([], [])
    if len(points) > len(sampled):
        sampled = points[np.linspace(0, len(points) - 1, len(sampled), dtype=int)]
    elif len(points):
        sampled = points
    figure = plt.figure(figsize=(9, 7), dpi=130)
    axis = figure.add_subplot(111, projection="3d")
    if len(sampled):
        axis.scatter(sampled[:, 0], sampled[:, 1], sampled[:, 2], s=1, alpha=0.22, label="slice points")
    if len(contour) >= 3:
        closed = np.vstack((contour, contour[0]))
        axis.plot(closed[:, 0], closed[:, 1], closed[:, 2], color="crimson", lw=1.8, label="inner contour")
    axis.set_xlabel("X (m)")
    axis.set_ylabel("Y (m)")
    axis.set_zlabel("Z (m)")
    axis.set_title(f"Tunnel section, thickness={thickness:g}")
    elev, azim = _view_along_axis(axis_vector)
    axis.view_init(elev=elev, azim=azim)
    _set_axes_3d(axis, np.vstack((points, contour)) if len(contour) else points, equal=True)
    axis.legend(loc="best", fontsize=8)
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)


def save_tunnel_3d_plot(path: Path, points, contour, axis_vector, thickness, section_center):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    points = np.asarray(points, dtype=float)
    contour = np.asarray(contour, dtype=float)
    figure = plt.figure(figsize=(11, 8), dpi=130)
    axis = figure.add_subplot(111, projection="3d")
    if len(points):
        sampled = points[np.linspace(0, len(points) - 1, min(len(points), 120000), dtype=int)]
        axis.scatter(sampled[:, 0], sampled[:, 1], sampled[:, 2], s=0.8, alpha=0.18,
                     color="steelblue", label="tunnel points")
    if len(contour) >= 3:
        closed = np.vstack((contour, contour[0]))
        axis.plot(closed[:, 0], closed[:, 1], closed[:, 2], color="crimson", lw=1.6, label="selected contour")
    center = np.asarray(section_center, dtype=float)
    axis.scatter([center[0]], [center[1]], [center[2]], color="black", s=22, label="slice center")
    axis.set_xlabel("X (m)")
    axis.set_ylabel("Y (m)")
    axis.set_zlabel("Z (m)")
    axis.set_title(f"Tunnel overview, thickness={thickness:g}")
    elev, azim = _view_along_axis(axis_vector)
    axis.view_init(elev=elev, azim=azim)
    frame_pts = points if len(points) else np.reshape(center, (1, 3))
    _set_axes_3d(axis, frame_pts, equal=False, pad=0.08)
    axis.legend(loc="best", fontsize=8)
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)


def save_area_depth_plot(path: Path, stations, areas):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    stations = np.asarray(stations, dtype=float)
    areas = np.asarray(areas, dtype=float)
    figure, axis = plt.subplots(figsize=(8, 5), dpi=130)
    if len(stations):
        axis.plot(stations, areas, "s-", color="crimson", lw=1.4, ms=5, label="section area")
    axis.set_xlabel("s (m)")
    axis.set_ylabel("S (m$^2$)")
    axis.set_title("Section area along station")
    axis.grid(alpha=0.25)
    axis.legend(loc="best", fontsize=8)
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)


def save_volume_depth_plot(path: Path, stations, volumes):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    stations = np.asarray(stations, dtype=float)
    volumes = np.asarray(volumes, dtype=float)
    figure, axis = plt.subplots(figsize=(8, 5), dpi=130)
    if len(stations):
        axis.plot(stations, volumes, "o-", color="steelblue", lw=1.4, ms=5, label="cumulative volume")
    axis.set_xlabel("s (m)")
    axis.set_ylabel("V (m$^3$)")
    axis.set_title("Contour volume from first station")
    axis.grid(alpha=0.25)
    axis.legend(loc="best", fontsize=8)
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)


def save_contour_gallery(path: Path, sections):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    n = max(1, len(sections))
    columns = min(5, n)
    rows = int(np.ceil(n / columns))
    figure, axes = plt.subplots(rows, columns, figsize=(2.8 * columns, 2.8 * rows), dpi=120)
    axes = np.atleast_1d(axes).ravel()
    for axis, item in zip(axes, sections):
        station, contour, design = item
        contour = np.asarray(contour, dtype=float)
        design = np.asarray(design, dtype=float)
        if len(design) > 2:
            closed = np.vstack((design, design[0]))
            axis.plot(closed[:, 0], closed[:, 1], color="0.35", lw=1.0)
        if len(contour) > 2:
            closed = np.vstack((contour, contour[0]))
            axis.plot(closed[:, 0], closed[:, 1], color="crimson", lw=1.1)
        axis.set_title(f"{station:.2f} m", fontsize=8)
        axis.set_aspect("equal", adjustable="box")
        axis.tick_params(labelsize=7)
        axis.grid(alpha=0.15)
    for axis in axes[len(sections):]:
        axis.axis("off")
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)


def save_contour_stack_plot(path: Path, rings):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    figure = plt.figure(figsize=(9, 6), dpi=130)
    axis = figure.add_subplot(111, projection="3d")
    for ring in rings:
        pts = np.asarray(ring, dtype=float)
        if len(pts) < 2:
            continue
        closed = np.vstack((pts, pts[0]))
        axis.plot(closed[:, 0], closed[:, 2], closed[:, 1], color="0.25", lw=0.9)
    axis.set_xlabel("u (m)")
    axis.set_ylabel("s (m)")
    axis.set_zlabel("v (m)")
    axis.set_title("Stacked section contours")
    axis.view_init(elev=18, azim=-70)
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)


def save_overbreak_plot(path: Path, contour, design, samples, stats=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    contour = np.asarray(contour, dtype=float)
    design = np.asarray(design, dtype=float)
    samples = np.asarray(samples, dtype=float)
    figure, axis = plt.subplots(figsize=(7, 7), dpi=130)
    if len(design) > 2:
        closed = np.vstack((design, design[0]))
        axis.plot(closed[:, 0], closed[:, 1], color="royalblue", lw=1.6, label="design horseshoe")
    if len(contour) > 2:
        closed = np.vstack((contour, contour[0]))
        axis.plot(closed[:, 0], closed[:, 1], color="crimson", lw=1.3, label="measured contour")
    if len(samples):
        for row in samples:
            u, v, delta = row[:3]
            color = "seagreen" if delta >= 0 else "darkorange"
            axis.scatter([u], [v], s=12, color=color, zorder=3)
            axis.annotate(f"{delta:+.3f}", (u, v), textcoords="offset points", xytext=(3, 3),
                          fontsize=6, color=color)
    axis.set_aspect("equal", adjustable="box")
    axis.set_xlabel("section u (m)")
    axis.set_ylabel("section v (m)")
    title = "Over / under break  $\\\\Delta d$ (m)"
    if stats:
        title += (f"\\nover max {stats.get('max_over', 0):.3f}, mean {stats.get('mean_over', 0):.3f}; "
                  f"under max {stats.get('max_under', 0):.3f}, mean {stats.get('mean_under', 0):.3f}")
    axis.set_title(title, fontsize=10)
    axis.grid(alpha=0.2)
    axis.legend(loc="best", fontsize=8)
    figure.tight_layout()
    figure.savefig(path)
    plt.close(figure)
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

def render_figures(kinds, thickness, station, fit, methods):
    u = _f8("/tmp/u.bin")
    v = _f8("/tmp/v.bin")
    contour = _xy("/tmp/contour.bin")
    slab = _xyz("/tmp/slab_xyz.bin")
    contour_xyz = _xyz("/tmp/contour_xyz.bin")
    overview = _xyz("/tmp/overview.bin")
    origin = _f8("/tmp/origin.bin")
    axis = _f8("/tmp/axis.bin")
    design = _xy("/tmp/design.bin")
    stations = _f8("/tmp/stations.bin")
    areas = _f8("/tmp/areas.bin")
    volumes = _f8("/tmp/volumes.bin")
    samples = _xyz("/tmp/samples.bin")
    stats = json.loads(Path("/tmp/stats.json").read_text() or "null")
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
    if "overbreak" in kinds:
        path = Path("/tmp/overbreak.png")
        save_overbreak_plot(path, contour, design, samples, stats)
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
            save_contour_gallery(path, sections)
            files["gallery"] = str(path)
        if "stack" in kinds:
            path = Path("/tmp/stack.png")
            save_contour_stack_plot(path, rings)
            files["stack"] = str(path)
    return files
`;let d=null,m=null;function f(e){self.postMessage({type:"progress",message:e})}function i(e,n,t){e.FS.writeFile(n,new Uint8Array(t.buffer,t.byteOffset,t.byteLength))}async function g(){if(d)return d;if(m)return m;m=(async()=>{f("正在加载 Python WASM（首次较慢）");const e=await x({indexURL:y});return f("正在装入 numpy / matplotlib"),await e.loadPackage(["numpy","matplotlib"],{messageCallback:n=>f(String(n))}),e.runPython(`
import os
os.makedirs("/tmp/mplconfig", exist_ok=True)
os.environ["MPLCONFIGDIR"] = "/tmp/mplconfig"
os.environ["MPLBACKEND"] = "Agg"
`),e.runPython(_),e.runPython(h),d=e,f("matplotlib 已在本机就绪"),e})();try{return await m}catch(e){throw m=null,e}}self.onmessage=async e=>{try{if(e.data.type==="init"){await g(),self.postMessage({type:"ready"});return}const n=await g(),t=e.data.pack;f("正在用 matplotlib 出图"),i(n,"/tmp/u.bin",t.u),i(n,"/tmp/v.bin",t.v),i(n,"/tmp/contour.bin",t.contour),i(n,"/tmp/slab_xyz.bin",b(t)),i(n,"/tmp/contour_xyz.bin",v(t)),i(n,"/tmp/overview.bin",t.overview),i(n,"/tmp/origin.bin",t.origin),i(n,"/tmp/axis.bin",t.axis),i(n,"/tmp/design.bin",t.design),i(n,"/tmp/stations.bin",t.stations),i(n,"/tmp/areas.bin",t.areas),i(n,"/tmp/volumes.bin",t.volumes),i(n,"/tmp/samples.bin",t.samples),n.FS.writeFile("/tmp/stats.json",t.stats?JSON.stringify({max_over:t.stats.maxOver,mean_over:t.stats.meanOver,max_under:t.stats.maxUnder,mean_under:t.stats.meanUnder,over_area:t.stats.overArea,under_area:t.stats.underArea}):"null"),n.FS.writeFile("/tmp/gallery_n.txt",String(t.gallery.length)),t.gallery.forEach((a,c)=>{i(n,`/tmp/gallery_${c}.bin`,a.contour),n.FS.writeFile(`/tmp/gallery_${c}_s.txt`,String(a.s))});for(const a of t.compare)i(n,`/tmp/contour_${a.method}.bin`,a.contour),n.FS.writeFile(`/tmp/cov_${a.method}.txt`,String(a.coverage));const l=t.fit?JSON.stringify({center_x:t.fit.center_x,center_y:t.fit.center_y,radius:t.fit.radius}):"null";n.runPython(`
files = render_figures(
    json.loads(${JSON.stringify(JSON.stringify(t.kinds))}),
    ${t.thickness},
    ${t.s},
    json.loads(${JSON.stringify(l)}),
    json.loads(${JSON.stringify(JSON.stringify(t.compare.map(a=>a.method)))}),
)
`);const o=n.globals.get("files"),r=o.toJs({dict_converter:Object.fromEntries});o.destroy?.();const s={};for(const[a,c]of Object.entries(r)){const u=n.FS.readFile(c);s[a]=new Blob([u.slice()],{type:"image/png"})}const p=new Date().toISOString().replace(/[-:T]/g,"").slice(0,15);self.postMessage({type:"plotted",stamp:p,blobs:s})}catch(n){const t=n instanceof Error?n.message:"matplotlib 出图失败";self.postMessage({type:"error",message:t})}};function b(e){const n=e.u.length,t=new Float64Array(n*3),l=e.origin,o=e.axis,r=e.uAxis,s=e.vAxis;for(let p=0;p<n;p+=1){const a=e.u[p],c=e.v[p],u=e.z[p];t[p*3]=l[0]+a*r[0]+c*s[0]+u*o[0],t[p*3+1]=l[1]+a*r[1]+c*s[1]+u*o[1],t[p*3+2]=l[2]+a*r[2]+c*s[2]+u*o[2]}return t}function v(e){const n=e.contour.length/2|0,t=new Float64Array(n),l=new Float64Array(n),o=new Float64Array(n);for(let s=0;s<n;s+=1)t[s]=e.contour[s*2],l[s]=e.contour[s*2+1],o[s]=e.s;const r=new Float64Array(n*3);for(let s=0;s<n;s+=1)r[s*3]=e.origin[0]+t[s]*e.uAxis[0]+l[s]*e.vAxis[0]+o[s]*e.axis[0],r[s*3+1]=e.origin[1]+t[s]*e.uAxis[1]+l[s]*e.vAxis[1]+o[s]*e.axis[1],r[s*3+2]=e.origin[2]+t[s]*e.uAxis[2]+l[s]*e.vAxis[2]+o[s]*e.axis[2];return r}
