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

# Savitzky-Golay parameters for non-causal temporal smoothing *inside fixations*.
# At 30 fps: window=11 ≈ 367 ms. That is an order of magnitude LONGER than a
# saccade (30–80 ms), so applying it across the whole trace flattens exactly the
# events the biomarkers measure — see `_saccade_mask` for why the trace is
# segmented before this window is ever applied.
_SG_WINDOW = 11
_SG_POLY   = 3

# Angle-space speed above which a sample is treated as saccadic and excluded
# from smoothing. At 30 fps a 4° saccade collapses into a single-frame step of
# ~120°/s, while landmark/inference noise of ~0.5°/frame is only ~15°/s, so the
# two populations separate cleanly well below this threshold.
_SACCADE_VEL_DEG_S = 60.0
# Frames kept unsmoothed on each side of a detected saccade. The sample before
# onset and after offset carry the step edges; smoothing them back into the
# neighbouring fixation is what rounds off peak velocity.
_SACCADE_PAD = 1


def _saccade_mask(
    yaw: np.ndarray,
    pitch: np.ndarray,
    t_ms: np.ndarray,
    vel_thresh_deg_s: float = _SACCADE_VEL_DEG_S,
    pad: int = _SACCADE_PAD,
) -> np.ndarray:
    """
    Boolean mask of samples belonging to a saccade, computed on the RAW trace.

    Detection must run before smoothing: a filter wide enough to be useful
    inside a fixation is also wide enough to erase the event it would be asked
    to detect afterwards. Speed is the angular distance between consecutive
    gaze directions (small-angle: hypot of the per-axis deltas), which is the
    same quantity events.py thresholds in screen space — just upstream of the
    calibration mapping, so it is available before a mapper exists.

    NaN samples (blink / no face) are never marked: their neighbours are
    genuinely unknown, not fast.
    """
    n = len(yaw)
    mask = np.zeros(n, dtype=bool)
    if n < 3:
        return mask

    dt_s = np.diff(t_ms) / 1000.0
    dt_s[dt_s <= 0] = np.nan
    step_deg = np.rad2deg(np.hypot(np.diff(yaw), np.diff(pitch)))
    vel = step_deg / dt_s                       # deg/s between sample i and i+1

    fast = vel > vel_thresh_deg_s               # NaN compares False — intended
    # A fast step spans the two samples it connects.
    mask[:-1] |= fast
    mask[1:]  |= fast

    for _ in range(max(0, pad)):
        mask[:-1] |= mask[1:].copy()
        mask[1:]  |= mask[:-1].copy()
    return mask


def _smooth_gaze(arr: np.ndarray, saccade_mask: np.ndarray | None = None) -> np.ndarray:
    """
    Non-causal Savitzky-Golay smoothing over a 1-D gaze angle trace.

    Key advantage over causal filters (OneEuro, Kalman): zero phase lag —
    every sample is smoothed using both past AND future values, which is only
    possible offline. This removes the systematic timing bias in saccade onset
    detection that causal filters introduce.

    `saccade_mask` (from `_saccade_mask`, shared across both gaze axes so the
    two stay time-aligned) splits the trace into fixation segments that are
    filtered **independently**; masked samples are passed through untouched.
    The filter therefore never mixes samples across a saccade boundary, which
    is what preserved amplitude and peak velocity. Pass None for slowly-varying
    signals such as the head-position proxy, where a single window over the
    whole trace is correct.

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

    if saccade_mask is None:
        result = savgol_filter(result, window_length=_SG_WINDOW, polyorder=_SG_POLY)
    else:
        for start, stop in _runs(~saccade_mask):
            seg_len = stop - start
            # SG needs window > polyorder and an odd window; a segment shorter
            # than that is left raw (it is at most a few frames of fixation
            # wedged between two saccades — there is nothing to average).
            window = min(_SG_WINDOW, seg_len if seg_len % 2 else seg_len - 1)
            if window <= _SG_POLY:
                continue
            result[start:stop] = savgol_filter(
                result[start:stop], window_length=window, polyorder=_SG_POLY,
            )

    # Restore NaN at original gap positions so downstream code can filter them.
    result[~valid] = np.nan
    return result


def _runs(flags: np.ndarray) -> list[tuple[int, int]]:
    """Contiguous [start, stop) index ranges where `flags` is True."""
    out: list[tuple[int, int]] = []
    i, n = 0, len(flags)
    while i < n:
        if flags[i]:
            j = i
            while j < n and flags[j]:
                j += 1
            out.append((i, j))
            i = j
        else:
            i += 1
    return out


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
    t_arr = to_arr(t_ms_list)
    yaw_raw, pitch_raw = to_arr(yaw_list), to_arr(pitch_list)
    # Detect saccades on the raw trace, then smooth only between them (F7).
    sacc = _saccade_mask(yaw_raw, pitch_raw, t_arr)
    yaw_arr   = _smooth_gaze(yaw_raw,   sacc)
    pitch_arr = _smooth_gaze(pitch_raw, sacc)
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
        "Processed %d frames — %d gaze hits (%.0f%%), %d glare frames, "
        "%d saccadic frames kept unsmoothed, SG window=%d inside fixations",
        n_total, n_valid, 100 * n_valid / max(1, n_total), n_glare,
        int(sacc.sum()), _SG_WINDOW,
    )
    return {
        "t_ms": t_arr, "yaw": yaw_arr, "pitch": pitch_arr,
        "quality": quality_arr,
        "head_u": head_u_arr, "head_v": head_v_arr, "head_w": head_w_arr,
    }
