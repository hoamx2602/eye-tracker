"""
Batch reprocessing + accuracy CLI (offline, GPU box).

Takes a recorded session video and a metadata JSON (screen geometry + calibration
dot windows, optional held-out validation dots), runs the full offline pipeline,
and writes the *authoritative* biomarkers plus an honest accuracy report. This is
the dissertation/analysis path — decoupled from the live test UX, so the minutes
of OpenFace per-frame inference don't block anyone.

Usage
-----
    python3 -m app.reprocess --video session.webm --meta session.json --out report.json

`session.json` schema (see app/reprocess_example.json):
    {
      "screen":   {"width_px":1920,"height_px":1080,"width_cm":34.5,"viewing_distance_cm":60},
      "frame_stride": 1,
      "saccade_velocity_threshold_deg_s": 30,
      "calibration_outlier_sigma": 2.5,
      "head_compensation": true,          # parallax compensation (default true)
      "camera_hfov_deg": 60,              # webcam horizontal FOV assumption
      "head_comp_gain": 1.0,              # 0 disables; tune from validation A/B
      "personalize": false,               # experimental per-subject fine-tuning;
                                          # kept only if it beats the baseline
      "glasses": true,
      "calibration_dots": [{"screen_x":..,"screen_y":..,"t_start_ms":..,"t_end_ms":..}, ...],
      "validation_dots":  [{"screen_x":..,"screen_y":..,"t_start_ms":..,"t_end_ms":..}, ...]
    }

All t_*_ms are milliseconds from the START of the recorded video.
"""
from __future__ import annotations

import argparse
import json
import logging
from dataclasses import asdict

import numpy as np

from .calibration import CalibrationDot, fit_mapper
from .events import ScreenGeometry, detect_events
from .head_comp import DEFAULT_HFOV_DEG, build_compensator
from .validation import evaluate_mapper

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("reprocess")

_TRACE_QUALITY_GATE = 0.4


def _dots(raw: list[dict]) -> list[CalibrationDot]:
    return [CalibrationDot(d["screen_x"], d["screen_y"], d["t_start_ms"], d["t_end_ms"]) for d in raw]


def reprocess(
    video_path: str,
    meta: dict,
    weights_dir: str | None = None,
    model=None,
    include_trace: bool = False,
) -> dict:
    """
    Full offline pipeline for one session. `model` may be injected (anything with
    an `infer_batch(frames) -> list[FrameGaze | None]`) so the pipeline is
    testable end-to-end without OpenFace/GPU; by default the real GazeModel is
    lazily constructed.
    """
    geo = ScreenGeometry(
        width_px=meta["screen"]["width_px"],
        height_px=meta["screen"]["height_px"],
        width_cm=meta["screen"]["width_cm"],
        viewing_distance_cm=meta["screen"].get("viewing_distance_cm", 60.0),
    )

    # Lazy imports so the pure-Python parts can be unit-tested without OpenFace.
    from .video import process_video

    if model is None:
        from .gaze_model import GazeModel
        model = GazeModel(weights_dir=weights_dir) if weights_dir else GazeModel()
    cal_dots = _dots(meta["calibration_dots"])

    frames = process_video(video_path, model, frame_stride=meta.get("frame_stride", 1))
    analysis = _analyze(frames, meta, geo, cal_dots)

    # ── Optional per-subject personalization (experimental) ──────────────────
    # Fine-tune the gaze head on this session's own calibration dots, re-infer,
    # refit — and KEEP only if the held-out score actually improved. Offline
    # path only: mutating the model is unsafe in the shared-model API server.
    personalization = None
    if meta.get("personalize", False):
        personalization = _try_personalize(
            model, video_path, meta, geo, cal_dots, frames, analysis,
        )
        if personalization.get("kept"):
            analysis = personalization.pop("_analysis")
        else:
            personalization.pop("_analysis", None)

    # ── Authoritative biomarkers on the (compensated, quality-gated) trace ───
    x_px, y_px = analysis["x_px"], analysis["y_px"]
    bm = detect_events(
        analysis["frames"]["t_ms"], x_px, y_px, geo,
        saccade_velocity_threshold_deg_s=meta.get("saccade_velocity_threshold_deg_s", 30.0),
    )

    mapper = analysis["mapper"]
    report = {
        "glasses": meta.get("glasses"),
        "head": {
            "compensation_applied": analysis["compensator"] is not None,
            "hfov_deg": meta.get("camera_hfov_deg", DEFAULT_HFOV_DEG),
            "gain": meta.get("head_comp_gain", 1.0),
            "motion": analysis["head_motion"],
        },
        "calibration": {
            "train_rmse_px": mapper.train_rmse_px,
            "loocv_px": mapper.loocv_px,
            "region_errors_px": mapper.region_errors_px,
            "degree": mapper.degree,
            "alpha": mapper.alpha,
            "dots_used": mapper.n_dots_used,
            "dots_total": mapper.n_dots_total,
        },
        "validation": analysis["validation"],
        "personalization": personalization,
        "biomarkers": asdict(bm),
    }
    if include_trace:
        report["debug_trace"] = _debug_trace(analysis["frames"], x_px, y_px)
    return report


def _finite_or_none(v: float) -> float | None:
    return float(v) if np.isfinite(v) else None


def _debug_trace(frames: dict, x_px: np.ndarray, y_px: np.ndarray) -> list[dict]:
    """Compact per-frame trace for visual replay/debugging."""
    t_ms = frames["t_ms"]
    yaw = frames["yaw"]
    pitch = frames["pitch"]
    quality = frames.get("quality")
    head_u = frames.get("head_u")
    head_v = frames.get("head_v")
    head_w = frames.get("head_w")
    out: list[dict] = []
    for i, t in enumerate(t_ms):
        out.append({
            "t": round(float(t), 1),
            "x": _finite_or_none(x_px[i]),
            "y": _finite_or_none(y_px[i]),
            "yaw": _finite_or_none(yaw[i]),
            "pitch": _finite_or_none(pitch[i]),
            "q": _finite_or_none(quality[i]) if quality is not None else None,
            "hu": _finite_or_none(head_u[i]) if head_u is not None else None,
            "hv": _finite_or_none(head_v[i]) if head_v is not None else None,
            "hw": _finite_or_none(head_w[i]) if head_w is not None else None,
        })
    return out


def _analyze(frames: dict, meta: dict, geo: ScreenGeometry, cal_dots: list[CalibrationDot]) -> dict:
    """
    One full analysis pass over inferred frames: calibration fit, head
    compensation, held-out validation, compensated + quality-gated trace.
    Reused for the baseline and (when personalizing) the fine-tuned pass.
    """
    quality = frames.get("quality")
    mapper = fit_mapper(
        cal_dots,
        frames["t_ms"], frames["yaw"], frames["pitch"],
        frame_quality=quality,
        outlier_sigma=meta.get("calibration_outlier_sigma", 2.5),
    )

    # Head-translation (parallax) compensation: reference = head position during
    # the calibration windows; every mapped point is shifted by the displacement
    # since then. Disable per session with "head_compensation": false.
    compensator = None
    head = {k: frames[k] for k in ("head_u", "head_v", "head_w") if k in frames}
    if meta.get("head_compensation", True) and len(head) == 3:
        compensator = build_compensator(
            [(d.t_start_ms, d.t_end_ms) for d in cal_dots],
            frames["t_ms"], head["head_u"], head["head_v"], head["head_w"],
            viewing_distance_cm=geo.viewing_distance_cm,
            screen_width_px=geo.width_px,
            screen_width_cm=geo.width_cm,
            hfov_deg=meta.get("camera_hfov_deg", DEFAULT_HFOV_DEG),
            gain=meta.get("head_comp_gain", 1.0),
        )

    # Held-out validation (truthful accuracy; raw-vs-compensated A/B).
    validation = None
    if meta.get("validation_dots"):
        rep = evaluate_mapper(
            mapper, _dots(meta["validation_dots"]),
            frames["t_ms"], frames["yaw"], frames["pitch"], geo,
            frame_quality=quality,
            compensator=compensator,
            frame_head=head if compensator is not None else None,
        )
        logger.info("\n%s", rep.summary())
        validation = {
            "n_points": rep.n_points,
            "overall_px": rep.overall_px, "overall_deg": rep.overall_deg,
            "overall_px_raw": rep.overall_px_raw, "overall_deg_raw": rep.overall_deg_raw,
            "region_px": rep.region_px, "region_deg": rep.region_deg,
            "by_quality": rep.by_quality,
            "per_point": [asdict(p) for p in rep.per_point],
        }

    mapped = mapper.map(frames["yaw"], frames["pitch"])
    x_px, y_px = mapped[:, 0], mapped[:, 1]
    head_motion = None
    if compensator is not None:
        x_px, y_px = compensator.apply(
            x_px, y_px, head["head_u"], head["head_v"], head["head_w"],
        )
        head_motion = compensator.motion_stats(
            head["head_u"], head["head_v"], head["head_w"],
        )
        logger.info("Head motion over trace: %s", {k: round(v, 3) for k, v in head_motion.items()})
    if quality is not None:
        glare = quality < _TRACE_QUALITY_GATE
        x_px = np.where(glare, np.nan, x_px)
        y_px = np.where(glare, np.nan, y_px)

    return {
        "frames": frames, "mapper": mapper, "compensator": compensator,
        "validation": validation, "head_motion": head_motion,
        "x_px": x_px, "y_px": y_px,
    }


def _held_out_score_px(analysis: dict) -> float:
    """Model-selection score: validation RMSE when available, else calibration LODO."""
    val = analysis["validation"]
    if val and np.isfinite(val["overall_px"]):
        return float(val["overall_px"])
    return float(analysis["mapper"].loocv_px)


def _try_personalize(
    model, video_path: str, meta: dict, geo: ScreenGeometry,
    cal_dots: list[CalibrationDot], frames: dict, baseline: dict,
) -> dict:
    """
    Run the personalization step and re-analysis; decide keep-vs-restore on the
    held-out score. Never lets a failed/worse fine-tune leak into the report:
    the gaze head is snapshotted before and restored unless it won.
    """
    from .personalize import personalize_on_session, restore_gaze_head, snapshot_gaze_head
    from .video import process_video

    out: dict = {"kept": False}
    try:
        snap = snapshot_gaze_head(model)
    except Exception as e:  # noqa: BLE001 — e.g. stub/injected model without a torch net
        out["reason"] = f"model does not expose a tunable gaze head ({e})"
        return out

    res = personalize_on_session(
        model, video_path, cal_dots, frames,
        screen_width_px=geo.width_px, screen_width_cm=geo.width_cm,
        viewing_distance_cm=geo.viewing_distance_cm,
        hfov_deg=meta.get("camera_hfov_deg", DEFAULT_HFOV_DEG),
    )
    out.update(res.to_dict())
    if not res.applied:
        restore_gaze_head(model, snap)
        return out

    frames_p = process_video(video_path, model, frame_stride=meta.get("frame_stride", 1))
    analysis_p = _analyze(frames_p, meta, geo, cal_dots)

    base_score = _held_out_score_px(baseline)
    pers_score = _held_out_score_px(analysis_p)
    out["baseline_score_px"] = base_score
    out["personalized_score_px"] = pers_score
    out["kept"] = bool(pers_score < base_score)
    out["_analysis"] = analysis_p
    if not out["kept"]:
        restore_gaze_head(model, snap)
        logger.info(
            "Personalization NOT kept (%.1f px vs baseline %.1f px) — gaze head restored",
            pers_score, base_score,
        )
    else:
        logger.info(
            "Personalization kept: held-out %.1f px → %.1f px", base_score, pers_score,
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Offline batch reprocessing + accuracy report.")
    ap.add_argument("--video", required=True, help="recorded session video (must cover calibration)")
    ap.add_argument("--meta", required=True, help="metadata JSON (screen + dot windows)")
    ap.add_argument("--out", help="write full report JSON here (default: stdout)")
    ap.add_argument("--weights", help="OpenFace weights dir (default: $OPENFACE_WEIGHTS)")
    ap.add_argument("--personalize", action="store_true",
                    help="experimental per-subject gaze-head fine-tuning "
                         "(kept only if it beats the baseline on held-out dots)")
    ap.add_argument("--include-trace", action="store_true",
                    help="include per-frame debug_trace for app.replay visualization")
    args = ap.parse_args()

    with open(args.meta) as f:
        meta = json.load(f)
    if args.personalize:
        meta["personalize"] = True

    report = reprocess(args.video, meta, weights_dir=args.weights, include_trace=args.include_trace)
    out = json.dumps(report, indent=2)
    if args.out:
        with open(args.out, "w") as f:
            f.write(out)
        logger.info("Wrote report → %s", args.out)
    else:
        print(out)


if __name__ == "__main__":
    main()
