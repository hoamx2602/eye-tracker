"""
End-to-end offline-pipeline test with a stub gaze model — no OpenFace/GPU.

Covers the glue that the pure-math tests (test_head_comp.py) don't:
  • video.process_video — decode, PTS timestamps, the batched infer_batch path,
    SG smoothing, head arrays
  • reprocess.reprocess — model injection, calibration fit, head compensation,
    validation A/B, biomarkers, report shape

A tiny synthetic video is written with cv2; the stub model ignores pixels and
replays a scripted per-frame gaze (same geometry as test_head_comp), so the
expected calibration/validation numbers are known.

Run:  python -m tests.test_pipeline_stub     (from backend/)
"""
from __future__ import annotations

import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.reprocess import reprocess

# ── Geometry (mirrors test_head_comp) ────────────────────────────────────────
W_PX, H_PX, W_CM, Z_CM = 1920, 1080, 34.5, 60.0
PPCM = W_PX / W_CM
HFOV = 60.0
F_N = 0.5 / np.tan(np.deg2rad(HFOV) / 2.0)
W0 = 0.25
FPS = 30.0

CAL_TARGETS = [(x, y) for y in (140, 540, 940) for x in (240, 960, 1680)]
VAL_TARGETS = [(600, 340), (1320, 340), (600, 740), (1320, 740), (960, 540)]
FRAMES_PER_DOT = 12
GAP_FRAMES = 3
HEAD_VAL_CM = (3.0, -2.0)   # head shifts 3 cm right, 2 cm up during validation


@dataclass
class _Gaze:  # duck-typed FrameGaze (video.py only reads these attributes)
    yaw: float
    pitch: float
    bbox_area: float = 10000.0
    quality: float = 1.0
    head_u: float = 0.0
    head_v: float = 0.0
    head_w: float = W0


class StubModel:
    """Replays a script of per-frame _Gaze (or None) regardless of pixels."""

    def __init__(self, script: list[_Gaze | None]):
        self.script = script
        self.cursor = 0
        self.batch_sizes: list[int] = []

    def infer_batch(self, frames):
        self.batch_sizes.append(len(frames))
        out = []
        for _ in frames:
            out.append(self.script[self.cursor] if self.cursor < len(self.script) else None)
            self.cursor += 1
        return out


def _observed_head(hx_cm: float, hy_cm: float) -> tuple[float, float, float]:
    return -F_N * hx_cm / Z_CM, F_N * hy_cm / Z_CM, W0


def _build_script_and_meta() -> tuple[list[_Gaze | None], dict]:
    rng = np.random.default_rng(11)
    cx_cm, cy_cm = W_PX / 2 / PPCM, H_PX / 2 / PPCM
    script: list[_Gaze | None] = []
    cal_dots, val_dots = [], []
    frame_ms = 1000.0 / FPS

    def emit(targets, dots_out, head_cm):
        hu, hv, hw = _observed_head(*head_cm)
        hx, hy = head_cm
        for (tx, ty) in targets:
            t0 = len(script) * frame_ms
            for _ in range(FRAMES_PER_DOT):
                yaw = np.arctan(((tx / PPCM) - (cx_cm + hx)) / Z_CM) + rng.normal(0, 2e-4)
                pitch = np.arctan(((ty / PPCM) - (cy_cm + hy)) / Z_CM) + rng.normal(0, 2e-4)
                script.append(_Gaze(yaw=yaw, pitch=pitch, head_u=hu, head_v=hv, head_w=hw))
            t1 = len(script) * frame_ms - frame_ms
            dots_out.append({"screen_x": tx, "screen_y": ty, "t_start_ms": t0, "t_end_ms": t1})
            script.extend([None] * GAP_FRAMES)   # blink/no-face gap between dots

    emit(CAL_TARGETS, cal_dots, (0.0, 0.0))
    emit(VAL_TARGETS, val_dots, HEAD_VAL_CM)

    meta = {
        "screen": {"width_px": W_PX, "height_px": H_PX, "width_cm": W_CM,
                   "viewing_distance_cm": Z_CM},
        "camera_hfov_deg": HFOV,
        "calibration_dots": cal_dots,
        "validation_dots": val_dots,
    }
    return script, meta


def _write_video(n_frames: int, path: str) -> None:
    vw = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (64, 48))
    assert vw.isOpened(), "cv2 VideoWriter failed to open"
    for i in range(n_frames):
        frame = np.full((48, 64, 3), i % 255, dtype=np.uint8)
        vw.write(frame)
    vw.release()


def test_full_pipeline_with_stub_model() -> None:
    script, meta = _build_script_and_meta()
    with tempfile.TemporaryDirectory() as td:
        video_path = str(Path(td) / "session.mp4")
        _write_video(len(script), video_path)

        model = StubModel(script)
        report = reprocess(video_path, meta, model=model)

    # Batched path actually used, with the configured chunk size
    assert model.batch_sizes and max(model.batch_sizes) > 1, model.batch_sizes

    # Calibration: 9 clean dots, LODO error far under one degree-equivalent
    cal = report["calibration"]
    assert cal["dots_total"] == len(CAL_TARGETS)
    assert cal["loocv_px"] < 20.0, cal

    # Head compensation ran and saw the 3.6 cm validation-phase displacement
    head = report["head"]
    assert head["compensation_applied"] is True
    assert head["motion"]["lateral_max_cm"] > 2.5, head["motion"]

    # Validation A/B: raw error ≈ the parallax (~200 px); compensated ≪ raw
    val = report["validation"]
    expected_raw = float(np.hypot(*HEAD_VAL_CM) * PPCM)
    assert val["overall_px_raw"] > 0.6 * expected_raw, (val["overall_px_raw"], expected_raw)
    assert val["overall_px"] < 0.25 * val["overall_px_raw"], val
    assert val["n_points"] == len(VAL_TARGETS)

    # Biomarkers present and sane on the compensated trace
    bm = report["biomarkers"]
    assert bm["n_samples"] == len(script)
    assert 0.5 < bm["valid_ratio"] <= 1.0
    assert bm["fixation_count"] >= 5

    print(f"  loocv {cal['loocv_px']:.1f} px | validation raw {val['overall_px_raw']:.1f} px"
          f" -> comp {val['overall_px']:.1f} px | batches {model.batch_sizes[:3]}...")


def test_pipeline_head_comp_disabled() -> None:
    script, meta = _build_script_and_meta()
    meta["head_compensation"] = False
    with tempfile.TemporaryDirectory() as td:
        video_path = str(Path(td) / "session.mp4")
        _write_video(len(script), video_path)
        report = reprocess(video_path, meta, model=StubModel(script))

    assert report["head"]["compensation_applied"] is False
    val = report["validation"]
    # Without compensation the parallax stays in the validation error
    assert val["overall_px"] > 100.0, val
    assert np.isnan(val["overall_px_raw"])


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            print(f"{name} ...")
            fn()
            print("  ok")
    print("all tests passed")
