"""
Compute-device selection, kept free of heavy imports.

`gaze_model` pulls in OpenFace and its vendored RetinaFace at import time, so
anything that only needs to *name* the device — the /health endpoint above all —
must not go through it. /health has to answer even on a box where the weights or
the openface package are missing; that is precisely when someone is checking it.
"""
from __future__ import annotations

import os

import torch


def resolve_device() -> str:
    """
    Best available torch device: CUDA, then Apple-Silicon MPS, then CPU.

    MPS matters because this backend is perfectly usable on an M-series Mac —
    the work is offline, so minutes per session are fine — but the Docker image
    is CUDA-only and Docker Desktop on macOS cannot reach the GPU at all. On a
    Mac the service has to run natively, and then this picks up the GPU with no
    configuration.

    OPENFACE_DEVICE overrides everything (e.g. "cpu" when an MPS kernel is
    missing and the CPU fallback is not wanted).
    """
    override = os.environ.get("OPENFACE_DEVICE")
    if override:
        return override
    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available() and mps.is_built():
        return "mps"
    return "cpu"
