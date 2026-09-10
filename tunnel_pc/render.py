from pathlib import Path
import json
import pandas as pd
from .geometry import dense_station_range
from .plotting import save_section_3d_plot, save_section_plot, save_tunnel_3d_plot


def load_manifest(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema_version") not in {"1.0", "1.1"}:
        raise ValueError("unsupported profile manifest schema")
    data["_root"] = path.parent
    return data


def render_from_manifest(manifest_path: Path, section_id: int, layers: set[str], output: Path):
    manifest = load_manifest(manifest_path)
    record = next((item for item in manifest["sections"] if item["section_id"] == section_id), None)
    if record is None:
        raise ValueError(f"section {section_id} is not in the manifest")
    root = manifest["_root"]
    if "points" in layers and not record.get("points_file"):
        raise ValueError("this manifest was created without point files")
    points = pd.read_csv(root / record["points_file"]) if "points" in layers else None
    contour = pd.read_csv(root / record["contour_file"])
    fit = record.get("fit") if "circle" in layers else None
    x = points["u"].to_numpy() if points is not None else contour["u"].to_numpy()
    y = points["v"].to_numpy() if points is not None else contour["v"].to_numpy()
    contour_xy = contour[["u", "v"]].to_numpy()
    save_section_plot(output, x, y, contour_xy if "contour" in layers else [], fit,
                      show_points="points" in layers)


def render_section_3d_from_manifest(manifest_path: Path, section_id: int, output: Path):
    manifest = load_manifest(manifest_path)
    record = next((item for item in manifest["sections"] if item["section_id"] == section_id), None)
    if record is None or not record.get("points_file"):
        raise ValueError(f"section {section_id} has no saved point cloud")
    root = manifest["_root"]
    points = pd.read_csv(root / record["points_file"])[["x", "y", "z"]].to_numpy()
    contour = pd.read_csv(root / record["contour_file"])[["x", "y", "z"]].to_numpy()
    direction = manifest["axis"]["direction"]
    save_section_3d_plot(output, points, contour, direction, float(manifest["thickness"]))


def render_tunnel_3d_from_manifest(manifest_path: Path, section_id: int, output: Path):
    manifest = load_manifest(manifest_path)
    record = next((item for item in manifest["sections"] if item["section_id"] == section_id), None)
    overview_file = manifest.get("overview_points_file")
    if record is None or not overview_file:
        raise ValueError("manifest does not contain overview points or the selected section")
    root = manifest["_root"]
    overview = pd.read_csv(root / overview_file)
    points = overview[["x", "y", "z"]].to_numpy()
    if "s" in overview.columns:
        stations = overview["s"].to_numpy()
        lo, hi = dense_station_range(stations)
        points = points[(stations >= lo) & (stations <= hi)]
    contour = pd.read_csv(root / record["contour_file"])[["x", "y", "z"]].to_numpy()
    save_tunnel_3d_plot(output, points, contour, manifest["axis"]["direction"],
                        float(manifest["thickness"]), record["section_center"])
