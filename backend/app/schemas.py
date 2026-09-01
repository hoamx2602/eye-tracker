"""Request/response models for the /process endpoint."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class CalibrationDotIn(BaseModel):
    screen_x: float
    screen_y: float
    t_start_ms: float
    t_end_ms: float


class ScreenGeometryIn(BaseModel):
    width_px: int
    height_px: int
    width_cm: float
    viewing_distance_cm: float = 60.0


class ProcessRequest(BaseModel):
    """Sent as a JSON form field alongside the uploaded video file."""
    calibration_dots: list[CalibrationDotIn]
    validation_dots: list[CalibrationDotIn] = Field(
        default_factory=list,
        description="Held-out dots used only for reporting true offline accuracy.",
    )
    screen: ScreenGeometryIn
    glasses: bool = Field(
        default=False,
        description="Whether the subject wore glasses — recorded on the report so "
                    "accuracy can be broken down by condition.",
    )
    frame_stride: int = 1
    saccade_velocity_threshold_deg_s: float = 30.0
    calibration_outlier_sigma: float = Field(
        default=2.5,
        description=(
            "Calibration dot outlier-rejection threshold in standard deviations. "
            "Dots with reprojection error > μ + σ·this are removed before refitting. "
            "Set to a very large number (e.g. 999) to disable rejection."
        ),
    )
    head_compensation: bool = Field(
        default=True,
        description=(
            "First-order parallax compensation: shift mapped gaze by the head "
            "displacement since calibration (estimated from the face bbox)."
        ),
    )
    camera_hfov_deg: float = Field(
        default=60.0,
        description="Assumed webcam horizontal FOV (deg) for head back-projection.",
    )
    head_comp_gain: float | Literal["auto"] = Field(
        default="auto",
        description=(
            "Scale on the parallax correction; 0 disables. \"auto\" (default) picks "
            "the gain that minimises held-out validation error, falling back to 0 "
            "when no validation dots were supplied — the correction rests on an "
            "assumed camera FOV and un-mirrored recording, so it is verified "
            "rather than trusted."
        ),
    )
    personalize: bool = Field(
        default=False,
        description=(
            "Few-shot fine-tune the gaze head on this session's own calibration "
            "dots, keeping the result only if it beats the baseline on held-out "
            "dots. Adds minutes of GPU time; requests are serialised because the "
            "model is shared."
        ),
    )


class BiomarkersOut(BaseModel):
    n_samples: int
    valid_ratio: float
    saccade_count: int
    saccade_peak_velocity_deg_s: float
    saccade_mean_amplitude_deg: float
    fixation_count: int
    fixation_mean_duration_ms: float
    bcea_deg2: float


class GazeSampleOut(BaseModel):
    t_ms: float
    x: float
    y: float


class ValidationOut(BaseModel):
    n_points: int
    overall_px: float
    overall_deg: float
    overall_px_raw: float = float("nan")
    overall_deg_raw: float = float("nan")
    region_px: dict[str, float] = Field(default_factory=dict)
    region_deg: dict[str, float] = Field(default_factory=dict)
    by_quality: dict[str, dict[str, float]] = Field(default_factory=dict)


class ProcessResponse(BaseModel):
    calibration_train_rmse_px: float = Field(
        description="In-sample calibration fit error (optimistic; sanity check only)."
    )
    calibration_loocv_px: float = Field(
        default=float("nan"),
        description="Leave-one-dot-out RMSE — honest generalisation accuracy of the mapping.",
    )
    calibration_region_errors_px: dict[str, float] = Field(
        default_factory=dict,
        description="LODO error broken down by screen region: center / edge / corner.",
    )
    calibration_degree: int = Field(
        default=2, description="Polynomial degree auto-selected by cross-validation."
    )
    calibration_use_head: bool = Field(
        default=False,
        description=(
            "Whether cross-validation found head position worth including as a "
            "mapper input. Only possible when calibration spans several head "
            "poses; a single-pose grid leaves the head columns constant and CV "
            "correctly drops them."
        ),
    )
    calibration_dots_used: int = Field(
        description="Calibration dots kept after outlier rejection."
    )
    calibration_dots_total: int = Field(
        description="Calibration dots with enough valid frames before rejection."
    )
    head_compensation_applied: bool = Field(
        default=False,
        description="Whether parallax compensation was applied to the scored trace.",
    )
    head_motion: dict[str, float] = Field(
        default_factory=dict,
        description=(
            "Head displacement since calibration over the trace (cm): "
            "lateral_median/p95/max, moved_frames_frac, distance_ratio_median."
        ),
    )
    head_comp_gain: float = Field(
        default=0.0,
        description="Parallax gain actually applied (0 = compensation off).",
    )
    head_comp_gain_selection: dict[str, Any] | None = Field(
        default=None,
        description=(
            "How the gain was chosen when head_comp_gain was \"auto\": the "
            "per-gain held-out error sweep and the winner. Null when a gain was "
            "given explicitly."
        ),
    )
    personalization: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Per-subject fine-tuning outcome when requested: whether it was kept, "
            "why, and the held-out scores before/after. Null when not requested."
        ),
    )
    validation: ValidationOut | None = Field(
        default=None,
        description="Held-out validation-dot accuracy report, if validation_dots were supplied.",
    )
    biomarkers: BiomarkersOut
    gaze_trace: list[GazeSampleOut] = Field(
        default_factory=list,
        description="Mapped screen-space gaze. Large; omit via include_trace=false.",
    )


def response_from_report(report: dict, include_trace: bool = False) -> ProcessResponse:
    """
    Flatten a nested `reprocess.reprocess()` report into the flat wire shape.

    Lives here rather than in main.py because this *is* the wire contract: it can
    then be exercised without importing FastAPI, so the mapping stays covered by
    the stub pipeline test that runs with no web framework and no GPU.
    """
    cal, head = report["calibration"], report["head"]
    val = report.get("validation")

    trace: list[GazeSampleOut] = []
    if include_trace:
        for row in report.get("debug_trace", []):
            if row["x"] is not None and row["y"] is not None:
                trace.append(GazeSampleOut(t_ms=row["t"], x=row["x"], y=row["y"]))

    return ProcessResponse(
        calibration_train_rmse_px=cal["train_rmse_px"],
        calibration_loocv_px=cal["loocv_px"],
        calibration_region_errors_px=cal["region_errors_px"],
        calibration_degree=cal["degree"],
        calibration_use_head=cal["use_head"],
        calibration_dots_used=cal["dots_used"],
        calibration_dots_total=cal["dots_total"],
        head_compensation_applied=head["compensation_applied"],
        head_motion=head["motion"] or {},
        head_comp_gain=head["gain"],
        head_comp_gain_selection=head["gain_selection"],
        personalization=report.get("personalization"),
        # per_point is a per-dot detail the browser never reads; it stays in the
        # CLI report and off the wire.
        validation=ValidationOut(**{k: v for k, v in val.items() if k != "per_point"})
        if val else None,
        biomarkers=BiomarkersOut(**{
            k: v for k, v in report["biomarkers"].items() if k != "extra"
        }),
        gaze_trace=trace,
    )
