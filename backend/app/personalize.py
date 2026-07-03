"""
Per-subject personalization — few-shot fine-tuning of the gaze head on the
session's own calibration dots (README "Remaining improvements" #4).

Why: OpenFace 3.0 is a *cross-subject* model (~2.56° MPIIGaze). The 2024–2025
personalization literature consistently shows that adapting the network to the
individual (eye shape, kappa angle, glasses) with a handful of labelled samples
is the single largest remaining accuracy lever — and the polynomial calibration
can only fix what is an *affine-ish output-space* bias; it cannot fix
appearance-dependent errors (per-gaze-direction glasses distortion, eyelid
shape at downgaze, …). Fine-tuning the gaze branch can.

Design (deliberately conservative — 9–25 dots is tiny):

  Targets without knowing the model's convention.  We do not know OpenFace's
  exact yaw/pitch sign/origin convention, and guessing wrong would poison the
  labels. Instead we compute *geometric* gaze angles (eye→dot ray from the
  head-position proxy and screen geometry, camera assumed at screen top-center)
  and robust-fit a per-axis linear map from geometric → model output space
  across the dots. Targets are the fitted line evaluated at each dot — i.e. "be
  consistent with geometry up to the affine transform the polynomial absorbs
  anyway". If |correlation| between model medians and geometric angles is < 0.8
  on either axis, personalization aborts (labels would be unreliable).

  What trains.  Only the gaze branch (fc_gaze + gaze_regressor); the backbone
  stays frozen. AdamW, small LR, L1 loss, photometric augmentation, early
  stopping on dots held out of training (split by dot, never by frame).

  Safety.  The caller snapshots the gaze-branch weights first and decides —
  after re-inference and calibration refit — whether the personalized pass
  actually beat the baseline on held-out validation dots (or calibration LOOCV
  when there are none), restoring the snapshot otherwise. This module never
  silently degrades a session. Offline (reprocess CLI) only — the FastAPI
  service shares one model across requests, so it must not be mutated there.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np

logger = logging.getLogger(__name__)

# Training hyper-parameters. Small LR + few epochs + weight decay + early stop:
# with ≤ a few hundred crops the risk is overfitting, not underfitting.
_LR = 1e-4
_WEIGHT_DECAY = 1e-2
_MAX_EPOCHS = 40
# Early-stop patience. The val curve typically bumps UP for the first ~5–8
# epochs (AdamW transient on a freshly-thawed head) before descending; a tight
# patience stops inside that bump and freezes the near-initial weights.
_PATIENCE = 10
_BATCH = 32
_VAL_EVERY_NTH_DOT = 4      # every 4th dot is held out for early stopping
_MIN_ALIGN_CORR = 0.8       # abort if model↔geometry correlation is below this
_MIN_DOTS = 6
_MIN_CROPS = 30
_SETTLE_FRAC = 0.4          # drop the approach transient, like calibration.py
_QUALITY_GATE = 0.3


@dataclass
class PersonalizationResult:
    applied: bool
    reason: str
    n_dots: int = 0
    n_crops: int = 0
    align_corr_yaw: float = float("nan")
    align_corr_pitch: float = float("nan")
    epochs_run: int = 0
    best_val_l1: float = float("nan")     # radians, on held-out dots
    initial_val_l1: float = float("nan")
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "applied": self.applied, "reason": self.reason,
            "n_dots": self.n_dots, "n_crops": self.n_crops,
            "align_corr_yaw": self.align_corr_yaw,
            "align_corr_pitch": self.align_corr_pitch,
            "epochs_run": self.epochs_run,
            "best_val_l1_rad": self.best_val_l1,
            "initial_val_l1_rad": self.initial_val_l1,
            **self.extra,
        }


# ── Gaze-branch snapshot / restore (safety net for the caller) ───────────────

def _gaze_branch_modules(model) -> dict:
    """The trainable submodules of the MTL net: {'fc_gaze': …, 'gaze_regressor': …}."""
    mtl = model._model.model
    return {"fc_gaze": mtl.fc_gaze, "gaze_regressor": mtl.gaze_regressor}


def snapshot_gaze_head(model) -> dict:
    """Deep-copied state of the gaze branch, for restore_gaze_head()."""
    return {
        name: {k: v.detach().clone() for k, v in mod.state_dict().items()}
        for name, mod in _gaze_branch_modules(model).items()
    }


def restore_gaze_head(model, snapshot: dict) -> None:
    for name, mod in _gaze_branch_modules(model).items():
        mod.load_state_dict(snapshot[name])


# ── Geometric targets aligned to the model's output convention ───────────────

def geometric_angles(
    dot_x_px: np.ndarray,
    dot_y_px: np.ndarray,
    head_u: np.ndarray,      # per-dot median head proxy (normalized, see gaze_model)
    head_v: np.ndarray,
    head_w_ratio: np.ndarray,  # per-dot (w_ref / w_dot): distance ratio vs calibration ref
    screen_width_px: float,
    screen_width_cm: float,
    viewing_distance_cm: float,
    hfov_deg: float,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Eye→dot gaze angles (rad) in camera space, one per dot.

    Camera assumed at the screen's top-center, axis ⟂ screen. The affine part
    of that assumption's error is absorbed by the alignment fit + the
    polynomial recalibration; only its (small) nonlinear part leaks through.
    """
    ppcm = screen_width_px / screen_width_cm
    f_n = 0.5 / np.tan(np.deg2rad(hfov_deg) / 2.0)
    z = viewing_distance_cm * head_w_ratio

    # Eye in camera coords (X = camera right = user's LEFT, Y = down, Z toward user)
    ex = head_u * z / f_n
    ey = head_v * z / f_n
    # Dot in camera coords: screen x to the user's right = camera −X;
    # camera sits at the top-center of the screen (y≈0 at the top edge).
    dx = -(dot_x_px / ppcm - screen_width_cm / 2.0)
    dy = dot_y_px / ppcm

    gx = dx - ex
    gy = dy - ey
    gz = -z              # from the eye toward the screen plane (z=0)
    yaw_geom = np.arctan2(gx, -gz)
    pitch_geom = np.arctan2(gy, -gz)
    return yaw_geom, pitch_geom


def align_targets(
    model_yaw: np.ndarray,
    model_pitch: np.ndarray,
    yaw_geom: np.ndarray,
    pitch_geom: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, float, float]:
    """
    Per-axis robust linear fit  model ≈ a + b·geom  across dots; targets are the
    fitted line at each dot. Returns (yaw_targets, pitch_targets, corr_yaw,
    corr_pitch). Correlations are the guardrail: near ±1 means the model's
    convention maps cleanly onto geometry and the labels are trustworthy.
    """
    def _fit(m: np.ndarray, g: np.ndarray) -> tuple[np.ndarray, float]:
        if len(m) <= 2 or float(np.std(m)) == 0.0 or float(np.std(g)) == 0.0:
            corr = 0.0   # degenerate → caller's |corr| guard will abort
        else:
            corr = float(np.corrcoef(m, g)[0, 1])
        # One robust re-weighting pass (Huber-ish): fit, downweight outliers, refit.
        A = np.column_stack([np.ones_like(g), g])
        coef, *_ = np.linalg.lstsq(A, m, rcond=None)
        resid = m - A @ coef
        mad = 1.4826 * np.median(np.abs(resid - np.median(resid))) + 1e-12
        w = 1.0 / np.maximum(1.0, np.abs(resid) / (2.0 * mad))
        Aw = A * w[:, None]
        coef, *_ = np.linalg.lstsq(Aw, m * w, rcond=None)
        return A @ coef, corr

    yaw_t, corr_y = _fit(model_yaw, yaw_geom)
    pitch_t, corr_p = _fit(model_pitch, pitch_geom)
    return yaw_t, pitch_t, corr_y, corr_p


# ── Crop collection ──────────────────────────────────────────────────────────

def make_crop_fn(model):
    """frame(BGR) → face crop | None, using the model's own detector."""
    def _crop(frame: np.ndarray) -> np.ndarray | None:
        dets = model._detect_faces(frame)
        if dets is None:
            return None
        extracted = model._crop_dominant(frame, dets)
        return extracted[0] if extracted is not None else None
    return _crop


def collect_dot_crops(
    video_path: str,
    windows: list[tuple[float, float]],
    crop_fn,
    frame_quality: np.ndarray,
    frame_t_ms: np.ndarray,
    settle_frac: float = _SETTLE_FRAC,
    quality_gate: float = _QUALITY_GATE,
    max_per_dot: int = 20,
) -> list[list[np.ndarray]]:
    """
    Re-decode the video and collect face crops per calibration window, mirroring
    calibration.py's frame selection: drop the approach transient (first
    settle_frac of each window) and glare-gated frames, cap at max_per_dot.

    frame_quality/frame_t_ms come from the pass-1 process_video output, so the
    glare gate here matches what calibration used.
    """
    import cv2

    # Effective (post-settle) window per dot.
    eff = []
    for (t0, t1) in windows:
        eff.append((t0 + (t1 - t0) * settle_frac, t1))

    # Timestamp → pass-1 quality lookup (nearest processed frame).
    def _quality_at(ts: float) -> float:
        i = int(np.searchsorted(frame_t_ms, ts))
        i = min(max(i, 0), len(frame_t_ms) - 1)
        return float(frame_quality[i])

    crops: list[list[np.ndarray]] = [[] for _ in windows]
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    t_end_all = max(t1 for _, t1 in eff)
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        pos = cap.get(cv2.CAP_PROP_POS_MSEC)
        ts = pos if pos and pos > 0 else (idx / fps) * 1000.0
        idx += 1
        if ts > t_end_all:
            break
        for di, (t0, t1) in enumerate(eff):
            if t0 <= ts <= t1 and len(crops[di]) < max_per_dot:
                if _quality_at(ts) < quality_gate:
                    break
                c = crop_fn(frame)
                if c is not None and c.size:
                    crops[di].append(c)
                break
    cap.release()
    return crops


# ── Fine-tuning ──────────────────────────────────────────────────────────────

def _augment(batch, rng):
    """
    Mild photometric jitter + noise on preprocessed image tensors (N,3,H,W).
    Deliberately gentle: strong global scale/shift can wash out the gaze signal
    itself; the main overfitting guards are weight decay + early stopping.
    """
    import torch

    shape = (batch.shape[0],) + (1,) * (batch.ndim - 1)
    scale = 1.0 + 0.05 * (2 * torch.rand(shape, device=batch.device) - 1)
    shift = 0.03 * (2 * torch.rand(shape, device=batch.device) - 1)
    noise = 0.01 * torch.randn_like(batch)
    return batch * scale + shift + noise


def finetune_gaze_head(
    model,
    dot_crops: list[list[np.ndarray]],
    yaw_targets: np.ndarray,
    pitch_targets: np.ndarray,
    max_epochs: int = _MAX_EPOCHS,
    lr: float = _LR,
) -> tuple[int, float, float]:
    """
    Fine-tune fc_gaze + gaze_regressor on (crop, target) pairs, early-stopped on
    dots held out of training. Mutates the model in place; snapshot first.
    Returns (epochs_run, initial_val_l1, best_val_l1) in radians.
    """
    import torch

    mtl = model._model.model
    device = next(mtl.gaze_regressor.parameters()).device

    # Preprocess every crop once; group indices by dot for the split.
    tensors, targets, dot_of = [], [], []
    for di, crops in enumerate(dot_crops):
        for c in crops:
            tensors.append(model._model.preprocess(c))
            targets.append((yaw_targets[di], pitch_targets[di]))
            dot_of.append(di)
    X = torch.cat(tensors, dim=0).to(device)
    Y = torch.tensor(np.asarray(targets), dtype=torch.float32, device=device)
    dot_of = np.asarray(dot_of)

    val_dots = set(range(0, len(dot_crops), _VAL_EVERY_NTH_DOT))
    val_m = np.isin(dot_of, list(val_dots))
    tr_idx = torch.tensor(np.where(~val_m)[0], device=device)
    va_idx = torch.tensor(np.where(val_m)[0], device=device)

    # The backbone is frozen: forward it under no_grad and train only the head.
    # Validation features are cached (never augmented); training crops are
    # photometrically augmented in IMAGE space each batch, then passed through
    # the frozen backbone — principled augmentation at negligible cost for a
    # few hundred crops.
    was_training = mtl.training
    mtl.eval()

    def _backbone(x):
        with torch.no_grad():
            return mtl.base_model(x)

    va_feats = []
    with torch.no_grad():
        for i in range(0, len(va_idx), _BATCH):
            va_feats.append(_backbone(X[va_idx[i:i + _BATCH]]))
    F_val = torch.cat(va_feats, dim=0) if va_feats else X.new_zeros((0, 1))

    def _head(f):
        out = mtl.gaze_regressor(mtl.relu(mtl.fc_gaze(f)))
        if out.shape[1] == 4:   # per-eye (l_yaw, l_pitch, r_yaw, r_pitch) → average,
            out = torch.stack(  # matching gaze_model._predict_gaze_batch
                [(out[:, 0] + out[:, 2]) / 2, (out[:, 1] + out[:, 3]) / 2], dim=1,
            )
        return out[:, :2]

    def _val_l1() -> float:
        with torch.no_grad():
            return float(torch.nn.functional.l1_loss(_head(F_val), Y[va_idx]).item())

    params = [p for m in (mtl.fc_gaze, mtl.gaze_regressor) for p in m.parameters()]
    opt = torch.optim.AdamW(params, lr=lr, weight_decay=_WEIGHT_DECAY)
    loss_fn = torch.nn.L1Loss()

    initial_val = best_val = _val_l1()
    best_state = snapshot_gaze_head(model)
    bad_epochs = 0
    epochs_run = 0
    gen = torch.Generator().manual_seed(0)
    rng = np.random.default_rng(0)

    for epoch in range(max_epochs):
        epochs_run = epoch + 1
        perm = tr_idx[torch.randperm(len(tr_idx), generator=gen)]
        for i in range(0, len(perm), _BATCH):
            sel = perm[i:i + _BATCH]
            f = _backbone(_augment(X[sel], rng))
            loss = loss_fn(_head(f), Y[sel])
            opt.zero_grad()
            loss.backward()
            opt.step()
        v = _val_l1()
        if v < best_val - 1e-5:
            best_val, bad_epochs = v, 0
            best_state = snapshot_gaze_head(model)
        else:
            bad_epochs += 1
            if bad_epochs >= _PATIENCE:
                break

    restore_gaze_head(model, best_state)
    if was_training:
        mtl.train()
    return epochs_run, initial_val, best_val


# ── Orchestration ────────────────────────────────────────────────────────────

def personalize_on_session(
    model,
    video_path: str,
    cal_dots,                      # list[calibration.CalibrationDot]
    frames: dict[str, np.ndarray],  # pass-1 process_video output
    screen_width_px: float,
    screen_width_cm: float,
    viewing_distance_cm: float,
    hfov_deg: float,
    crop_fn=None,
) -> PersonalizationResult:
    """
    Full personalization step (mutates the model's gaze branch — snapshot first
    with snapshot_gaze_head()). The caller re-infers + refits afterwards and
    keeps or restores based on held-out numbers.
    """
    from .calibration import _aggregate_dot

    windows = [(d.t_start_ms, d.t_end_ms) for d in cal_dots]
    t, yaw, pitch = frames["t_ms"], frames["yaw"], frames["pitch"]
    quality = frames.get("quality")
    head_u, head_v, head_w = frames["head_u"], frames["head_v"], frames["head_w"]

    # Per-dot medians of the model's pass-1 output + head proxy.
    m_yaw, m_pitch, h_u, h_v, h_w = [], [], [], [], []
    dot_x, dot_y, used = [], [], []
    for di, d in enumerate(cal_dots):
        in_w = (t >= d.t_start_ms) & (t <= d.t_end_ms)
        yw, pw = yaw[in_w].copy(), pitch[in_w].copy()
        if quality is not None:
            bad = quality[in_w] < _QUALITY_GATE
            yw[bad] = np.nan
            pw[bad] = np.nan
        agg = _aggregate_dot(yw, pw)
        if agg is None or not np.isfinite(np.nanmedian(head_w[in_w])):
            continue
        m_yaw.append(agg[0])
        m_pitch.append(agg[1])
        h_u.append(float(np.nanmedian(head_u[in_w])))
        h_v.append(float(np.nanmedian(head_v[in_w])))
        h_w.append(float(np.nanmedian(head_w[in_w])))
        dot_x.append(d.screen_x)
        dot_y.append(d.screen_y)
        used.append(di)

    if len(used) < _MIN_DOTS:
        return PersonalizationResult(False, f"only {len(used)} usable dots (need {_MIN_DOTS})")

    h_w_arr = np.asarray(h_w)
    w_ref = float(np.median(h_w_arr))
    yaw_g, pitch_g = geometric_angles(
        np.asarray(dot_x), np.asarray(dot_y),
        np.asarray(h_u), np.asarray(h_v), w_ref / h_w_arr,
        screen_width_px, screen_width_cm, viewing_distance_cm, hfov_deg,
    )
    yaw_t, pitch_t, corr_y, corr_p = align_targets(
        np.asarray(m_yaw), np.asarray(m_pitch), yaw_g, pitch_g,
    )
    res = PersonalizationResult(
        False, "", n_dots=len(used), align_corr_yaw=corr_y, align_corr_pitch=corr_p,
    )
    if abs(corr_y) < _MIN_ALIGN_CORR or abs(corr_p) < _MIN_ALIGN_CORR:
        res.reason = (
            f"model-geometry alignment too weak (|corr| yaw {corr_y:.2f} / "
            f"pitch {corr_p:.2f} < {_MIN_ALIGN_CORR}) — labels unreliable"
        )
        return res

    if crop_fn is None:
        crop_fn = make_crop_fn(model)
    crops = collect_dot_crops(
        video_path, [windows[di] for di in used], crop_fn,
        frames.get("quality", np.ones_like(t)), t,
    )
    n_crops = sum(len(c) for c in crops)
    res.n_crops = n_crops
    if n_crops < _MIN_CROPS:
        res.reason = f"only {n_crops} usable crops (need {_MIN_CROPS})"
        return res

    epochs, init_l1, best_l1 = finetune_gaze_head(model, crops, yaw_t, pitch_t)
    res.epochs_run = epochs
    res.initial_val_l1 = init_l1
    res.best_val_l1 = best_l1
    res.applied = True
    res.reason = "ok"
    logger.info(
        "Personalization: %d dots / %d crops, corr(yaw %.2f, pitch %.2f), "
        "val L1 %.4f → %.4f rad over %d epochs",
        res.n_dots, n_crops, corr_y, corr_p, init_l1, best_l1, epochs,
    )
    return res
