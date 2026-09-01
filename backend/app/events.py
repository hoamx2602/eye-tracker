"""
Oculomotor event detection + concussion-relevant biomarkers.

Operates on a screen-space gaze trace (t_ms, x_px, y_px). Uses an I-VT
(velocity-threshold) classifier — the standard for separating saccades from
fixations (Salvucci & Goldberg, 2000). Velocities are converted to degrees of
visual angle using screen geometry + viewing distance so thresholds and outputs
match the clinical literature your dissertation cites.

These are *raw measurements*. Turning them into a concussion label is a separate
step (a classifier trained on the expert-labelled dataset) — kept separate on
purpose so the features stay interpretable for clinicians.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class ScreenGeometry:
    width_px: int
    height_px: int
    width_cm: float          # physical screen width
    viewing_distance_cm: float = 60.0  # matches DEFAULT_CONFIG.faceDistance


def _px_per_degree(geo: ScreenGeometry) -> float:
    cm_per_px = geo.width_cm / geo.width_px
    # 1° subtends viewing_distance * tan(1°) cm at the eye
    cm_per_deg = geo.viewing_distance_cm * np.tan(np.deg2rad(1.0))
    return cm_per_deg / cm_per_px


@dataclass
class Biomarkers:
    n_samples: int
    valid_ratio: float
    # Saccades
    saccade_count: int = 0
    saccade_peak_velocity_deg_s: float = float("nan")   # main-sequence peak (~350°/s @10° healthy)
    saccade_mean_amplitude_deg: float = float("nan")
    # Fixations
    fixation_count: int = 0
    fixation_mean_duration_ms: float = float("nan")
    # Fixation stability (Bivariate Contour Ellipse Area, 95%) — °²; healthy ~2.4
    bcea_deg2: float = float("nan")
    extra: dict = field(default_factory=dict)


# A fixation shorter than this carries too few samples for a meaningful 2×2
# covariance (at 30 fps, 200 ms ≈ 6 samples — already the practical floor).
_MIN_BCEA_FIXATION_MS = 200.0


def _bcea_deg2(vx: np.ndarray, vy: np.ndarray, p: float = 0.95) -> float | None:
    """
    Bivariate Contour Ellipse Area of one fixation, in deg².

    Returns None when the sample is too small or degenerate (collinear samples
    give a singular covariance), so callers can skip rather than record a zero.
    """
    ok = ~(np.isnan(vx) | np.isnan(vy))
    if int(ok.sum()) < 3:
        return None
    cov = np.cov(np.vstack([vx[ok], vy[ok]]))
    det = float(np.linalg.det(cov))
    if not np.isfinite(det) or det <= 0:
        return None
    k = -np.log(1.0 - p)          # 95% → ln(20)
    return float(2.0 * np.pi * k * np.sqrt(det))


def _velocity_deg_s(t_ms: np.ndarray, xy: np.ndarray, ppd: float) -> np.ndarray:
    dt_s = np.diff(t_ms) / 1000.0
    dt_s[dt_s <= 0] = np.nan
    dxy_px = np.linalg.norm(np.diff(xy, axis=0), axis=1)
    vel_px_s = dxy_px / dt_s
    vel = vel_px_s / ppd
    return np.concatenate([[0.0], vel])  # align length to samples


def detect_events(
    t_ms: np.ndarray,
    x_px: np.ndarray,
    y_px: np.ndarray,
    geo: ScreenGeometry,
    saccade_velocity_threshold_deg_s: float = 30.0,  # I-VT, lit. range 30–100
    min_fixation_ms: float = 100.0,
) -> Biomarkers:
    n = len(t_ms)
    valid = ~(np.isnan(x_px) | np.isnan(y_px))
    bm = Biomarkers(n_samples=n, valid_ratio=float(valid.mean()) if n else 0.0)
    if valid.sum() < 5:
        return bm

    ppd = _px_per_degree(geo)
    xy = np.column_stack([x_px, y_px])
    vel = _velocity_deg_s(t_ms, xy, ppd)

    is_sacc = (vel > saccade_velocity_threshold_deg_s) & valid

    # --- Saccades: contiguous above-threshold runs ---
    sacc_peaks, sacc_amps = [], []
    i = 0
    while i < n:
        if is_sacc[i]:
            j = i
            while j < n and is_sacc[j]:
                j += 1
            seg = vel[i:j]
            sacc_peaks.append(float(np.nanmax(seg)))
            # `vel[k]` is the step from sample k-1 to k, so the run i..j-1
            # covers the displacement from position i-1 to position j-1.
            # Measuring xy[j] - xy[i] instead spans the wrong interval and
            # collapses to ~0 for a saccade sharp enough to occupy one sample —
            # which is every saccade once the smoothing stops rounding them off.
            p0 = xy[max(0, i - 1)]
            p1 = xy[min(j - 1, n - 1)]
            amp_px = float(np.linalg.norm(p1 - p0))
            sacc_amps.append(amp_px / ppd)
            i = j
        else:
            i += 1
    if sacc_peaks:
        bm.saccade_count = len(sacc_peaks)
        bm.saccade_peak_velocity_deg_s = float(np.median(sacc_peaks))
        bm.saccade_mean_amplitude_deg = float(np.mean(sacc_amps))

    # --- Fixations: contiguous below-threshold runs of sufficient duration ---
    fix_durations = []
    fix_spans: list[tuple[int, int]] = []   # [start, stop) index ranges, for BCEA
    i = 0
    while i < n:
        if valid[i] and not is_sacc[i]:
            j = i
            while j < n and valid[j] and not is_sacc[j]:
                j += 1
            dur = t_ms[min(j, n - 1)] - t_ms[i]
            if dur >= min_fixation_ms:
                fix_durations.append(float(dur))
                fix_spans.append((i, j))
            i = j
        else:
            i += 1
    if fix_durations:
        bm.fixation_count = len(fix_durations)
        bm.fixation_mean_duration_ms = float(np.mean(fix_durations))

    # --- BCEA (95%), per fixation, in deg² ---
    # BCEA measures how tightly gaze holds during a SINGLE fixation. Pooling all
    # valid samples instead measures how far apart the targets were placed on the
    # screen — which is why that version returned ~1400 deg² against a healthy
    # norm of ~2.4. Compute it within each fixation and report the median across
    # them, so one long drifting fixation cannot dominate.
    bceas = [
        b for start, stop in fix_spans
        if (t_ms[min(stop, n - 1)] - t_ms[start]) >= _MIN_BCEA_FIXATION_MS
        and (b := _bcea_deg2(x_px[start:stop] / ppd, y_px[start:stop] / ppd)) is not None
    ]
    if bceas:
        bm.bcea_deg2 = float(np.median(bceas))
        bm.extra["bcea_n_fixations"] = len(bceas)

    return bm


def saccade_latency_ms(
    t_ms: np.ndarray, x_px: np.ndarray, y_px: np.ndarray, geo: ScreenGeometry,
    stimulus_onset_ms: float, threshold_deg_s: float = 30.0,
) -> float:
    """First saccade onset after a stimulus appears — pro/anti-saccade latency.
    Healthy pro-saccade ≈ 220±43 ms, anti-saccade ≈ 343±76 ms (Antoniades 2013)."""
    ppd = _px_per_degree(geo)
    xy = np.column_stack([x_px, y_px])
    vel = _velocity_deg_s(t_ms, xy, ppd)
    after = np.where((t_ms >= stimulus_onset_ms) & (vel > threshold_deg_s))[0]
    return float(t_ms[after[0]] - stimulus_onset_ms) if len(after) else float("nan")
