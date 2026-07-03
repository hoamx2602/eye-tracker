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

import json
import logging
import os
import tempfile

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .calibration import CalibrationDot, fit_mapper
from .events import ScreenGeometry, detect_events
from .gaze_model import GazeModel, _WEIGHTS_DIR as WEIGHTS_DIR
from .head_comp import build_compensator
from .schemas import BiomarkersOut, GazeSampleOut, ProcessRequest, ProcessResponse
from .video import process_video

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# WEIGHTS_DIR resolved in gaze_model (env → docker mount → local models/openface).

# Frames below this eye-region quality are dropped from the scored trace (glasses
# glare). Conservative: only clearly-glared frames (heavy specular coverage).
_TRACE_QUALITY_GATE = 0.4

app = FastAPI(title="Eye-Tracker Offline Gaze Backend", version="0.2.0")
_model: GazeModel | None = None


def get_model() -> GazeModel:
    global _model
    if _model is None:
        _model = GazeModel(weights_dir=WEIGHTS_DIR)
    return _model


@app.get("/health")
def health() -> dict:
    import torch
    return {"status": "ok", "cuda": torch.cuda.is_available(), "weights_dir": WEIGHTS_DIR}


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
    quality = frames.get("quality")
    try:
        mapper = fit_mapper(
            dots, frames["t_ms"], frames["yaw"], frames["pitch"],
            frame_quality=quality,
            outlier_sigma=req.calibration_outlier_sigma,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    mapped = mapper.map(frames["yaw"], frames["pitch"])  # (F, 2); NaN rows where no face
    x_px, y_px = mapped[:, 0], mapped[:, 1]

    # First-order parallax compensation: shift each mapped point by the head
    # displacement since calibration (face-bbox back-projection, head_comp.py).
    compensator = None
    head_motion: dict[str, float] = {}
    head = {k: frames[k] for k in ("head_u", "head_v", "head_w") if k in frames}
    if req.head_compensation and len(head) == 3:
        compensator = build_compensator(
            [(d.t_start_ms, d.t_end_ms) for d in dots],
            frames["t_ms"], head["head_u"], head["head_v"], head["head_w"],
            viewing_distance_cm=req.screen.viewing_distance_cm,
            screen_width_px=req.screen.width_px,
            screen_width_cm=req.screen.width_cm,
            hfov_deg=req.camera_hfov_deg,
            gain=req.head_comp_gain,
        )
    if compensator is not None:
        x_px, y_px = compensator.apply(
            x_px, y_px, head["head_u"], head["head_v"], head["head_w"],
        )
        head_motion = compensator.motion_stats(
            head["head_u"], head["head_v"], head["head_w"],
        )

    # Gate the scored trace by eye-region quality: glare frames (glasses) give
    # unreliable gaze, so mark them missing (NaN) — the SG smoother already
    # bridged short gaps, and I-VT event detection skips NaN — instead of letting
    # glare spikes inflate saccade velocity / fixation-instability biomarkers.
    if quality is not None:
        glare = quality < _TRACE_QUALITY_GATE
        x_px = np.where(glare, np.nan, x_px)
        y_px = np.where(glare, np.nan, y_px)

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
        calibration_loocv_px=mapper.loocv_px,
        calibration_region_errors_px=mapper.region_errors_px,
        calibration_degree=mapper.degree,
        calibration_dots_used=mapper.n_dots_used,
        calibration_dots_total=mapper.n_dots_total,
        head_compensation_applied=compensator is not None,
        head_motion=head_motion,
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
