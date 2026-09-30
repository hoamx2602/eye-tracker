"""The traces behind the summary numbers.

A ratio cannot show whether the subject performed the movement twice as asked,
whether both sides peaked together, or whether a window caught a mistrack. The
report carries the per-frame series and the timestamps of the frames worth
looking at so a reviewer can check the summary rather than trust it.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.facial_speech import _downsample, _face_metrics, _speech_features  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_facial_speech_quality_gates import (  # noqa: E402
    SAMPLE_RATE,
    _frame,
    _good_face_quality,
    _task_frames,
)


def _visuals(task_frames=None, quality=None):
    _, _, visuals = _face_metrics(task_frames or _task_frames(), quality or _good_face_quality())
    return visuals


def test_each_movement_task_carries_a_left_right_trace() -> None:
    series = _visuals()["series"]
    for task in ("face_smile_show_teeth", "face_brow_raise", "face_eye_closure"):
        trace = series[task]
        assert len(trace["t_ms"]) == len(trace["left"]) == len(trace["right"])
        assert trace["label"] and trace["unit"]


def test_the_trace_time_axis_comes_from_the_media_clock() -> None:
    trace = _visuals()["series"]["face_smile_show_teeth"]
    assert trace["t_ms"][0] == pytest.approx(0.0)
    assert trace["t_ms"][1] > trace["t_ms"][0]


def test_the_peak_frame_is_where_the_movement_actually_peaked() -> None:
    """The annotated still must show the movement, not an arbitrary frame."""
    frames = _task_frames()
    smile = [_frame(mouth_v=0.42, t_ms=index * 66.7) for index in range(30)]
    smile[17] = _frame(mouth_v=0.9, t_ms=17 * 66.7)  # the one real smile
    frames["face_smile_show_teeth"] = smile
    visuals = _visuals(frames)
    assert visuals["series"]["face_smile_show_teeth"]["peak_t_ms"] == pytest.approx(17 * 66.7)
    assert visuals["key_frame_t_ms"]["smile_peak"] == pytest.approx(17 * 66.7)


def test_the_eye_closure_key_frame_is_the_most_closed_not_the_most_open() -> None:
    """Closure is an extreme in the other direction, so a max would pick the
    moment the subject's eyes were widest."""
    frames = _task_frames()
    closure = [_frame(eye=0.1, t_ms=index * 66.7) for index in range(30)]
    closure[8] = _frame(eye=0.005, t_ms=8 * 66.7)
    frames["face_eye_closure"] = closure
    assert _visuals(frames)["key_frame_t_ms"]["eye_closed"] == pytest.approx(8 * 66.7)


def test_a_rest_key_frame_is_always_offered() -> None:
    assert "rest" in _visuals()["key_frame_t_ms"]


def test_a_blocked_capture_offers_no_traces_to_over_read() -> None:
    quality = _good_face_quality()
    quality["valid_face_frame_ratio"] = 0.2
    visuals = _visuals(quality=quality)
    assert visuals["series"] == {}
    assert visuals["key_frame_t_ms"] == {}


def _vowel(seconds: float, freq: float = 130.0) -> np.ndarray:
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    wave = np.sin(2 * np.pi * freq * t) + 0.5 * np.sin(2 * np.pi * 2 * freq * t)
    return (0.25 * wave / np.abs(wave).max()).astype(np.float32)


def _silence(seconds: float) -> np.ndarray:
    return np.zeros(int(SAMPLE_RATE * seconds), dtype=np.float32)


def test_the_speech_trace_shows_which_stretches_were_treated_as_speech() -> None:
    samples = np.concatenate([_vowel(4.0), _silence(1.0), _vowel(4.0)])
    report, _ = _speech_features(samples, SAMPLE_RATE, "speech_sustained_a")
    series = report["series"]
    assert len(series["trials_s"]) == 2
    start, end = series["trials_s"][0]
    assert end - start == pytest.approx(4.0, abs=0.3)
    assert series["duration_s"] == pytest.approx(9.0, abs=0.1)
    assert series["gate"] > 0


def test_the_sustained_vowel_carries_a_pitch_contour_per_trial() -> None:
    samples = np.concatenate([_vowel(4.0), _silence(1.0), _vowel(4.0)])
    report, _ = _speech_features(samples, SAMPLE_RATE, "speech_sustained_a")
    contours = report["series"]["f0"]
    assert len(contours) == 2
    voiced = [value for value in contours[0]["hz"] if value is not None]
    assert voiced and np.median(voiced) == pytest.approx(130.0, rel=0.1)


def test_unvoiced_frames_are_breaks_in_the_line_not_a_drop_to_zero() -> None:
    """Plotting an unvoiced frame as 0 Hz draws a spike to the axis that reads
    as a pitch collapse rather than as an absence of voicing."""
    samples = np.concatenate([_vowel(2.0), _silence(0.15), _vowel(2.0)])
    report, _ = _speech_features(samples, SAMPLE_RATE, "speech_sustained_a")
    for contour in report["series"]["f0"]:
        assert all(value is None or value > 0 for value in contour["hz"])


def test_a_blocked_speech_window_carries_no_trace() -> None:
    report, _ = _speech_features(_silence(6.0), SAMPLE_RATE, "speech_counting")
    assert report["available"] is False
    assert "series" not in report


def test_downsampling_preserves_the_shape_and_bounds_the_payload() -> None:
    ramp = np.linspace(0.0, 1.0, 100_000)
    thinned = _downsample(ramp, target=500)
    assert len(thinned) <= 501
    assert thinned[0] == pytest.approx(0.0)
    assert thinned[-1] == pytest.approx(1.0, abs=0.01)


def test_downsampling_leaves_a_short_series_untouched() -> None:
    assert _downsample([1.0, 2.0, 3.0], target=500) == [1.0, 2.0, 3.0]
