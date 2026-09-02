"""
Per-session calibration mapping: raw gaze angles (yaw, pitch) → screen (x, y) px.

The browser shows N calibration dots at known screen positions. This module
re-fits the mapping from the *recorded video* using the backend gaze model
(OpenFace 3.0) so the screen mapping is consistent with the offline model.

For each dot the browser sends its screen (x, y) plus the [t_start, t_end]
window during which the subject fixated it. From that window we extract a single
robust gaze estimate and a per-dot reliability weight, then fit a low-order
polynomial Ridge from gaze → screen.

Accuracy design (offline, max-accuracy — see docs/EXPERT_ACCURACY_ASSESSMENT.md):

  1. Offline gaze-contingent selection. A dot window contains an *approach
     transient* (the saccade + settling toward the dot) followed by the
     *fixation* we actually want. Taking a plain median over the whole window
     blends the two — worst at screen edges/corners where the saccade is large.
     `_aggregate_dot` drops the approach phase and keeps the settled cluster.

  2. Glare/outlier robustness (glasses). Prescription-lens glare produces
     occasional gaze spikes inside an otherwise-stable window. We reject frames
     outside k·MAD of the per-window median (robust to ≤50% contamination) before
     taking the center, and penalise jittery windows in the per-dot weight.

  3. Self-tuning model. Instead of a fixed degree-2 / fixed-alpha fit, we pick
     the polynomial degree (1 affine vs 2 curvature) and Ridge alpha that
     minimise *leave-one-dot-out* error. This adapts to dot count and noise
     automatically (few/noisy dots → simpler, more-regularised map) and avoids
     overfitting the calibration points.

  4. Honest accuracy report. `train_rmse_px` (in-sample) is optimistic. We also
     report `loocv_px` (leave-one-dot-out RMSE = real generalisation) and break
     it down by screen region (center / edge / corner), since edge/corner error
     is what dominates and a single number hides it.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline as SkPipeline
from sklearn.preprocessing import PolynomialFeatures, StandardScaler

logger = logging.getLogger(__name__)

# Default search grid for self-tuning. Small on purpose: leave-one-dot-out is
# refit once per dot per (degree, alpha), and dot counts are ~9–25.
# Because features are standardised (below), this alpha grid is scale-invariant:
# it means the same thing whether gaze is in radians or degrees and whatever the
# screen resolution — so the optimum is always inside the grid.
_DEGREE_GRID = (1, 2)
_ALPHA_GRID = (1e-3, 1e-2, 1e-1, 1.0, 10.0, 100.0)

# Within-window aggregation defaults.
_SETTLE_FRAC = 0.40   # fraction of a dot window treated as approach transient (dropped)
_MAD_K = 3.0          # keep frames within k · MAD of the window median (per axis)
_MIN_DOT_FRAMES = 3   # need at least this many clean frames to use a dot
_MIN_DOTS = 6         # minimum usable dots to attempt a fit


@dataclass
class CalibrationDot:
    screen_x: float
    screen_y: float
    t_start_ms: float
    t_end_ms: float


@dataclass
class GazeMapper:
    model_x: SkPipeline
    model_y: SkPipeline
    train_rmse_px: float          # in-sample fit error; sanity check, not generalisation
    n_dots_used: int              # dots kept after outlier rejection
    n_dots_total: int             # dots with enough valid frames before rejection
    loocv_px: float = float("nan")           # leave-one-dot-out RMSE — real accuracy estimate
    degree: int = 2                          # polynomial degree chosen by CV
    alpha: float = 1.0                       # Ridge alpha chosen by CV
    region_errors_px: dict = field(default_factory=dict)  # {center, edge, corner} LODO RMSE

    def map(self, yaw: np.ndarray, pitch: np.ndarray) -> np.ndarray:
        """
        Map arrays of (yaw, pitch) to an (N, 2) array of screen (x, y) px.
        NaN inputs (no-face frames) yield NaN rows — predicted explicitly on the
        finite subset because recent sklearn raises on NaN in predict().
        """
        feats = np.column_stack([yaw, pitch])
        out = np.full((len(feats), 2), np.nan)
        ok = np.isfinite(feats).all(axis=1)
        if ok.any():
            out[ok, 0] = self.model_x.predict(feats[ok])
            out[ok, 1] = self.model_y.predict(feats[ok])
        return out


def _poly_ridge(alpha: float, degree: int) -> SkPipeline:
    # poly → standardise → ridge. Standardising each polynomial term to unit
    # variance makes the Ridge penalty comparable across terms and scale-free in
    # the inputs (radians vs degrees) and outputs (screen resolution), so `alpha`
    # has a consistent meaning across sessions and machines.
    return SkPipeline([
        ("poly",  PolynomialFeatures(degree=degree, include_bias=False)),
        ("scale", StandardScaler()),
        ("ridge", Ridge(alpha=alpha)),
    ])


def _fit_weighted(
    feats: np.ndarray,
    sx: np.ndarray,
    sy: np.ndarray,
    weights: np.ndarray,
    alpha: float,
    degree: int,
) -> tuple[SkPipeline, SkPipeline]:
    """Fit two weighted Ridge pipelines (one per screen axis)."""
    mx = _poly_ridge(alpha, degree).fit(feats, sx, ridge__sample_weight=weights)
    my = _poly_ridge(alpha, degree).fit(feats, sy, ridge__sample_weight=weights)
    return mx, my


def _aggregate_dot(
    yaw_w: np.ndarray,
    pitch_w: np.ndarray,
    settle_frac: float = _SETTLE_FRAC,
    mad_k: float = _MAD_K,
    min_frames: int = _MIN_DOT_FRAMES,
) -> tuple[float, float, int, float] | None:
    """
    Reduce one dot's time-ordered window of (yaw, pitch) frames to a single
    robust gaze estimate.

    Returns (yaw_c, pitch_c, n_inliers, spread) or None if too few clean frames.
      yaw_c, pitch_c : robust window center (median of inliers)
      n_inliers      : number of frames in the settled inlier cluster (reliability)
      spread         : combined per-axis MAD (lower = steadier fixation; for weighting)

    Steps: drop NaN → drop approach transient (first settle_frac of the window)
    → reject frames outside mad_k·MAD of the median on either axis → median of
    the survivors.
    """
    valid = ~(np.isnan(yaw_w) | np.isnan(pitch_w))
    yv = yaw_w[valid]
    pv = pitch_w[valid]
    n = len(yv)
    if n < min_frames:
        return None

    # ── Drop the approach transient: keep the settled tail of the window ──────
    # Only when there are enough frames that trimming still leaves a usable cluster.
    if n >= 5:
        start = int(n * settle_frac)
        # Never trim below min_frames survivors.
        start = min(start, n - min_frames)
        if start > 0:
            yv = yv[start:]
            pv = pv[start:]

    # ── Robust inlier selection via MAD (per axis) ───────────────────────────
    my = float(np.median(yv))
    mp = float(np.median(pv))
    # 1.4826 makes MAD a consistent estimator of σ for Gaussian data.
    mad_y = 1.4826 * float(np.median(np.abs(yv - my)))
    mad_p = 1.4826 * float(np.median(np.abs(pv - mp)))
    # Guard against a degenerate (all-identical) window collapsing to zero width.
    tol_y = max(mad_k * mad_y, 1e-9)
    tol_p = max(mad_k * mad_p, 1e-9)
    inlier = (np.abs(yv - my) <= tol_y) & (np.abs(pv - mp) <= tol_p)
    if inlier.sum() < min_frames:
        inlier = np.ones(len(yv), dtype=bool)  # fall back to all settled frames

    yi = yv[inlier]
    pi = pv[inlier]
    yaw_c = float(np.median(yi))
    pitch_c = float(np.median(pi))
    spread = mad_y + mad_p
    return yaw_c, pitch_c, int(inlier.sum()), spread


def _per_dot_weights(n_inliers: np.ndarray, spreads: np.ndarray) -> np.ndarray:
    """
    Combine frame-count reliability with fixation steadiness into [0, 1] weights.

    A dot contributes more when it has more clean inlier frames AND a steadier
    fixation (small spread). Spread is normalised by its median across dots so the
    penalty is scale-free (works whether gaze angles are in radians or degrees).
    """
    n = n_inliers.astype(float)
    n_w = n / n.max() if n.max() > 0 else np.ones_like(n)

    med_spread = float(np.median(spreads))
    if med_spread <= 0:
        steady_w = np.ones_like(spreads)
    else:
        # spread == median → 0.5; steadier → →1; jitterier → →0.
        steady_w = 1.0 / (1.0 + spreads / med_spread)
    w = n_w * steady_w
    # Avoid an all-zero weight vector.
    return w if w.max() > 0 else np.ones_like(w)


def _leave_one_dot_out_errors(
    feats: np.ndarray,
    sx: np.ndarray,
    sy: np.ndarray,
    weights: np.ndarray,
    alpha: float,
    degree: int,
) -> np.ndarray:
    """Per-dot Euclidean reprojection error (px) when that dot is held out of the fit."""
    n = len(feats)
    errs = np.empty(n, dtype=float)
    idx = np.arange(n)
    for i in range(n):
        keep = idx != i
        mx, my = _fit_weighted(
            feats[keep], sx[keep], sy[keep], weights[keep], alpha, degree,
        )
        px = float(mx.predict(feats[i:i + 1])[0])
        py = float(my.predict(feats[i:i + 1])[0])
        errs[i] = float(np.hypot(px - sx[i], py - sy[i]))
    return errs


def _classify_regions(sx: np.ndarray, sy: np.ndarray, edge_frac: float = 0.2) -> np.ndarray:
    """
    Label each dot center / edge / corner from its position within the calibration
    field (normalised by the dot bounding box). A dot near an extreme on both axes
    is a corner, on one axis an edge, otherwise center.
    """
    def _norm(a: np.ndarray) -> np.ndarray:
        lo, hi = float(a.min()), float(a.max())
        return (a - lo) / (hi - lo) if hi > lo else np.full_like(a, 0.5)

    nx, ny = _norm(sx), _norm(sy)
    x_extreme = (nx < edge_frac) | (nx > 1 - edge_frac)
    y_extreme = (ny < edge_frac) | (ny > 1 - edge_frac)
    labels = np.empty(len(sx), dtype=object)
    for i in range(len(sx)):
        if x_extreme[i] and y_extreme[i]:
            labels[i] = "corner"
        elif x_extreme[i] or y_extreme[i]:
            labels[i] = "edge"
        else:
            labels[i] = "center"
    return labels


def fit_mapper(
    dots: list[CalibrationDot],
    frame_t_ms: np.ndarray,    # (F,) timestamp of each processed frame
    frame_yaw: np.ndarray,     # (F,) yaw per frame (NaN where no face)
    frame_pitch: np.ndarray,   # (F,) pitch per frame (NaN where no face)
    frame_quality: np.ndarray | None = None,  # (F,) optional per-frame quality 0–1 (glare gate)
    alpha: float = 1.0,
    outlier_sigma: float = 2.5,
    cv_tune: bool = True,
) -> GazeMapper:
    """
    Fit a (yaw, pitch) → (screen_x, screen_y) mapper from calibration dot windows.

    Parameters
    ----------
    frame_quality:
        Optional per-frame quality in [0, 1] (e.g. from the glare gate in
        video.py). Frames below 0.3 are excluded from each dot window before
        aggregation, so lens-glare frames don't corrupt the calibration center.
    alpha:
        Ridge regularisation strength. Used directly when cv_tune=False; when
        cv_tune=True it seeds the search grid but the CV-selected value wins.
    outlier_sigma:
        Dots with leave-one-dot-out error > mean + outlier_sigma · std are removed
        before refitting. Set to np.inf to disable outlier rejection.
    cv_tune:
        Auto-select polynomial degree and alpha by leave-one-dot-out CV. Strongly
        recommended; set False only for debugging a fixed model.
    """
    # ── Per-dot robust aggregation ───────────────────────────────────────────
    xs: list[float] = []        # yaw center
    ys: list[float] = []        # pitch center
    sx: list[float] = []        # screen x
    sy: list[float] = []        # screen y
    n_inl: list[int] = []       # inlier frame count per dot
    spreads: list[float] = []   # fixation spread per dot

    for d in dots:
        in_window = (frame_t_ms >= d.t_start_ms) & (frame_t_ms <= d.t_end_ms)
        yaw_w = frame_yaw[in_window].copy()
        pitch_w = frame_pitch[in_window].copy()
        if frame_quality is not None:
            q = frame_quality[in_window]
            bad = q < 0.3
            yaw_w[bad] = np.nan
            pitch_w[bad] = np.nan

        agg = _aggregate_dot(yaw_w, pitch_w)
        if agg is None:
            continue
        yaw_c, pitch_c, n_i, spread = agg
        xs.append(yaw_c)
        ys.append(pitch_c)
        sx.append(d.screen_x)
        sy.append(d.screen_y)
        n_inl.append(n_i)
        spreads.append(spread)

    n_total = len(xs)
    if n_total < _MIN_DOTS:
        raise ValueError(
            f"Only {n_total} usable calibration dots (need ≥{_MIN_DOTS}). "
            "Check that the recorded video covers the calibration phase and that "
            "the dot time windows align with the video timeline."
        )

    feats = np.column_stack([xs, ys])
    sx_arr = np.array(sx, dtype=float)
    sy_arr = np.array(sy, dtype=float)
    w = _per_dot_weights(np.array(n_inl), np.array(spreads, dtype=float))

    # ── Self-tune (degree, alpha) by leave-one-dot-out error ─────────────────
    best_degree, best_alpha = 2, alpha
    if cv_tune:
        best_score = np.inf
        for degree in _DEGREE_GRID:
            # Degree-2 needs ≥6 points to be identifiable; fall back otherwise.
            if degree == 2 and n_total < 6:
                continue
            for a in _ALPHA_GRID:
                errs = _leave_one_dot_out_errors(feats, sx_arr, sy_arr, w, a, degree)
                score = float(np.sqrt(np.mean(errs ** 2)))
                if score < best_score:
                    best_score, best_degree, best_alpha = score, degree, a
        logger.info(
            "Calibration CV: degree=%d alpha=%.2f → LODO RMSE %.1f px",
            best_degree, best_alpha, best_score,
        )

    # ── Outlier-dot rejection based on held-out error, then refit ────────────
    lodo = _leave_one_dot_out_errors(feats, sx_arr, sy_arr, w, best_alpha, best_degree)
    mu, sigma = float(lodo.mean()), float(lodo.std())
    keep = np.ones(n_total, dtype=bool)
    if sigma > 0 and np.isfinite(outlier_sigma):
        threshold = mu + outlier_sigma * sigma
        candidate = lodo <= threshold
        if (~candidate).any() and candidate.sum() >= _MIN_DOTS:
            keep = candidate
            logger.info(
                "Calibration: rejecting %d outlier dot(s) (LODO error > %.1f px), refitting",
                int((~keep).sum()), threshold,
            )

    n_used = int(keep.sum())
    mx, my = _fit_weighted(
        feats[keep], sx_arr[keep], sy_arr[keep], w[keep], best_alpha, best_degree,
    )

    # ── Reporting: in-sample RMSE, honest LODO RMSE, per-region breakdown ────
    pred_x = mx.predict(feats[keep])
    pred_y = my.predict(feats[keep])
    rmse = float(np.sqrt(np.mean((pred_x - sx_arr[keep]) ** 2 + (pred_y - sy_arr[keep]) ** 2)))

    lodo_used = _leave_one_dot_out_errors(
        feats[keep], sx_arr[keep], sy_arr[keep], w[keep], best_alpha, best_degree,
    )
    loocv_px = float(np.sqrt(np.mean(lodo_used ** 2)))

    regions = _classify_regions(sx_arr[keep], sy_arr[keep])
    region_errors: dict[str, float] = {}
    for name in ("center", "edge", "corner"):
        mask = regions == name
        if mask.any():
            region_errors[name] = float(np.sqrt(np.mean(lodo_used[mask] ** 2)))

    logger.info(
        "Calibration fit: %d/%d dots, degree=%d alpha=%.2f | train RMSE %.1f px | "
        "LODO RMSE %.1f px | regions %s",
        n_used, n_total, best_degree, best_alpha, rmse, loocv_px,
        {k: round(v, 1) for k, v in region_errors.items()},
    )
    return GazeMapper(
        model_x=mx,
        model_y=my,
        train_rmse_px=rmse,
        n_dots_used=n_used,
        n_dots_total=n_total,
        loocv_px=loocv_px,
        degree=best_degree,
        alpha=best_alpha,
        region_errors_px=region_errors,
    )
