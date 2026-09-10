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
