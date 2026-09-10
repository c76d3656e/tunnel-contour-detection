"""Local FastAPI viewer: binary cloud, O(log n) slices, matplotlib export."""

from __future__ import annotations

import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, ORJSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .contours import DEFAULT_METHOD, METHODS
from .viewer_data import ViewerCache, build_cache, export_section, public_meta, slice_section

_cache: ViewerCache | None = None
_lock = threading.Lock()
_state = {"status": "loading", "message": "preparing point cloud"}


def get_cache() -> ViewerCache:
    if _cache is None:
        raise HTTPException(status_code=503, detail=_state["message"])
    return _cache


class SliceRequest(BaseModel):
    s: float
    thickness: float = Field(0.2, gt=0, le=5)
    method: str = DEFAULT_METHOD
    contour_bins: int = Field(180, ge=12, le=720)
    smooth_window: int = Field(9, ge=5)


class ExportRequest(SliceRequest):
    kinds: list[str] = Field(default_factory=lambda: ["section2d", "section3d", "tunnel3d"])


def create_app(las_path: Path, output: Path, viz_points: int = 300000) -> FastAPI:
    app = FastAPI(title="Tunnel viewer", default_response_class=ORJSONResponse)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173",
                       "http://127.0.0.1:8765", "http://localhost:8765"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def prepare():
        global _cache
        try:
            _state["message"] = "reading LAS and building display frame"
            cache = build_cache(las_path, output, viz_points)
            with _lock:
                _cache = cache
            _state["status"] = "ready"
            _state["message"] = "ready"
        except Exception as error:
            _state["status"] = "error"
            _state["message"] = str(error)

    threading.Thread(target=prepare, daemon=True).start()

    @app.get("/api/health")
    def health():
        return {"status": _state["status"], "message": _state["message"]}

    @app.get("/api/meta")
    def meta():
        if _state["status"] != "ready":
            raise HTTPException(status_code=503, detail=_state)
        return public_meta(get_cache())

    @app.get("/api/cloud.bin")
    def cloud():
        path = output / "viewer" / "cloud.bin"
        if not path.exists():
            raise HTTPException(status_code=503, detail="cloud cache is not ready")
        return FileResponse(path, media_type="application/octet-stream",
                            headers={"Cache-Control": "public, max-age=3600"})

    @app.post("/api/slice")
    def slice_api(body: SliceRequest):
        if body.method not in METHODS:
            raise HTTPException(status_code=400, detail=f"method must be one of {METHODS}")
        if body.smooth_window % 2 == 0:
            raise HTTPException(status_code=400, detail="smooth_window must be odd")
        cache = get_cache()
        s = min(max(body.s, cache.s_min), cache.s_max)
        return slice_section(cache, s, body.thickness, body.method, body.contour_bins, body.smooth_window)

    @app.post("/api/export")
    def export_api(body: ExportRequest):
        allowed = {"section2d", "section3d", "tunnel3d", "compare"}
        kinds = [item for item in body.kinds if item in allowed]
        if not kinds:
            raise HTTPException(status_code=400, detail="select at least one figure")
        if body.method not in METHODS:
            raise HTTPException(status_code=400, detail=f"method must be one of {METHODS}")
        cache = get_cache()
        s = min(max(body.s, cache.s_min), cache.s_max)
        return export_section(cache, s, body.thickness, body.method, body.contour_bins,
                              body.smooth_window, kinds)

    @app.get("/api/export-file/{stamp}/{name}")
    def export_file(stamp: str, name: str):
        path = (output / "viewer" / "exports" / stamp / name).resolve()
        root = (output / "viewer" / "exports").resolve()
        if root not in path.parents or not path.exists():
            raise HTTPException(status_code=404, detail="export not found")
        return FileResponse(path, media_type="image/png")

    dist = Path(__file__).resolve().parent.parent / "viewer" / "dist"
    if dist.exists():
        app.mount("/", StaticFiles(directory=dist, html=True), name="ui")
    return app


def run_server(las_path: Path, output: Path, host: str, port: int, open_browser: bool, viz_points: int):
    import uvicorn
    import webbrowser

    app = create_app(las_path, output, viz_points)
    if open_browser:
        threading.Timer(1.2, lambda: webbrowser.open(f"http://{host}:{port}")).start()
    uvicorn.run(app, host=host, port=port, log_level="info")
