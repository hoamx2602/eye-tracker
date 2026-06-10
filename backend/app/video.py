"""Decode a video file frame-by-frame and run gaze inference, with timestamps."""
from __future__ import annotations

import logging

import cv2
import numpy as np

from .gaze_model import GazeModel

logger = logging.getLogger(__name__)


def process_video(path: str, model: GazeModel, frame_stride: int = 1) -> dict[str, np.ndarray]:
    """
    Returns dict of equal-length arrays:
      t_ms  — frame timestamp (ms, from container PTS)
      yaw   — L2CS yaw (rad), NaN where no face
      pitch — L2CS pitch (rad), NaN where no face

    frame_stride > 1 subsamples frames (e.g. 2 = every other frame) to trade
    temporal resolution for speed. Keep at 1 for saccade-velocity accuracy.
    """
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    t_ms, yaw, pitch = [], [], []
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % frame_stride == 0:
            # Prefer the container PTS; fall back to index/fps if unavailable.
            pos = cap.get(cv2.CAP_PROP_POS_MSEC)
            ts = pos if pos and pos > 0 else (idx / fps) * 1000.0
            g = model.infer(frame)
            t_ms.append(ts)
            yaw.append(g.yaw if g else np.nan)
            pitch.append(g.pitch if g else np.nan)
        idx += 1
    cap.release()

    arr = lambda v: np.asarray(v, dtype=float)
    logger.info("Processed %d frames (%d gaze hits)", len(t_ms), int(np.sum(~np.isnan(yaw))))
    return {"t_ms": arr(t_ms), "yaw": arr(yaw), "pitch": arr(pitch)}
