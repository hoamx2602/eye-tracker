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
    calibration_train_rmse_px: float
    biomarkers: BiomarkersOut
    gaze_trace: list[GazeSampleOut] = Field(
        default_factory=list,
        description="Mapped screen-space gaze. Large; omit via include_trace=false.",
    )
