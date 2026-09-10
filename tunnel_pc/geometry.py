import numpy as np

def principal_axis(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    center = np.median(points, axis=0)
    _, _, vt = np.linalg.svd(points - center, full_matrices=False)
    axis = vt[0]
    axis /= np.linalg.norm(axis)
    if axis[np.argmax(np.abs(axis))] < 0: axis = -axis
    return center, axis

def frame(axis: np.ndarray, up: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Return a profile frame with the second axis pointing upward.

    World Z is used as the vertical reference because tunnel scans normally
    preserve gravity even when the tunnel axis has a small grade.
    """
    if up is None:
        up = np.array([0., 0., 1.])
    ref = up if abs(float(np.dot(axis, up))) < .9 else np.array([1., 0., 0.])
    u = np.cross(axis, ref)
    u /= np.linalg.norm(u)
    w = np.cross(axis, u)
    if np.dot(w, up) < 0:
        u, w = -u, -w
    return u, w


def dense_station_range(s: np.ndarray, bins: int = 64) -> tuple[float, float]:
    """Drop sparse axial tails; keep the occupied tunnel from first to last dense bin."""
    s = np.asarray(s, dtype=float)
    if len(s) < 50:
        return float(s.min()), float(s.max())
    counts, edges = np.histogram(s, bins=bins)
    peak = float(counts.max())
    if peak <= 0:
        return float(s.min()), float(s.max())
    thresh = max(peak * 0.003, 800.0)
    kept = np.flatnonzero(counts >= thresh)
    if len(kept) == 0:
        return float(np.percentile(s, 2)), float(np.percentile(s, 99.5))
    return float(edges[kept[0]]), float(edges[kept[-1] + 1])

