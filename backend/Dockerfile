# GPU inference image for the offline gaze backend.
# Base: CUDA runtime + cuDNN. Match the CUDA version to the server's driver
# (check with `nvidia-smi`; 12.1 works with recent drivers ≥ 525).
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3-pip python-is-python3 git libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CUDA-enabled torch FIRST so pip doesn't pull CPU wheels when
# installing openface-test (which lists torch as a dependency).
#
# cu128 wheels: required for Blackwell GPUs (RTX 50-series, sm_120) — older
# cu121/torch 2.3 wheels have no kernels for sm_120 ("no kernel image available
# for execution on the device"). The wheel bundles its own CUDA 12.8 runtime, so
# it runs on this 12.1 base image as long as the host driver is R570+ (which any
# Blackwell card requires anyway). For older GPUs, cu128 still works fine.
RUN pip3 install --no-cache-dir \
        torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu128

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY app ./app

# Model weights are mounted at runtime — not baked into the image.
# Download them directly from HuggingFace into backend/models/openface (see
# README "Get model weights"); do NOT pip install openface-test on the host
# (it pins Pillow 9.4 / numpy 1.26 and breaks modern envs).
ENV OPENFACE_WEIGHTS=/models/openface

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
