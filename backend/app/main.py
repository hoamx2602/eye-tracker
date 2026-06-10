"""
FastAPI service: recorded assessment video -> high-accuracy gaze trace + biomarkers.

Endpoint
  POST /process   (multipart/form-data)
    file:    the recorded webcam video (MUST include the calibration phase)
    payload: JSON string matching schemas.ProcessRequest

  GET  /health

Flow:  video -> L2CS per-frame yaw/pitch -> fit calibration mapping from the
       recorded calibration dots -> map whole trace to screen px -> I-VT events
       + biomarkers.

This is the OFFLINE / analysis path. The browser keeps using MediaPipe for the
live cursor; this backend produces the accurate trace used for scoring and for
the concussion-classifier dataset.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .calibration import CalibrationDot, fit_mapper
from .events import ScreenGeometry, detect_events
from .gaze_model import GazeModel
from .schemas import BiomarkersOut, GazeSampleOut, ProcessRequest, ProcessResponse
from .video import process_video

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

WEIGHTS_PATH = os.environ.get("L2CS_WEIGHTS", "/models/L2CSNet_gaze360.pkl")
ARCH = os.environ.get("L2CS_ARCH", "ResNet50")

app = FastAPI(title="Eye-Tracker Offline Gaze Backend", version="0.1.0")
_model: GazeModel | None = None


def get_model() -> GazeModel:
    global _model
    if _model is None:
        _model = GazeModel(weights_path=WEIGHTS_PATH, arch=ARCH)
    return _model


@app.get("/health")
def health() -> dict:
    import torch
    return {"status": "ok", "cuda": torch.cuda.is_available(), "weights": WEIGHTS_PATH}


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

    try:
        frames = process_video(tmp_path, get_model(), frame_stride=req.frame_stride)
    finally:
        os.unlink(tmp_path)

    dots = [
        CalibrationDot(d.screen_x, d.screen_y, d.t_start_ms, d.t_end_ms)
        for d in req.calibration_dots
    ]
    try:
        mapper = fit_mapper(dots, frames["t_ms"], frames["yaw"], frames["pitch"])
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    mapped = mapper.map(frames["yaw"], frames["pitch"])  # (F, 2); NaN rows where no face
    x_px, y_px = mapped[:, 0], mapped[:, 1]

    geo = ScreenGeometry(
        width_px=req.screen.width_px,
        height_px=req.screen.height_px,
        width_cm=req.screen.width_cm,
        viewing_distance_cm=req.screen.viewing_distance_cm,
    )
    bm = detect_events(
        frames["t_ms"], x_px, y_px, geo,
        saccade_velocity_threshold_deg_s=req.saccade_velocity_threshold_deg_s,
    )

    trace: list[GazeSampleOut] = []
    if include_trace:
        for t, x, y in zip(frames["t_ms"], x_px, y_px):
            if not (np.isnan(x) or np.isnan(y)):
                trace.append(GazeSampleOut(t_ms=float(t), x=float(x), y=float(y)))

    return ProcessResponse(
        calibration_train_rmse_px=mapper.train_rmse_px,
        biomarkers=BiomarkersOut(
            n_samples=bm.n_samples,
            valid_ratio=bm.valid_ratio,
            saccade_count=bm.saccade_count,
            saccade_peak_velocity_deg_s=bm.saccade_peak_velocity_deg_s,
            saccade_mean_amplitude_deg=bm.saccade_mean_amplitude_deg,
            fixation_count=bm.fixation_count,
            fixation_mean_duration_ms=bm.fixation_mean_duration_ms,
            bcea_deg2=bm.bcea_deg2,
        ),
        gaze_trace=trace,
    )
