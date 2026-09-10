"""Local FastAPI viewer: binary cloud, O(log n) slices, matplotlib export."""

from __future__ import annotations

import re
import threading
import time
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, ORJSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .contours import DEFAULT_METHOD, METHODS
from .viewer_data import ViewerCache, build_cache, cloud_bin_path, export_section, public_meta, slice_section

MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024
_NAME_CLEAN = re.compile(r"[^A-Za-z0-9._\-]+")

_cache: ViewerCache | None = None
_lock = threading.Lock()
_state = {
    "status": "idle",
    "message": "选择 LAS 或 LAZ 点云",
    "source_name": None,
}


def get_cache() -> ViewerCache:
    if _cache is None:
        raise HTTPException(status_code=503, detail=_state["message"])
    return _cache


def _require_ready() -> ViewerCache:
    if _state["status"] != "ready":
        raise HTTPException(status_code=503, detail=_state)
    return get_cache()


class SliceRequest(BaseModel):
    s: float
    thickness: float = Field(0.2, gt=0, le=5)
    method: str = DEFAULT_METHOD
    contour_bins: int = Field(180, ge=12, le=720)
    smooth_window: int = Field(9, ge=5)


class ExportRequest(SliceRequest):
    kinds: list[str] = Field(default_factory=lambda: ["section2d", "section3d", "tunnel3d"])


def _safe_cloud_name(filename: str) -> str:
    raw = Path(filename).name
    cleaned = _NAME_CLEAN.sub("_", raw).strip("._")
    lower = cleaned.lower()
    if lower.endswith(".laz"):
        ext = ".laz"
        stem = cleaned[:-4]
    elif lower.endswith(".las"):
        ext = ".las"
        stem = cleaned[:-4]
    else:
        raise HTTPException(status_code=400, detail="只接受 .las 或 .laz")
    stem = (stem or "cloud")[:80]
    return f"{stem}{ext}"


def create_app(las_path: Path | None, output: Path, viz_points: int = 300000) -> FastAPI:
    app = FastAPI(title="Tunnel viewer", default_response_class=ORJSONResponse)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173",
                       "http://127.0.0.1:8765", "http://localhost:8765"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    uploads = output / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    runtime = {"generation": 0}
    prepare_lock = threading.Lock()

    global _cache
    _cache = None
    _state.update(status="idle", message="选择 LAS 或 LAZ 点云", source_name=None)

    def kickoff(path: Path) -> None:
        with _lock:
            runtime["generation"] += 1
            gen = runtime["generation"]
            _state["status"] = "loading"
            _state["message"] = f"正在读入 {path.name}"
            _state["source_name"] = path.name
        threading.Thread(target=prepare, args=(path, gen), daemon=True).start()

    def prepare(path: Path, gen: int) -> None:
        global _cache
        with prepare_lock:
            if gen != runtime["generation"]:
                return
            try:
                _state["message"] = f"正在建立显示坐标：{path.name}"
                cache = build_cache(path, output, viz_points)
                with _lock:
                    if gen != runtime["generation"]:
                        return
                    _cache = cache
                    _state["status"] = "ready"
                    _state["message"] = "ready"
                    _state["source_name"] = path.name
            except Exception as error:
                with _lock:
                    if gen != runtime["generation"]:
                        return
                    _state["status"] = "error"
                    _state["message"] = str(error)
                    _state["source_name"] = path.name

    if las_path is not None:
        kickoff(las_path.resolve())

    @app.get("/api/health")
    def health():
        return dict(_state)

    @app.get("/api/meta")
    def meta():
        return public_meta(_require_ready())

    @app.get("/api/cloud.bin")
    def cloud():
        path = cloud_bin_path(_require_ready())
        if not path.exists():
            raise HTTPException(status_code=503, detail="cloud cache is not ready")
        return FileResponse(path, media_type="application/octet-stream",
                            headers={"Cache-Control": "no-store"})

    @app.post("/api/open")
    async def open_cloud(file: UploadFile = File(...)):
        name = _safe_cloud_name(file.filename or "")
        dest = uploads / name
        with _lock:
            current = _cache.las_path.resolve() if _cache is not None else None
        if dest.exists() and current is not None and dest.resolve() == current:
            dest = uploads / f"{dest.stem}_{int(time.time())}{dest.suffix}"
        tmp = dest.with_name(dest.name + ".part")
        written = 0
        try:
            with tmp.open("wb") as handle:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail="点云超过 4 GB 上限")
                    handle.write(chunk)
            if written == 0:
                raise HTTPException(status_code=400, detail="空文件")
            tmp.replace(dest)
        except Exception:
            if tmp.exists():
                tmp.unlink(missing_ok=True)
            raise
        finally:
            await file.close()
        kickoff(dest)
        return dict(_state)

    @app.post("/api/slice")
    def slice_api(body: SliceRequest):
        if body.method not in METHODS:
            raise HTTPException(status_code=400, detail=f"method must be one of {METHODS}")
        if body.smooth_window % 2 == 0:
            raise HTTPException(status_code=400, detail="smooth_window must be odd")
        cache = _require_ready()
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
        cache = _require_ready()
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


def run_server(las_path: Path | None, output: Path, host: str, port: int, open_browser: bool, viz_points: int):
    import uvicorn
    import webbrowser

    app = create_app(las_path, output, viz_points)
    if open_browser:
        threading.Timer(1.2, lambda: webbrowser.open(f"http://{host}:{port}")).start()
    uvicorn.run(app, host=host, port=port, log_level="info")
