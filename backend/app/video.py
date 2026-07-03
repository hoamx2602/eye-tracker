"""Decode a video file frame-by-frame and run OpenFace 3.0 gaze inference, with timestamps."""
from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

import cv2
import numpy as np
from scipy.signal import savgol_filter

if TYPE_CHECKING:  # type-hint only — keeps this module importable without
    from .gaze_model import GazeModel  # openface/torch (stub-model tests)

logger = logging.getLogger(__name__)

# Frames per batched GPU forward (GazeModel.infer_batch). 16 crops ≈ 10 MB of
# input tensors — VRAM is not the constraint; diminishing returns past ~32.
_BATCH_SIZE = max(1, int(os.environ.get("GAZE_BATCH_SIZE", "16")))

# Savitzky-Golay parameters for non-causal temporal smoothing.
# At 30 fps: window=11 ≈ 367 ms. Preserves saccade shape while removing
# high-freq noise. Increase window for very noisy signals; decrease for
# high-fps recordings where saccade duration is shorter in frames.
_SG_WINDOW = 11
_SG_POLY   = 3


def _smooth_gaze(arr: np.ndarray) -> np.ndarray:
    """
    Non-causal Savitzky-Golay smoothing over a 1-D gaze angle trace.

    Key advantage over causal filters (OneEuro, Kalman): zero phase lag —
    every sample is smoothed using both past AND future values, which is only
    possible offline. This removes the systematic timing bias in saccade onset
    detection that causal filters introduce.

    NaN gaps (blinks / no-face frames) are bridged by linear interpolation
    before filtering then restored afterward so calibration.py can still
    skip missing-face frames via the NaN sentinel.
    """
    result = arr.copy()
    valid  = ~np.isnan(arr)
    n_valid = int(valid.sum())

    if n_valid < _SG_WINDOW:
        return result   # too few valid frames to smooth — return as-is

    t = np.arange(len(arr), dtype=float)
    # Bridge NaN gaps with linear interpolation (modifies only NaN positions).
    result[~valid] = np.interp(t[~valid], t[valid], arr[valid])

    result = savgol_filter(result, window_length=_SG_WINDOW, polyorder=_SG_POLY)

    # Restore NaN at original gap positions so downstream code can filter them.
    result[~valid] = np.nan
    return result


def process_video(
    path: str,
    model: GazeModel,
    frame_stride: int = 1,
) -> dict[str, np.ndarray]:
    """
    Decode a video, run per-frame gaze inference, apply Savitzky-Golay smoothing.

    Returns dict of equal-length arrays:
      t_ms    — frame timestamp (ms, from container PTS)
      yaw     — smoothed yaw  (rad), NaN where no face detected
      pitch   — smoothed pitch (rad), NaN where no face detected
      quality — eye-region quality 0–1 (1=clean, <1=specular glare), 0 where no face
      head_u/head_v/head_w — smoothed head-position proxy (bbox center offset +
                width, normalized by image width; see gaze_model.FrameGaze),
                NaN where no face — consumed by head_comp.py

    frame_stride > 1 subsamples frames (e.g. 2 = every other frame) to trade
    temporal resolution for speed. Keep at 1 for saccade-velocity accuracy.
    """
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    t_ms_list: list[float] = []
    yaw_list:  list[float] = []
    pitch_list: list[float] = []
    quality_list: list[float] = []
    head_u_list: list[float] = []
    head_v_list: list[float] = []
    head_w_list: list[float] = []
    idx = 0

    # Batch frames so GazeModel.infer_batch can run one MTL forward per chunk
    # instead of one GPU launch per frame. Timestamps are recorded at read time
    # (same order), so the lists stay aligned across flushes.
    infer_batch = getattr(model, "infer_batch", None)
    pending: list[np.ndarray] = []

    def _flush() -> None:
        if not pending:
            return
        gazes = infer_batch(pending) if infer_batch else [model.infer(f) for f in pending]
        for g in gazes:
            yaw_list.append(g.yaw   if g else np.nan)
            pitch_list.append(g.pitch if g else np.nan)
            quality_list.append(g.quality if g else 0.0)
            head_u_list.append(g.head_u if g else np.nan)
            head_v_list.append(g.head_v if g else np.nan)
            head_w_list.append(g.head_w if g else np.nan)
        pending.clear()

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % frame_stride == 0:
            # Prefer container PTS; fall back to index/fps when PTS is unavailable.
            pos = cap.get(cv2.CAP_PROP_POS_MSEC)
            ts  = pos if pos and pos > 0 else (idx / fps) * 1000.0
            t_ms_list.append(ts)
            pending.append(frame)
            if len(pending) >= _BATCH_SIZE:
                _flush()
        idx += 1
    _flush()
    cap.release()

    to_arr = lambda v: np.asarray(v, dtype=float)
    yaw_arr   = _smooth_gaze(to_arr(yaw_list))
    pitch_arr = _smooth_gaze(to_arr(pitch_list))
    quality_arr = to_arr(quality_list)
    # Head moves slowly; the same zero-phase smoothing kills bbox jitter without
    # lagging real postural drift.
    head_u_arr = _smooth_gaze(to_arr(head_u_list))
    head_v_arr = _smooth_gaze(to_arr(head_v_list))
    head_w_arr = _smooth_gaze(to_arr(head_w_list))

    n_total = len(t_ms_list)
    n_valid = int(np.sum(~np.isnan(yaw_arr)))
    n_glare = int(np.sum((quality_arr < 0.5) & (quality_arr > 0.0)))
    logger.info(
        "Processed %d frames — %d gaze hits (%.0f%%), %d glare frames, SG-smoothed (window=%d)",
        n_total, n_valid, 100 * n_valid / max(1, n_total), n_glare, _SG_WINDOW,
    )
    return {
        "t_ms": to_arr(t_ms_list), "yaw": yaw_arr, "pitch": pitch_arr,
        "quality": quality_arr,
        "head_u": head_u_arr, "head_v": head_v_arr, "head_w": head_w_arr,
    }
