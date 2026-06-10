# Offline Gaze Backend (L2CS-Net)

High-accuracy, **GPU-side, non-real-time** gaze processing for the eye-tracker.

The browser keeps using MediaPipe for the live cursor during a test. After the
session, the **recorded video** is sent here. This service runs L2CS-Net per
frame, re-fits the calibration mapping from the recorded calibration dots, maps
the whole trace to screen pixels, and extracts oculomotor biomarkers
(saccade peak velocity, fixation duration, BCEA, …) that feed scoring and the
future concussion classifier.

> **Status: not yet validated on GPU.** The code is written against the real
> L2CS-Net / OpenCV / FastAPI APIs but has not been run here (this dev box has no
> CUDA, torch, or model weights). First-run validation must happen on the Bradford
> GPU server — see "Smoke test" below.

## Why offline / not real-time

- No network-latency pressure → highest model quality per frame.
- Reaction times use **client-side capture timestamps**, so accuracy is unaffected
  by processing speed.
- Old sessions can be **re-processed** when the model improves.

## Layout

```
backend/
  app/
    main.py         FastAPI: POST /process, GET /health
    gaze_model.py   L2CS-Net wrapper (per-frame yaw/pitch)
    video.py        decode video -> per-frame gaze + timestamps
    calibration.py  fit (yaw,pitch)->(x,y) mapping from recorded calib dots
    events.py       I-VT event detection + biomarkers
    schemas.py      request/response models
  Dockerfile
  requirements.txt
```

## Setup on the Bradford GPU server

1. **Get model weights.** Download `L2CSNet_gaze360.pkl` from the L2CS-Net Google
   Drive (linked in https://github.com/Ahmednull/L2CS-Net) into `./models/`.
   Gaze360 weights generalise best to unconstrained webcam video.

2. **Build & run** (Docker with NVIDIA runtime):
   ```bash
   docker build -t gaze-backend .
   docker run --gpus all -p 8000:8000 \
     -v $(pwd)/models:/models gaze-backend
   ```
   Match the `FROM nvidia/cuda:12.1.1` tag + the torch `cu121` index in the
   Dockerfile to the server's driver (`nvidia-smi`).

3. **Smoke test:**
   ```bash
   curl localhost:8000/health      # -> {"cuda": true, ...}
   ```
   Then post a short recorded clip + a calibration payload to `/process` and
   confirm `calibration_train_rmse_px` is small (tens of px) and biomarkers look
   sane (e.g. saccade_peak_velocity_deg_s in the hundreds).

## Request shape (`POST /process`, multipart/form-data)

- `file`: recorded webcam video **that includes the calibration phase**.
- `payload`: JSON string, e.g.
  ```json
  {
    "calibration_dots": [
      {"screen_x": 192, "screen_y": 108, "t_start_ms": 1200, "t_end_ms": 2400},
      ...
    ],
    "screen": {"width_px": 1920, "height_px": 1080, "width_cm": 34.5,
               "viewing_distance_cm": 60},
    "frame_stride": 1,
    "saccade_velocity_threshold_deg_s": 30
  }
  ```
- `include_trace` (bool): set true to also return the full mapped gaze trace.

## ⚠️ Two integration requirements on the Next.js / browser side

1. **The recorded video must cover calibration.** The backend re-fits calibration
   from the video, so recording has to start *before* the calibration dots, not
   only at test start. Verify what `enableVideoRecording` currently captures.
2. **The browser must emit per-dot windows** — each calibration dot's screen
   `(x, y)` and the `[t_start_ms, t_end_ms]` of its fixation, **on the same clock
   as the video timestamps**. The browser already knows dot positions and capture
   windows; this just needs to be logged and sent alongside the upload.

## Model choice note

L2CS-Net (MIT) is used because it has a clean per-frame API and a commercial-
friendly licence. GazeFollower has higher headline accuracy but is GUI/live-
oriented, its best (32M-image) weights are gated, and its licence is
NonCommercial — fine for the dissertation, a blocker for a product. The pipeline
is model-agnostic (calibration is re-fit on raw gaze), so swapping the model in
`gaze_model.py` later is low-effort.
