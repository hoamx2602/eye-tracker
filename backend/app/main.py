"""
FastAPI service: recorded assessment video -> high-accuracy gaze trace + biomarkers.

Endpoint
  POST /process   (multipart/form-data)
    file:    the recorded webcam video (MUST include the calibration phase)
    payload: JSON string matching schemas.ProcessRequest

  GET  /health

Flow:  video -> OpenFace 3.0 per-frame yaw/pitch -> fit calibration mapping from the
       recorded calibration dots -> map whole trace to screen px -> I-VT events
       + biomarkers.

This is the OFFLINE / analysis path. The browser keeps using MediaPipe for the
live cursor; this backend produces the accurate trace used for scoring and for
the concussion-classifier dataset.
"""
from __future__ import annotations

import logging
import os
import tempfile
import threading

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .device import resolve_device
from .gaze_model import GazeModel, _WEIGHTS_DIR as WEIGHTS_DIR
from .reprocess import reprocess
from .schemas import ProcessRequest, ProcessResponse, response_from_report

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# WEIGHTS_DIR resolved in gaze_model (env → docker mount → local models/openface).

# Serialises requests that fine-tune the shared model (see /process).
_personalize_lock = threading.Lock()

app = FastAPI(title="Eye-Tracker Offline Gaze Backend", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get(
        "OFFLINE_BACKEND_CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
_model: GazeModel | None = None


def get_model() -> GazeModel:
    global _model
    if _model is None:
        _model = GazeModel(weights_dir=WEIGHTS_DIR)
    return _model


@app.get("/health")
def health() -> dict:
    """
    Liveness plus which compute the model will actually use.

    `device` is the honest answer; `cuda` is kept for older checklists and is
    just `device == "cuda"`. On an Apple-Silicon Mac running natively this
    reports "mps" — Docker Desktop on macOS cannot reach the GPU, so a
    containerised Mac run correctly reports "cpu".
    """
    import torch

    device = resolve_device()
    return {
        "status": "ok",
        "device": device,
        "cuda": device.startswith("cuda"),
        "torch": torch.__version__,
        "weights_dir": WEIGHTS_DIR,
    }


@app.post("/process", response_model=ProcessResponse)
async def process(
    file: UploadFile = File(...),
    payload: str = Form(...),
    include_trace: bool = Form(False),
) -> ProcessResponse:
    try:
        req = ProcessRequest.model_validate_json(payload)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Invalid payload JSON: {e}")

    suffix = os.path.splitext(file.filename or "")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    # `reprocess` owns the pipeline (decode → infer → calibrate → head-comp gain
    # selection → validate → events). This endpoint used to re-implement all of
    # it inline, which meant every accuracy fix had to be made twice and the two
    # copies had already drifted apart. Delegating keeps the browser flow and the
    # analysis CLI on provably identical numbers.
    meta = req.model_dump()
    try:
        if req.personalize:
            # Fine-tuning mutates the shared model. personalize.py snapshots and
            # restores the gaze head around the attempt, but that invariant only
            # holds for one attempt at a time.
            with _personalize_lock:
                report = reprocess(tmp_path, meta, model=get_model(), include_trace=include_trace)
        else:
            report = reprocess(tmp_path, meta, model=get_model(), include_trace=include_trace)
    except ValueError as e:
        # fit_mapper raises this for "not enough usable calibration dots" — a
        # client-data problem, not a server fault.
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        os.unlink(tmp_path)

    return response_from_report(report, include_trace=include_trace)
