"""
Smoke test for the OpenFace gaze model — confirm weights load and inference works
on the GPU box, before worrying about full sessions / calibration.

Usage (inside the container, with weights mounted):
    python3 -m app.smoke /data/face.jpg          # single image
    python3 -m app.smoke /data/clip.webm          # video: detection rate + sample gaze

Reports: face-detection rate, sample gaze in degrees, and eye-region glare quality
(so glasses wearers can see how much glare the new detector is catching).
"""
from __future__ import annotations

import math
import sys

import cv2
import numpy as np

from .gaze_model import GazeModel

_IMG_EXT = (".jpg", ".jpeg", ".png", ".bmp")


def _deg(rad: float) -> float:
    return rad * 180.0 / math.pi


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: python3 -m app.smoke <image_or_video>")
        raise SystemExit(2)
    path = sys.argv[1]

    print("Loading OpenFace 3.0 …")
    model = GazeModel()
    print(f"Model loaded on {model.device}.\n")

    if path.lower().endswith(_IMG_EXT):
        frame = cv2.imread(path)
        if frame is None:
            print(f"Could not read image: {path}"); raise SystemExit(1)
        g = model.infer(frame)
        if g is None:
            print("NO FACE detected — check lighting / framing / that a face is present.")
            raise SystemExit(1)
        print(f"Face detected. gaze yaw={_deg(g.yaw):+.1f}°  pitch={_deg(g.pitch):+.1f}°  "
              f"glare_quality={g.quality:.2f}  (1=clean, <1=lens glare)")
        return

    # Video: sample frames, report detection rate + gaze spread + glare prevalence.
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        print(f"Could not open video: {path}"); raise SystemExit(1)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    stride = max(1, total // 60) if total else 5   # ~60 sampled frames
    n_seen = n_face = 0
    yaws: list[float] = []
    pitches: list[float] = []
    quals: list[float] = []
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % stride == 0:
            n_seen += 1
            g = model.infer(frame)
            if g is not None:
                n_face += 1
                yaws.append(_deg(g.yaw)); pitches.append(_deg(g.pitch)); quals.append(g.quality)
        idx += 1
    cap.release()

    if n_seen == 0:
        print("No frames decoded."); raise SystemExit(1)
    rate = 100.0 * n_face / n_seen
    print(f"Sampled {n_seen} frames — face detected in {n_face} ({rate:.0f}%).")
    if n_face:
        print(f"  yaw   range {min(yaws):+.1f}°..{max(yaws):+.1f}°")
        print(f"  pitch range {min(pitches):+.1f}°..{max(pitches):+.1f}°")
        glare = sum(1 for q in quals if q < 0.6)
        print(f"  glare frames (quality<0.6): {glare}/{n_face} ({100*glare/n_face:.0f}%)")
    if rate < 70:
        print("\n⚠ Low detection rate — improve lighting / framing, or the recording "
              "codec may be too compressed (check bitrate; see EXPERT_ACCURACY_ASSESSMENT §1.1).")


if __name__ == "__main__":
    main()
