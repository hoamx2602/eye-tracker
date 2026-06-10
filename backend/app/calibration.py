"""
Per-session calibration mapping: raw L2CS gaze (yaw, pitch) -> screen (x, y) px.

The browser already shows N calibration dots at known screen positions. We re-fit
the mapping on the backend from the *recorded video* so it uses L2CS features
(the browser's own calibration used MediaPipe features, which are not comparable).

For each dot the browser sends its screen (x, y) plus the [t_start, t_end] window
during which the subject fixated it. We take the median yaw/pitch over that window
(robust to blinks/saccades into the dot) and fit a 2nd-order polynomial Ridge —
enough to capture screen-edge curvature with as few as ~9 dots, without overfitting.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline as SkPipeline
from sklearn.preprocessing import PolynomialFeatures


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
    train_rmse_px: float  # in-sample fit error; sanity check, not generalization

    def map(self, yaw: np.ndarray, pitch: np.ndarray) -> np.ndarray:
        """Map arrays of (yaw, pitch) to an (N, 2) array of screen (x, y) px."""
        feats = np.column_stack([yaw, pitch])
        return np.column_stack([self.model_x.predict(feats), self.model_y.predict(feats)])


def _poly_ridge(alpha: float = 1.0, degree: int = 2) -> SkPipeline:
    return SkPipeline([
        ("poly", PolynomialFeatures(degree=degree, include_bias=True)),
        ("ridge", Ridge(alpha=alpha)),
    ])


def fit_mapper(
    dots: list[CalibrationDot],
    frame_t_ms: np.ndarray,   # (F,) timestamp of each processed frame
    frame_yaw: np.ndarray,    # (F,) yaw per frame (NaN where no face)
    frame_pitch: np.ndarray,  # (F,) pitch per frame (NaN where no face)
    alpha: float = 1.0,
) -> GazeMapper:
    xs, ys, sx, sy = [], [], [], []
    for d in dots:
        m = (frame_t_ms >= d.t_start_ms) & (frame_t_ms <= d.t_end_ms)
        yaw_w = frame_yaw[m]
        pitch_w = frame_pitch[m]
        valid = ~(np.isnan(yaw_w) | np.isnan(pitch_w))
        if valid.sum() < 3:
            continue  # too few clean frames for this dot
        xs.append(float(np.median(yaw_w[valid])))
        ys.append(float(np.median(pitch_w[valid])))
        sx.append(d.screen_x)
        sy.append(d.screen_y)

    if len(xs) < 6:
        raise ValueError(
            f"Only {len(xs)} usable calibration dots (need >=6). "
            "Check that the recorded video covers the calibration phase and that "
            "the dot time windows align with the video timeline."
        )

    feats = np.column_stack([xs, ys])
    mx = _poly_ridge(alpha).fit(feats, sx)
    my = _poly_ridge(alpha).fit(feats, sy)

    pred_x = mx.predict(feats)
    pred_y = my.predict(feats)
    rmse = float(np.sqrt(np.mean((pred_x - sx) ** 2 + (pred_y - sy) ** 2)))
    return GazeMapper(model_x=mx, model_y=my, train_rmse_px=rmse)
