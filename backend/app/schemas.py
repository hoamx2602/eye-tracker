"""Request/response models for the /process endpoint."""
from __future__ import annotations

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
    screen: ScreenGeometryIn
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
    head_comp_gain: float = Field(
        default=1.0,
        description="Scale on the parallax correction; 0 disables. Tune from validation A/B.",
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
    biomarkers: BiomarkersOut
    gaze_trace: list[GazeSampleOut] = Field(
        default_factory=list,
        description="Mapped screen-space gaze. Large; omit via include_trace=false.",
    )
