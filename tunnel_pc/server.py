"""Serve the static viewer. Point-cloud work runs in the browser."""

from __future__ import annotations

import threading
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles


def create_app() -> FastAPI:
    app = FastAPI(title="Tunnel viewer")
    dist = Path(__file__).resolve().parent.parent / "viewer" / "dist"
    if not dist.exists():
        raise RuntimeError(f"viewer build missing: {dist}. Run npm run build in viewer/")
    app.mount("/", StaticFiles(directory=dist, html=True), name="ui")
    return app


def run_server(host: str, port: int, open_browser: bool):
    import uvicorn
    import webbrowser

    app = create_app()
    if open_browser:
        threading.Timer(1.2, lambda: webbrowser.open(f"http://{host}:{port}")).start()
    uvicorn.run(app, host=host, port=port, log_level="info")
