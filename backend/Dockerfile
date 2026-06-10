# GPU inference image for the offline gaze backend.
# Base: CUDA runtime + cuDNN. Match the CUDA version to the Bradford server's driver
# (check with `nvidia-smi`; 12.1 works with recent drivers).
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3-pip git libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CUDA-enabled torch FIRST so the l2cs git dep doesn't drag in CPU wheels.
# Pick the index-url matching the base CUDA (cu121 here).
RUN pip3 install --no-cache-dir \
        torch==2.3.1 torchvision==0.18.1 --index-url https://download.pytorch.org/whl/cu121

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY app ./app

# Model weights are mounted at runtime (not baked in) — see README.
ENV L2CS_WEIGHTS=/models/L2CSNet_gaze360.pkl

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
