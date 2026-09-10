import{loadPyodide as x}from"https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs";var c=`from pathlib import Path\r
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
\r
\r
KIND_LABELS = {\r
    "section2d": "二维断面",\r
    "section3d": "三维断面",\r
    "tunnel3d": "隧道总览",\r
    "compare": "算法对比",\r
    "overbreak": "超欠挖对比",\r
    "areaDepth": "桩号–面积",\r
    "volumeDepth": "桩号–体积",\r
    "gallery": "多断面轮廓",\r
    "stack": "轮廓叠置",\r
    "liveSection": "实时断面",\r
}\r
\r
REPLAY_SCRIPT = """\\\r
# Re-draw every figure from data/*.csv sitting next to this file.\r
# Needs numpy and matplotlib (SciencePlots optional).\r
from pathlib import Path\r
import sys\r
\r
root = Path(__file__).resolve().parent\r
sys.path.insert(0, str(root))\r
from plotting import replay_plot_csv\r
\r
out = root / "replayed"\r
out.mkdir(exist_ok=True)\r
for csv_path in sorted((root / "data").glob("*.csv")):\r
    dest = out / f"{csv_path.stem}.png"\r
    replay_plot_csv(csv_path, dest)\r
    print("wrote", dest)\r
"""\r
\r
README_TEXT = """\\\r
隧道剖面导出包\r
==============\r
\r
figures/   选中的 PNG\r
data/      每张图一张 CSV，列与出图函数一一对应\r
plotting.py / replay.py  用 CSV 原样重画\r
\r
约定\r
----\r
以 \`\`# key=value\`\` 记录标量（桩号、厚度、拟合圆、覆盖率等）。\r
\`\`# table=名称\`\` 之后是表头和数值。空表只留表头。\r
\r
重画::\r
\r
    python replay.py\r
\r
结果写到 replayed/。每张图只依赖自己那份 CSV。\r
"""\r
\r
\r
def _as_2d(values, cols):\r
    arr = np.asarray(values, dtype=float) if values is not None else np.empty((0, cols))\r
    if arr.size == 0:\r
        return np.empty((0, cols), dtype=float)\r
    if arr.ndim == 1:\r
        if arr.size == cols:\r
            return arr.reshape(1, cols)\r
        if cols == 1:\r
            return arr.reshape(-1, 1)\r
        raise ValueError("array rank does not match column count")\r
    if arr.shape[1] != cols:\r
        raise ValueError(f"expected {cols} columns, got {arr.shape[1]}")\r
    return arr\r
\r
\r
def _fmt_meta(value):\r
    if isinstance(value, (float, np.floating)):\r
        if not np.isfinite(value):\r
            return ""\r
        return f"{float(value):.10g}"\r
    return str(value)\r
\r
\r
def write_plot_csv(path: Path, kind, meta, tables):\r
    """Write one reconstructable CSV: \`\`# key=value\`\` then \`\`# table=\`\` blocks."""\r
    path = Path(path)\r
    path.parent.mkdir(parents=True, exist_ok=True)\r
    with path.open("w", encoding="utf-8", newline="") as handle:\r
        handle.write(f"# kind={kind}\\n")\r
        for key, value in meta.items():\r
            if value is None:\r
                continue\r
            text = _fmt_meta(value)\r
            if text == "":\r
                continue\r
            handle.write(f"# {key}={text}\\n")\r
        for name, (columns, values) in tables.items():\r
            arr = _as_2d(values, len(columns))\r
            handle.write(f"# table={name}\\n")\r
            handle.write(",".join(columns) + "\\n")\r
            if arr.size:\r
                np.savetxt(handle, arr, delimiter=",", fmt="%.10g")\r
\r
\r
def load_plot_csv(path: Path):\r
    """Return \`\`(meta, tables)\`\` where tables map name -> (columns, ndarray)."""\r
    meta = {}\r
    tables = {}\r
    current = None\r
    columns = None\r
    rows = []\r
\r
    def flush():\r
        nonlocal current, columns, rows\r
        if current is None or columns is None:\r
            return\r
        if rows:\r
            tables[current] = (columns, np.asarray(rows, dtype=float))\r
        else:\r
            tables[current] = (columns, np.empty((0, len(columns)), dtype=float))\r
        current = None\r
        columns = None\r
        rows = []\r
\r
    with Path(path).open(encoding="utf-8") as handle:\r
        for raw in handle:\r
            line = raw.strip()\r
            if not line:\r
                continue\r
            if line.startswith("#"):\r
                body = line[1:].strip()\r
                if body.startswith("table="):\r
                    flush()\r
                    current = body.split("=", 1)[1].strip()\r
                    columns = None\r
                    rows = []\r
                    continue\r
                if "=" in body:\r
                    key, value = body.split("=", 1)\r
                    meta[key.strip()] = value.strip()\r
                continue\r
            if current is not None and columns is None:\r
                columns = [item.strip() for item in line.split(",")]\r
                continue\r
            if current is not None and columns is not None:\r
                parts = [item.strip() for item in line.split(",")]\r
                rows.append([float(item) if item not in ("", "nan", "NaN") else np.nan for item in parts])\r
        flush()\r
    return meta, tables\r
\r
\r
def _fit_from_meta(meta):\r
    radius = meta.get("fit_radius")\r
    if not radius:\r
        return None\r
    try:\r
        r = float(radius)\r
    except ValueError:\r
        return None\r
    if not np.isfinite(r) or r <= 0:\r
        return None\r
    return {\r
        "center_x": float(meta.get("fit_center_x", 0)),\r
        "center_y": float(meta.get("fit_center_y", 0)),\r
        "radius": r,\r
    }\r
\r
\r
def _table(tables, name, cols):\r
    if name not in tables:\r
        return np.empty((0, cols), dtype=float)\r
    _, arr = tables[name]\r
    return _as_2d(arr, cols)\r
\r
\r
def _optional_float(meta, key):\r
    if key not in meta:\r
        return None\r
    try:\r
        value = float(meta[key])\r
    except ValueError:\r
        return None\r
    return value if np.isfinite(value) else None\r
\r
\r
def write_kind_csv(path: Path, kind, payload):\r
    """Dump one figure's plotting arrays. \`\`payload\`\` keys depend on \`\`kind\`\`."""\r
    fit = payload.get("fit") or {}\r
    station = payload.get("station")\r
    thickness = payload.get("thickness")\r
    if kind in ("section2d", "liveSection"):\r
        meta = {"station": station, "thickness": thickness}\r
        if fit.get("radius", 0):\r
            meta.update(\r
                fit_center_x=fit.get("center_x"),\r
                fit_center_y=fit.get("center_y"),\r
                fit_radius=fit.get("radius"),\r
            )\r
        stats = payload.get("stats") or {}\r
        for key in ("max_over", "mean_over", "max_under", "mean_under", "over_area", "under_area"):\r
            if key in stats and stats[key] is not None:\r
                meta[key] = stats[key]\r
        u = np.asarray(payload.get("u", []), dtype=float)\r
        v = np.asarray(payload.get("v", []), dtype=float)\r
        tables = {\r
            "point": (("u", "v"), np.column_stack((u, v)) if len(u) else np.empty((0, 2))),\r
            "contour": (("u", "v"), payload.get("contour")),\r
        }\r
        if kind == "liveSection":\r
            tables["design"] = (("u", "v"), payload.get("design"))\r
        write_plot_csv(path, kind, meta, tables)\r
        return\r
    if kind == "section3d":\r
        axis = np.asarray(payload.get("axis", [0.0, 1.0, 0.0]), dtype=float)\r
        write_plot_csv(\r
            path,\r
            kind,\r
            {\r
                "station": station,\r
                "thickness": thickness,\r
                "axis_u": float(axis[0]),\r
                "axis_s": float(axis[1]),\r
                "axis_v": float(axis[2]),\r
            },\r
            {\r
                "point": (("u", "s", "v"), payload.get("points")),\r
                "contour": (("u", "s", "v"), payload.get("contour")),\r
            },\r
        )\r
        return\r
    if kind == "tunnel3d":\r
        axis = np.asarray(payload.get("axis", [0.0, 1.0, 0.0]), dtype=float)\r
        center = np.asarray(payload.get("center", [0.0, station or 0.0, 0.0]), dtype=float)\r
        write_plot_csv(\r
            path,\r
            kind,\r
            {\r
                "station": station,\r
                "thickness": thickness,\r
                "axis_u": float(axis[0]),\r
                "axis_s": float(axis[1]),\r
                "axis_v": float(axis[2]),\r
                "center_u": float(center[0]),\r
                "center_s": float(center[1]),\r
                "center_v": float(center[2]),\r
            },\r
            {\r
                "point": (("u", "s", "v"), payload.get("points")),\r
                "contour": (("u", "s", "v"), payload.get("contour")),\r
            },\r
        )\r
        return\r
    if kind == "compare":\r
        meta = {"methods": ",".join(payload.get("methods", []))}\r
        u = np.asarray(payload.get("u", []), dtype=float)\r
        v = np.asarray(payload.get("v", []), dtype=float)\r
        tables = {"point": (("u", "v"), np.column_stack((u, v)) if len(u) else np.empty((0, 2)))}\r
        for name, result in (payload.get("results") or {}).items():\r
            if result is None:\r
                meta[f"coverage_{name}"] = ""\r
                tables[f"contour_{name}"] = (("u", "v"), np.empty((0, 2)))\r
            else:\r
                contour, coverage = result\r
                meta[f"coverage_{name}"] = coverage\r
                tables[f"contour_{name}"] = (("u", "v"), contour)\r
        write_plot_csv(path, kind, meta, tables)\r
        return\r
    if kind == "overbreak":\r
        stats = payload.get("stats") or {}\r
        meta = {"station": station}\r
        for key in ("max_over", "mean_over", "max_under", "mean_under", "over_area", "under_area"):\r
            if stats.get(key) is not None:\r
                meta[key] = stats[key]\r
        write_plot_csv(\r
            path,\r
            kind,\r
            meta,\r
            {\r
                "contour": (("u", "v"), payload.get("contour")),\r
                "design": (("u", "v"), payload.get("design")),\r
                "sample": (("u", "v", "delta"), payload.get("samples")),\r
            },\r
        )\r
        return\r
    if kind == "areaDepth":\r
        stations = np.asarray(payload.get("stations", []), dtype=float)\r
        areas = np.asarray(payload.get("areas", []), dtype=float)\r
        write_plot_csv(\r
            path,\r
            kind,\r
            {},\r
            {"series": (("s", "area"), np.column_stack((stations, areas)) if len(stations) else np.empty((0, 2)))},\r
        )\r
        return\r
    if kind == "volumeDepth":\r
        stations = np.asarray(payload.get("stations", []), dtype=float)\r
        volumes = np.asarray(payload.get("volumes", []), dtype=float)\r
        write_plot_csv(\r
            path,\r
            kind,\r
            {},\r
            {"series": (("s", "volume"), np.column_stack((stations, volumes)) if len(stations) else np.empty((0, 2)))},\r
        )\r
        return\r
    if kind in ("gallery", "stack"):\r
        sections = payload.get("sections") or []\r
        design = payload.get("design")\r
        contour_rows = []\r
        ring_rows = []\r
        for item in sections:\r
            s_i, contour = item[0], item[1]\r
            contour = np.asarray(contour, dtype=float)\r
            if len(contour):\r
                s_col = np.full((len(contour), 1), float(s_i))\r
                contour_rows.append(np.column_stack((s_col, contour)))\r
                ring_rows.append(np.column_stack((contour[:, 0], np.full(len(contour), float(s_i)), contour[:, 1])))\r
        stacked = np.vstack(contour_rows) if contour_rows else np.empty((0, 3))\r
        rings = np.vstack(ring_rows) if ring_rows else np.empty((0, 3))\r
        meta = {"station": station, "n": len(sections)}\r
        if kind == "gallery":\r
            write_plot_csv(\r
                path,\r
                kind,\r
                meta,\r
                {\r
                    "design": (("u", "v"), design),\r
                    "contour": (("s", "u", "v"), stacked if stacked.size else np.empty((0, 3))),\r
                },\r
            )\r
            return\r
        write_plot_csv(path, kind, meta, {"ring": (("u", "s", "v"), rings)})\r
        return\r
    raise ValueError(f"unknown figure kind {kind}")\r
\r
\r
def replay_plot_csv(csv_path: Path, png_path: Path):\r
    """Redraw one PNG from its CSV using the same \`\`save_*\`\` functions."""\r
    meta, tables = load_plot_csv(csv_path)\r
    kind = meta.get("kind") or Path(csv_path).stem\r
    station = _optional_float(meta, "station")\r
    thickness = _optional_float(meta, "thickness")\r
    png_path = Path(png_path)\r
    png_path.parent.mkdir(parents=True, exist_ok=True)\r
    if kind in ("section2d", "liveSection"):\r
        point = _table(tables, "point", 2)\r
        contour = _table(tables, "contour", 2)\r
        u = point[:, 0] if len(point) else np.empty((0,))\r
        v = point[:, 1] if len(point) else np.empty((0,))\r
        fit = _fit_from_meta(meta)\r
        if kind == "liveSection":\r
            stats = {key: _optional_float(meta, key) for key in ("max_over", "mean_over", "max_under", "mean_under")}\r
            stats = {key: value for key, value in stats.items() if value is not None}\r
            save_live_section_plot(\r
                png_path, u, v, contour, fit, _table(tables, "design", 2),\r
                station=station, thickness=thickness, stats=stats or None,\r
            )\r
            return\r
        save_section_plot(png_path, u, v, contour, fit, station=station)\r
        return\r
    if kind == "section3d":\r
        axis = np.array([\r
            float(meta.get("axis_u", 0)),\r
            float(meta.get("axis_s", 1)),\r
            float(meta.get("axis_v", 0)),\r
        ])\r
        save_section_3d_plot(\r
            png_path, _table(tables, "point", 3), _table(tables, "contour", 3),\r
            axis, thickness if thickness is not None else 0.2, station=station,\r
        )\r
        return\r
    if kind == "tunnel3d":\r
        axis = np.array([\r
            float(meta.get("axis_u", 0)),\r
            float(meta.get("axis_s", 1)),\r
            float(meta.get("axis_v", 0)),\r
        ])\r
        center = np.array([\r
            float(meta.get("center_u", 0)),\r
            float(meta.get("center_s", station or 0)),\r
            float(meta.get("center_v", 0)),\r
        ])\r
        save_tunnel_3d_plot(\r
            png_path, _table(tables, "point", 3), _table(tables, "contour", 3),\r
            axis, thickness if thickness is not None else 0.2, center, station=station,\r
        )\r
        return\r
    if kind == "compare":\r
        point = _table(tables, "point", 2)\r
        methods = [item for item in meta.get("methods", "").split(",") if item]\r
        results = {}\r
        for name in methods:\r
            contour = _table(tables, f"contour_{name}", 2)\r
            cov = _optional_float(meta, f"coverage_{name}")\r
            results[name] = None if len(contour) == 0 else (contour, cov if cov is not None else 0.0)\r
        save_contour_comparison(png_path, point[:, 0] if len(point) else [], point[:, 1] if len(point) else [], results)\r
        return\r
    if kind == "overbreak":\r
        stats = {key: _optional_float(meta, key) for key in ("max_over", "mean_over", "max_under", "mean_under", "over_area", "under_area")}\r
        stats = {key: value for key, value in stats.items() if value is not None}\r
        save_overbreak_plot(\r
            png_path, _table(tables, "contour", 2), _table(tables, "design", 2),\r
            _table(tables, "sample", 3), stats=stats or None, station=station,\r
        )\r
        return\r
    if kind == "areaDepth":\r
        series = _table(tables, "series", 2)\r
        save_area_depth_plot(png_path, series[:, 0] if len(series) else [], series[:, 1] if len(series) else [])\r
        return\r
    if kind == "volumeDepth":\r
        series = _table(tables, "series", 2)\r
        save_volume_depth_plot(png_path, series[:, 0] if len(series) else [], series[:, 1] if len(series) else [])\r
        return\r
    if kind == "gallery":\r
        design = _table(tables, "design", 2)\r
        stacked = _table(tables, "contour", 3)\r
        sections = []\r
        if len(stacked):\r
            for s_i in np.unique(stacked[:, 0]):\r
                panel = stacked[stacked[:, 0] == s_i][:, 1:3]\r
                sections.append((float(s_i), panel, design))\r
        save_contour_gallery(png_path, sections, station=station)\r
        return\r
    if kind == "stack":\r
        rings_data = _table(tables, "ring", 3)\r
        rings = []\r
        if len(rings_data):\r
            for s_i in np.unique(rings_data[:, 1]):\r
                panel = rings_data[rings_data[:, 1] == s_i]\r
                if len(panel):\r
                    rings.append(panel)\r
        save_contour_stack_plot(png_path, rings)\r
        return\r
    raise ValueError(f"unknown figure kind {kind}")\r
\r
\r
def manifest_csv(kinds):\r
    lines = ["kind,label,png,csv"]\r
    for kind in kinds:\r
        label = KIND_LABELS.get(kind, kind)\r
        lines.append(f"{kind},{label},figures/{kind}.png,data/{kind}.csv")\r
    return "\\n".join(lines) + "\\n"\r
\r
`;const b="https://cdn.jsdelivr.net/pyodide/v0.27.7/full/",k=`
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


def _compare_results(methods):
    results = {}
    for name in methods:
        raw = _xy(f"/tmp/contour_{name}.bin")
        cov_path = Path(f"/tmp/cov_{name}.txt")
        if cov_path.exists() and raw.size:
            coverage = float(cov_path.read_text())
            results[name] = (raw, coverage)
        else:
            results[name] = None
    return results


def _gallery_sections(design):
    n = int(Path("/tmp/gallery_n.txt").read_text() or "0")
    sections = []
    for i in range(n):
        s_i = float(Path(f"/tmp/gallery_{i}_s.txt").read_text())
        c_i = _xy(f"/tmp/gallery_{i}.bin")
        sections.append((s_i, c_i, design))
    return sections


def export_bundle(kinds, thickness, station, fit, methods):
    import zipfile
    files = render_figures(kinds, thickness, station, fit, methods)
    if kinds == ["liveSection"]:
        return files, ""
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
    csv_dir = Path("/tmp/csv")
    if csv_dir.exists():
        import shutil
        shutil.rmtree(csv_dir)
    csv_dir.mkdir(exist_ok=True)
    if "section2d" in kinds:
        write_kind_csv(csv_dir / "section2d.csv", "section2d", {
            "u": u, "v": v, "contour": contour, "fit": fit, "station": station,
        })
    if "liveSection" in kinds:
        write_kind_csv(csv_dir / "liveSection.csv", "liveSection", {
            "u": u, "v": v, "contour": contour, "fit": fit, "design": design,
            "station": station, "thickness": thickness, "stats": stats,
        })
    if "section3d" in kinds:
        write_kind_csv(csv_dir / "section3d.csv", "section3d", {
            "points": slab, "contour": contour_xyz, "axis": axis,
            "thickness": thickness, "station": station,
        })
    if "tunnel3d" in kinds:
        center = contour_xyz.mean(axis=0) if len(contour_xyz) else np.array([0.0, station, 0.0])
        write_kind_csv(csv_dir / "tunnel3d.csv", "tunnel3d", {
            "points": overview, "contour": contour_xyz, "axis": axis, "center": center,
            "thickness": thickness, "station": station,
        })
    if "compare" in kinds:
        write_kind_csv(csv_dir / "compare.csv", "compare", {
            "u": u, "v": v, "methods": methods, "results": _compare_results(methods),
        })
    if "overbreak" in kinds:
        write_kind_csv(csv_dir / "overbreak.csv", "overbreak", {
            "contour": contour, "design": design, "samples": samples,
            "stats": stats, "station": station,
        })
    if "areaDepth" in kinds:
        write_kind_csv(csv_dir / "areaDepth.csv", "areaDepth", {
            "stations": stations, "areas": areas,
        })
    if "volumeDepth" in kinds:
        write_kind_csv(csv_dir / "volumeDepth.csv", "volumeDepth", {
            "stations": stations, "volumes": volumes,
        })
    gallery_kinds = [name for name in ("gallery", "stack") if name in kinds]
    if gallery_kinds:
        sections = _gallery_sections(design)
        for name in gallery_kinds:
            write_kind_csv(csv_dir / f"{name}.csv", name, {
                "sections": sections, "design": design, "station": station,
            })
    zip_path = Path("/tmp/figures.zip")
    csv_kinds = [p.stem for p in sorted(csv_dir.glob("*.csv"))]
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for kind, png in files.items():
            zf.write(png, f"figures/{kind}.png")
        for csv_file in sorted(csv_dir.glob("*.csv")):
            zf.write(csv_file, f"data/{csv_file.name}")
        plotting_src = Path("/tmp/plotting.py")
        if plotting_src.exists():
            zf.write(plotting_src, "plotting.py")
        zf.writestr("replay.py", REPLAY_SCRIPT)
        zf.writestr("README.txt", README_TEXT)
        zf.writestr("manifest.csv", manifest_csv(csv_kinds))
    return files, str(zip_path)
`;let p=null,i=null;function a(e){self.postMessage({type:"progress",message:e})}function s(e,n,t){e.FS.writeFile(n,new Uint8Array(t.buffer,t.byteOffset,t.byteLength))}async function m(){if(p)return p;if(i)return i;i=(async()=>{a("正在加载 Python WASM（首次较慢）");const e=await x({indexURL:b});a("正在装入 numpy / matplotlib"),await e.loadPackage(["numpy","matplotlib"],{messageCallback:n=>a(String(n))}),e.runPython(`
import os
os.makedirs("/tmp/mplconfig", exist_ok=True)
os.environ["MPLCONFIGDIR"] = "/tmp/mplconfig"
os.environ["MPLBACKEND"] = "Agg"
`);try{a("正在装入 SciencePlots 样式"),await e.loadPackage("micropip"),e.runPython("import micropip");const n=e.globals.get("micropip");await n.install("SciencePlots"),n.destroy?.()}catch(n){a(`SciencePlots 装入失败，改用 matplotlib 默认样式：${n instanceof Error?n.message:String(n)}`)}return e.runPython(c),e.FS.writeFile("/tmp/plotting.py",c),e.runPython(k),p=e,a("matplotlib 已在本机就绪"),e})();try{return await i}catch(e){throw i=null,e}}self.onmessage=async e=>{try{if(e.data.type==="init"){await m(),self.postMessage({type:"ready"});return}const n=await m(),t=e.data.pack;a("正在用 matplotlib 出图"),n.FS.writeFile("/tmp/plotting.py",c),s(n,"/tmp/u.bin",t.u),s(n,"/tmp/v.bin",t.v),s(n,"/tmp/z.bin",t.z),s(n,"/tmp/contour.bin",t.contour),s(n,"/tmp/overview.bin",t.overview),s(n,"/tmp/design.bin",t.design),s(n,"/tmp/stations.bin",t.stations),s(n,"/tmp/areas.bin",t.areas),s(n,"/tmp/volumes.bin",t.volumes),s(n,"/tmp/samples.bin",t.samples),n.FS.writeFile("/tmp/stats.json",t.stats?JSON.stringify({max_over:t.stats.maxOver,mean_over:t.stats.meanOver,max_under:t.stats.maxUnder,mean_under:t.stats.meanUnder,over_area:t.stats.overArea,under_area:t.stats.underArea}):"null"),n.FS.writeFile("/tmp/gallery_n.txt",String(t.gallery.length)),t.gallery.forEach((r,l)=>{s(n,`/tmp/gallery_${l}.bin`,r.contour),n.FS.writeFile(`/tmp/gallery_${l}_s.txt`,String(r.s))});for(const r of t.compare)s(n,`/tmp/contour_${r.method}.bin`,r.contour),n.FS.writeFile(`/tmp/cov_${r.method}.txt`,String(r.coverage));const g=t.fit?JSON.stringify({center_x:t.fit.center_x,center_y:t.fit.center_y,radius:t.fit.radius}):"null";n.runPython(`
files, zip_path = export_bundle(
    json.loads(${JSON.stringify(JSON.stringify(t.kinds))}),
    ${t.thickness},
    ${t.s},
    json.loads(${JSON.stringify(g)}),
    json.loads(${JSON.stringify(JSON.stringify(t.compare.map(r=>r.method)))}),
)
`);const u=n.globals.get("files"),y=u.toJs({dict_converter:Object.fromEntries});u.destroy?.();const f={};for(const[r,l]of Object.entries(y)){const h=n.FS.readFile(l);f[r]=new Blob([h.slice()],{type:"image/png"})}const d=n.globals.get("zip_path"),o=String(d??"");d?.destroy?.();let _=null;if(o&&o!=="None"&&o!==""){const r=n.FS.readFile(o);_=r.buffer.slice(r.byteOffset,r.byteOffset+r.byteLength)}const v=new Date().toISOString().replace(/[-:T]/g,"").slice(0,15);self.postMessage({type:"plotted",stamp:v,blobs:f,zip:_})}catch(n){const t=n instanceof Error?n.message:"matplotlib 出图失败";self.postMessage({type:"error",message:t})}};
