"""
L2CS-Net wrapper — per-frame gaze inference.

L2CS-Net outputs a 3D gaze direction (yaw, pitch) in radians per detected face.
We do NOT convert to screen coordinates here — that mapping is fit per-session
from the recorded calibration segment (see calibration.py), which makes the
whole pipeline model-agnostic.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import torch
from l2cs import Pipeline

logger = logging.getLogger(__name__)


@dataclass
class FrameGaze:
    yaw: float    # radians, + = looking to subject's right
    pitch: float  # radians, + = looking up
    bbox_area: float  # face bbox area (px²) — used to pick the dominant face


class GazeModel:
    def __init__(self, weights_path: str, arch: str = "ResNet50", device: str | None = None):
        self.device = torch.device(
            device or ("cuda" if torch.cuda.is_available() else "cpu")
        )
        logger.info("Loading L2CS-Net (%s) on %s from %s", arch, self.device, weights_path)
        self.pipeline = Pipeline(weights=weights_path, arch=arch, device=self.device)

    def infer(self, frame_bgr: np.ndarray) -> FrameGaze | None:
        """
        Run gaze inference on one OpenCV BGR frame.
        Returns None when no face is detected (L2CS raises ValueError in that case).
        When multiple faces are present, returns the largest (closest to camera).
        """
        try:
            results = self.pipeline.step(frame_bgr)
        except ValueError:
            return None  # no face detected this frame

        if results is None or results.pitch is None or len(results.pitch) == 0:
            return None

        # results.bboxes: (N, 4) [x_min, y_min, x_max, y_max]; pick largest face.
        if results.bboxes is not None and len(results.bboxes) > 0:
            areas = [
                max(0.0, (b[2] - b[0])) * max(0.0, (b[3] - b[1]))
                for b in results.bboxes
            ]
            idx = int(np.argmax(areas))
            area = float(areas[idx])
        else:
            idx, area = 0, 0.0

        return FrameGaze(
            yaw=float(results.yaw[idx]),
            pitch=float(results.pitch[idx]),
            bbox_area=area,
        )
