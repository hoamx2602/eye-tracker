"""
Tests for per-subject personalization (app/personalize.py) — no OpenFace/GPU.

A fake torch model reproduces the MTL layout personalize.py touches
(base_model → fc_gaze → relu → gaze_regressor, plus predictor.preprocess).
Synthetic "face crops" encode the ground-truth gaze in their pixel values, so
the (frozen) backbone can expose it and the trainable head can learn it.

Run:  python -m tests.test_personalize    (from backend/)
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.calibration import CalibrationDot
from app.personalize import (
    align_targets,
    collect_dot_crops,
    finetune_gaze_head,
    geometric_angles,
    personalize_on_session,
    restore_gaze_head,
    snapshot_gaze_head,
)

# ── Fake OpenFace-like model ─────────────────────────────────────────────────

FEAT = 16


class _FakeMTL(torch.nn.Module):
    """Same attribute layout as OpenFace's MTL net, tiny sizes."""

    def __init__(self):
        super().__init__()
        torch.manual_seed(0)
        # Frozen "backbone": channel means → linear lift to FEAT dims.
        self.base_model = torch.nn.Sequential(
            torch.nn.AdaptiveAvgPool2d(1),
            torch.nn.Flatten(),                 # (N, 3) channel means
            torch.nn.Linear(3, FEAT),
        )
        for p in self.base_model.parameters():
            p.requires_grad_(False)
        self.fc_gaze = torch.nn.Linear(FEAT, FEAT)
        self.relu = torch.nn.ReLU()
        self.gaze_regressor = torch.nn.Linear(FEAT, 2)


class _FakePredictor:
    def __init__(self):
        self.model = _FakeMTL()

    def preprocess(self, crop_bgr: np.ndarray) -> torch.Tensor:
        img = cv2.resize(crop_bgr, (8, 8)).astype(np.float32) / 255.0
        return torch.from_numpy(img.transpose(2, 0, 1)).unsqueeze(0)


class _FakeGazeModel:
    """Only the surface personalize.py touches: _model.{model, preprocess}."""

    def __init__(self):
        self._model = _FakePredictor()


def _encode_crop(yaw: float, pitch: float, rng) -> np.ndarray:
    """Crop whose channel means carry the gaze — 128 + angle·300, mild noise."""
    c = np.empty((16, 16, 3), dtype=np.uint8)
    c[:, :, 0] = np.clip(128 + yaw * 300 + rng.normal(0, 1, (16, 16)), 0, 255)
    c[:, :, 1] = np.clip(128 + pitch * 300 + rng.normal(0, 1, (16, 16)), 0, 255)
    c[:, :, 2] = 128
    return c


# ── Unit tests ───────────────────────────────────────────────────────────────

def test_align_targets_handles_sign_flip() -> None:
    rng = np.random.default_rng(3)
    geom = np.linspace(-0.3, 0.3, 12)
    model = 0.05 - 1.7 * geom + rng.normal(0, 0.003, 12)   # negative convention
    t_yaw, t_pitch, corr_y, corr_p = align_targets(model, model, geom, geom)
    assert corr_y < -0.99
    # Targets sit on the robust line — closer to the line than the noisy data
    line = 0.05 - 1.7 * geom
    assert np.abs(t_yaw - line).max() < 0.01


def test_geometric_angles_signs() -> None:
    # Two dots: far left and far right of a 1920×1080/34.5cm screen, eye centered.
    yaw, pitch = geometric_angles(
        dot_x_px=np.array([0.0, 1920.0]),
        dot_y_px=np.array([540.0, 540.0]),
        head_u=np.zeros(2), head_v=np.zeros(2), head_w_ratio=np.ones(2),
        screen_width_px=1920, screen_width_cm=34.5,
        viewing_distance_cm=60.0, hfov_deg=60.0,
    )
    # Camera X = user's LEFT → the user-left dot (x=0) has positive camera-x ray.
    assert yaw[0] > 0 > yaw[1]
    assert pitch[0] == pitch[1]           # same row → same vertical angle
    assert abs(yaw[0]) < np.deg2rad(20)   # half a 34.5 cm screen at 60 cm ≈ 16°


def test_snapshot_restore_roundtrip() -> None:
    m = _FakeGazeModel()
    x = torch.randn(4, 3, 8, 8)
    mtl = m._model.model
    before = mtl.gaze_regressor(mtl.relu(mtl.fc_gaze(mtl.base_model(x))))
    snap = snapshot_gaze_head(m)
    with torch.no_grad():
        for p in mtl.fc_gaze.parameters():
            p.add_(1.0)
    changed = mtl.gaze_regressor(mtl.relu(mtl.fc_gaze(mtl.base_model(x))))
    assert not torch.allclose(before, changed)
    restore_gaze_head(m, snap)
    after = mtl.gaze_regressor(mtl.relu(mtl.fc_gaze(mtl.base_model(x))))
    assert torch.allclose(before, after)


def test_finetune_reduces_heldout_error() -> None:
    rng = np.random.default_rng(5)
    n_dots = 12
    yaw_t = np.linspace(-0.25, 0.25, n_dots)
    pitch_t = np.linspace(0.2, -0.2, n_dots)
    crops = [
        [_encode_crop(yaw_t[i], pitch_t[i], rng) for _ in range(10)]
        for i in range(n_dots)
    ]
    m = _FakeGazeModel()
    epochs, init_l1, best_l1 = finetune_gaze_head(m, crops, yaw_t, pitch_t, max_epochs=60, lr=3e-3)
    assert epochs > 0
    assert best_l1 < init_l1 * 0.5, (init_l1, best_l1)
    assert best_l1 < 0.05, best_l1   # radians on held-out dots
    print(f"  val L1 {init_l1:.4f} -> {best_l1:.4f} rad in {epochs} epochs")


def test_collect_dot_crops_settle_and_cap() -> None:
    fps, n = 30.0, 90
    with tempfile.TemporaryDirectory() as td:
        path = str(Path(td) / "v.mp4")
        vw = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (32, 24))
        for i in range(n):
            vw.write(np.full((24, 32, 3), i % 250, dtype=np.uint8))
        vw.release()

        t = np.arange(n) / fps * 1000.0
        quality = np.ones(n)
        # one 1-second window: 30 frames; settle drops the first 40% → ~18 left
        crops = collect_dot_crops(
            path, [(0.0, 1000.0)], lambda f: f, quality, t, max_per_dot=10,
        )
    assert len(crops) == 1
    assert len(crops[0]) == 10                      # capped
    # Settle drops the first 40% (frames 0–11); mp4v quantization shifts the
    # gray values by a few units, so assert well above the early frames only.
    assert float(crops[0][0][0, 0, 0]) >= 5, float(crops[0][0][0, 0, 0])


def test_personalize_on_session_end_to_end() -> None:
    """Full orchestration over a real (synthetic) video with the fake model."""
    rng = np.random.default_rng(9)
    W_PX, W_CM, Z = 1920.0, 34.5, 60.0
    fps = 30.0
    frames_per_dot, gap = 10, 2
    xs = [240, 960, 1680]
    ys = [140, 540, 940]
    dots_px = [(x, y) for y in ys for x in xs]

    dot_yaw_g, dot_pitch_g = geometric_angles(
        np.array([d[0] for d in dots_px], float),
        np.array([d[1] for d in dots_px], float),
        np.zeros(len(dots_px)), np.zeros(len(dots_px)), np.ones(len(dots_px)),
        W_PX, W_CM, Z, 60.0,
    )
    # Model-space convention: affine of geometry (what align_targets must find)
    dot_yaw_m = 0.03 + 1.4 * dot_yaw_g
    dot_pitch_m = -0.02 + 1.2 * dot_pitch_g

    # Video: each dot's frames encode ITS model-space angle in the pixels
    script_yaw, script_pitch, cal_dots = [], [], []
    frames_imgs = []
    for i, (x, y) in enumerate(dots_px):
        t0 = len(frames_imgs) / fps * 1000.0
        for _ in range(frames_per_dot):
            frames_imgs.append(_encode_crop(dot_yaw_m[i], dot_pitch_m[i], rng))
            script_yaw.append(dot_yaw_m[i] + rng.normal(0, 1e-3))
            script_pitch.append(dot_pitch_m[i] + rng.normal(0, 1e-3))
        t1 = len(frames_imgs) / fps * 1000.0 - 1000.0 / fps
        cal_dots.append(CalibrationDot(x, y, t0, t1))
        for _ in range(gap):
            frames_imgs.append(np.zeros((16, 16, 3), np.uint8))
            script_yaw.append(np.nan)
            script_pitch.append(np.nan)

    n = len(frames_imgs)
    frames = {
        "t_ms": np.arange(n) / fps * 1000.0,
        "yaw": np.array(script_yaw), "pitch": np.array(script_pitch),
        "quality": np.ones(n),
        "head_u": np.zeros(n), "head_v": np.zeros(n), "head_w": np.full(n, 0.25),
    }

    with tempfile.TemporaryDirectory() as td:
        path = str(Path(td) / "v.mp4")
        vw = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (16, 16))
        for img in frames_imgs:
            vw.write(img)
        vw.release()

        m = _FakeGazeModel()
        res = personalize_on_session(
            m, path, cal_dots, frames,
            screen_width_px=W_PX, screen_width_cm=W_CM,
            viewing_distance_cm=Z, hfov_deg=60.0,
            crop_fn=lambda f: f,
        )

    assert res.applied, res.reason
    assert res.n_dots == len(dots_px)
    assert abs(res.align_corr_yaw) > 0.99 and abs(res.align_corr_pitch) > 0.99
    assert res.best_val_l1 < res.initial_val_l1, (res.initial_val_l1, res.best_val_l1)
    print(f"  applied: corr(yaw {res.align_corr_yaw:.3f}), "
          f"val L1 {res.initial_val_l1:.4f} -> {res.best_val_l1:.4f} rad")


def test_personalize_aborts_on_weak_alignment() -> None:
    rng = np.random.default_rng(1)
    n = 12 * 10
    cal_dots = [CalibrationDot(100 + 150 * i, 500, i * 400.0, i * 400.0 + 350.0)
                for i in range(12)]
    frames = {
        "t_ms": np.linspace(0, 12 * 400.0, n),
        "yaw": rng.normal(0, 0.2, n),      # pure noise — no relation to geometry
        "pitch": rng.normal(0, 0.2, n),
        "quality": np.ones(n),
        "head_u": np.zeros(n), "head_v": np.zeros(n), "head_w": np.full(n, 0.25),
    }
    res = personalize_on_session(
        _FakeGazeModel(), "unused.mp4", cal_dots, frames,
        screen_width_px=1920, screen_width_cm=34.5,
        viewing_distance_cm=60, hfov_deg=60,
        crop_fn=lambda f: f,
    )
    assert not res.applied
    assert "alignment too weak" in res.reason


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            print(f"{name} ...")
            fn()
            print("  ok")
    print("all tests passed")
