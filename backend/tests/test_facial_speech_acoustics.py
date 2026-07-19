"""Trial segmentation for the speech tasks.

Every speech task asks for repetitions inside a single timed window, so the
window is not one utterance. These tests pin the behaviour that follows from
that: features are measured per repetition, and rates are divided by the
duration of the repetition rather than of the whole window.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.facial_speech import (  # noqa: E402
    MIN_STEADY_PHONATION_S,
    STEADY_TRIM_S,
    _across_trials,
    _active_segments,
    _ddk_metrics,
    _speech_features,
)

SAMPLE_RATE = 16000


def _envelope_of(samples: np.ndarray) -> np.ndarray:
    frame = max(1, int(SAMPLE_RATE * 0.02))
    return np.sqrt(np.convolve(samples ** 2, np.ones(frame) / frame, mode="same"))


def _vowel(seconds: float, freq: float = 130.0, amplitude: float = 0.25) -> np.ndarray:
    """A periodic voiced-like signal: a fundamental plus two harmonics."""
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    wave = (
        np.sin(2 * np.pi * freq * t)
        + 0.5 * np.sin(2 * np.pi * 2 * freq * t)
        + 0.25 * np.sin(2 * np.pi * 3 * freq * t)
    )
    return (amplitude * wave / np.abs(wave).max()).astype(np.float32)


def _silence(seconds: float) -> np.ndarray:
    return np.zeros(int(SAMPLE_RATE * seconds), dtype=np.float32)


def _three_vowel_trials(vowel_s: float = 5.0, gap_s: float = 1.0) -> np.ndarray:
    """The battery's actual sustained-vowel window: 3 x /a/ with rests."""
    parts = []
    for index in range(3):
        if index:
            parts.append(_silence(gap_s))
        parts.append(_vowel(vowel_s))
    return np.concatenate(parts)


def _syllable_train(rate_hz: float, seconds: float) -> np.ndarray:
    """Amplitude-modulated bursts standing in for pa-ta-ka syllables."""
    total = int(SAMPLE_RATE * seconds)
    t = np.arange(total) / SAMPLE_RATE
    carrier = np.sin(2 * np.pi * 200.0 * t)
    gate = (np.sin(2 * np.pi * rate_hz * t) > 0.3).astype(np.float32)
    return (0.3 * carrier * gate).astype(np.float32)


def test_segmentation_finds_each_repetition() -> None:
    samples = _three_vowel_trials()
    segments = _active_segments(_envelope_of(samples), 0.02, SAMPLE_RATE)
    assert len(segments) == 3
    for start, end in segments:
        assert (end - start) / SAMPLE_RATE == pytest.approx(5.0, abs=0.2)


def test_segmentation_merges_only_short_gaps() -> None:
    samples = np.concatenate([_vowel(2.0), _silence(0.05), _vowel(2.0)])
    segments = _active_segments(_envelope_of(samples), 0.02, SAMPLE_RATE)
    assert len(segments) == 1, "a 50 ms gap is within one utterance, not between two"


def test_segmentation_discards_fragments_below_the_minimum() -> None:
    samples = np.concatenate([_vowel(2.0), _silence(1.0), _vowel(0.1), _silence(1.0)])
    segments = _active_segments(_envelope_of(samples), 0.02, SAMPLE_RATE)
    assert len(segments) == 1


def test_sustained_vowel_is_measured_per_trial() -> None:
    report, issues = _speech_features(_three_vowel_trials(), SAMPLE_RATE, "speech_sustained_a")
    assert report["available"] is True, issues
    assert report["trials_detected"] == 3
    assert report["usable_trials"] == 3
    assert report["f0_hz_median"]["n_trials"] == 3
    assert report["f0_hz_median"]["median"] == pytest.approx(130.0, rel=0.1)
    # Three identical trials must agree with each other.
    assert report["f0_hz_median"]["iqr"] == pytest.approx(0.0, abs=2.0)


def test_max_phonation_time_is_the_longest_trial_not_the_sum() -> None:
    samples = np.concatenate([_vowel(3.0), _silence(1.0), _vowel(6.0), _silence(1.0), _vowel(4.0)])
    report, _ = _speech_features(samples, SAMPLE_RATE, "speech_sustained_a")
    assert report["max_phonation_time_s"] == pytest.approx(6.0, abs=0.3)


def test_a_window_of_only_brief_phonations_is_refused() -> None:
    """Below the steady-state minimum there is nothing jitter can be read from."""
    too_short = 2 * STEADY_TRIM_S + MIN_STEADY_PHONATION_S - 0.6
    samples = np.concatenate([_vowel(too_short), _silence(1.0), _vowel(too_short)])
    report, issues = _speech_features(samples, SAMPLE_RATE, "speech_sustained_a")
    assert report["available"] is False
    assert "no-steady-phonation" in {issue["code"] for issue in issues}
    assert "jitter_local" not in report


def test_ddk_rate_uses_run_duration_not_window_duration() -> None:
    """The regression: two 10 s runs inside a 24 s window.

    Dividing the peak count by the full window - which includes the rest between
    runs - understated every subject's rate by roughly the duty cycle.
    """
    run, rest = 10.0, 4.0
    samples = np.concatenate([_syllable_train(5.0, run), _silence(rest), _syllable_train(5.0, run)])
    envelope = _envelope_of(samples)
    metrics = _ddk_metrics(envelope, SAMPLE_RATE, _active_segments(envelope, 0.02, SAMPLE_RATE), 0.3)
    assert metrics["usable_runs"] == 2
    rate = metrics["energy_peak_rate_hz"]["median"]
    assert rate == pytest.approx(5.0, rel=0.15)
    # The window-wide figure the old code produced would land near 4.2 Hz.
    window_rate = rate * (2 * run) / (2 * run + rest)
    assert abs(rate - window_rate) > 0.5


def test_ddk_rate_is_independent_of_recording_level() -> None:
    """Prominence scaled to the signal, not fixed in absolute amplitude."""
    samples = _syllable_train(5.0, 10.0)
    envelope = _envelope_of(samples)
    loud = _ddk_metrics(envelope, SAMPLE_RATE, _active_segments(envelope, 0.02, SAMPLE_RATE), 0.3)
    quiet_samples = samples * 0.1
    quiet_envelope = _envelope_of(quiet_samples)
    quiet = _ddk_metrics(
        quiet_envelope, SAMPLE_RATE, _active_segments(quiet_envelope, 0.002, SAMPLE_RATE), 0.03
    )
    assert quiet["energy_peak_rate_hz"]["median"] == pytest.approx(
        loud["energy_peak_rate_hz"]["median"], rel=0.05
    )


def test_connected_speech_reports_pause_structure() -> None:
    samples = np.concatenate([_vowel(2.0), _silence(1.0), _vowel(2.0), _silence(1.0), _vowel(2.0)])
    report, issues = _speech_features(samples, SAMPLE_RATE, "speech_counting")
    assert report["available"] is True, issues
    assert report["pause_count"] == 2
    assert report["pause_duration_s_median"] == pytest.approx(1.0, abs=0.2)
    assert report["speaking_time_ratio"] == pytest.approx(6.0 / 8.0, abs=0.1)
    assert report["pause_ratio"] == pytest.approx(1.0 - report["speaking_time_ratio"])


def test_across_trials_reports_spread_as_repeatability_evidence() -> None:
    aggregate = _across_trials([10.0, 12.0, 14.0])
    assert aggregate["median"] == 12.0
    assert aggregate["n_trials"] == 3
    assert aggregate["iqr"] == pytest.approx(2.0)
    assert aggregate["per_trial"] == [10.0, 12.0, 14.0]


def test_across_trials_drops_unmeasurable_repetitions() -> None:
    aggregate = _across_trials([10.0, None, float("nan"), 14.0])
    assert aggregate["n_trials"] == 2
    assert aggregate["median"] == 12.0


def test_across_trials_with_nothing_measurable_is_null_not_zero() -> None:
    aggregate = _across_trials([None, None])
    assert aggregate["median"] is None
    assert aggregate["n_trials"] == 0
