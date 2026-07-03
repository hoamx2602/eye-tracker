"""
Synthetic tests for head-translation (parallax) compensation.

Pure numpy/sklearn — no OpenFace/torch/cv2 needed, so these run anywhere:

    python -m tests.test_head_comp        (from backend/)
    pytest tests/test_head_comp.py

The end-to-end test builds a geometric ground-truth world (screen, eye position,
pinhole webcam), simulates a calibration with the head still and a validation
with the head displaced, and asserts that compensation recovers most of the
parallax error that the raw polynomial mapping cannot see.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.calibration import CalibrationDot, fit_mapper
from app.events import ScreenGeometry
from app.head_comp import HeadCompensator, HeadRef, build_compensator, fit_head_ref
from app.validation import evaluate_mapper

# ── Shared geometry ──────────────────────────────────────────────────────────
GEO = ScreenGeometry(width_px=1920, height_px=1080, width_cm=34.5, viewing_distance_cm=60.0)
PPCM = GEO.width_px / GEO.width_cm
HFOV = 60.0
F_N = 0.5 / np.tan(np.deg2rad(HFOV) / 2.0)   # focal, image-width units
W0 = 0.25                                     # face bbox width at 60 cm (norm.)


def _observed_head(hx_cm: float, hy_cm: float, z_cm: float) -> tuple[float, float, float]:
    """Pinhole observation of a head at user-right hx, user-down hy, distance z."""
    x_cam = -hx_cm            # camera X = user's left
    y_cam = hy_cm             # camera Y = down (shared with screen)
    u = F_N * x_cam / z_cm
    v = F_N * y_cam / z_cm
    w = W0 * (GEO.viewing_distance_cm / z_cm)
    return u, v, w


def test_static_head_is_identity() -> None:
    ref = HeadRef(u=0.01, v=-0.02, w=W0)
    comp = HeadCompensator(ref=ref, viewing_distance_cm=60.0, px_per_cm=PPCM, hfov_deg=HFOV)
    x = np.array([100.0, 960.0])
    y = np.array([500.0, 540.0])
    hu = np.full(2, ref.u)
    hv = np.full(2, ref.v)
    hw = np.full(2, ref.w)
    cx, cy = comp.apply(x, y, hu, hv, hw)
    assert np.allclose(cx, x, atol=1e-9) and np.allclose(cy, y, atol=1e-9)
    stats = comp.motion_stats(hu, hv, hw)
    assert stats["lateral_max_cm"] < 1e-9


def test_known_translation_shifts_by_expected_px() -> None:
    ref = HeadRef(u=0.0, v=0.0, w=W0)
    comp = HeadCompensator(ref=ref, viewing_distance_cm=60.0, px_per_cm=PPCM, hfov_deg=HFOV)
    d = 3.0  # user moves 3 cm right and 2 cm down
    u, v, w = _observed_head(d, 2.0, 60.0)
    cx, cy = comp.apply(np.array([960.0]), np.array([540.0]),
                        np.array([u]), np.array([v]), np.array([w]))
    # POR follows the head: +3 cm right, +2 cm down
    assert abs(cx[0] - (960.0 + d * PPCM)) < 0.5, cx
    assert abs(cy[0] - (540.0 + 2.0 * PPCM)) < 0.5, cy


def test_pure_distance_change_no_lateral_shift() -> None:
    ref = HeadRef(u=0.0, v=0.0, w=W0)
    comp = HeadCompensator(ref=ref, viewing_distance_cm=60.0, px_per_cm=PPCM, hfov_deg=HFOV)
    u, v, w = _observed_head(0.0, 0.0, 75.0)  # leaned back 15 cm, centered
    cx, cy = comp.apply(np.array([500.0]), np.array([400.0]),
                        np.array([u]), np.array([v]), np.array([w]))
    assert abs(cx[0] - 500.0) < 1e-6 and abs(cy[0] - 400.0) < 1e-6
    stats = comp.motion_stats(np.array([u]), np.array([v]), np.array([w]))
    # distance_ratio = Z_now / Z_calibration (w_ref / w_now): 75/60 = leaned back
    assert abs(stats["distance_ratio_median"] - 75.0 / 60.0) < 1e-6


def test_missing_head_frames_pass_through() -> None:
    ref = HeadRef(u=0.0, v=0.0, w=W0)
    comp = HeadCompensator(ref=ref, viewing_distance_cm=60.0, px_per_cm=PPCM, hfov_deg=HFOV)
    cx, cy = comp.apply(np.array([100.0]), np.array([200.0]),
                        np.array([np.nan]), np.array([np.nan]), np.array([np.nan]))
    assert cx[0] == 100.0 and cy[0] == 200.0


def test_fit_head_ref_uses_only_windows() -> None:
    t = np.arange(0, 100, dtype=float) * 100.0   # 100 frames, 100 ms apart
    hu = np.zeros(100)
    hu[50:] = 0.1                                 # big move AFTER the windows
    hv = np.zeros(100)
    hw = np.full(100, W0)
    ref = fit_head_ref([(0.0, 2000.0), (2500.0, 4500.0)], t, hu, hv, hw)
    assert ref is not None and abs(ref.u) < 1e-9

    # All-NaN head data → no compensator
    nan = np.full(100, np.nan)
    assert fit_head_ref([(0.0, 2000.0)], t, nan, nan, nan) is None


def _simulate_session(head_val_cm: tuple[float, float]) -> dict:
    """
    Ground truth: eye starts centered in front of the screen at 60 cm. Gaze
    angles are exact camera-space directions eye→target. During calibration the
    head is still; during validation it is displaced by head_val_cm (right, down).
    """
    rng = np.random.default_rng(7)
    z = GEO.viewing_distance_cm
    cx_cm, cy_cm = GEO.width_px / 2 / PPCM, GEO.height_px / 2 / PPCM  # eye faces screen center

    cal_targets = [(x, y) for y in (140, 540, 940) for x in (240, 960, 1680)]
    val_targets = [(600, 340), (1320, 340), (600, 740), (1320, 740), (960, 540)]

    frames_per_dot, dt = 12, 33.0
    t_list, yaw_list, pitch_list = [], [], []
    hu_list, hv_list, hw_list = [], [], []
    cal_dots, val_dots = [], []
    t = 0.0

    def emit(targets, dots_out, head_cm):
        nonlocal t
        hx, hy = head_cm
        u, v, w = _observed_head(hx, hy, z)
        for (tx, ty) in targets:
            t0 = t
            for _ in range(frames_per_dot):
                # exact gaze direction from displaced eye to target (+ tiny noise)
                yaw = np.arctan(((tx / PPCM) - (cx_cm + hx)) / z) + rng.normal(0, 2e-4)
                pitch = np.arctan(((ty / PPCM) - (cy_cm + hy)) / z) + rng.normal(0, 2e-4)
                t_list.append(t)
                yaw_list.append(yaw)
                pitch_list.append(pitch)
                hu_list.append(u + rng.normal(0, 1e-4))
                hv_list.append(v + rng.normal(0, 1e-4))
                hw_list.append(w + rng.normal(0, 1e-4))
                t += dt
            dots_out.append(CalibrationDot(tx, ty, t0, t - dt))
            t += 3 * dt  # gap between dots

    emit(cal_targets, cal_dots, (0.0, 0.0))
    emit(val_targets, val_dots, head_val_cm)

    return {
        "t_ms": np.array(t_list), "yaw": np.array(yaw_list), "pitch": np.array(pitch_list),
        "head_u": np.array(hu_list), "head_v": np.array(hv_list), "head_w": np.array(hw_list),
        "cal_dots": cal_dots, "val_dots": val_dots,
    }


def test_end_to_end_compensation_recovers_parallax() -> None:
    s = _simulate_session(head_val_cm=(3.0, -2.0))  # 3 cm right, 2 cm up during validation
    mapper = fit_mapper(s["cal_dots"], s["t_ms"], s["yaw"], s["pitch"])
    comp = build_compensator(
        [(d.t_start_ms, d.t_end_ms) for d in s["cal_dots"]],
        s["t_ms"], s["head_u"], s["head_v"], s["head_w"],
        viewing_distance_cm=GEO.viewing_distance_cm,
        screen_width_px=GEO.width_px, screen_width_cm=GEO.width_cm, hfov_deg=HFOV,
    )
    assert comp is not None
    head = {k: s[k] for k in ("head_u", "head_v", "head_w")}
    rep = evaluate_mapper(
        mapper, s["val_dots"], s["t_ms"], s["yaw"], s["pitch"], GEO,
        compensator=comp, frame_head=head,
    )
    # ~3.6 cm displacement ≈ 200 px raw error; compensation should remove ≥80%.
    expected_raw = np.hypot(3.0, 2.0) * PPCM
    assert rep.overall_px_raw > 0.7 * expected_raw, (rep.overall_px_raw, expected_raw)
    assert rep.overall_px < 0.2 * rep.overall_px_raw, (rep.overall_px, rep.overall_px_raw)
    print(f"  raw {rep.overall_px_raw:.1f} px -> compensated {rep.overall_px:.1f} px "
          f"(expected raw ~ {expected_raw:.0f} px)")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            print(f"{name} ...")
            fn()
            print("  ok")
    print("all tests passed")
