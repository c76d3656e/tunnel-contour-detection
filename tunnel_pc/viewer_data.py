"""In-memory tunnel cache, O(log n) slab extraction, and export helpers."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np

from .contours import DEFAULT_METHOD, METHODS, extract_contour
from .fitting import fit_circle
from .geometry import dense_station_range, frame, principal_axis
from .io import read_las
from .plotting import (
    save_contour_comparison,
    save_section_3d_plot,
    save_section_plot,
    save_tunnel_3d_plot,
)

CACHE_DIRNAME = "viewer"
CLOUD_NAME = "cloud.bin"
META_NAME = "meta.json"
XYZ_NAME = "xyz.npy"
S_NAME = "s.npy"
DISPLAY_FRAME = "uvs-v3"


@dataclass
class ViewerCache:
    las_path: Path
    output: Path
    xyz: np.ndarray
    s: np.ndarray
    origin: np.ndarray
    axis: np.ndarray
    u_axis: np.ndarray
    v_axis: np.ndarray
    viz_count: int
    s_min: float
    s_max: float
    dense_s_min: float
    dense_s_max: float
    uv_extent: float


def _cache_dir(output: Path) -> Path:
    path = output / CACHE_DIRNAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def _model_dir(output: Path, las_path: Path) -> Path:
    key = hashlib.sha1(str(las_path.resolve()).encode("utf-8")).hexdigest()[:16]
    path = _cache_dir(output) / "models" / key
    path.mkdir(parents=True, exist_ok=True)
    return path


def cloud_bin_path(cache: ViewerCache) -> Path:
    return _model_dir(cache.output, cache.las_path) / CLOUD_NAME


def _same_las(left: Path, right: Path) -> bool:
    try:
        return left.resolve() == right.resolve()
    except OSError:
        return False


def _load_axis(output: Path, points: np.ndarray, las_path: Path):
    manifest_path = output / "profile_manifest.json"
    if manifest_path.exists():
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        source = data.get("source_file")
        if source and _same_las(Path(source), las_path):
            origin = np.asarray(data["axis"]["origin"], dtype=np.float64)
            axis = np.asarray(data["axis"]["direction"], dtype=np.float64)
            u_axis = np.asarray(data["axis"]["u"], dtype=np.float64)
            v_axis = np.asarray(data["axis"]["v_up"], dtype=np.float64)
            return origin, axis / np.linalg.norm(axis), u_axis, v_axis
    origin, axis = principal_axis(points)
    u_axis, v_axis = frame(axis)
    return origin, axis, u_axis, v_axis


def build_cache(las_path: Path, output: Path, viz_points: int = 300000) -> ViewerCache:
    las_path = las_path.resolve()
    cache = _model_dir(output, las_path)
    las_mtime = las_path.stat().st_mtime
    meta_path = cache / META_NAME
    xyz_path = cache / XYZ_NAME
    s_path = cache / S_NAME
    cloud_path = cache / CLOUD_NAME
    if meta_path.exists() and xyz_path.exists() and s_path.exists() and cloud_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if (meta.get("las_mtime") == las_mtime and meta.get("viz_points") == viz_points
                and meta.get("display_frame") == DISPLAY_FRAME):
            xyz = np.load(xyz_path, mmap_mode="r")
            s = np.load(s_path, mmap_mode="r")
            dense_s_min = float(meta.get("dense_s_min", s[0]))
            dense_s_max = float(meta.get("dense_s_max", s[-1]))
            return ViewerCache(
                las_path=las_path, output=output, xyz=xyz, s=s,
                origin=np.asarray(meta["origin"], dtype=np.float64),
                axis=np.asarray(meta["axis"], dtype=np.float64),
                u_axis=np.asarray(meta["u"], dtype=np.float64),
                v_axis=np.asarray(meta["v_up"], dtype=np.float64),
                viz_count=int(meta["viz_count"]),
                s_min=float(meta["s_min"]), s_max=float(meta["s_max"]),
                dense_s_min=dense_s_min, dense_s_max=dense_s_max,
                uv_extent=float(meta["uv_extent"]),
            )

    points = read_las(las_path)
    origin, axis, u_axis, v_axis = _load_axis(output, points, las_path)
    s = ((points - origin) @ axis).astype(np.float32)
    order = np.argsort(s, kind="mergesort")
    xyz = np.ascontiguousarray(points[order], dtype=np.float32)
    s = np.ascontiguousarray(s[order], dtype=np.float32)
    np.save(xyz_path, xyz)
    np.save(s_path, s)

    dense_s_min, dense_s_max = dense_station_range(s)
    i0 = int(np.searchsorted(s, dense_s_min, side="left"))
    i1 = int(np.searchsorted(s, dense_s_max, side="right"))
    dense_xyz = xyz[i0:i1]
    dense_s = s[i0:i1]
    stride = max(1, int(np.ceil(len(dense_xyz) / viz_points))) if len(dense_xyz) else 1
    viz = dense_xyz[::stride]
    viz_s = dense_s[::stride]
    delta = viz.astype(np.float64) - origin
    display = np.column_stack((delta @ u_axis, delta @ v_axis, viz_s)).astype(np.float32)
    cloud_path.write_bytes(np.ascontiguousarray(display).tobytes())

    all_delta = dense_xyz.astype(np.float64) - origin if len(dense_xyz) else (xyz.astype(np.float64) - origin)
    u = all_delta @ u_axis
    v = all_delta @ v_axis
    uv_extent = float(max(np.percentile(np.abs(u), 99.5), np.percentile(np.abs(v), 99.5), 1.5) * 2.4)
    meta = {
        "las_path": str(las_path), "source_name": las_path.name,
        "las_mtime": las_mtime, "viz_points": viz_points,
        "display_frame": DISPLAY_FRAME,
        "point_count": int(len(xyz)), "viz_count": int(len(viz)),
        "origin": origin.tolist(), "axis": axis.tolist(), "u": u_axis.tolist(), "v_up": v_axis.tolist(),
        "s_min": float(s[0]), "s_max": float(s[-1]),
        "dense_s_min": dense_s_min, "dense_s_max": dense_s_max,
        "uv_extent": uv_extent,
        "methods": list(METHODS), "default_method": DEFAULT_METHOD,
        "axes": {
            "x": "u, horizontal across the tunnel",
            "y": "v_up, gravity-aligned up; invert/floor is negative Y",
            "z": "s, station along the axis; the tunnel is laid horizontal along Z",
        },
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return ViewerCache(
        las_path=las_path, output=output, xyz=xyz, s=s, origin=origin, axis=axis,
        u_axis=u_axis, v_axis=v_axis, viz_count=int(len(viz)),
        s_min=float(s[0]), s_max=float(s[-1]),
        dense_s_min=dense_s_min, dense_s_max=dense_s_max,
        uv_extent=uv_extent,
    )


def public_meta(cache: ViewerCache) -> dict:
    mtime = int(cache.las_path.stat().st_mtime) if cache.las_path.exists() else 0
    return {
        "point_count": int(cache.xyz.shape[0]),
        "viz_count": cache.viz_count,
        "origin": cache.origin.tolist(),
        "axis": cache.axis.tolist(),
        "u": cache.u_axis.tolist(),
        "v_up": cache.v_axis.tolist(),
        "s_min": cache.s_min,
        "s_max": cache.s_max,
        "dense_s_min": cache.dense_s_min,
        "dense_s_max": cache.dense_s_max,
        "uv_extent": cache.uv_extent,
        "methods": list(METHODS),
        "default_method": DEFAULT_METHOD,
        "display_frame": DISPLAY_FRAME,
        "source_name": cache.las_path.name,
        "cloud_url": f"/api/cloud.bin?v={mtime}",
        "axes": {
            "x": "u, horizontal across the tunnel",
            "y": "v_up, gravity-aligned up; invert/floor is negative Y",
            "z": "s, station along the axis; the tunnel is laid horizontal along Z",
        },
    }


def _display(uv: np.ndarray, station: float | np.ndarray) -> np.ndarray:
    if len(uv) == 0:
        return np.empty((0, 3), dtype=np.float32)
    if np.isscalar(station):
        z = np.full(len(uv), float(station), dtype=np.float32)
    else:
        z = np.asarray(station, dtype=np.float32)
    return np.column_stack((uv[:, 0], uv[:, 1], z)).astype(np.float32)


def _world(cache: ViewerCache, s_center: float, uv: np.ndarray) -> np.ndarray:
    if len(uv) == 0:
        return np.empty((0, 3), dtype=np.float32)
    center = cache.origin + s_center * cache.axis
    return (center + uv[:, 0, None] * cache.u_axis + uv[:, 1, None] * cache.v_axis).astype(np.float32)


def _circle_uv(fit: dict, count: int = 160) -> np.ndarray:
    angles = np.linspace(0, 2 * np.pi, count, endpoint=True)
    return np.column_stack((
        fit["center_x"] + fit["radius"] * np.cos(angles),
        fit["center_y"] + fit["radius"] * np.sin(angles),
    ))


def slice_section(cache: ViewerCache, s_center: float, thickness: float,
                  method: str = DEFAULT_METHOD, contour_bins: int = 180,
                  smooth_window: int = 9, slab_limit: int = 12000) -> dict:
    half = thickness / 2
    left = float(np.searchsorted(cache.s, s_center - half, side="left"))
    right = float(np.searchsorted(cache.s, s_center + half, side="right"))
    i0, i1 = int(left), int(right)
    slab = np.asarray(cache.xyz[i0:i1])
    center = cache.origin + s_center * cache.axis
    if len(slab) == 0:
        return {
            "s": s_center, "thickness": thickness, "method": method,
            "point_count": 0, "contour_point_count": 0, "angular_coverage": 0.0,
            "fit": None, "contour": [], "contour_uv": [], "fit_line": [],
            "slab": [],
        }
    local = slab.astype(np.float64) - center
    u = local @ cache.u_axis
    v = local @ cache.v_axis
    contour, coverage = extract_contour(u, v, bins=contour_bins, method=method,
                                        smooth_window=smooth_window)
    fit = None
    fit_line = np.empty((0, 3), dtype=np.float32)
    if len(contour) >= 3:
        try:
            fit = fit_circle(contour[:, 0], contour[:, 1])
            fit_line = _display(_circle_uv(fit), s_center)
        except ValueError:
            fit = None
    slab_s = np.asarray(cache.s[i0:i1])
    slab_uv = np.column_stack((u, v))
    if len(slab) > slab_limit:
        sample = np.linspace(0, len(slab) - 1, slab_limit, dtype=int)
        slab_vis = _display(slab_uv[sample], slab_s[sample])
    else:
        slab_vis = _display(slab_uv, slab_s)
    return {
        "s": s_center, "thickness": thickness, "method": method,
        "point_count": int(len(slab)),
        "contour_point_count": int(len(contour)),
        "angular_coverage": float(coverage),
        "fit": fit,
        "contour": _display(contour, s_center).tolist() if len(contour) else [],
        "contour_uv": contour.tolist() if len(contour) else [],
        "fit_line": fit_line.tolist(),
        "slab": slab_vis.tolist(),
        "contour_world": _world(cache, s_center, contour).tolist() if len(contour) else [],
    }


def export_section(cache: ViewerCache, s_center: float, thickness: float,
                   method: str, contour_bins: int, smooth_window: int,
                   kinds: list[str]) -> dict:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    folder = _cache_dir(cache.output) / "exports" / stamp
    folder.mkdir(parents=True, exist_ok=True)
    payload = slice_section(cache, s_center, thickness, method, contour_bins, smooth_window,
                            slab_limit=80000)
    half = thickness / 2
    i0 = int(np.searchsorted(cache.s, s_center - half, side="left"))
    i1 = int(np.searchsorted(cache.s, s_center + half, side="right"))
    slab = np.asarray(cache.xyz[i0:i1], dtype=np.float64)
    center = cache.origin + s_center * cache.axis
    local = slab - center
    u = local @ cache.u_axis
    v = local @ cache.v_axis
    contour_uv = np.asarray(payload["contour_uv"], dtype=float)
    files = {}
    if "section2d" in kinds:
        path = folder / "section_2d.png"
        save_section_plot(path, u, v, contour_uv, payload.get("fit"), station=s_center)
        files["section2d"] = path.as_posix()
    if "section3d" in kinds:
        path = folder / "section_3d.png"
        slab_s = np.asarray(cache.s[i0:i1], dtype=float)
        slab_disp = np.column_stack((u, slab_s, v)) if len(u) else np.empty((0, 3))
        contour_disp = (
            np.column_stack((contour_uv[:, 0], np.full(len(contour_uv), s_center), contour_uv[:, 1]))
            if len(contour_uv) else np.empty((0, 3))
        )
        save_section_3d_plot(path, slab_disp, contour_disp, np.array([0.0, 1.0, 0.0]),
                             thickness, station=s_center)
        files["section3d"] = path.as_posix()
    if "tunnel3d" in kinds:
        path = folder / "tunnel_3d.png"
        lo, hi = cache.dense_s_min, cache.dense_s_max
        i0 = int(np.searchsorted(cache.s, lo, side="left"))
        i1 = int(np.searchsorted(cache.s, hi, side="right"))
        dense = cache.xyz[i0:i1]
        stride = max(1, len(dense) // 120000) if len(dense) else 1
        pts = np.asarray(dense[::stride], dtype=np.float64) if len(dense) else np.empty((0, 3))
        ss = np.asarray(cache.s[i0:i1][::stride], dtype=float) if len(dense) else np.empty((0,))
        if len(pts):
            delta = pts - cache.origin
            overview = np.column_stack((delta @ cache.u_axis, ss, delta @ cache.v_axis))
        else:
            overview = np.empty((0, 3))
        contour_disp = (
            np.column_stack((contour_uv[:, 0], np.full(len(contour_uv), s_center), contour_uv[:, 1]))
            if len(contour_uv) else np.empty((0, 3))
        )
        center = contour_disp.mean(axis=0) if len(contour_disp) else np.array([0.0, s_center, 0.0])
        save_tunnel_3d_plot(path, overview, contour_disp, np.array([0.0, 1.0, 0.0]),
                            thickness, center, station=s_center)
        files["tunnel3d"] = path.as_posix()
    if "compare" in kinds:
        path = folder / "methods.png"
        results = {}
        for name in METHODS:
            try:
                contour, coverage = extract_contour(u, v, bins=contour_bins, method=name,
                                                    smooth_window=smooth_window)
                results[name] = (contour, coverage)
            except (RuntimeError, ValueError) as error:
                results[name] = None
                _ = error
        save_contour_comparison(path, u, v, results)
        files["compare"] = path.as_posix()
    urls = {key: f"/api/export-file/{stamp}/{Path(value).name}" for key, value in files.items()}
    return {"stamp": stamp, "files": files, "urls": urls, "slice": {
        "s": payload["s"], "point_count": payload["point_count"],
        "contour_point_count": payload["contour_point_count"],
        "angular_coverage": payload["angular_coverage"], "fit": payload["fit"],
        "method": method, "thickness": thickness,
    }}
