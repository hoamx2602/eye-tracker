"""
Settled (gaze-contingent) dot windows: the browser already cuts each window at
the start of a stable fixation, so the backend must not drop another 40% of it.

Run:  python -m pytest tests/test_settled_windows.py   (from backend/)
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.calibration import (  # noqa: E402
    _SETTLE_FRAC,
    SETTLED_WINDOW_SETTLE_FRAC,
    CalibrationDot,
    _aggregate_dot,
    fit_mapper,
    settle_frac_for,
)


def test_settle_frac_for() -> None:
    assert settle_frac_for(False) == _SETTLE_FRAC
    assert settle_frac_for(True) == SETTLED_WINDOW_SETTLE_FRAC
    assert SETTLED_WINDOW_SETTLE_FRAC < _SETTLE_FRAC


def test_settled_window_keeps_more_fixation_frames() -> None:
    rng = np.random.default_rng(0)
    yaw = 0.2 + 0.002 * rng.standard_normal(20)
    pitch = -0.1 + 0.002 * rng.standard_normal(20)
    legacy = _aggregate_dot(yaw, pitch, settle_frac=settle_frac_for(False))
    settled = _aggregate_dot(yaw, pitch, settle_frac=settle_frac_for(True))
    assert legacy is not None and settled is not None
    assert settled[2] > legacy[2]            # more inlier frames used
    assert abs(settled[0] - 0.2) < 0.003     # still centred on the fixation


def test_fit_mapper_accepts_settle_frac() -> None:
    rng = np.random.default_rng(1)
    targets = [(x, y) for y in (100, 500, 900) for x in (200, 960, 1700)]
    frames_per_dot, dt = 12, 33.0
    t, yaw, pitch, dots = [], [], [], []
    clock = 0.0
    for sx, sy in targets:
        start = clock
        for _ in range(frames_per_dot):
            t.append(clock)
            yaw.append((sx - 960) / 4000 + 0.001 * rng.standard_normal())
            pitch.append((sy - 500) / 4000 + 0.001 * rng.standard_normal())
            clock += dt
        dots.append(CalibrationDot(sx, sy, start, clock - dt))
    mapper = fit_mapper(
        dots, np.array(t), np.array(yaw), np.array(pitch),
        settle_frac=settle_frac_for(True),
    )
    assert mapper.n_dots_total == len(targets)
    assert mapper.loocv_px < 50
