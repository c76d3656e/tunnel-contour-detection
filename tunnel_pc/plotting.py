from pathlib import Path
import numpy as np

DPI = 300

# "science" alone turns on text.usetex, so every figure is rendered with
# "no-latex" appended to keep it working where LaTeX is absent (Pyodide).
STYLE = ["science", "no-latex"]


def _sample(x, y, limit=12000):
    if len(x) <= limit:
        return x, y
    indexes = np.linspace(0, len(x) - 1, limit, dtype=int)
    return x[indexes], y[indexes]


def _style():
    """SciencePlots rc context, degrading to plain matplotlib if it is unavailable."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    try:
        import scienceplots  # noqa: F401
    except ImportError:
        return plt.style.context("default")
    return plt.style.context(STYLE)

def save_section_plot(path: Path, x, y, contour, fit=None, show_points=True, station=None):
    import matplotlib.pyplot as plt

    with _style():
        sx, sy = _sample(np.asarray(x), np.asarray(y))
        figure, axis = plt.subplots(figsize=(7, 7), dpi=DPI)
        if station is not None:
            axis.set_title(f"s = {station:.2f} m", fontsize=11)
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
        figure.savefig(path, dpi=DPI)
        plt.close(figure)


def save_live_section_plot(path: Path, x, y, contour, fit=None, design=None, station=None,
                           thickness=None, stats=None):
    """The live inset's section, redrawn: slice points, contour, fit circle and design profile."""
    import matplotlib.pyplot as plt

    with _style():
        figure, axis = plt.subplots(figsize=(7, 7), dpi=DPI)
        sx, sy = _sample(np.asarray(x), np.asarray(y))
        if len(sx):
            axis.scatter(sx, sy, s=1, alpha=0.25, label="section points")
        if len(contour):
            contour = np.asarray(contour, dtype=float)
            closed = np.vstack((contour, contour[0]))
            axis.plot(closed[:, 0], closed[:, 1], "r.-", ms=2, lw=1, label="wall contour")
        if design is not None and len(design) > 2:
            design = np.asarray(design, dtype=float)
            closed = np.vstack((design, design[0]))
            axis.plot(closed[:, 0], closed[:, 1], color="royalblue", lw=1.5,
                      label="design horseshoe")
        if fit and fit.get("radius", 0) > 0:
            angles = np.linspace(0, 2 * np.pi, 360)
            axis.plot(fit["center_x"] + fit["radius"] * np.cos(angles),
                      fit["center_y"] + fit["radius"] * np.sin(angles), "k--", lw=1,
                      label=f"circle r={fit['radius']:.3f} m")
        axis.set_aspect("equal", adjustable="box")
        axis.set_xlabel("section u (m)")
        axis.set_ylabel("section v (m)")
        title = "Tunnel section"
        if station is not None:
            title += f",  s = {station:.2f} m"
        if thickness is not None:
            title += f",  thickness = {thickness:g} m"
        if stats:
            title += (f"\nover max {stats.get('max_over', 0):.3f}, mean {stats.get('mean_over', 0):.3f}; "
                      f"under max {stats.get('max_under', 0):.3f}, mean {stats.get('mean_under', 0):.3f}")
        axis.set_title(title, fontsize=10)
        axis.grid(alpha=0.2)
        axis.legend(loc="best", fontsize=8)
        figure.tight_layout()
        figure.savefig(path, dpi=DPI)
        plt.close(figure)


def save_contour_comparison(path: Path, x, y, results):
    import matplotlib.pyplot as plt

    with _style():
        columns = 3
        rows = int(np.ceil(len(results) / columns))
        figure, axes = plt.subplots(rows, columns, figsize=(14, 4 * rows), dpi=DPI)
        axes = np.atleast_1d(axes).ravel()
        sx, sy = _sample(np.asarray(x), np.asarray(y), limit=7000)
        for axis, (method, result) in zip(axes.flat, results.items()):
            contour = result[0] if result is not None else np.empty((0, 2))
            axis.scatter(sx, sy, s=1, alpha=0.12, color="steelblue")
            if len(contour):
                closed = np.vstack((contour, contour[0]))
                axis.plot(closed[:, 0], closed[:, 1], color="crimson", lw=1)
            title = method if result is None else f"{method}\nN={len(contour)}, coverage={result[1]:.2f}"
            axis.set_title(title, fontsize=9)
            axis.set_aspect("equal", adjustable="box")
            axis.grid(alpha=0.15)
        for axis in axes[len(results):]:
            axis.axis("off")
        figure.tight_layout()
        figure.savefig(path, dpi=DPI)
        plt.close(figure)


def _view_along_axis(axis_vector, yaw_offset=45.0, elev=30.0):
    """Look along the plotted Y axis of a horizontal tunnel, then yaw for isometric.

    3D figures use the display frame packed as (u, s, v), so matplotlib's Z is
    gravity-up and the tunnel runs along Y. World-frame callers pass the tunnel
    axis in XYZ and get the same kind of oblique view.
    """
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


def save_section_3d_plot(path: Path, points, contour, axis_vector, thickness, station=None):
    """Slice in the display frame: points are (u, s, v) so matplotlib Z is up."""
    import matplotlib.pyplot as plt

    points = np.asarray(points, dtype=float)
    contour = np.asarray(contour, dtype=float)
    sampled, _ = _sample(points[:, 0], points[:, 1]) if len(points) else ([], [])
    if len(points) > len(sampled):
        sampled = points[np.linspace(0, len(points) - 1, len(sampled), dtype=int)]
    elif len(points):
        sampled = points
    with _style():
        figure = plt.figure(figsize=(9, 7), dpi=DPI)
        axis = figure.add_subplot(111, projection="3d")
        if len(sampled):
            axis.scatter(sampled[:, 0], sampled[:, 1], sampled[:, 2], s=1, alpha=0.22, label="slice points")
        if len(contour) >= 3:
            closed = np.vstack((contour, contour[0]))
            axis.plot(closed[:, 0], closed[:, 1], closed[:, 2], color="crimson", lw=1.8, label="inner contour")
        axis.set_xlabel("u (m)")
        axis.set_ylabel("s (m)")
        axis.set_zlabel("v (m)")
        title = f"Tunnel section, thickness={thickness:g}"
        if station is not None:
            title += f",  s = {station:.2f} m"
        axis.set_title(title)
        elev, azim = _view_along_axis(axis_vector)
        axis.view_init(elev=elev, azim=azim)
        _set_axes_3d(axis, np.vstack((points, contour)) if len(contour) else points, equal=True)
        axis.legend(loc="best", fontsize=8)
        figure.tight_layout()
        figure.savefig(path, dpi=DPI)
        plt.close(figure)


def save_tunnel_3d_plot(path: Path, points, contour, axis_vector, thickness, section_center,
                        station=None):
    """Overview in the display frame: points are (u, s, v) so matplotlib Z is up."""
    import matplotlib.pyplot as plt

    points = np.asarray(points, dtype=float)
    contour = np.asarray(contour, dtype=float)
    with _style():
        figure = plt.figure(figsize=(11, 8), dpi=DPI)
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
        axis.set_xlabel("u (m)")
        axis.set_ylabel("s (m)")
        axis.set_zlabel("v (m)")
        title = f"Tunnel overview, thickness={thickness:g}"
        if station is not None:
            title += f",  s = {station:.2f} m"
        axis.set_title(title)
        elev, azim = _view_along_axis(axis_vector)
        axis.view_init(elev=elev, azim=azim)
        frame_pts = points if len(points) else np.reshape(center, (1, 3))
        _set_axes_3d(axis, frame_pts, equal=False, pad=0.08)
        axis.legend(loc="best", fontsize=8)
        figure.tight_layout()
        figure.savefig(path, dpi=DPI)
        plt.close(figure)


def save_area_depth_plot(path: Path, stations, areas):
    import matplotlib.pyplot as plt

    stations = np.asarray(stations, dtype=float)
    areas = np.asarray(areas, dtype=float)
    with _style():
        figure, axis = plt.subplots(figsize=(8, 5), dpi=DPI)
        if len(stations):
            axis.plot(stations, areas, "s-", color="crimson", lw=1.4, ms=5, label="section area")
        axis.set_xlabel("s (m)")
        axis.set_ylabel("S (m$^2$)")
        axis.set_title("Section area along station")
        axis.grid(alpha=0.25)
        axis.legend(loc="best", fontsize=8)
        figure.tight_layout()
        figure.savefig(path, dpi=DPI)
        plt.close(figure)


def save_volume_depth_plot(path: Path, stations, volumes):
    import matplotlib.pyplot as plt

    stations = np.asarray(stations, dtype=float)
    volumes = np.asarray(volumes, dtype=float)
    with _style():
        figure, axis = plt.subplots(figsize=(8, 5), dpi=DPI)
        if len(stations):
            axis.plot(stations, volumes, "o-", color="steelblue", lw=1.4, ms=5, label="cumulative volume")
        axis.set_xlabel("s (m)")
        axis.set_ylabel("V (m$^3$)")
        axis.set_title("Contour volume from first station")
        axis.grid(alpha=0.25)
        axis.legend(loc="best", fontsize=8)
        figure.tight_layout()
        figure.savefig(path, dpi=DPI)
        plt.close(figure)


def save_contour_gallery(path: Path, sections, station=None):
    import matplotlib.pyplot as plt

    n = max(1, len(sections))
    columns = min(5, n)
    rows = int(np.ceil(n / columns))
    with _style():
        figure, axes = plt.subplots(rows, columns, figsize=(2.8 * columns, 2.8 * rows), dpi=DPI)
        axes = np.atleast_1d(axes).ravel()
        for axis, item in zip(axes, sections):
            panel_s, contour, design = item
            contour = np.asarray(contour, dtype=float)
            design = np.asarray(design, dtype=float)
            if len(design) > 2:
                closed = np.vstack((design, design[0]))
                axis.plot(closed[:, 0], closed[:, 1], color="0.35", lw=1.0)
            if len(contour) > 2:
                closed = np.vstack((contour, contour[0]))
                axis.plot(closed[:, 0], closed[:, 1], color="crimson", lw=1.1)
            axis.set_title(f"{panel_s:.2f} m", fontsize=8)
            axis.set_aspect("equal", adjustable="box")
            axis.tick_params(labelsize=7)
            axis.grid(alpha=0.15)
        for axis in axes[len(sections):]:
            axis.axis("off")
        if station is not None:
            figure.suptitle(f"sections along the tunnel,  current s = {station:.2f} m", fontsize=10)
        figure.tight_layout()
        figure.savefig(path, dpi=DPI)
        plt.close(figure)


def save_contour_stack_plot(path: Path, rings):
    import matplotlib.pyplot as plt

    with _style():
        figure = plt.figure(figsize=(9, 6), dpi=DPI)
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
        figure.savefig(path, dpi=DPI)
        plt.close(figure)


def save_overbreak_plot(path: Path, contour, design, samples, stats=None, station=None):
    import matplotlib.pyplot as plt

    contour = np.asarray(contour, dtype=float)
    design = np.asarray(design, dtype=float)
    samples = np.asarray(samples, dtype=float)
    with _style():
        figure, axis = plt.subplots(figsize=(7, 7), dpi=DPI)
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
        title = "Over / under break  $\\Delta d$ (m)"
        if station is not None:
            title += f"   (s = {station:.2f} m)"
        if stats:
            title += (f"\nover max {stats.get('max_over', 0):.3f}, mean {stats.get('mean_over', 0):.3f}; "
                      f"under max {stats.get('max_under', 0):.3f}, mean {stats.get('mean_under', 0):.3f}")
        axis.set_title(title, fontsize=10)
        axis.grid(alpha=0.2)
        axis.legend(loc="best", fontsize=8)
        figure.tight_layout()
        figure.savefig(path, dpi=DPI)
        plt.close(figure)


KIND_LABELS = {
    "section2d": "二维断面",
    "section3d": "三维断面",
    "tunnel3d": "隧道总览",
    "compare": "算法对比",
    "overbreak": "超欠挖对比",
    "areaDepth": "桩号–面积",
    "volumeDepth": "桩号–体积",
    "gallery": "多断面轮廓",
    "stack": "轮廓叠置",
    "liveSection": "实时断面",
}

REPLAY_SCRIPT = """\
# Re-draw every figure from data/*.csv sitting next to this file.
# Needs numpy and matplotlib (SciencePlots optional).
from pathlib import Path
import sys

root = Path(__file__).resolve().parent
sys.path.insert(0, str(root))
from plotting import replay_plot_csv

out = root / "replayed"
out.mkdir(exist_ok=True)
for csv_path in sorted((root / "data").glob("*.csv")):
    dest = out / f"{csv_path.stem}.png"
    replay_plot_csv(csv_path, dest)
    print("wrote", dest)
"""

README_TEXT = """\
隧道剖面导出包
==============

figures/   选中的 PNG
data/      每张图一张 CSV，列与出图函数一一对应
plotting.py / replay.py  用 CSV 原样重画

约定
----
以 ``# key=value`` 记录标量（桩号、厚度、拟合圆、覆盖率等）。
``# table=名称`` 之后是表头和数值。空表只留表头。

重画::

    python replay.py

结果写到 replayed/。每张图只依赖自己那份 CSV。
"""


def _as_2d(values, cols):
    arr = np.asarray(values, dtype=float) if values is not None else np.empty((0, cols))
    if arr.size == 0:
        return np.empty((0, cols), dtype=float)
    if arr.ndim == 1:
        if arr.size == cols:
            return arr.reshape(1, cols)
        if cols == 1:
            return arr.reshape(-1, 1)
        raise ValueError("array rank does not match column count")
    if arr.shape[1] != cols:
        raise ValueError(f"expected {cols} columns, got {arr.shape[1]}")
    return arr


def _fmt_meta(value):
    if isinstance(value, (float, np.floating)):
        if not np.isfinite(value):
            return ""
        return f"{float(value):.10g}"
    return str(value)


def write_plot_csv(path: Path, kind, meta, tables):
    """Write one reconstructable CSV: ``# key=value`` then ``# table=`` blocks."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(f"# kind={kind}\n")
        for key, value in meta.items():
            if value is None:
                continue
            text = _fmt_meta(value)
            if text == "":
                continue
            handle.write(f"# {key}={text}\n")
        for name, (columns, values) in tables.items():
            arr = _as_2d(values, len(columns))
            handle.write(f"# table={name}\n")
            handle.write(",".join(columns) + "\n")
            if arr.size:
                np.savetxt(handle, arr, delimiter=",", fmt="%.10g")


def load_plot_csv(path: Path):
    """Return ``(meta, tables)`` where tables map name -> (columns, ndarray)."""
    meta = {}
    tables = {}
    current = None
    columns = None
    rows = []

    def flush():
        nonlocal current, columns, rows
        if current is None or columns is None:
            return
        if rows:
            tables[current] = (columns, np.asarray(rows, dtype=float))
        else:
            tables[current] = (columns, np.empty((0, len(columns)), dtype=float))
        current = None
        columns = None
        rows = []

    with Path(path).open(encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line:
                continue
            if line.startswith("#"):
                body = line[1:].strip()
                if body.startswith("table="):
                    flush()
                    current = body.split("=", 1)[1].strip()
                    columns = None
                    rows = []
                    continue
                if "=" in body:
                    key, value = body.split("=", 1)
                    meta[key.strip()] = value.strip()
                continue
            if current is not None and columns is None:
                columns = [item.strip() for item in line.split(",")]
                continue
            if current is not None and columns is not None:
                parts = [item.strip() for item in line.split(",")]
                rows.append([float(item) if item not in ("", "nan", "NaN") else np.nan for item in parts])
        flush()
    return meta, tables


def _fit_from_meta(meta):
    radius = meta.get("fit_radius")
    if not radius:
        return None
    try:
        r = float(radius)
    except ValueError:
        return None
    if not np.isfinite(r) or r <= 0:
        return None
    return {
        "center_x": float(meta.get("fit_center_x", 0)),
        "center_y": float(meta.get("fit_center_y", 0)),
        "radius": r,
    }


def _table(tables, name, cols):
    if name not in tables:
        return np.empty((0, cols), dtype=float)
    _, arr = tables[name]
    return _as_2d(arr, cols)


def _optional_float(meta, key):
    if key not in meta:
        return None
    try:
        value = float(meta[key])
    except ValueError:
        return None
    return value if np.isfinite(value) else None


def write_kind_csv(path: Path, kind, payload):
    """Dump one figure's plotting arrays. ``payload`` keys depend on ``kind``."""
    fit = payload.get("fit") or {}
    station = payload.get("station")
    thickness = payload.get("thickness")
    if kind in ("section2d", "liveSection"):
        meta = {"station": station, "thickness": thickness}
        if fit.get("radius", 0):
            meta.update(
                fit_center_x=fit.get("center_x"),
                fit_center_y=fit.get("center_y"),
                fit_radius=fit.get("radius"),
            )
        stats = payload.get("stats") or {}
        for key in ("max_over", "mean_over", "max_under", "mean_under", "over_area", "under_area"):
            if key in stats and stats[key] is not None:
                meta[key] = stats[key]
        u = np.asarray(payload.get("u", []), dtype=float)
        v = np.asarray(payload.get("v", []), dtype=float)
        tables = {
            "point": (("u", "v"), np.column_stack((u, v)) if len(u) else np.empty((0, 2))),
            "contour": (("u", "v"), payload.get("contour")),
        }
        if kind == "liveSection":
            tables["design"] = (("u", "v"), payload.get("design"))
        write_plot_csv(path, kind, meta, tables)
        return
    if kind == "section3d":
        axis = np.asarray(payload.get("axis", [0.0, 1.0, 0.0]), dtype=float)
        write_plot_csv(
            path,
            kind,
            {
                "station": station,
                "thickness": thickness,
                "axis_u": float(axis[0]),
                "axis_s": float(axis[1]),
                "axis_v": float(axis[2]),
            },
            {
                "point": (("u", "s", "v"), payload.get("points")),
                "contour": (("u", "s", "v"), payload.get("contour")),
            },
        )
        return
    if kind == "tunnel3d":
        axis = np.asarray(payload.get("axis", [0.0, 1.0, 0.0]), dtype=float)
        center = np.asarray(payload.get("center", [0.0, station or 0.0, 0.0]), dtype=float)
        write_plot_csv(
            path,
            kind,
            {
                "station": station,
                "thickness": thickness,
                "axis_u": float(axis[0]),
                "axis_s": float(axis[1]),
                "axis_v": float(axis[2]),
                "center_u": float(center[0]),
                "center_s": float(center[1]),
                "center_v": float(center[2]),
            },
            {
                "point": (("u", "s", "v"), payload.get("points")),
                "contour": (("u", "s", "v"), payload.get("contour")),
            },
        )
        return
    if kind == "compare":
        meta = {"methods": ",".join(payload.get("methods", []))}
        u = np.asarray(payload.get("u", []), dtype=float)
        v = np.asarray(payload.get("v", []), dtype=float)
        tables = {"point": (("u", "v"), np.column_stack((u, v)) if len(u) else np.empty((0, 2)))}
        for name, result in (payload.get("results") or {}).items():
            if result is None:
                meta[f"coverage_{name}"] = ""
                tables[f"contour_{name}"] = (("u", "v"), np.empty((0, 2)))
            else:
                contour, coverage = result
                meta[f"coverage_{name}"] = coverage
                tables[f"contour_{name}"] = (("u", "v"), contour)
        write_plot_csv(path, kind, meta, tables)
        return
    if kind == "overbreak":
        stats = payload.get("stats") or {}
        meta = {"station": station}
        for key in ("max_over", "mean_over", "max_under", "mean_under", "over_area", "under_area"):
            if stats.get(key) is not None:
                meta[key] = stats[key]
        write_plot_csv(
            path,
            kind,
            meta,
            {
                "contour": (("u", "v"), payload.get("contour")),
                "design": (("u", "v"), payload.get("design")),
                "sample": (("u", "v", "delta"), payload.get("samples")),
            },
        )
        return
    if kind == "areaDepth":
        stations = np.asarray(payload.get("stations", []), dtype=float)
        areas = np.asarray(payload.get("areas", []), dtype=float)
        write_plot_csv(
            path,
            kind,
            {},
            {"series": (("s", "area"), np.column_stack((stations, areas)) if len(stations) else np.empty((0, 2)))},
        )
        return
    if kind == "volumeDepth":
        stations = np.asarray(payload.get("stations", []), dtype=float)
        volumes = np.asarray(payload.get("volumes", []), dtype=float)
        write_plot_csv(
            path,
            kind,
            {},
            {"series": (("s", "volume"), np.column_stack((stations, volumes)) if len(stations) else np.empty((0, 2)))},
        )
        return
    if kind in ("gallery", "stack"):
        sections = payload.get("sections") or []
        design = payload.get("design")
        contour_rows = []
        ring_rows = []
        for item in sections:
            s_i, contour = item[0], item[1]
            contour = np.asarray(contour, dtype=float)
            if len(contour):
                s_col = np.full((len(contour), 1), float(s_i))
                contour_rows.append(np.column_stack((s_col, contour)))
                ring_rows.append(np.column_stack((contour[:, 0], np.full(len(contour), float(s_i)), contour[:, 1])))
        stacked = np.vstack(contour_rows) if contour_rows else np.empty((0, 3))
        rings = np.vstack(ring_rows) if ring_rows else np.empty((0, 3))
        meta = {"station": station, "n": len(sections)}
        if kind == "gallery":
            write_plot_csv(
                path,
                kind,
                meta,
                {
                    "design": (("u", "v"), design),
                    "contour": (("s", "u", "v"), stacked if stacked.size else np.empty((0, 3))),
                },
            )
            return
        write_plot_csv(path, kind, meta, {"ring": (("u", "s", "v"), rings)})
        return
    raise ValueError(f"unknown figure kind {kind}")


def replay_plot_csv(csv_path: Path, png_path: Path):
    """Redraw one PNG from its CSV using the same ``save_*`` functions."""
    meta, tables = load_plot_csv(csv_path)
    kind = meta.get("kind") or Path(csv_path).stem
    station = _optional_float(meta, "station")
    thickness = _optional_float(meta, "thickness")
    png_path = Path(png_path)
    png_path.parent.mkdir(parents=True, exist_ok=True)
    if kind in ("section2d", "liveSection"):
        point = _table(tables, "point", 2)
        contour = _table(tables, "contour", 2)
        u = point[:, 0] if len(point) else np.empty((0,))
        v = point[:, 1] if len(point) else np.empty((0,))
        fit = _fit_from_meta(meta)
        if kind == "liveSection":
            stats = {key: _optional_float(meta, key) for key in ("max_over", "mean_over", "max_under", "mean_under")}
            stats = {key: value for key, value in stats.items() if value is not None}
            save_live_section_plot(
                png_path, u, v, contour, fit, _table(tables, "design", 2),
                station=station, thickness=thickness, stats=stats or None,
            )
            return
        save_section_plot(png_path, u, v, contour, fit, station=station)
        return
    if kind == "section3d":
        axis = np.array([
            float(meta.get("axis_u", 0)),
            float(meta.get("axis_s", 1)),
            float(meta.get("axis_v", 0)),
        ])
        save_section_3d_plot(
            png_path, _table(tables, "point", 3), _table(tables, "contour", 3),
            axis, thickness if thickness is not None else 0.2, station=station,
        )
        return
    if kind == "tunnel3d":
        axis = np.array([
            float(meta.get("axis_u", 0)),
            float(meta.get("axis_s", 1)),
            float(meta.get("axis_v", 0)),
        ])
        center = np.array([
            float(meta.get("center_u", 0)),
            float(meta.get("center_s", station or 0)),
            float(meta.get("center_v", 0)),
        ])
        save_tunnel_3d_plot(
            png_path, _table(tables, "point", 3), _table(tables, "contour", 3),
            axis, thickness if thickness is not None else 0.2, center, station=station,
        )
        return
    if kind == "compare":
        point = _table(tables, "point", 2)
        methods = [item for item in meta.get("methods", "").split(",") if item]
        results = {}
        for name in methods:
            contour = _table(tables, f"contour_{name}", 2)
            cov = _optional_float(meta, f"coverage_{name}")
            results[name] = None if len(contour) == 0 else (contour, cov if cov is not None else 0.0)
        save_contour_comparison(png_path, point[:, 0] if len(point) else [], point[:, 1] if len(point) else [], results)
        return
    if kind == "overbreak":
        stats = {key: _optional_float(meta, key) for key in ("max_over", "mean_over", "max_under", "mean_under", "over_area", "under_area")}
        stats = {key: value for key, value in stats.items() if value is not None}
        save_overbreak_plot(
            png_path, _table(tables, "contour", 2), _table(tables, "design", 2),
            _table(tables, "sample", 3), stats=stats or None, station=station,
        )
        return
    if kind == "areaDepth":
        series = _table(tables, "series", 2)
        save_area_depth_plot(png_path, series[:, 0] if len(series) else [], series[:, 1] if len(series) else [])
        return
    if kind == "volumeDepth":
        series = _table(tables, "series", 2)
        save_volume_depth_plot(png_path, series[:, 0] if len(series) else [], series[:, 1] if len(series) else [])
        return
    if kind == "gallery":
        design = _table(tables, "design", 2)
        stacked = _table(tables, "contour", 3)
        sections = []
        if len(stacked):
            for s_i in np.unique(stacked[:, 0]):
                panel = stacked[stacked[:, 0] == s_i][:, 1:3]
                sections.append((float(s_i), panel, design))
        save_contour_gallery(png_path, sections, station=station)
        return
    if kind == "stack":
        rings_data = _table(tables, "ring", 3)
        rings = []
        if len(rings_data):
            for s_i in np.unique(rings_data[:, 1]):
                panel = rings_data[rings_data[:, 1] == s_i]
                if len(panel):
                    rings.append(panel)
        save_contour_stack_plot(png_path, rings)
        return
    raise ValueError(f"unknown figure kind {kind}")


def manifest_csv(kinds):
    lines = ["kind,label,png,csv"]
    for kind in kinds:
        label = KIND_LABELS.get(kind, kind)
        lines.append(f"{kind},{label},figures/{kind}.png,data/{kind}.csv")
    return "\n".join(lines) + "\n"

