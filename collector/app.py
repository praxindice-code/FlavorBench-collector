"""Local web application. No source videos, images, or sessions are stored server-side."""
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

from .local_vision import AnalysisRequest, analyze, status
from .cases import sample_cases
from .flavor_bridge import FlavorRequest, engine_status, predict
from .schema import Session

app = FastAPI(title="FlavorBench Collector", docs_url=None, redoc_url=None)
WEB = Path(__file__).resolve().parent / "web"


@app.middleware("http")
async def local_guard(request: Request, call_next):
    try:
        content_length = int(request.headers.get("content-length", "0"))
    except ValueError:
        return JSONResponse({"detail": "Invalid content length."}, status_code=400)
    if content_length < 0:
        return JSONResponse({"detail": "Invalid content length."}, status_code=400)
    if content_length > 6_000_000:
        return JSONResponse({"detail": "Request too large."}, status_code=413)
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            return JSONResponse({"detail": "Cross-origin requests are disabled."}, status_code=403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; "
        "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    )
    return response


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")


@app.get("/app.js")
def javascript():
    return FileResponse(WEB / "app.js", media_type="text/javascript")


@app.get("/visuals.js")
def visualization_javascript():
    return FileResponse(WEB / "visuals.js", media_type="text/javascript")


@app.get("/flavor.js")
def flavor_javascript():
    return FileResponse(WEB / "flavor.js", media_type="text/javascript")


@app.get("/style.css")
def stylesheet():
    return FileResponse(WEB / "style.css", media_type="text/css")


@app.get("/sample.json")
def sample():
    return FileResponse(Path(__file__).resolve().parents[1] / "examples" / "synthetic_session.json", media_type="application/json")


@app.get("/api/cases")
def cases():
    return {"cases": sample_cases(), "illustrative": True}


@app.get("/api/health")
def health():
    return {"status": "ok", "local_only": True}


@app.post("/api/validate")
def validate(session: Session):
    return session.model_dump(mode="json")


@app.get("/api/schema")
def schema():
    return Session.model_json_schema()


@app.get("/api/local-models")
def local_models():
    return status()


@app.post("/api/analyze")
def analyze_local(request: AnalysisRequest):
    return analyze(request)


@app.get("/api/flavor/status")
def flavor_status():
    return engine_status()


@app.post("/api/flavor/predict")
def flavor_predict(request: FlavorRequest):
    return predict(request)
