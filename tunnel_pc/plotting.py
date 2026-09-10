from pathlib import Path
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
        title = method if result is None else f"{method}\nN={len(contour)}, coverage={result[1]:.2f}"
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
