"""
Frame geometry helpers, kept free of the OpenFace import chain.

`gaze_model` pulls in OpenFace and its vendored RetinaFace at import time, so
pure image maths that wants a real-cv2 test has to live outside it.
"""
from __future__ import annotations

import cv2
import numpy as np


def downscale_for_detection(
    frame_bgr: np.ndarray, max_width: int,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Return (image to run face detection on, [sx, sy, sx, sy] mapping box
    coordinates in that image back to `frame_bgr`).

    Face detection cost grows with frame area while a face bounding box is a
    coarse object: RetinaFace localises it just as well at 640 px wide, and the
    face crop is still taken from the full-resolution frame afterwards, so
    nothing the gaze model sees is degraded. This matters now that capture is
    1080p — 2.25x the pixels of 720p — and doubly so on Apple-Silicon MPS, where
    detection is the slowest stage of the pipeline.

    The scale factors are derived from the resulting shape rather than the
    requested ratio, and kept per-axis: preserving aspect ratio still rounds the
    new height to an integer, so one shared factor would put a sub-pixel skew
    into every vertical box coordinate.

    Frames already at or below `max_width` are returned untouched, with unit
    factors — no copy, no interpolation.
    """
    h, w = frame_bgr.shape[:2]
    if w <= max_width:
        return frame_bgr, np.ones(4, dtype=np.float32)
    new_h = max(1, round(h * max_width / w))
    # INTER_AREA is the correct kernel for shrinking: it averages the source
    # pixels that fall in each destination pixel instead of point-sampling, so
    # a small face doesn't alias away before the detector ever sees it.
    small = cv2.resize(frame_bgr, (max_width, new_h), interpolation=cv2.INTER_AREA)
    sx = w / float(small.shape[1])
    sy = h / float(small.shape[0])
    return small, np.array([sx, sy, sx, sy], dtype=np.float32)
