"""Candidate contour extraction pipelines for tunnel cross sections."""

from __future__ import annotations

import numpy as np
from scipy.ndimage import median_filter
from scipy.signal import savgol_filter
from scipy.spatial import cKDTree
from scipy.interpolate import splprep, splev


METHODS = ("legacy", "statistical", "radius", "hampel", "robust", "spline")
DEFAULT_METHOD = "hampel"


def statistical_keep(points: np.ndarray, neighbors: int = 16, std_ratio: float = 2.5) -> np.ndarray:
    if len(points) <= neighbors + 1:
        return np.ones(len(points), dtype=bool)
    distances, _ = cKDTree(points).query(points, k=neighbors + 1)
    local_mean = distances[:, 1:].mean(axis=1)
    median = float(np.median(local_mean))
    mad = float(np.median(np.abs(local_mean - median)))
    scale = max(1e-6, 1.4826 * mad)
    return local_mean <= median + std_ratio * scale


def radius_keep(points: np.ndarray, radius: float = 0.08, min_neighbors: int = 3) -> np.ndarray:
    if len(points) == 0:
        return np.zeros(0, dtype=bool)
    counts = cKDTree(points).query_ball_point(points, radius, return_length=True)
    return counts >= min_neighbors


def _circular_hampel(values: np.ndarray, window: int = 15, threshold: float = 3.0):
    window = max(5, int(window) // 2 * 2 + 1)
    local_median = median_filter(values, size=window, mode="wrap")
    deviation = np.abs(values - local_median)
    local_mad = median_filter(deviation, size=window, mode="wrap")
    scale = np.maximum(0.015, 1.4826 * local_mad)
    result = values.copy()
    result[deviation > threshold * scale] = local_median[deviation > threshold * scale]
    return result


def _polar_envelope(points: np.ndarray, bins: int, quantile: float,
                    min_bin_points: int, smooth: str | None = None,
                    smooth_window: int = 9):
    if len(points) == 0:
        return np.empty((0, 2)), 0.0
    origin = np.median(points, axis=0)
    delta = points - origin
    radii = np.hypot(delta[:, 0], delta[:, 1])
    angles = np.arctan2(delta[:, 1], delta[:, 0])
    edges = np.linspace(-np.pi, np.pi, bins + 1)
    centers = (edges[:-1] + edges[1:]) / 2
    idx = np.clip(np.digitize(angles, edges) - 1, 0, bins - 1)
    order = np.argsort(idx, kind="mergesort")
    idx_s = idx[order]
    rad_s = radii[order]
    splits = np.searchsorted(idx_s, np.arange(bins + 1), side="left")
    radial = np.full(bins, np.nan)
    for index in range(bins):
        start, stop = int(splits[index]), int(splits[index + 1])
        if stop - start >= min_bin_points:
            radial[index] = np.quantile(rad_s[start:stop], quantile)
    valid = np.isfinite(radial)
    coverage = float(valid.mean())
    if valid.sum() < 3:
        return np.empty((0, 2)), coverage
    # Periodic interpolation fills only gaps between observed angular bins.
    index = np.arange(bins)
    valid_index = index[valid]
    radial = np.interp(index, np.r_[valid_index - bins, valid_index, valid_index + bins],
                       np.r_[radial[valid], radial[valid], radial[valid]])
    if smooth in {"hampel", "robust", "spline"}:
        radial = _circular_hampel(radial, window=max(15, smooth_window))
    if smooth in {"median", "robust"}:
        radial = median_filter(radial, size=max(3, smooth_window // 2 * 2 + 1), mode="wrap")
    if smooth in {"robust", "spline"}:
        window = min(bins - (1 - bins % 2), max(15, smooth_window) if smooth_window % 2 else max(15, smooth_window) - 1)
        if window >= 5:
            radial = savgol_filter(radial, window_length=window, polyorder=2, mode="wrap")
    contour = np.column_stack((origin[0] + radial * np.cos(centers),
                               origin[1] + radial * np.sin(centers)))
    if smooth == "spline" and len(contour) >= 8:
        try:
            tck, _ = splprep(contour.T, s=0.001 * len(contour), per=True, k=3)
            parameter = np.linspace(0, 1, len(contour), endpoint=False)
            contour = np.column_stack(splev(parameter, tck))
        except (ValueError, TypeError):
            pass
    return contour, coverage


def extract_contour(x: np.ndarray, y: np.ndarray, bins: int = 180,
                    quantile: float = 0.90, min_bin_points: int = 2,
                    method: str = DEFAULT_METHOD, smooth_window: int = 9):
    """Extract an ordered inner-wall contour using a named candidate method."""
    if method not in METHODS:
        raise ValueError(f"method must be one of {METHODS}")
    points = np.column_stack((np.asarray(x, dtype=float), np.asarray(y, dtype=float)))
    if method in {"statistical", "robust", "spline"}:
        points = points[statistical_keep(points)]
    if method in {"radius", "robust", "spline"}:
        filtered = points[radius_keep(points)]
        if len(filtered) >= max(20, int(0.25 * len(points))):
            points = filtered
    smooth = {"legacy": None, "statistical": None, "radius": None,
              "hampel": "hampel", "robust": "robust", "spline": "spline"}[method]
    return _polar_envelope(points, bins, quantile, min_bin_points, smooth, smooth_window)
