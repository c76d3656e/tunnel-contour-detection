"""Compare contour extraction methods on one saved section.

Keep this module for later visual A/B checks. It does not change the default
processing path; it only re-reads a section point cloud and draws every method
in `METHODS` side by side.

Examples:

    uv run tunnel-pc compare-contours output/profile_manifest.json 100
    uv run python -m tunnel_pc.compare_contours output/profile_manifest.json 100
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import typer

from .contours import METHODS, extract_contour
from .plotting import save_contour_comparison
from .render import load_manifest


def compare_section_methods(manifest: Path, section_id: int, output: Path | None = None) -> Path:
    """Run every contour method on one section and write a grid PNG plus CSV metrics."""
    data = load_manifest(manifest)
    record = next((item for item in data["sections"] if item["section_id"] == section_id), None)
    if record is None or not record.get("points_file"):
        raise ValueError("selected section has no saved point file")
    root = manifest.parent
    section = pd.read_csv(root / record["points_file"])
    results, metrics = {}, []
    for method in METHODS:
        try:
            contour, coverage = extract_contour(
                section["u"].to_numpy(), section["v"].to_numpy(), method=method)
            results[method] = (contour, coverage)
            metrics.append({"method": method, "contour_points": len(contour),
                            "angular_coverage": coverage, "status": "ok"})
        except (RuntimeError, ValueError) as error:
            results[method] = None
            metrics.append({"method": method, "contour_points": 0,
                            "angular_coverage": 0.0, "status": str(error)})
    if output is None:
        output = root / "comparisons" / f"section_{section_id:06d}_methods.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    save_contour_comparison(output, section["u"].to_numpy(), section["v"].to_numpy(), results)
    pd.DataFrame(metrics).to_csv(output.with_suffix(".csv"), index=False)
    return output


def main(manifest: Path, section_id: int, output: Path | None = None):
    path = compare_section_methods(manifest, section_id, output)
    typer.echo(f"compared {len(METHODS)} methods -> {path}")


if __name__ == "__main__":
    typer.run(main)
