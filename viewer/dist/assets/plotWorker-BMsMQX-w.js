import{loadPyodide as _}from"https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs";var g=`from pathlib import Path
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
`;let d=null,f=null;function m(t){self.postMessage({type:"progress",message:t})}function p(t,e,n){t.FS.writeFile(e,new Uint8Array(n.buffer,n.byteOffset,n.byteLength))}async function x(){if(d)return d;if(f)return f;f=(async()=>{m("正在加载 Python WASM（首次较慢）");const t=await _({indexURL:y});return m("正在装入 numpy / matplotlib"),await t.loadPackage(["numpy","matplotlib"],{messageCallback:e=>m(String(e))}),t.runPython(`
import os
os.makedirs("/tmp/mplconfig", exist_ok=True)
os.environ["MPLCONFIGDIR"] = "/tmp/mplconfig"
os.environ["MPLBACKEND"] = "Agg"
`),t.runPython(g),t.runPython(h),d=t,m("matplotlib 已在本机就绪"),t})();try{return await f}catch(t){throw f=null,t}}self.onmessage=async t=>{try{if(t.data.type==="init"){await x(),self.postMessage({type:"ready"});return}const e=await x(),n=t.data.pack;m("正在用 matplotlib 出图"),p(e,"/tmp/u.bin",n.u),p(e,"/tmp/v.bin",n.v),p(e,"/tmp/contour.bin",n.contour),p(e,"/tmp/slab_xyz.bin",b(n)),p(e,"/tmp/contour_xyz.bin",v(n)),p(e,"/tmp/overview.bin",n.overview),p(e,"/tmp/origin.bin",n.origin),p(e,"/tmp/axis.bin",n.axis);for(const i of n.compare)p(e,`/tmp/contour_${i.method}.bin`,i.contour),e.FS.writeFile(`/tmp/cov_${i.method}.txt`,String(i.coverage));const a=n.fit?JSON.stringify({center_x:n.fit.center_x,center_y:n.fit.center_y,radius:n.fit.radius}):"null";e.runPython(`
files = render_figures(
    json.loads(${JSON.stringify(JSON.stringify(n.kinds))}),
    ${n.thickness},
    ${n.s},
    json.loads(${JSON.stringify(a)}),
    json.loads(${JSON.stringify(JSON.stringify(n.compare.map(i=>i.method)))}),
)
`);const o=e.globals.get("files"),r=o.toJs({dict_converter:Object.fromEntries});o.destroy?.();const s={};for(const[i,c]of Object.entries(r)){const u=e.FS.readFile(c);s[i]=new Blob([u.slice()],{type:"image/png"})}const l=new Date().toISOString().replace(/[-:T]/g,"").slice(0,15);self.postMessage({type:"plotted",stamp:l,blobs:s})}catch(e){const n=e instanceof Error?e.message:"matplotlib 出图失败";self.postMessage({type:"error",message:n})}};function b(t){const e=t.u.length,n=new Float64Array(e*3),a=t.origin,o=t.axis,r=t.uAxis,s=t.vAxis;for(let l=0;l<e;l+=1){const i=t.u[l],c=t.v[l],u=t.z[l];n[l*3]=a[0]+i*r[0]+c*s[0]+u*o[0],n[l*3+1]=a[1]+i*r[1]+c*s[1]+u*o[1],n[l*3+2]=a[2]+i*r[2]+c*s[2]+u*o[2]}return n}function v(t){const e=t.contour.length/2|0,n=new Float64Array(e),a=new Float64Array(e),o=new Float64Array(e);for(let s=0;s<e;s+=1)n[s]=t.contour[s*2],a[s]=t.contour[s*2+1],o[s]=t.s;const r=new Float64Array(e*3);for(let s=0;s<e;s+=1)r[s*3]=t.origin[0]+n[s]*t.uAxis[0]+a[s]*t.vAxis[0]+o[s]*t.axis[0],r[s*3+1]=t.origin[1]+n[s]*t.uAxis[1]+a[s]*t.vAxis[1]+o[s]*t.axis[1],r[s*3+2]=t.origin[2]+n[s]*t.uAxis[2]+a[s]*t.vAxis[2]+o[s]*t.axis[2];return r}
