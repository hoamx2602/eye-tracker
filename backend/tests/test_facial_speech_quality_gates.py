"""Quality gates must fail closed.

The dangerous failure mode for this module is not a crash but a confident,
symmetric-looking report generated from data that was never usable. Each test
here asserts that a degraded capture yields *no* measurement plus a named
reason, rather than a plausible number.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.facial_speech import (  # noqa: E402
    BLOCKING,
    MIN_SPEECH_ACTIVITY_RATIO,
    MIN_TASK_FACE_FRAMES,
    _blocking,
    _face_metrics,
    _speech_features,
)

SAMPLE_RATE = 16000
FACE_TASKS = ("face_rest", "face_brow_raise", "face_eye_closure", "face_smile_show_teeth")


def _frame(*, brow: float = 0.5, eye: float = 0.1, mouth_y: float = 100.0) -> dict[str, float]:
    return {
        "ipd": 256.0,
        "mouth_corner_vertical_asymmetry": 0.0,
        "mouth_left_x": 140.0,
        "mouth_left_y": mouth_y,
        "mouth_right_x": 100.0,
        "mouth_right_y": mouth_y,
        "brow_left": brow,
        "brow_right": brow,
        "eye_left": eye,
        "eye_right": eye,
    }


def _task_frames(count: int = MIN_TASK_FACE_FRAMES + 5, **overrides: int) -> dict[str, list[dict[str, float]]]:
    frames = {task: [_frame() for _ in range(count)] for task in FACE_TASKS}
    for task, task_count in overrides.items():
        frames[task] = [_frame() for _ in range(task_count)]
    return frames


def _good_face_quality() -> dict[str, float]:
    return {
        "sampled_frames": 900,
        "valid_face_frame_ratio": 0.98,
        "brightness_median_0_255": 120.0,
        "blur_variance_median": 300.0,
    }


def _codes(issues: list[dict[str, str]]) -> set[str]:
    return {issue["code"] for issue in issues}


def _all_side_measures(metrics: dict) -> list[dict]:
    return [value for value in metrics.values() if isinstance(value, dict)]


def test_a_clean_capture_produces_measurements_and_no_blocking_issue() -> None:
    metrics, issues = _face_metrics(_task_frames(), _good_face_quality())
    assert not _blocking(issues)
    assert metrics["resting_mouth_corner_vertical_asymmetry_ipd"] is not None


def test_missing_rest_baseline_withholds_every_measurement() -> None:
    """The regression this module previously shipped.

    With no rest window the deltas collapsed to zero and every left/right ratio
    to exactly 1.0, so a capture that failed entirely was rendered as a
    perfectly symmetric face.
    """
    metrics, issues = _face_metrics(_task_frames(face_rest=0), _good_face_quality())
    assert "rest-baseline-missing" in _codes(issues)
    assert _blocking(issues)
    assert metrics["resting_mouth_corner_vertical_asymmetry_ipd"] is None
    for measure in _all_side_measures(metrics):
        assert measure["ratio_weaker_over_stronger"] is None
        # Critically, not 1.0 - the value that reads as a healthy face.
        assert measure["weaker_side"] is None


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("valid_face_frame_ratio", 0.30, "face-visibility-low"),
        ("brightness_median_0_255", 20.0, "illumination-low"),
        ("brightness_median_0_255", None, "illumination-low"),
        ("blur_variance_median", 5.0, "image-blurred"),
        ("blur_variance_median", None, "image-blurred"),
    ],
)
def test_degraded_video_blocks_all_face_metrics(field: str, value: float | None, code: str) -> None:
    quality = _good_face_quality()
    quality[field] = value
    metrics, issues = _face_metrics(_task_frames(), quality)
    assert code in _codes(issues)
    assert _blocking(issues)
    assert metrics["resting_mouth_corner_vertical_asymmetry_ipd"] is None
    for measure in _all_side_measures(metrics):
        assert measure["ratio_weaker_over_stronger"] is None


def test_one_unusable_movement_window_withholds_only_that_measurement() -> None:
    metrics, issues = _face_metrics(_task_frames(face_smile_show_teeth=2), _good_face_quality())
    assert "task-window-unusable" in _codes(issues)
    assert metrics["smile_excursion_ipd"]["ratio_weaker_over_stronger"] is None
    # The brow window was fine, so its measurement survives.
    assert metrics["brow_excursion_ipd"]["left"] is not None
    assert metrics["resting_mouth_corner_vertical_asymmetry_ipd"] is not None


def test_an_unusable_window_still_blocks_the_overall_result() -> None:
    _, issues = _face_metrics(_task_frames(face_eye_closure=1), _good_face_quality())
    assert _blocking(issues), "an incomplete battery must not report an overall pass"


def _tone(seconds: float, amplitude: float = 0.2, freq: float = 140.0) -> np.ndarray:
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    return (amplitude * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def test_a_short_speech_window_carries_no_feature_values() -> None:
    report, issues = _speech_features(_tone(1.0), SAMPLE_RATE, "speech_sustained_a")
    assert "speech-window-too-short" in _codes(issues)
    assert report["available"] is False
    assert "f0_hz_median" not in report
    # Quality is still reported, so the operator learns why.
    assert report["quality"]["duration_s"] == pytest.approx(1.0, rel=1e-3)


def test_clipped_audio_carries_no_feature_values() -> None:
    report, issues = _speech_features(_tone(6.0, amplitude=1.5).clip(-1.0, 1.0), SAMPLE_RATE, "speech_sustained_a")
    assert "audio-clipping" in _codes(issues)
    assert report["available"] is False
    assert "jitter_local" not in report


def test_a_silent_window_carries_no_feature_values() -> None:
    report, issues = _speech_features(np.zeros(SAMPLE_RATE * 6, dtype=np.float32), SAMPLE_RATE, "speech_counting")
    assert "speech-activity-low" in _codes(issues)
    assert report["available"] is False
    assert report["quality"]["speech_activity_ratio"] < MIN_SPEECH_ACTIVITY_RATIO


def test_an_empty_window_is_rejected_rather_than_crashing() -> None:
    report, issues = _speech_features(np.zeros(0, dtype=np.float32), SAMPLE_RATE, "speech_reading")
    assert _blocking(issues)
    assert report["available"] is False


def test_usable_audio_passes_the_gates() -> None:
    report, issues = _speech_features(_tone(6.0), SAMPLE_RATE, "speech_sustained_a")
    assert not _blocking(issues), _codes(issues)
    assert report["available"] is True


def test_every_issue_names_a_code_severity_and_scope() -> None:
    _, face_issues = _face_metrics(_task_frames(face_rest=0), _good_face_quality())
    _, speech_issues = _speech_features(_tone(0.2), SAMPLE_RATE, "speech_sustained_a")
    for issue in face_issues + speech_issues:
        assert issue["code"] and issue["scope"] and issue["message"]
        assert issue["severity"] in {BLOCKING, "advisory"}
