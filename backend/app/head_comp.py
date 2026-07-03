"""
First-order head-translation (parallax) compensation for the mapped gaze trace.

Problem (README "Remaining improvements" #3, EXPERT_ACCURACY_ASSESSMENT §1.5/§3):
the calibration mapping (yaw, pitch) → (x, y) implicitly bakes in where the head
was *during calibration*. If the head later translates by Δ (cm) parallel to the
screen while the gaze direction stays fixed, the true point-of-regard moves by
the same Δ — but the polynomial map cannot know that, so every cm of head drift
becomes ~1 cm of systematic screen error (~0.5–1° at 60 cm). Sessions run for
minutes; postural drift of a few cm is normal.

This module implements the *first-order geometric* fix — full 3D ray-screen
intersection needs camera intrinsics + PnP and is deferred:

  1. Per frame, gaze_model.py provides a head-position proxy from the RetinaFace
     face bbox: normalized image coordinates of the bbox center (u, v) and the
     normalized bbox width w (∝ 1/distance).
  2. During calibration we take a robust reference (median over all calibration
     dot windows) — the head position the mapping was fitted for.
  3. For every later frame we back-project (u, v, w) to camera-space cm using a
     pinhole model with an assumed webcam horizontal FOV, and shift the mapped
     screen point by the head displacement since calibration.

Camera model & sign conventions (camera faces the user, no mirroring —
MediaRecorder records the raw stream):
  • image u right, v down; camera X = camera's right = the USER'S LEFT; Y down.
  • user moves right by d  → ΔX_cam = −d → point-of-regard shifts right → x += d·ppcm
  • user moves down  by d  → ΔY_cam = +d → point-of-regard shifts down  → y += d·ppcm
  • distance from bbox width: Z_t = Z_ref · (w_ref / w_t)   (similar triangles)
  • back-projection: X = u_n · Z / f_n with f_n = 0.5 / tan(HFOV/2), where u_n
    is the bbox-center offset from the image center in units of image WIDTH
    (v_n likewise divided by width, keeping the focal isotropic).

`gain` exists because appearance-based gaze networks normalise the face crop
(virtual camera rotated toward the face), which itself absorbs part of the
translation effect in a model-specific way. gain=1.0 assumes the raw geometric
shift; if a validation A/B (reprocess.py reports both raw and compensated
validation error) shows over/under-correction, tune gain — or set it to 0 to
disable. A sign error (e.g. an unexpectedly mirrored recording) would show up
in the same A/B as compensation *increasing* the error.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

logger = logging.getLogger(__name__)

# Assumed webcam horizontal field of view. Typical laptop/USB webcams are 60–78°;
# the induced error from a wrong assumption is proportional (a 70° camera treated
# as 60° under-corrects by ~18%), which is still far better than no compensation.
DEFAULT_HFOV_DEG = 60.0

# Head displacement (cm, lateral) beyond which frames are counted as "moved" in
# the motion report — chosen as the point where the residual error of even the
# *compensated* mapping becomes noticeable (model-space normalisation effects).
_MOVED_THRESH_CM = 2.0


@dataclass
class HeadRef:
    """Robust head position during calibration (the pose the mapping was fitted for)."""
    u: float   # bbox-center x offset from image center, in units of image width
    v: float   # bbox-center y offset from image center, in units of image width
    w: float   # bbox width in units of image width (∝ 1/distance)


def fit_head_ref(
    dot_windows: list[tuple[float, float]],
    frame_t_ms: np.ndarray,
    head_u: np.ndarray,
    head_v: np.ndarray,
    head_w: np.ndarray,
) -> HeadRef | None:
    """
    Median head position over all calibration dot windows.

    Uses the union of the dot dwell windows (not the whole video) so that head
    motion during instructions / between phases doesn't shift the reference.
    Returns None when there are no valid head samples (old videos processed with
    a gaze model that didn't emit head data).
    """
    in_any = np.zeros(len(frame_t_ms), dtype=bool)
    for t0, t1 in dot_windows:
        in_any |= (frame_t_ms >= t0) & (frame_t_ms <= t1)
    sel = in_any & ~(np.isnan(head_u) | np.isnan(head_v) | np.isnan(head_w))
    if sel.sum() < 3 or float(np.nanmedian(head_w[sel])) <= 0:
        return None
    return HeadRef(
        u=float(np.median(head_u[sel])),
        v=float(np.median(head_v[sel])),
        w=float(np.median(head_w[sel])),
    )


@dataclass
class HeadCompensator:
    ref: HeadRef
    viewing_distance_cm: float        # distance at calibration (screen geometry value)
    px_per_cm: float                  # screen width_px / width_cm
    hfov_deg: float = DEFAULT_HFOV_DEG
    gain: float = 1.0

    @property
    def _f_n(self) -> float:
        return 0.5 / float(np.tan(np.deg2rad(self.hfov_deg) / 2.0))

    def displacement_cm(
        self, head_u: np.ndarray, head_v: np.ndarray, head_w: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Per-frame camera-space head displacement since calibration, in cm.
        Returns (dX, dY): camera X (user's left = positive) and camera Y (down).
        NaN where head data is missing.
        """
        f = self._f_n
        with np.errstate(invalid="ignore", divide="ignore"):
            z = self.viewing_distance_cm * (self.ref.w / head_w)
            z_ref = self.viewing_distance_cm
            dx = head_u * z / f - self.ref.u * z_ref / f
            dy = head_v * z / f - self.ref.v * z_ref / f
        return dx, dy

    def apply(
        self,
        x_px: np.ndarray,
        y_px: np.ndarray,
        head_u: np.ndarray,
        head_v: np.ndarray,
        head_w: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Shift mapped screen points by the head displacement since calibration.
        Frames without head data (NaN) are passed through uncorrected.
        """
        dx_cm, dy_cm = self.displacement_cm(head_u, head_v, head_w)
        # camera X = user's left → user-right displacement is −dX (see module docstring)
        corr_x = self.gain * (-dx_cm) * self.px_per_cm
        corr_y = self.gain * (+dy_cm) * self.px_per_cm
        corr_x = np.where(np.isnan(corr_x), 0.0, corr_x)
        corr_y = np.where(np.isnan(corr_y), 0.0, corr_y)
        return x_px + corr_x, y_px + corr_y

    def motion_stats(
        self, head_u: np.ndarray, head_v: np.ndarray, head_w: np.ndarray
    ) -> dict[str, float]:
        """
        Quantify how much the head actually moved over the trace — this is the
        number that says whether compensation mattered for a given session.
        """
        dx, dy = self.displacement_cm(head_u, head_v, head_w)
        lat = np.hypot(dx, dy)
        valid = ~np.isnan(lat)
        if not valid.any():
            return {"n_frames_with_head": 0.0}
        lat_v = lat[valid]
        with np.errstate(invalid="ignore", divide="ignore"):
            z_ratio = self.ref.w / head_w[valid & ~np.isnan(head_w)]
        return {
            "n_frames_with_head": float(valid.sum()),
            "lateral_median_cm": float(np.median(lat_v)),
            "lateral_p95_cm": float(np.percentile(lat_v, 95)),
            "lateral_max_cm": float(lat_v.max()),
            "moved_frames_frac": float((lat_v > _MOVED_THRESH_CM).mean()),
            "distance_ratio_median": float(np.nanmedian(z_ratio)) if z_ratio.size else 1.0,
        }


def build_compensator(
    dot_windows: list[tuple[float, float]],
    frame_t_ms: np.ndarray,
    head_u: np.ndarray,
    head_v: np.ndarray,
    head_w: np.ndarray,
    viewing_distance_cm: float,
    screen_width_px: float,
    screen_width_cm: float,
    hfov_deg: float = DEFAULT_HFOV_DEG,
    gain: float = 1.0,
) -> HeadCompensator | None:
    """Convenience: fit the calibration head reference and wrap it, or None if no head data."""
    ref = fit_head_ref(dot_windows, frame_t_ms, head_u, head_v, head_w)
    if ref is None:
        logger.info("Head compensation: no usable head data in calibration windows — disabled")
        return None
    comp = HeadCompensator(
        ref=ref,
        viewing_distance_cm=viewing_distance_cm,
        px_per_cm=screen_width_px / screen_width_cm,
        hfov_deg=hfov_deg,
        gain=gain,
    )
    logger.info(
        "Head compensation: ref u=%.4f v=%.4f w=%.4f (HFOV %.0f°, gain %.2f)",
        ref.u, ref.v, ref.w, hfov_deg, gain,
    )
    return comp
