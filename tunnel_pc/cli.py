from pathlib import Path
import json, typer, pandas as pd
import numpy as np
from .io import read_las, metadata
from .geometry import frame, principal_axis
from .sections import extract
from .compare_contours import compare_section_methods
from .contours import DEFAULT_METHOD, METHODS, extract_contour
from .fitting import fit_circle
from .plotting import save_section_plot
from .render import render_from_manifest
app=typer.Typer()

@app.command()
def inspect(input: Path):
    typer.echo(json.dumps(metadata(input), ensure_ascii=False, indent=2))

@app.command()
def process(input: Path, output: Path=Path("output"), thickness: float=0.2,
            min_points: int=30, contour_bins: int=180, min_contour_points: int=12,
            min_angular_coverage: float=0.5, overview_max_points: int=100000,
            contour_method: str = DEFAULT_METHOD, smooth_window: int = 9,
            save_points: bool=True):
    """Estimate the tunnel axis, extract sections, and fit wall profiles."""
    if thickness <= 0:
        raise typer.BadParameter("thickness must be positive")
    if contour_bins < 12:
        raise typer.BadParameter("contour_bins must be at least 12")
    if min_points < 3:
        raise typer.BadParameter("min_points must be at least 3")
    if min_contour_points < 3:
        raise typer.BadParameter("min_contour_points must be at least 3")
    if not 0 < min_angular_coverage <= 1:
        raise typer.BadParameter("min_angular_coverage must be in (0, 1]")
    if overview_max_points < 1000:
        raise typer.BadParameter("overview_max_points must be at least 1000")
    if contour_method not in METHODS:
        raise typer.BadParameter(f"contour_method must be one of {METHODS}")
    if smooth_window < 5 or smooth_window % 2 == 0:
        raise typer.BadParameter("smooth_window must be an odd integer >= 5")
    points = read_las(input)
    center, axis = principal_axis(points)
    output.mkdir(parents=True, exist_ok=True)
    sections_dir = output / "sections"
    summary_dir = output / "summary"
    sections_dir.mkdir(exist_ok=True)
    summary_dir.mkdir(exist_ok=True)
    (output / "axis_direction.json").write_text(
        json.dumps({"center": center.tolist(), "axis": axis.tolist()}, indent=2), encoding="utf-8")

    u_axis, v_axis = frame(axis)
    overview_indexes = np.linspace(0, len(points) - 1, min(len(points), overview_max_points), dtype=int)
    overview_file = output / "overview_points.csv"
    overview_s = (points[overview_indexes] - center) @ axis
    pd.DataFrame({"x": points[overview_indexes, 0], "y": points[overview_indexes, 1],
                  "z": points[overview_indexes, 2], "s": overview_s}).to_csv(overview_file, index=False)
    rows, failures, manifest_sections = [], [], []
    for i, start, p, x, y in extract(points, center, axis, thickness):
        point_file = sections_dir / f"section_{i:06d}_points.csv"
        contour_file = sections_dir / f"section_{i:06d}_contour.csv"
        image_file = sections_dir / f"section_{i:06d}.png"
        if save_points:
            point_s = (p - center) @ axis
            pd.DataFrame({"x": p[:, 0], "y": p[:, 1], "z": p[:, 2], "u": x, "v": y,
                          "s": point_s}).to_csv(point_file, index=False)
        if len(p) < min_points:
            if image_file.exists(): image_file.unlink()
            failures.append({"section_id": i, "axis_position": start, "point_count": len(p),
                             "contour_point_count": 0, "angular_coverage": 0.0,
                             "fit_status": "failed", "reason": f"point_count below min_points ({min_points})"})
            continue
        contour, coverage = extract_contour(x, y, bins=contour_bins,
                                             method=contour_method, smooth_window=smooth_window)
        section_center = center + (start + thickness / 2) * axis
        if len(contour):
            world = section_center + contour[:, 0, None] * u_axis + contour[:, 1, None] * v_axis
            contour_df = pd.DataFrame({"point_index": range(len(contour)), "u": contour[:, 0], "v": contour[:, 1],
                                       "x": world[:, 0], "y": world[:, 1], "z": world[:, 2]})
        else:
            contour_df = pd.DataFrame(columns=["point_index", "u", "v", "x", "y", "z"])
        contour_df.to_csv(contour_file, index=False)
        base = {"section_id": i, "axis_position": start, "point_count": len(p),
                "contour_point_count": len(contour), "angular_coverage": coverage}
        if len(contour) < min_contour_points or coverage < min_angular_coverage:
            if image_file.exists(): image_file.unlink()
            base.update(fit_status="failed", reason="contour insufficient")
            failures.append(base)
            continue
        try:
            fit = fit_circle(contour[:, 0], contour[:, 1])
            status = ("ok" if len(contour) >= 12 and coverage >= 0.5 and fit["rmse"] <= 0.25
                      and 0.3 <= fit["radius"] <= 5.0 else "review")
            base.update(fit, fit_status=status)
            rows.append(base)
        except ValueError as error:
            base.update(fit_status="failed", reason=str(error))
            failures.append(base)
            fit = None
        if fit is not None:
            save_section_plot(image_file, x, y, contour, fit)
        manifest_sections.append({"section_id": i, "axis_position": start, "point_count": len(p),
                                  "section_center": section_center.tolist(),
                                  "slice_start": float(start), "slice_end": float(start + thickness),
                                  "contour_point_count": len(contour), "angular_coverage": coverage,
                                  "fit_status": base["fit_status"], "fit": fit,
                                  "points_file": point_file.relative_to(output).as_posix() if save_points else None,
                                  "contour_file": contour_file.relative_to(output).as_posix(),
                                  "preview_file": image_file.relative_to(output).as_posix()})
    pd.DataFrame(rows).to_csv(summary_dir / "section_parameters.csv", index=False)
    pd.DataFrame(failures).to_csv(summary_dir / "failed_sections.csv", index=False)
    manifest = {"schema_version": "1.1", "source_file": str(input), "thickness": thickness,
                "min_points": min_points, "min_contour_points": min_contour_points,
                "min_angular_coverage": min_angular_coverage,
                "overview_max_points": overview_max_points,
                "contour_method": contour_method, "smooth_window": smooth_window,
                "overview_points_file": overview_file.relative_to(output).as_posix(),
                "axis": {"origin": center.tolist(), "direction": axis.tolist(),
                         "u": u_axis.tolist(), "v_up": v_axis.tolist()},
                "sections": manifest_sections}
    (output / "profile_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    typer.echo(f"processed {len(rows)} sections, failed {len(failures)} -> {output}")


@app.command()
def render(manifest: Path, section_id: int, layers: str = "full", output: Path | None = None):
    """Render a section from profile files without reading the LAS model."""
    aliases = {"full": {"points", "contour", "circle"}, "contour": {"contour"},
               "points": {"points"}, "points_contour": {"points", "contour"}}
    selected = aliases.get(layers, {item.strip() for item in layers.split(",") if item.strip()})
    if not selected or not selected <= {"points", "contour", "circle"}:
        raise typer.BadParameter("layers: full, contour, points, points_contour, or comma-separated layers")
    if output is None:
        output = manifest.parent / "renders" / f"section_{section_id:06d}_{layers}.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    render_from_manifest(manifest, section_id, selected, output)
    typer.echo(f"rendered {output}")


@app.command("compare-contours")
def compare_contours(manifest: Path, section_id: int, output: Path | None = None):
    """Compare all contour extraction methods on a saved section."""
    try:
        path = compare_section_methods(manifest, section_id, output)
    except ValueError as error:
        raise typer.BadParameter(str(error)) from error
    typer.echo(f"compared {len(METHODS)} methods -> {path}")


@app.command("render-section-3d")
def render_section_3d(manifest: Path, section_id: int, output: Path | None = None):
    """Render one saved section as a three-dimensional bread-slice slab."""
    from .render import render_section_3d_from_manifest
    if output is None:
        output = manifest.parent / "renders" / f"section_{section_id:06d}_3d.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    render_section_3d_from_manifest(manifest, section_id, output)
    typer.echo(f"rendered {output}")


@app.command("render-tunnel-3d")
def render_tunnel_3d(manifest: Path, section_id: int, output: Path | None = None):
    """Render the full tunnel overview with a transparent selected slice."""
    from .render import render_tunnel_3d_from_manifest
    if output is None:
        output = manifest.parent / "renders" / f"tunnel_slice_{section_id:06d}_3d.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    render_tunnel_3d_from_manifest(manifest, section_id, output)
    typer.echo(f"rendered {output}")


@app.command()
def view(input: Path | None = typer.Argument(None, help="LAS/LAZ to open first; omit to pick a file in the browser"),
         output: Path = Path("output"), host: str = "127.0.0.1",
         port: int = 8765, viz_points: int = 300000, open_browser: bool = True):
    """Serve the interactive 3D viewer. The tunnel is laid flat with invert down."""
    if viz_points < 20000:
        raise typer.BadParameter("viz_points must be at least 20000")
    if input is not None and not input.exists():
        raise typer.BadParameter(f"file not found: {input}")
    from .server import run_server
    label = str(input) if input is not None else "browser upload"
    typer.echo(f"viewer http://{host}:{port}  (LAS={label})")
    run_server(input, output, host, port, open_browser, viz_points)
