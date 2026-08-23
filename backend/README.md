# Offline Gaze Backend

High-accuracy, **GPU-side, non-real-time** gaze processing for the eye-tracker.

For the end-to-end offline-mode test checklist and visual QA workflow, see
[`../docs/OFFLINE_MODE_TESTING.md`](../docs/OFFLINE_MODE_TESTING.md).

The browser uses MediaPipe for the live cursor during a test. After the session
the **recorded video** is sent here. This service runs a deep gaze model per
frame, re-fits the calibration mapping from the recorded calibration dots, maps
the whole trace to screen pixels, and extracts oculomotor biomarkers
(saccade peak velocity, fixation duration, BCEA, …) for scoring and the
concussion classifier.

---

## Architecture overview

```
POST /process (multipart: video + JSON payload)
        │
        ▼
  video.py — decode video → per-frame BGR frames
        │
        ▼
  gaze_model.py — OpenFace 3.0 per-frame inference
        │  FaceDetector (RetinaFace) → crop face
        │  MultitaskPredictor        → (yaw, pitch) in radians
        ▼
  calibration.py — fit (yaw, pitch) → (screen_x, screen_y) px
        │  per calibration dot: median yaw/pitch over dwell window
        │  model: 2nd-order polynomial Ridge (sklearn)
        ▼
  head_comp.py — first-order parallax compensation
        │  face-bbox head position vs its calibration reference
        │  → shift mapped points by the head displacement (cm → px)
        ▼
  events.py — I-VT event detection
        │  velocity in deg/s via screen geometry + viewing distance
        │  → saccades, fixations, BCEA
        ▼
  schemas.py → ProcessResponse (biomarkers + optional trace)
```

---

## Gaze model: OpenFace 3.0

**Why the switch from L2CS-Net:**

| | L2CS-Net (old) | OpenFace 3.0 (current) |
|---|---|---|
| MPIIGaze error | 3.92° | **2.56°** |
| Gaze360 error | 10.41° | 10.6° |
| Architecture | ResNet50 + classification head | ResNet + multitask (gaze + AU + landmarks + emotion) |
| Weights source | Google Drive (.pkl) | HuggingFace (`nutPace/openface_weights`) |
| Install | `l2cs` pip (git dep) | `openface-test` pip |

The calibration pipeline (polynomial Ridge fit on raw yaw/pitch) is model-agnostic,
so swapping the model only touches `gaze_model.py`.

**API note — FaceDetector takes a file path, not a numpy array.** For video frames
we write each frame to a single reused `/tmp` JPEG before detection. This adds
~0.5 ms/frame (negligible offline). See `gaze_model.py` for the implementation.

---

## File layout

```
backend/
  app/
    main.py         FastAPI: POST /process, GET /health
    gaze_model.py   OpenFace 3.0 wrapper (per-frame yaw/pitch + eye-region glare quality)
    video.py        decode video → per-frame gaze + quality + timestamps
    calibration.py  fit (yaw,pitch)→(x,y): gaze-contingent windows, glare-robust, CV-tuned
    head_comp.py    first-order head-translation (parallax) compensation + motion stats
    personalize.py  EXPERIMENTAL per-subject gaze-head fine-tuning (safety-gated)
    validation.py   held-out accuracy report (px + degrees, by region, glasses vs clean,
                    raw vs head-compensated)
    events.py       I-VT event detection + biomarkers
    reprocess.py    batch CLI: video + meta.json → biomarkers + accuracy report (offline)
    reprocess_example.json   metadata schema example
    schemas.py      request/response models
  tests/            synthetic test suites — run WITHOUT GPU/OpenFace weights:
                    python -m tests.test_head_comp      (parallax math)
                    python -m tests.test_pipeline_stub  (end-to-end, stub model)
                    python -m tests.test_infer_batch    (batching glue, stubbed openface)
                    python -m tests.test_personalize    (fine-tuning, fake torch net)
  Dockerfile
  requirements.txt
  README.md         ← this file
```

---

## Setup on the GPU server

### 1. Prerequisites

- Docker with NVIDIA runtime (`--gpus all`)
- `nvidia-smi` shows driver ≥ 525 (matches CUDA 12.1 in the Dockerfile)

### 2. Get model weights

OpenFace 3.0 weights are on HuggingFace (`nutPace/openface_weights`). Download
once into `backend/models/openface` (compose mounts it into the container).

**Do NOT `pip install openface-test` on the host to get weights** — that package
hard-pins `Pillow==9.4.0` / `numpy==1.26.4` / `opencv==4.11` … which has no wheel
on modern Python (forces a source build that needs libjpeg) and would downgrade
your env. The container already has it working; you only need the files.

```bash
# Option A — direct download (no openface-test, no compile). Recommended.
mkdir -p ./models/openface && cd ./models/openface
base="https://huggingface.co/nutPace/openface_weights/resolve/main"
for f in Alignment_RetinaFace.pth MTL_backbone.pth Landmark_68.pkl \
         Landmark_98.pkl mobilenetV1X0.25_pretrain.tar; do
  curl -L -o "$f" "$base/$f"
done

# Option B — let the (working) container's openface CLI fetch them
docker run --rm -v "$PWD/models/openface:/models/openface" \
  gaze-backend openface download --output /models/openface
```

Files: `Alignment_RetinaFace.pth` (detector) + `MTL_backbone.pth` (gaze model) are
what `gaze_model.py` loads; the `Landmark_*.pkl` / mobilenet pretrain are pulled by
RetinaFace internally, so keep all five in the folder.

### 3. Build and run (Docker Compose — recommended)

`docker-compose.yml` mounts two host folders so you never `docker cp`:
`backend/models/openface` (weights) and `backend/data` (videos / images / meta /
reports). Put the weights from step 2 into `backend/models/openface`, then:

```bash
cd backend
mkdir -p data models/openface           # weights go in models/openface (step 2)
docker compose up -d --build            # API on :8000 with GPU + mounts
docker compose logs -f                  # watch logs (Ctrl-C to stop watching)
```

Anything you drop in `backend/data/` on the host appears at `/data` in the
container, and reports written to `/data` show up back on the host.

### 4. Smoke test — confirm OpenFace + GPU actually work

```bash
# (a) Health — must show device: cuda (or mps on an Apple-Silicon Mac)
curl localhost:8000/health

# (b) Run the model on one face image or a short clip (drop it in backend/data first)
docker compose exec gaze-backend python3 -m app.smoke /data/face.jpg
docker compose exec gaze-backend python3 -m app.smoke /data/clip.webm

# (c) Full offline pipeline on a video + metadata (see "Batch reprocessing" below)
docker compose exec gaze-backend python3 -m app.reprocess \
  --video /data/clip.webm --meta /data/meta.json --out /data/report.json
```

`app.smoke` prints the face-detection rate, sample gaze in degrees, and the
eye-region glare quality (glasses wearers: shine a light on the lens and watch
`glare_quality` drop below 1.0 — that's the new specular-glare detector).

Expected response sanity checks:
- `calibration_loocv_px` — the **honest** accuracy number (leave-one-dot-out). Tens
  of px; divide by `px_per_degree` for visual angle. `calibration_train_rmse_px` is
  in-sample (optimistic). `calibration_region_errors_px` shows center/edge/corner.
- `biomarkers.saccade_peak_velocity_deg_s` — 200–600 deg/s for healthy saccades
- `biomarkers.bcea_deg2` — < 5 deg² for healthy fixation stability

---

## Run natively (no Docker)

Docker just isolates `openface-test`'s old pinned deps (Pillow 9.4 / numpy 1.26 /
opencv 4.11 …). You can run on the host instead — but use a **dedicated Python
3.10 env** (those pinned wheels exist for 3.10, so nothing compiles) and **do not
install into another project's env**.

```bash
conda create -y -n gaze python=3.10
conda activate gaze
# Blackwell (RTX 50-series) needs cu128; fine for older GPUs too.
pip install torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt        # fastapi/uvicorn + openface-test + numpy/opencv/sklearn…

# Run from backend/ so OpenFace's hardcoded ./weights/* paths resolve,
# and point OPENFACE_WEIGHTS at the downloaded weights.
cd backend
export OPENFACE_WEIGHTS=$PWD/models/openface
python -m app.smoke ./data/face.jpg                      # quick check
python -m app.reprocess --video ./data/clip.webm --meta ./data/meta.json --out ./data/report.json
uvicorn app.main:app --host 0.0.0.0 --port 8000          # or run the API
```

Force CPU if the torch build lacks kernels for a very new GPU: `OPENFACE_DEVICE=cpu`.

### Apple Silicon (M-series Mac)

**Do not use Docker on macOS.** Docker Desktop cannot reach the Mac GPU at all —
there is no CUDA, and MPS is not passed into containers — so a containerised run
falls back to CPU and is several times slower than it needs to be. Run natively
and the backend picks up the GPU through Metal (MPS) on its own.

```bash
conda create -y -n gaze python=3.10
conda activate gaze
pip install torch torchvision            # macOS arm64 wheels are MPS-enabled by default
pip install -r requirements.txt

cd backend
export OPENFACE_WEIGHTS=$PWD/models/openface
python -m app.smoke ./data/face.jpg      # prints "Model loaded on mps."
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`GET /health` must report `"device": "mps"`. If it reports `"cpu"`, torch was
built without MPS (check `python -c "import torch; print(torch.backends.mps.is_built())"`)
or `OPENFACE_DEVICE` is set.

A few operators still have no MPS kernel. `GazeModel` sets
`PYTORCH_ENABLE_MPS_FALLBACK=1` so those run on the CPU instead of aborting the
session — for an offline batch job that trade is obviously right. If you would
rather see the failure than the slowdown, set `PYTORCH_ENABLE_MPS_FALLBACK=0`
before starting; if MPS misbehaves entirely, `OPENFACE_DEVICE=cpu` still works
and is only a few times slower, which for offline processing is survivable.

Face detection dominates runtime on MPS, so it runs on a copy of each frame
downscaled to `GAZE_DETECT_WIDTH` (640 px) while the face crop still comes from
the full-resolution frame — same accuracy, much less work. Raise it if faces are
unusually small in frame or very far from the camera.

---

## Batch reprocessing + accuracy report (offline analysis path)

This is the **dissertation/dataset path**: process a recorded session video into
the *authoritative* biomarkers and a truthful accuracy report, decoupled from the
live test UX (OpenFace per-frame inference takes minutes/video — too slow to block
a user, fine for batch).

```bash
# inside the container / env with OpenFace weights available
python3 -m app.reprocess \
  --video  /data/session_001.webm \
  --meta   /data/session_001.json \
  --out    /data/session_001.report.json
```

`--meta` schema: see `app/reprocess_example.json`. It carries the screen geometry,
the **calibration_dots** ([t_start_ms, t_end_ms] windows on the video clock), and
optional **validation_dots** (held-out targets the subject fixated but that were
*not* used to fit the map — these give the truthful accuracy in `validation`).

The report's `validation` block reports error in **px and degrees of visual angle**,
broken down by screen **region** (center/edge/corner) and split **glasses vs clean**
(by eye-region glare quality) — so you can show, with numbers, both the accuracy and
whether glasses still hurt.

> **Measure glasses impact:** run the same subject twice (with/without glasses),
> set `"glasses": true/false` in each meta, and compare `validation.overall_deg`.

---

## Request format (`POST /process`, multipart/form-data)

| Field | Type | Description |
|---|---|---|
| `file` | binary | Recorded webcam video. **Must include the calibration phase.** |
| `payload` | JSON string | See `ProcessRequest` in `schemas.py` |
| `include_trace` | bool | If true, returns full gaze trace (large; use for debugging) |

Minimal `payload` example:
```json
{
  "calibration_dots": [
    {"screen_x": 192, "screen_y": 108, "t_start_ms": 1200, "t_end_ms": 2400},
    {"screen_x": 960, "screen_y": 540, "t_start_ms": 3600, "t_end_ms": 4800}
  ],
  "screen": {
    "width_px": 1920,
    "height_px": 1080,
    "width_cm": 34.5,
    "viewing_distance_cm": 60
  },
  "frame_stride": 1,
  "saccade_velocity_threshold_deg_s": 30
}
```

---

## Getting a real session in (frontend exporter)

The frontend records the calibration+validation video and now also emits the
matching `meta.json` (per-dot `[t_start_ms, t_end_ms]` windows on the video clock,
plus screen geometry). Implemented in `lib/calibrationMeta.ts`
(`CalibrationMetaRecorder`) + hooks in `App.tsx`.

**To capture a real session for offline measurement:**

1. Open the app with `?exportMeta=1` in the URL.
2. Run the calibration + validation phase as normal.
3. Two files download automatically: `session-<ts>.webm` and `session-<ts>.meta.json`.
4. Drop both into `backend/data/`, then:

```bash
conda activate gaze && cd backend
python -m app.reprocess --video ./data/session-<ts>.webm \
                        --meta  ./data/session-<ts>.meta.json \
                        --out   ./data/report.json
```

5. Read `report.json` → `validation.overall_deg` / `region_deg` = your **real**
   accuracy (in degrees, by screen region, glasses vs clean). This is the number
   that matters — not the synthetic estimates.

> Set `screen.width_cm` in the meta to your monitor's real physical width for
> accurate degree units (default 34.5; edit the exported file or the constant in
> `App.tsx`). Pixel accuracy is unaffected by it.

The clock is `recorder.start()`; the backend takes a robust median over each
window after dropping the approach transient, so the small (<~100 ms) recorder
startup latency does not shift the calibration center.

---

## Offline replay / visual QA

Numbers are necessary but not enough. For debugging a real session, generate a
side-by-side replay: webcam video on the left, backend screen-space gaze on the
right, synchronized by timestamp.

```bash
# 1) Reprocess with per-frame debug trace included.
python -m app.reprocess --video ./data/session-<ts>.webm \
                        --meta  ./data/session-<ts>.meta.json \
                        --out   ./data/report.json \
                        --include-trace

# 2) Generate a self-contained HTML viewer next to the video.
python -m app.replay --video  ./data/session-<ts>.webm \
                     --meta   ./data/session-<ts>.meta.json \
                     --report ./data/report.json \
                     --out    ./data/offline-replay.html
```

Open `data/offline-replay.html` in a browser. Use it to verify:

- active calibration/validation dots line up with the subject's fixation in the
  video;
- the gaze dot lands near the expected target after the settling phase;
- missing/glare frames are visibly gated instead of creating fake saccades;
- head-compensation improves validation (`raw no-comp` vs `validation error`) and
  does not overcorrect.

Inside Docker:

```bash
docker compose exec gaze-backend python3 -m app.reprocess \
  --video /data/session-<ts>.webm --meta /data/session-<ts>.meta.json \
  --out /data/report.json --include-trace

docker compose exec gaze-backend python3 -m app.replay \
  --video /data/session-<ts>.webm --meta /data/session-<ts>.meta.json \
  --report /data/report.json --out /data/offline-replay.html
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENFACE_WEIGHTS` | `/models/openface` | Directory with `Alignment_RetinaFace.pth` and `MTL_backbone.pth` |
| `OPENFACE_DEVICE` | auto (`cuda` → `mps` → `cpu`) | Force `cpu`/`cuda`/`mps` (e.g. torch build lacks kernels for a very new GPU) |
| `GAZE_BATCH_SIZE` | `16` | Frames per batched gaze forward in `video.py` (lower it on small-VRAM GPUs) |
| `GAZE_DETECT_WIDTH` | `640` | Width frames are downscaled to for face detection; the crop still comes from the full-resolution frame |
| `PYTORCH_ENABLE_MPS_FALLBACK` | `1` (set automatically on MPS) | Run MPS-unsupported ops on the CPU instead of raising |

---

## What's done / what's next

### Done (current state)
- [x] OpenFace 3.0 replaces L2CS-Net in `gaze_model.py` (~35% angular error improvement)
- [x] Savitzky-Golay non-causal smoothing in `video.py` — zero phase lag, preserves saccade timing
- [x] **Max-accuracy calibration** (`calibration.py`): offline gaze-contingent within-window
      selection (drops the approach transient), glare-robust MAD aggregation, feature
      standardisation + CV-tuned polynomial degree & Ridge alpha, leave-one-dot-out error
      and per-region (center/edge/corner) report
- [x] **Glasses at the source**: real specular-highlight quality score on the eye region
      (`eye_region_glare_quality`, *not* EAR) → glare frames excluded from calibration and
      gated out of the scored trace (`video.py` → `main.py`)
- [x] **Held-out accuracy report** in px + degrees, by region, glasses vs clean (`validation.py`)
- [x] **Batch reprocessing CLI** (`reprocess.py`) — the offline analysis path
- [x] `calibration_outlier_sigma` exposed in `ProcessRequest` — tunable per session
- [x] `calibration_{loocv_px,region_errors_px,degree,dots_used,dots_total}` in `ProcessResponse`
- [x] I-VT event detection + biomarkers (`events.py`)
- [x] FastAPI `/process` endpoint
- [x] **First-order head-translation (parallax) compensation** (`head_comp.py`):
      per-frame head position from the RetinaFace bbox (center + width, pinhole
      back-projection with assumed webcam HFOV) → every mapped gaze point is shifted
      by the head displacement since calibration. Applied in both `/process` and
      `reprocess.py`; the validation report shows **raw vs compensated** error
      (`overall_px_raw` vs `overall_px`) so the correction is judged on held-out data,
      and `head.motion` quantifies how much the head actually drifted (cm).
      Tunables: `head_compensation` (default true), `camera_hfov_deg` (60),
      `head_comp_gain` (1.0; set 0 to disable, tune if the A/B shows over/under-correction).
      Synthetic tests: `python -m tests.test_head_comp` (pure numpy — no GPU needed).
- [x] **Batched + in-memory GPU inference** (`gaze_model.py`, `video.py`):
      `GazeModel.infer_batch()` collects the dominant-face crops of a chunk of
      frames (`GAZE_BATCH_SIZE`, default 16) and runs ONE batched MTL forward —
      gaze branch only (the discarded emotion + graph-attention AU heads are no
      longer computed). Face detection now runs **in-memory** (the file-path
      limitation was just `cv2.imread` inside the library): no more per-frame
      JPEG write+read round trip — which also removes JPEG compression loss from
      the detector input — with RetinaFace anchor priors cached per video size
      instead of regenerated per frame, and the unused landmark decode skipped.
      Detections below `vis_threshold` can no longer win dominant-face selection
      (previously any >0.02-confidence box was eligible). cuDNN benchmark mode
      is enabled on CUDA (fixed input sizes). Every step falls back to the
      original per-frame/library path on failure. `infer()` (smoke.py) is now a
      batch of 1. Tests: `python -m tests.test_infer_batch` (stubbed OpenFace —
      no GPU needed).
- [x] **Per-subject personalization** (`personalize.py`, EXPERIMENTAL — needs
      GPU validation on real sessions): few-shot fine-tuning of the gaze branch
      (fc_gaze + gaze_regressor, backbone frozen) on the session's own
      calibration-dot crops. Targets are geometric eye→dot angles robustly
      aligned to the model's own output convention (aborts if |corr| < 0.8, so
      wrong labels can't poison the net). AdamW + mild photometric augmentation
      + early stopping on dots held out of training. **Safety-gated**: reprocess
      snapshots the gaze head, re-infers + refits after fine-tuning, and keeps
      the personalized pass only if it beats the baseline on held-out validation
      dots (else calibration LOOCV) — a failed fine-tune can never degrade a
      report. Enable with `--personalize` or `"personalize": true` in the meta;
      the report gains a `personalization` block (corr, epochs, val L1
      before/after, baseline vs personalized held-out px, kept true/false).
      Offline CLI only — never mutates the shared model in the API server.
      Tests: `python -m tests.test_personalize` (fake torch model — no GPU).

### Remaining improvements (future work)

#### 1. Deeper throughput work (only if batching isn't enough)

After the batched/in-memory changes above, the remaining sequential CPU work per
frame is video decode (`cap.read()`), the RetinaFace decode/NMS (numpy), and the
crop preprocessing. Next levers, in order of effort:
1. **Pipeline decode with inference** — a producer thread reading frames while
   the GPU processes the previous chunk (overlaps the two dominant costs).
2. **Batch the RetinaFace forward too** — all frames of a video share one
   resolution, so N frames can go through the detector in one forward; decode +
   NMS stay per-frame on CPU.
3. Replace `FaceDetector` with a faster array-native detector
   (e.g. `insightface`, `facenet-pytorch`) if RetinaFace-mobilenet remains the
   bottleneck.

#### 2. Temporal model — USGaze / ARGaze (high complexity, ~1–2 weeks)

Replace per-frame OpenFace inference with a **video-level** model that processes
a sliding window of frames and outputs per-frame gaze jointly. This eliminates
the frame-by-frame approach entirely and can capture saccade dynamics directly.

**Options**:
- **USGaze** (Mar 2026, MDPI Electronics, arxiv-style): state-space model (Mamba)
  for temporal gaze estimation. Achieves better angular accuracy AND temporal
  consistency than per-frame models.
- **ARGaze** (CVPR 2025, arxiv 2602.05132): autoregressive transformer for online
  egocentric gaze.

**What to do**: check if either has a usable pre-trained checkpoint and Python
inference API. If yes, replace the body of `video.py:process_video()` to feed
frame windows to the model. `calibration.py` and `events.py` remain unchanged
since they consume raw `(t_ms, yaw, pitch)` arrays.

#### 3. Full 3D head pose / ray-screen intersection (upgrade of the shipped first-order fix)

The **first-order** parallax compensation is done (`head_comp.py`, see "Done"):
lateral head translation — the dominant term — is corrected geometrically from
the face bbox. What a full 3D treatment would still add: head *rotation*
compensation (PnP on the 68 landmarks → true 6-DoF pose), exact handling of
large distance changes (offset scaling around the head-projection point), and a
calibrated camera (intrinsics) instead of the HFOV assumption. Go here only if
the raw-vs-compensated validation A/B on real sessions shows a remaining
head-motion-correlated residual.

#### 4. Personalization upgrades (after GPU validation of the shipped version)

The experimental few-shot fine-tune is done (`personalize.py`, see "Done").
Once real-session A/Bs confirm it helps, the upgrades in rough value order:
gaze-redirection augmentation (synthesise novel gaze directions from the
calibration crops instead of photometric jitter only), unfreezing the last
backbone block with a tiny LR, and a persistent per-subject weight cache so a
returning subject starts from their previous adaptation.
