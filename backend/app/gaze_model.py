"""
OpenFace 3.0 wrapper — per-frame gaze inference.

Replaces L2CS-Net. Same output contract: FrameGaze(yaw, pitch, bbox_area).
The rest of the pipeline (video.py, calibration.py, events.py) is unchanged.

Model: OpenFace 3.0 multitask (landmarks + AU + gaze + emotion).
  • Accuracy: 2.56° on MPIIGaze vs L2CS-Net's 3.92° — ~35% improvement.
  • Backbone: ResNet, four independent FC heads (per-eye yaw/pitch + AU + emotion).
  • Weights: HuggingFace nutPace/openface_weights (downloaded via `openface download`).

Throughput optimizations (offline batch path):
  • In-memory RetinaFace detection — FaceDetector.get_face() only takes a file
    path because it calls cv2.imread; we replicate its preprocessing on the
    already-decoded BGR frame. Kills the per-frame JPEG write+read round trip
    AND the JPEG compression loss. The temp-file path is kept as a fallback.
  • PriorBox cache — the library regenerates anchor priors (pure-Python loops)
    for every frame; all frames of a video share one size, so we cache them.
  • Gaze-only MTL forward — the multitask forward also computes the emotion and
    AU heads (the AU head is a graph-attention module) that we discard; we run
    backbone + gaze branch only.
  • infer_batch() — stacks N face crops into one (N,3,224,224) tensor and runs
    a single MTL forward, instead of one GPU launch per frame.

Install:  pip install openface-test && openface download --output /models/openface
Weights:  Alignment_RetinaFace.pth, MTL_backbone.pth in OPENFACE_WEIGHTS directory.
"""
from __future__ import annotations

import logging
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import torch
from openface.face_detection import FaceDetector
from openface.multitask_model import MultitaskPredictor
from openface.Pytorch_Retinaface.layers.functions.prior_box import PriorBox
from openface.Pytorch_Retinaface.utils.box_utils import decode
from openface.Pytorch_Retinaface.utils.nms.py_cpu_nms import py_cpu_nms

from .device import resolve_device
from .imaging import downscale_for_detection

logger = logging.getLogger(__name__)

def _resolve_weights_dir() -> str:
    """
    Locate the OpenFace weights directory.

    Priority: OPENFACE_WEIGHTS env → the Docker mount (/models/openface) →
    models/openface under the CWD → models/openface next to the backend package.
    This lets `python -m app.smoke` "just work" natively without exporting an env
    var, while the Docker path still resolves in-container.
    """
    env = os.environ.get("OPENFACE_WEIGHTS")
    if env:
        return env
    backend_dir = Path(__file__).resolve().parent.parent  # …/backend
    for cand in ("/models/openface", Path.cwd() / "models" / "openface",
                 backend_dir / "models" / "openface"):
        if Path(cand).is_dir():
            return str(cand)
    return "/models/openface"


_WEIGHTS_DIR = _resolve_weights_dir()


def _ensure_weights_symlink(weights: Path) -> None:
    """
    OpenFace's vendored RetinaFace / landmark code loads several files by a
    hardcoded RELATIVE path (e.g. ``./weights/mobilenetV1X0.25_pretrain.tar``),
    i.e. relative to the current working directory — not to the model_path we pass.

    Rather than patch the library, point a ``./weights`` directory in the CWD at
    our real weights directory, so every ``./weights/<file>`` lookup resolves
    (all five OpenFace files live together in `weights`). Safe + idempotent.
    """
    link = Path.cwd() / "weights"
    try:
        if link.is_symlink() or link.exists():
            return
        link.symlink_to(weights.resolve(), target_is_directory=True)
        logger.info("Linked %s -> %s for OpenFace relative weight paths", link, weights.resolve())
    except OSError as e:  # noqa: BLE001
        logger.warning(
            "Could not create ./weights symlink (%s); OpenFace may fail to find its "
            "bundled weights. Run from a directory that contains weights/, or mount them there.",
            e,
        )


# Width the frame is downscaled to before face detection. RetinaFace localises a
# face bbox reliably well below this; the crop is taken from the full-resolution
# frame regardless, so nothing the gaze model sees is degraded. Frames already
# narrower than this are passed through untouched.
_DETECT_MAX_WIDTH = int(os.environ.get("GAZE_DETECT_WIDTH", "640"))


@dataclass
class FrameGaze:
    yaw: float        # horizontal gaze angle (radians); + = looking right
    pitch: float      # vertical gaze angle (radians); + = looking up
    bbox_area: float  # face bbox area (px²) — used to select dominant face
    quality: float = 1.0  # eye-region quality in [0, 1]; <1 = specular glare (glasses)
    # Head-position proxy for parallax compensation (head_comp.py). Normalized by
    # image WIDTH (both axes, so the pinhole focal stays isotropic): bbox-center
    # offset from the image center (u right, v down) and bbox width (∝ 1/distance).
    head_u: float = float("nan")
    head_v: float = float("nan")
    head_w: float = float("nan")


def eye_region_glare_quality(
    face_bgr: np.ndarray,
    band_top: float = 0.15,
    band_bottom: float = 0.55,
    v_thresh: int = 240,
    s_thresh: int = 40,
    full_frac: float = 0.05,
) -> float:
    """
    Per-frame eye-region quality in [0, 1] from specular-highlight coverage.

    This is the *correct* glare signal for glasses wearers — unlike EAR, which
    only measures eye openness. Prescription-lens glare is a **specular
    highlight**: a blown-out, near-white patch (very high brightness, very low
    saturation). We measure the fraction of such pixels in the eye band of the
    aligned face crop and map it to a quality score:

        quality = 1            no glare (clean)
        quality → 0            glare covers ≥ `full_frac` of the eye band

    Computed in pure NumPy (HSV V = max channel, S = (max−min)/max) so it has no
    OpenCV dependency and degrades safely (returns 1.0) on empty/odd crops.

    Frames with low quality are excluded from calibration aggregation and gated
    out of the scored trace, instead of silently biasing both.
    """
    if face_bgr is None or face_bgr.ndim != 3 or face_bgr.shape[0] < 4:
        return 1.0
    h = face_bgr.shape[0]
    band = face_bgr[int(h * band_top):int(h * band_bottom), :, :3]
    if band.size == 0:
        return 1.0
    band = band.astype(np.float32)
    v = band.max(axis=2)                       # HSV value
    mn = band.min(axis=2)
    s = np.where(v > 0, (v - mn) / np.maximum(v, 1.0) * 255.0, 0.0)  # HSV saturation (0–255)
    glare = (v >= v_thresh) & (s <= s_thresh)  # bright AND desaturated = blown highlight
    frac = float(glare.mean())
    return float(max(0.0, 1.0 - frac / full_frac))


class GazeModel:
    def __init__(self, weights_dir: str = _WEIGHTS_DIR, device: str | None = None):
        self._tmp_path: str | None = None   # set even if model load fails (see __del__)
        # Device order: explicit arg → OPENFACE_DEVICE env (escape hatch, e.g. "cpu"
        # when the torch build lacks kernels for a very new GPU) → auto.
        self.device = device or resolve_device()
        if self.device.startswith("mps"):
            # A handful of ops still have no MPS kernel. Without this, the first
            # one raises and the whole session dies; with it, torch quietly runs
            # that op on the CPU. For an offline batch job the slowdown is the
            # obviously right trade against a crash. Must be set before the first
            # MPS dispatch, hence here rather than in the shell.
            os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

        weights = Path(weights_dir)
        logger.info("Loading OpenFace 3.0 on %s from %s", self.device, weights)

        # OpenFace loads some bundled files by hardcoded ./weights/<file> paths.
        _ensure_weights_symlink(weights)

        self._detector = FaceDetector(
            model_path=str(weights / "Alignment_RetinaFace.pth"),
            device=self.device,
        )
        self._model = MultitaskPredictor(
            model_path=str(weights / "MTL_backbone.pth"),
            device=self.device,
        )

        # Anchor priors depend only on image size; all frames of a video share
        # one size, so regenerating them per frame (pure-Python loops in the
        # library) is wasted CPU. Cached per (h, w).
        self._priors_cache: dict[tuple[int, int], torch.Tensor] = {}
        # Set on first in-memory detection failure → all later frames use the
        # (slower) library file-path code, and we log the reason only once.
        self._detect_via_file = False
        # Fixed input sizes (detector: one video resolution; MTL: 224×224) —
        # let cuDNN autotune kernels once and reuse them. cuDNN-only; MPS and CPU
        # have no equivalent knob.
        if self.device.startswith("cuda"):
            torch.backends.cudnn.benchmark = True

        # Single reused temp file — avoids creating one per video frame.
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
        self._tmp_path = tmp.name
        tmp.close()

    def __del__(self) -> None:
        tmp = getattr(self, "_tmp_path", None)
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass

    # ── Face detection ───────────────────────────────────────────────────────

    def _priors_for(self, h: int, w: int) -> torch.Tensor:
        key = (h, w)
        priors = self._priors_cache.get(key)
        if priors is None:
            priors = PriorBox(self._detector.cfg, image_size=(h, w)).forward().to(self.device)
            self._priors_cache[key] = priors
        return priors

    def _detect_faces(self, frame_bgr: np.ndarray) -> np.ndarray | None:
        """
        RetinaFace on an in-memory BGR frame → (N, 5) dets [x1, y1, x2, y2, conf]
        with conf ≥ vis_threshold, or None, in FULL-frame pixel coordinates.

        Same preprocessing/decode/NMS as the library's detect_faces(), minus the
        file round trip, minus the landmark decode we never use, with priors
        cached per image size — and with detection run on a downscaled copy.

        Detection cost is quadratic in frame size while a face bbox is a coarse
        object: locating it at 640 px wide and scaling the box back up gives the
        same crop, because the crop is still taken from the full-resolution
        frame. That matters now that capture is 1080p (2.25x the pixels of 720p)
        and doubly so on Apple-Silicon MPS, where this is the slowest stage.
        """
        if not self._detect_via_file:
            try:
                det = self._detector
                small, scale_back = downscale_for_detection(frame_bgr, _DETECT_MAX_WIDTH)
                img = small.astype(np.float32)
                img -= (104, 117, 123)
                img_t = torch.from_numpy(img.transpose(2, 0, 1)).unsqueeze(0).to(self.device)
                h, w = small.shape[:2]
                with torch.no_grad():
                    loc, conf, _landms = det.model(img_t)
                priors = self._priors_for(h, w)
                boxes = decode(loc.data.squeeze(0), priors.data, det.cfg["variance"])
                scale = torch.tensor([w, h, w, h], dtype=boxes.dtype, device=boxes.device)
                boxes = (boxes * scale).cpu().numpy() * scale_back
                scores = conf.squeeze(0).data.cpu().numpy()[:, 1]
                keep = scores > det.confidence_threshold
                boxes, scores = boxes[keep], scores[keep]
                if len(boxes) == 0:
                    return None
                dets = np.hstack((boxes, scores[:, np.newaxis])).astype(np.float32, copy=False)
                dets = dets[py_cpu_nms(dets, det.nms_threshold)]
            except Exception:  # noqa: BLE001
                logger.exception(
                    "In-memory face detection failed — falling back to the library "
                    "file-path code for the rest of this process"
                )
                self._detect_via_file = True

        if self._detect_via_file:
            cv2.imwrite(self._tmp_path, frame_bgr)
            dets, _img_raw = self._detector.detect_faces(self._tmp_path)
            if dets is None or len(dets) == 0:
                return None
            dets = np.atleast_2d(np.asarray(dets, dtype=np.float32))

        dets = dets[dets[:, 4] >= self._detector.vis_threshold]
        return dets if len(dets) else None

    def _crop_dominant(
        self, frame_bgr: np.ndarray, dets: np.ndarray,
    ) -> tuple[np.ndarray, float, float, float, float] | None:
        """Largest-bbox face → (crop, bbox_area, head_u, head_v, head_w)."""
        areas = (dets[:, 2] - dets[:, 0]) * (dets[:, 3] - dets[:, 1])
        best = int(np.argmax(areas))

        # Head-position proxy (normalized by image width) for parallax compensation.
        fh, fw = frame_bgr.shape[:2]
        bx1, by1, bx2, by2 = (float(v) for v in dets[best, :4])
        head_u = ((bx1 + bx2) / 2.0 - fw / 2.0) / fw
        head_v = ((by1 + by2) / 2.0 - fh / 2.0) / fw
        head_w = max(0.0, bx2 - bx1) / fw

        x1, y1 = max(0, int(bx1)), max(0, int(by1))
        x2, y2 = min(fw, int(bx2)), min(fh, int(by2))
        if x2 <= x1 or y2 <= y1:
            return None
        crop = frame_bgr[y1:y2, x1:x2]
        return crop, float(max(0.0, areas[best])), head_u, head_v, head_w

    # ── Gaze inference ───────────────────────────────────────────────────────

    def _gaze_forward(self, batch: torch.Tensor) -> torch.Tensor:
        """
        Gaze branch only: backbone → fc_gaze → gaze_regressor. The full MTL
        forward also runs the emotion and AU heads (graph attention) whose
        outputs we discard. Falls back to the full forward if the model layout
        ever changes.
        """
        mtl = self._model.model
        try:
            features = mtl.base_model(batch)
            return mtl.gaze_regressor(mtl.relu(mtl.fc_gaze(features)))
        except AttributeError:
            _emotion, gaze, _au = mtl(batch)
            return gaze

    def _predict_gaze_batch(self, crops: list[np.ndarray]) -> np.ndarray:
        """N face crops → (N, 2) [yaw, pitch] via a single batched MTL forward."""
        tensors = [self._model.preprocess(c) for c in crops]  # each (1, 3, 224, 224)
        batch = torch.cat(tensors, dim=0)
        with torch.no_grad():
            gaze = self._gaze_forward(batch)
        g = gaze.detach().float().cpu().numpy().reshape(len(crops), -1)
        if g.shape[1] == 2:
            return g
        if g.shape[1] == 4:  # per-eye (l_yaw, l_pitch, r_yaw, r_pitch) → average
            return np.stack([(g[:, 0] + g[:, 2]) / 2, (g[:, 1] + g[:, 3]) / 2], axis=1)
        raise ValueError(f"Unexpected gaze output width {g.shape[1]}")

    def infer_batch(self, frames: list[np.ndarray]) -> list[FrameGaze | None]:
        """
        Run gaze inference on a list of BGR frames with one batched MTL forward.
        Returns one entry per input frame; None where no face was detected.
        """
        results: list[FrameGaze | None] = [None] * len(frames)
        crops: list[np.ndarray] = []
        metas: list[tuple[float, float, float, float]] = []
        idxs: list[int] = []
        for i, frame in enumerate(frames):
            dets = self._detect_faces(frame)
            if dets is None:
                continue
            extracted = self._crop_dominant(frame, dets)
            if extracted is None:
                continue
            crop, bbox_area, head_u, head_v, head_w = extracted
            crops.append(crop)
            metas.append((bbox_area, head_u, head_v, head_w))
            idxs.append(i)

        if not crops:
            return results

        try:
            gaze = self._predict_gaze_batch(crops)
        except Exception:  # noqa: BLE001
            logger.exception("Batched gaze forward failed — falling back to per-crop")
            rows = []
            for crop in crops:
                _emotion, gaze_output, _au = self._model.predict(crop)
                rows.append(gaze_output.detach().float().cpu().numpy().reshape(-1)[:2])
            gaze = np.asarray(rows)

        for i, crop, (bbox_area, head_u, head_v, head_w), (yaw, pitch) in zip(
            idxs, crops, metas, gaze,
        ):
            results[i] = FrameGaze(
                yaw=float(yaw), pitch=float(pitch), bbox_area=bbox_area,
                quality=eye_region_glare_quality(crop),
                head_u=head_u, head_v=head_v, head_w=head_w,
            )
        return results

    def infer(self, frame_bgr: np.ndarray) -> FrameGaze | None:
        """
        Run gaze inference on one OpenCV BGR frame.
        Returns None when no face is detected.
        When multiple faces are present, returns the largest (dominant / closest).
        """
        return self.infer_batch([frame_bgr])[0]
