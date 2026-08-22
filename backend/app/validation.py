"""
Honest offline-accuracy measurement for the calibrated gaze mapping.

`fit_mapper` already reports leave-one-dot-out error on the *calibration* dots.
This module evaluates the fitted mapper on **independent validation dots**
(held-out screen targets the subject fixated but that were not used to fit the
map), which is the truthful accuracy number for the dissertation.

What it adds over a single RMSE:
  • error in **degrees of visual angle** (the clinical unit; comparable to the
    eye-tracking literature) as well as pixels, via screen geometry;
  • a breakdown by **screen region** (center / edge / corner), because edge and
    corner error is what actually limits the 14-test scores and a mean hides it;
  • a split by **eye-region quality** (glare-affected vs clean) so the glasses
    problem is quantified — and so we can show whether the glare handling helped.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .calibration import HEAD_KEYS, CalibrationDot, GazeMapper, _aggregate_dot, _classify_regions
from .events import ScreenGeometry, _px_per_degree


@dataclass
class ValidationPoint:
    screen_x: float
    screen_y: float
    pred_x: float
    pred_y: float
    error_px: float
    error_deg: float
    region: str
    quality: float  # mean eye-region quality over the dot window (1=clean)
    # Error of the uncompensated prediction (= error_px when no head compensator
    # was used). Comparing error_px vs error_px_raw is the honest A/B for the
    # parallax compensation — if compensation *increases* error, suspect the
    # camera-geometry assumptions (see head_comp.py docstring).
    error_px_raw: float = float("nan")


@dataclass
class ValidationReport:
    n_points: int
    overall_px: float = float("nan")
    overall_deg: float = float("nan")
    # Uncompensated (raw polynomial) error; equals overall_px when no head
    # compensator was passed. NaN means "no compensation was attempted".
    overall_px_raw: float = float("nan")
    overall_deg_raw: float = float("nan")
    region_px: dict[str, float] = field(default_factory=dict)
    region_deg: dict[str, float] = field(default_factory=dict)
    by_quality: dict[str, dict[str, float]] = field(default_factory=dict)  # clean/glare → {n, px, deg}
    per_point: list[ValidationPoint] = field(default_factory=list)

    def summary(self) -> str:
        lines = [
            f"Validation on {self.n_points} held-out dots:",
            f"  overall   : {self.overall_px:6.1f} px   {self.overall_deg:5.2f}°",
        ]
        if not np.isnan(self.overall_px_raw):
            lines.append(
                f"  (raw, no head comp): {self.overall_px_raw:6.1f} px   {self.overall_deg_raw:5.2f}°"
            )
        for r in ("center", "edge", "corner"):
            if r in self.region_px:
                lines.append(f"  {r:<9} : {self.region_px[r]:6.1f} px   {self.region_deg[r]:5.2f}°")
        for q in ("clean", "glare"):
            if q in self.by_quality:
                d = self.by_quality[q]
                lines.append(f"  {q:<9} : {d['px']:6.1f} px   {d['deg']:5.2f}°   (n={int(d['n'])})")
        return "\n".join(lines)


def _rmse(errs: np.ndarray) -> float:
    return float(np.sqrt(np.mean(errs ** 2))) if len(errs) else float("nan")


def evaluate_mapper(
    mapper: GazeMapper,
    val_dots: list[CalibrationDot],
    frame_t_ms: np.ndarray,
    frame_yaw: np.ndarray,
    frame_pitch: np.ndarray,
    geo: ScreenGeometry,
    frame_quality: np.ndarray | None = None,
    glare_quality_thresh: float = 0.6,
    compensator=None,                                   # head_comp.HeadCompensator | None
    frame_head: dict[str, np.ndarray] | None = None,    # {"head_u","head_v","head_w"}
) -> ValidationReport:
    """
    Evaluate a fitted `mapper` on independent validation dots.

    Each validation dot is reduced to a single robust gaze estimate the same way
    calibration dots are (drop approach transient + MAD inliers), mapped to the
    screen, and compared to its true position. Errors are reported in px and in
    degrees of visual angle.

    When a `compensator` (+ `frame_head` arrays) is given, the prediction is
    additionally parallax-corrected using the median head position over the dot
    window; the report then carries both the compensated (primary) and the raw
    error so the compensation can be judged on held-out data.
    """
    ppd = _px_per_degree(geo)
    sx: list[float] = []
    sy: list[float] = []
    pts: list[ValidationPoint] = []
    errs_px: list[float] = []
    errs_px_raw: list[float] = []
    quals: list[float] = []
    use_head = compensator is not None and frame_head is not None
    if mapper.use_head and frame_head is None:
        raise ValueError(
            "mapper was fitted with head inputs — evaluate_mapper needs frame_head "
            "to score it, otherwise the validation number is not the model's."
        )

    for d in val_dots:
        in_win = (frame_t_ms >= d.t_start_ms) & (frame_t_ms <= d.t_end_ms)
        yaw_w = frame_yaw[in_win].copy()
        pitch_w = frame_pitch[in_win].copy()
        if frame_quality is not None:
            qw = frame_quality[in_win]
            mean_q = float(np.nanmean(qw)) if qw.size else 1.0
            bad = qw < 0.3
            yaw_w[bad] = np.nan
            pitch_w[bad] = np.nan
        else:
            mean_q = 1.0

        agg = _aggregate_dot(yaw_w, pitch_w)
        if agg is None:
            continue
        yaw_c, pitch_c, _, _ = agg

        # Median head position over this dot's window — needed as a mapper input
        # when the mapping is head-aware, and by the compensator either way.
        dot_head = (
            {k: np.array([np.nanmedian(frame_head[k][in_win])]) for k in HEAD_KEYS}
            if frame_head is not None else None
        )
        pred = mapper.map(
            np.array([yaw_c]), np.array([pitch_c]),
            head=dot_head if mapper.use_head else None,
        )[0]
        if not np.isfinite(pred).all():
            continue
        err_raw = float(np.hypot(pred[0] - d.screen_x, pred[1] - d.screen_y))

        if use_head:
            cx, cy = compensator.apply(
                np.array([pred[0]]), np.array([pred[1]]),
                dot_head["head_u"], dot_head["head_v"], dot_head["head_w"],
            )
            pred = np.array([float(cx[0]), float(cy[0])])
        err_px = float(np.hypot(pred[0] - d.screen_x, pred[1] - d.screen_y))

        sx.append(d.screen_x)
        sy.append(d.screen_y)
        errs_px.append(err_px)
        errs_px_raw.append(err_raw)
        quals.append(mean_q)
        pts.append(ValidationPoint(
            screen_x=d.screen_x, screen_y=d.screen_y,
            pred_x=float(pred[0]), pred_y=float(pred[1]),
            error_px=err_px, error_deg=err_px / ppd,
            region="", quality=mean_q,
            error_px_raw=err_raw if use_head else float("nan"),
        ))

    rep = ValidationReport(n_points=len(pts))
    if not pts:
        return rep

    errs_arr = np.array(errs_px)
    quals_arr = np.array(quals)
    regions = _classify_regions(np.array(sx), np.array(sy))
    for i, p in enumerate(pts):
        p.region = str(regions[i])

    rep.overall_px = _rmse(errs_arr)
    rep.overall_deg = rep.overall_px / ppd
    if use_head:
        rep.overall_px_raw = _rmse(np.array(errs_px_raw))
        rep.overall_deg_raw = rep.overall_px_raw / ppd
    for r in ("center", "edge", "corner"):
        m = regions == r
        if m.any():
            rep.region_px[r] = _rmse(errs_arr[m])
            rep.region_deg[r] = rep.region_px[r] / ppd

    if frame_quality is not None:
        clean_m = quals_arr >= glare_quality_thresh
        glare_m = ~clean_m
        for name, m in (("clean", clean_m), ("glare", glare_m)):
            if m.any():
                px = _rmse(errs_arr[m])
                rep.by_quality[name] = {"n": float(m.sum()), "px": px, "deg": px / ppd}

    rep.per_point = pts
    return rep
