"""Offline, inspectable feature extraction for the facial-speech capture route.

This module intentionally reports measurements and quality gates, not a medical
diagnosis. Clinical decision thresholds are introduced only after the labelled
validation study described in docs/FACIAL_SPEECH_SCREENING.md.
"""
from __future__ import annotations

import base64
import json
import logging
import math
import subprocess
import tempfile
import wave
from pathlib import Path
from typing import Any, Callable

import numpy as np
from scipy.signal import find_peaks

# cv2 and mediapipe are imported inside analyze_facial_speech: they are only
# needed for video decoding, and keeping them out of module import lets the
# feature/geometry logic be unit-tested without the full vision stack.

logger = logging.getLogger(__name__)

Progress = Callable[[str, int, str], None]

# Quality gates. These are engineering acceptability thresholds for the
# *measurement*, not clinical decision thresholds: they decide whether a number
# may be reported at all, never what the number means. A blocking issue
# suppresses the affected measurements entirely, because a plausible-looking
# symmetric result produced from missing data is more dangerous than no result.
BLOCKING = "blocking"
ADVISORY = "advisory"

MIN_VALID_FACE_FRAME_RATIO = 0.75
MIN_BRIGHTNESS_0_255 = 55.0
MIN_BLUR_VARIANCE = 40.0
SAMPLE_INTERVAL_MS = 1000.0 / 15.0  # analyse 15 frames per second of video
MAX_HEAD_ROLL_DEG = 15.0
# Pose proxies are IPD-normalised offsets of midline landmarks, so their
# tolerances are in IPD units rather than degrees.
MAX_POSE_DRIFT_FROM_REST_IPD = 0.08
MAX_POSE_SPREAD_WITHIN_TASK_IPD = 0.10
MIN_TASK_FACE_FRAMES = 15  # ~1 s of usable video at SAMPLE_INTERVAL_MS
MAX_CLIPPING_RATIO = 0.01
MIN_SPEECH_ACTIVITY_RATIO = 0.20
MIN_SNR_DB = 15.0
NOISE_FLOOR_TASK = "capture_noise_floor"
# Shortest window that can still carry the task's measurement. Below this the
# subject did not perform the task for long enough to measure, whatever the
# audio quality.
# Onset scoop and offset decay are discarded before perturbation measures, and
# what remains must still be long enough for a stable estimate.
STEADY_TRIM_S = 0.5
MIN_STEADY_PHONATION_S = 1.5
MIN_SPEECH_DURATION_S = {
    "speech_sustained_a": 3.0,
    "speech_ddk_patka": 5.0,
    "speech_reading": 2.0,
    "speech_counting": 5.0,
}


def _issue(code: str, severity: str, scope: str, message: str) -> dict[str, str]:
    return {"code": code, "severity": severity, "scope": scope, "message": message}


def _blocking(issues: list[dict[str, str]]) -> bool:
    return any(issue["severity"] == BLOCKING for issue in issues)


def _median(values: list[float]) -> float | None:
    valid = [value for value in values if math.isfinite(value)]
    return float(np.median(valid)) if valid else None


def _peak(values: list[float]) -> float | None:
    """Excursion at its maximum, robust to a few mistracked frames.

    A movement window contains the movement *and* the relaxed periods around
    it, so a central statistic measures mostly rest.
    """
    valid = [value for value in values if math.isfinite(value)]
    return float(np.percentile(valid, 90)) if valid else None


def _trough(values: list[float]) -> float | None:
    """The counterpart of _peak for measures where closure is the extreme."""
    valid = [value for value in values if math.isfinite(value)]
    return float(np.percentile(valid, 10)) if valid else None


def _side_ratio(left: float | None, right: float | None) -> dict[str, Any]:
    """Left/right comparison that preserves *which* side is reduced.

    A bare min/max ratio is symmetric and therefore throws away the single most
    clinically relevant fact about facial weakness: the affected side. Callers
    get both raw sides, the weaker-over-stronger ratio, and an explicit side
    label. `left`/`right` are always the *subject's* anatomical sides.
    """
    if left is None or right is None or not math.isfinite(left) or not math.isfinite(right):
        return {"left": left, "right": right, "ratio_weaker_over_stronger": None, "weaker_side": None}
    if max(left, right) <= 1e-8:
        return {"left": float(left), "right": float(right), "ratio_weaker_over_stronger": None, "weaker_side": None}
    return {
        "left": float(left),
        "right": float(right),
        "ratio_weaker_over_stronger": float(min(left, right) / max(left, right)),
        "weaker_side": "left" if left < right else "right" if right < left else None,
    }


# MediaPipe FaceMesh landmark indices. MediaPipe names sides anatomically, from
# the *subject's* perspective, and the captured stream is never mirrored (the
# CSS preview mirror does not reach MediaRecorder), so image space and anatomy
# agree. Getting this backwards would report facial weakness on the wrong side,
# so the constants are named explicitly rather than inlined.
EYE_OUTER_R, EYE_OUTER_L = 33, 263
MOUTH_CORNER_R, MOUTH_CORNER_L = 61, 291
BROW_R, BROW_L = 105, 334
LID_UPPER_R, LID_LOWER_R = 159, 145
LID_UPPER_L, LID_LOWER_L = 386, 374
NOSE_BRIDGE, NOSE_TIP = 168, 4
SIDE_CONVENTION = "subject-anatomical"


def _pixel_points(points: list[Any], width: int, height: int) -> np.ndarray:
    """MediaPipe normalises x by frame width and y by frame height separately.

    Mixing those two scales in a Euclidean distance silently stretches the
    horizontal axis by the frame aspect ratio (1.78x at 16:9), which corrupts
    IPD and therefore every IPD-normalised measure, and makes results
    incomparable across capture resolutions. Convert to pixels first.
    """
    return np.array([[p.x * width, p.y * height] for p in points], dtype=np.float64)


def _distance(points: np.ndarray, first: int, second: int) -> float:
    return float(np.linalg.norm(points[first] - points[second]))


def _face_frame(points: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, float] | None:
    """A coordinate system carried by the face itself.

    Landmark positions in image space move whenever the head does. Measuring a
    smile as displacement from a rest position recorded ~30 s earlier therefore
    charged any head translation to both mouth corners at once, which pushed the
    left/right ratio toward 1.0 and masked real asymmetry - the failure
    direction that matters for a screening tool. Head roll separately faked
    vertical mouth-corner asymmetry.

    The basis is built from the outer eye corners, which barely move during
    facial expression: origin at their midpoint, u pointing toward the subject's
    left, v downward, both scaled by IPD. That removes translation, in-plane
    rotation and scale. Out-of-plane rotation is left to the head-pose gate.
    """
    eye_r, eye_l = points[EYE_OUTER_R], points[EYE_OUTER_L]
    origin = (eye_r + eye_l) / 2.0
    axis = eye_l - eye_r
    ipd = float(np.linalg.norm(axis))
    if ipd < 1.0:  # pixels; a face this small cannot support landmark geometry
        return None
    u = axis / ipd
    v = np.array([-u[1], u[0]])  # image y grows downward, so this points down
    return origin, u, v, ipd


def _local(point: np.ndarray, origin: np.ndarray, u: np.ndarray, v: np.ndarray, ipd: float) -> tuple[float, float]:
    offset = point - origin
    return float(np.dot(offset, u) / ipd), float(np.dot(offset, v) / ipd)


def _face_features(points: np.ndarray) -> dict[str, float] | None:
    # Every measure is normalised by IPD so it stays comparable when the subject
    # moves closer to the webcam. Sides follow SIDE_CONVENTION.
    frame = _face_frame(points)
    if frame is None:
        return None
    origin, u, v, ipd = frame
    mouth_l_u, mouth_l_v = _local(points[MOUTH_CORNER_L], origin, u, v, ipd)
    mouth_r_u, mouth_r_v = _local(points[MOUTH_CORNER_R], origin, u, v, ipd)
    # Head-pose proxies. Out-of-plane rotation biases every left/right
    # comparison - a turned head shortens one side of the face - so pose has to
    # be observable. These use bony midline landmarks (nasion, nose tip), which
    # facial nerve palsy does not displace, rather than the mimetic-muscle
    # landmarks being measured. They are relative, not calibrated angles: the
    # gate needs to know the head did not move *between* windows, which is
    # exactly what a rest-relative comparison answers.
    bridge_u, _ = _local(points[NOSE_BRIDGE], origin, u, v, ipd)
    _, tip_v = _local(points[NOSE_TIP], origin, u, v, ipd)
    return {
        "ipd": ipd,
        "roll_deg": float(math.degrees(math.atan2(u[1], u[0]))),
        "yaw_proxy": bridge_u,
        "pitch_proxy": tip_v,
        # Taken along the face's own vertical axis, so head roll no longer
        # registers as a dropped mouth corner.
        "mouth_corner_vertical_asymmetry": abs(mouth_l_v - mouth_r_v),
        "mouth_left_u": mouth_l_u,
        "mouth_left_v": mouth_l_v,
        "mouth_right_u": mouth_r_u,
        "mouth_right_v": mouth_r_v,
        "brow_left": _distance(points, BROW_L, LID_UPPER_L) / ipd,
        "brow_right": _distance(points, BROW_R, LID_UPPER_R) / ipd,
        "eye_left": _distance(points, LID_UPPER_L, LID_LOWER_L) / ipd,
        "eye_right": _distance(points, LID_UPPER_R, LID_LOWER_R) / ipd,
    }


def _window_samples(tasks: list[dict[str, Any]], task_id: str) -> tuple[float, float] | None:
    for task in tasks:
        if task.get("id") == task_id and "startedAtMs" in task and "endedAtMs" in task:
            start, end = float(task["startedAtMs"]), float(task["endedAtMs"])
            if end > start:
                return start, end
    return None


def _stream_start_times(video_path: str) -> dict[str, float]:
    """First presentation timestamp of each stream, in seconds.

    Task windows are recorded on the MediaRecorder clock, but the extracted WAV
    begins at the audio stream's first sample, which in a MediaRecorder WebM is
    not necessarily the container origin. Slicing audio with video-timeline
    offsets therefore drifts. Reading the container's own start times lets the
    two be reconciled instead of assumed equal.
    """
    command = [
        "ffprobe", "-v", "error",
        "-show_entries", "stream=codec_type,start_time",
        "-of", "json", video_path,
    ]
    starts: dict[str, float] = {}
    try:
        proc = subprocess.run(command, capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            return starts
        for stream in json.loads(proc.stdout).get("streams", []):
            codec_type = stream.get("codec_type")
            start_time = stream.get("start_time")
            if codec_type in ("audio", "video") and start_time not in (None, "N/A"):
                starts[codec_type] = float(start_time)
    except Exception:  # a missing or unparseable start time is handled by the caller
        return {}
    return starts


def _read_wav(path: Path) -> tuple[int, np.ndarray]:
    with wave.open(str(path), "rb") as source:
        sr = source.getframerate()
        frames = source.readframes(source.getnframes())
        width = source.getsampwidth()
        channels = source.getnchannels()
    if width != 2:
        raise RuntimeError(f"Expected 16-bit PCM WAV, got sample width {width}")
    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return sr, audio


def _audio_quality(samples: np.ndarray) -> dict[str, float]:
    if samples.size == 0:
        return {"duration_s": 0.0, "rms_dbfs": float("-inf"), "clipping_ratio": 1.0}
    rms = float(np.sqrt(np.mean(samples ** 2)))
    return {
        "duration_s": float(samples.size),  # converted after sample rate is known
        "rms_dbfs": float(20.0 * math.log10(max(rms, 1e-8))),
        "clipping_ratio": float(np.mean(np.abs(samples) >= 0.98)),
    }


def _speech_features(
    samples: np.ndarray,
    sample_rate: int,
    task_id: str,
    include_ddk: bool = False,
    session_noise_floor: float | None = None,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Acoustic features for one task window, gated before anything is computed.

    Acoustic measures are only interpretable on audio that actually contains
    enough usable speech, so the gates run first and a blocked window carries no
    feature values at all - there is nothing for a reader to misread.
    """
    issues: list[dict[str, str]] = []
    quality = _audio_quality(samples)
    quality["duration_s"] = float(samples.size / sample_rate) if sample_rate else 0.0

    # A transparent energy/VAD proxy. It is not used as a clinical diagnosis.
    frame = max(1, int(sample_rate * 0.02))
    envelope = (
        np.sqrt(np.convolve(samples ** 2, np.ones(frame) / frame, mode="same"))
        if samples.size
        else np.zeros(0)
    )
    peak = float(np.percentile(envelope, 95)) if envelope.size else 0.0
    floor_estimate = float(np.percentile(envelope, 5)) if envelope.size else 0.0
    # The low percentile is only a noise floor if the window actually contains
    # silence. A sustained vowel is voiced end to end, so its 5th percentile is
    # speech; treating that as noise put the gate above the signal and scored a
    # textbook-perfect /a/ as containing no speech at all.
    has_silence = floor_estimate < 0.3 * peak
    # The dedicated silence task measures the room directly, which is the only
    # way to know the noise floor of a window that is voiced end to end.
    noise_floor = session_noise_floor if session_noise_floor is not None else (floor_estimate if has_silence else 0.0)
    speech_gate = max(peak * 0.15, noise_floor * 1.5, 0.005)
    activity = float(np.mean(envelope > speech_gate)) if envelope.size else 0.0
    quality["speech_activity_ratio"] = activity
    quality["noise_floor_rms"] = noise_floor or None
    quality["noise_floor_source"] = "silence-task" if session_noise_floor is not None else (
        "within-window" if has_silence else None
    )
    quality["snr_db"] = (
        float(20.0 * math.log10(peak / noise_floor))
        if noise_floor > 1e-9 and peak > 1e-9
        else None
    )

    minimum = MIN_SPEECH_DURATION_S.get(task_id, 2.0)
    if quality["duration_s"] < minimum:
        issues.append(_issue(
            "speech-window-too-short", BLOCKING, task_id,
            f"The {task_id} window is {quality['duration_s']:.1f} s (minimum {minimum:.1f} s). Repeat the task.",
        ))
    if quality["clipping_ratio"] > MAX_CLIPPING_RATIO:
        issues.append(_issue(
            "audio-clipping", BLOCKING, task_id,
            f"{quality['clipping_ratio']:.1%} of samples are clipped in {task_id}. "
            "Reduce microphone gain or move further from the microphone and re-capture.",
        ))
    if quality["snr_db"] is not None and quality["snr_db"] < MIN_SNR_DB:
        issues.append(_issue(
            "audio-snr-low", BLOCKING, task_id,
            f"Speech in {task_id} is only {quality['snr_db']:.0f} dB above the room noise floor "
            f"(minimum {MIN_SNR_DB:.0f} dB). Acoustic measures are not interpretable at this level; "
            "move to a quieter room and re-capture.",
        ))
    if activity < MIN_SPEECH_ACTIVITY_RATIO:
        issues.append(_issue(
            "speech-activity-low", BLOCKING, task_id,
            f"Only {activity:.0%} of the {task_id} window contains speech-level energy "
            f"(minimum {MIN_SPEECH_ACTIVITY_RATIO:.0%}). Speak closer to the microphone and repeat the task.",
        ))
    if _blocking(issues):
        return {"quality": quality, "available": False}, issues

    trials = _active_segments(envelope, speech_gate, sample_rate)
    result: dict[str, Any] = {
        "quality": quality,
        "available": True,
        "speech_activity_ratio": activity,
        "trials_detected": len(trials),
    }
    if not trials:
        issues.append(_issue(
            "no-speech-trial-detected", BLOCKING, task_id,
            f"No continuous speech segment could be isolated in {task_id}. Repeat the task.",
        ))
        result["available"] = False
        return result, issues

    # The trace behind the numbers: which stretches were treated as speech, and
    # where the gate sat. Without it, "2 trials detected" from a 3-repetition
    # task is an assertion a reviewer has no way to check.
    result["series"] = {
        "duration_s": float(samples.size / sample_rate),
        "envelope": _downsample(envelope),
        "gate": speech_gate,
        "trials_s": [[start / sample_rate, end / sample_rate] for start, end in trials],
    }

    if task_id == "speech_sustained_a":
        result.update(_sustained_vowel_metrics(samples, sample_rate, trials, task_id, issues))
        result["series"]["f0"] = _f0_contour(samples, sample_rate, trials)
    elif include_ddk:
        result.update(_ddk_metrics(envelope, sample_rate, trials, peak))
    else:
        result.update(_connected_speech_metrics(samples, sample_rate, trials))
    return result, issues


def _f0_contour(samples: np.ndarray, sample_rate: int, trials: list[tuple[int, int]]) -> list[dict[str, Any]]:
    """Pitch track per phonation, so pitch instability is visible as a shape.

    A median and an SD cannot distinguish a steady voice from one that drifts or
    breaks; the contour can, and voice breaks show up as gaps.
    """
    contours: list[dict[str, Any]] = []
    try:
        import parselmouth
    except Exception:
        return contours
    for index, (start, end) in enumerate(trials):
        segment = samples[start:end]
        if segment.size < sample_rate:
            continue
        try:
            sound = parselmouth.Sound(segment, sampling_frequency=sample_rate)
            floor, ceiling = _pitch_range(sound)
            pitch = sound.to_pitch(time_step=0.01, pitch_floor=floor, pitch_ceiling=ceiling)
            values = pitch.selected_array["frequency"]
        except Exception:
            continue
        contours.append({
            "trial": index + 1,
            "start_s": start / sample_rate,
            "step_s": 0.01,
            # Unvoiced frames come back as 0; null keeps them as breaks in the
            # line rather than a plunge to the axis.
            "hz": [float(value) if value > 0 else None for value in _downsample(values, 400)],
        })
    return contours


def _active_segments(
    envelope: np.ndarray,
    gate: float,
    sample_rate: int,
    min_duration_s: float = 0.4,
    merge_gap_s: float = 0.2,
) -> list[tuple[int, int]]:
    """Split a task window into the individual trials the subject performed.

    Every task in the battery asks for repetitions inside one window - three
    sustained vowels, two DDK runs - so the window is not a single utterance.
    Measuring across it treats the silences between repetitions as part of the
    signal, which is why segmentation has to happen before any acoustic
    feature is computed.
    """
    if not envelope.size:
        return []
    active = envelope > gate
    edges = np.diff(active.astype(np.int8))
    starts = list(np.flatnonzero(edges == 1) + 1)
    ends = list(np.flatnonzero(edges == -1) + 1)
    if active[0]:
        starts.insert(0, 0)
    if active[-1]:
        ends.append(active.size)

    merge_gap = int(merge_gap_s * sample_rate)
    merged: list[list[int]] = []
    for start, end in zip(starts, ends):
        if merged and start - merged[-1][1] <= merge_gap:
            merged[-1][1] = end
        else:
            merged.append([start, end])

    minimum = int(min_duration_s * sample_rate)
    return [(start, end) for start, end in merged if end - start >= minimum]


def _pitch_range(sound: Any) -> tuple[float, float]:
    """Two-pass pitch floor/ceiling.

    A fixed 60-500 Hz range spans well over an octave for any single speaker,
    which invites octave errors - and an octave error corrupts jitter and
    shimmer far more than it moves F0. The first pass finds the speaker's own
    range and the second pass brackets it.
    """
    try:
        rough = sound.to_pitch(time_step=0.01, pitch_floor=60, pitch_ceiling=600)
        values = rough.selected_array["frequency"]
        values = values[values > 0]
        if not len(values):
            return 60.0, 500.0
        centre = float(np.median(values))
        return max(50.0, min(centre * 0.6, 200.0)), min(800.0, max(centre * 1.8, 300.0))
    except Exception:
        return 60.0, 500.0


def _voice_quality(segment: np.ndarray, sample_rate: int) -> dict[str, Any] | None:
    """Perturbation and harmonicity measures for ONE steady phonation.

    Jitter and shimmer are cycle-to-cycle measures, so they are only defined on
    a continuously voiced stretch. Running them across a window containing three
    separate vowels plus the pauses between them measures the gaps as if they
    were glottal cycles and returns a meaningless number - one that would then
    be compared against thresholds (jitter < 1.04%, shimmer < 3.81%, HNR > 20 dB)
    defined only on a single steady vowel.
    """
    try:
        import parselmouth
    except Exception:
        return None
    try:
        sound = parselmouth.Sound(segment, sampling_frequency=sample_rate)
        floor, ceiling = _pitch_range(sound)
        pitch = sound.to_pitch(time_step=0.01, pitch_floor=floor, pitch_ceiling=ceiling)
        f0 = pitch.selected_array["frequency"]
        f0 = f0[f0 > 0]
        if not len(f0):
            return None
        intensity = sound.to_intensity(time_step=0.01).values[0]
        harmonicity = sound.to_harmonicity_cc(time_step=0.01, minimum_pitch=floor).values[0]
        harmonicity = harmonicity[np.isfinite(harmonicity)]
        measures: dict[str, Any] = {
            "f0_hz_median": float(np.median(f0)),
            "f0_hz_sd": float(np.std(f0)),
            "pitch_floor_hz": floor,
            "pitch_ceiling_hz": ceiling,
            "intensity_db_median": float(np.median(intensity)) if len(intensity) else None,
            "hnr_db_median": float(np.median(harmonicity)) if len(harmonicity) else None,
        }
        try:
            point_process = parselmouth.praat.call([sound, pitch], "To PointProcess (cc)")
            measures["jitter_local"] = float(parselmouth.praat.call(
                point_process, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3
            ))
            measures["shimmer_local"] = float(parselmouth.praat.call(
                [sound, point_process], "Get shimmer (local)", 0, 0, 0.0001, 0.02, 1.3, 1.6
            ))
        except Exception:  # requires a sufficiently periodic signal
            measures["jitter_local"] = None
            measures["shimmer_local"] = None
        return measures
    except Exception:
        return None


def _across_trials(values: list[float | None]) -> dict[str, Any]:
    """Median across repetitions plus the spread between them.

    The spread is the within-session test-retest evidence the validation plan
    asks for, and it comes free once trials are measured separately.
    """
    valid = [float(value) for value in values if value is not None and math.isfinite(value)]
    if not valid:
        return {"median": None, "iqr": None, "n_trials": 0, "per_trial": []}
    return {
        "median": float(np.median(valid)),
        "iqr": float(np.percentile(valid, 75) - np.percentile(valid, 25)) if len(valid) > 1 else 0.0,
        "n_trials": len(valid),
        "per_trial": valid,
    }


def _sustained_vowel_metrics(
    samples: np.ndarray,
    sample_rate: int,
    trials: list[tuple[int, int]],
    task_id: str,
    issues: list[dict[str, str]],
) -> dict[str, Any]:
    trim = int(STEADY_TRIM_S * sample_rate)
    minimum = int(MIN_STEADY_PHONATION_S * sample_rate)
    per_trial: list[dict[str, Any]] = []
    for start, end in trials:
        # Onset and offset carry the pitch scoop and decay, which are not part
        # of steady phonation; the standard practice is to measure the middle.
        steady = samples[start + trim:end - trim]
        if steady.size < minimum:
            continue
        measures = _voice_quality(steady, sample_rate)
        if measures:
            measures["steady_duration_s"] = float(steady.size / sample_rate)
            per_trial.append(measures)

    if not per_trial:
        issues.append(_issue(
            "no-steady-phonation", BLOCKING, task_id,
            f"No sustained phonation of at least {MIN_STEADY_PHONATION_S:.0f} s (after trimming onset and offset) "
            "was found. Take a breath and hold each vowel steadily.",
        ))
        return {"available": False}

    keys = ("f0_hz_median", "f0_hz_sd", "intensity_db_median", "hnr_db_median", "jitter_local", "shimmer_local")
    metrics: dict[str, Any] = {key: _across_trials([trial.get(key) for trial in per_trial]) for key in keys}
    # Maximum phonation time: the longest single trial, not the sum, and read
    # off the untrimmed segment because it is a duration, not a quality measure.
    metrics["max_phonation_time_s"] = float(max((end - start) / sample_rate for start, end in trials))
    metrics["usable_trials"] = len(per_trial)
    return metrics


def _ddk_metrics(
    envelope: np.ndarray,
    sample_rate: int,
    trials: list[tuple[int, int]],
    peak_level: float,
) -> dict[str, Any]:
    """Syllable-timing proxy, computed per DDK run.

    Rate must be divided by the duration of the run, not of the whole task
    window: the window holds two runs plus the rest between them, so dividing by
    it understated every subject's rate by roughly half. Peak prominence is
    scaled to the recording level rather than fixed in absolute amplitude, so
    the same speaker does not score differently on a quieter microphone.
    """
    rates: list[float | None] = []
    cvs: list[float | None] = []
    for start, end in trials:
        run = envelope[start:end]
        duration = (end - start) / sample_rate
        if duration < 1.0:
            continue
        peaks, _ = find_peaks(
            run,
            distance=max(1, int(sample_rate * 0.09)),  # caps the rate at ~11 syll/s
            prominence=max(peak_level * 0.15, 1e-4),
        )
        rates.append(float(len(peaks) / duration))
        if len(peaks) >= 3:
            intervals = np.diff(peaks) / sample_rate
            cvs.append(float(np.std(intervals) / max(float(np.mean(intervals)), 1e-6)))
        else:
            cvs.append(None)
    return {
        # Deliberately not called a syllable rate: unvoiced stop closures in
        # pa-ta-ka do not always produce a separate energy peak, so this is a
        # proxy and must not be read against published DDK norms.
        "energy_peak_rate_hz": _across_trials(rates),
        "peak_interval_cv": _across_trials(cvs),
        "usable_runs": len([rate for rate in rates if rate is not None]),
    }


def _connected_speech_metrics(
    samples: np.ndarray,
    sample_rate: int,
    trials: list[tuple[int, int]],
) -> dict[str, Any]:
    """Timing structure of connected speech: phonation versus pausing."""
    total_s = samples.size / sample_rate
    speaking_s = sum((end - start) for start, end in trials) / sample_rate
    pauses = [
        (trials[index + 1][0] - trials[index][1]) / sample_rate
        for index in range(len(trials) - 1)
    ]
    voice = _voice_quality(samples[trials[0][0]:trials[-1][1]], sample_rate) or {}
    return {
        "speaking_time_ratio": float(speaking_s / total_s) if total_s > 0 else None,
        "pause_ratio": float(1.0 - speaking_s / total_s) if total_s > 0 else None,
        "pause_count": len(pauses),
        "pause_duration_s_median": _median(pauses),
        "phonation_segments": len(trials),
        "f0_hz_median": voice.get("f0_hz_median"),
        "f0_hz_sd": voice.get("f0_hz_sd"),
        "intensity_db_median": voice.get("intensity_db_median"),
    }


def _head_pose_stable(
    frames: list[dict[str, float]],
    rest_yaw: float | None,
    rest_pitch: float | None,
    task_id: str,
    issues: list[dict[str, str]],
) -> bool:
    """Reject a movement window whose head pose differs from the baseline.

    Every facial measurement here is rest-relative, so it is only valid if the
    head is in the same pose in both windows. Turning toward one side
    foreshortens that side of the face and produces exactly the left/right
    difference the module is looking for, which is the worst possible confound
    for this measurement. The capture manifest has always claimed
    requireStableHeadPose; this is where that claim is honoured.
    """
    roll = _median([item["roll_deg"] for item in frames])
    if roll is not None and abs(roll) > MAX_HEAD_ROLL_DEG:
        issues.append(_issue(
            "head-roll-excessive", BLOCKING, task_id,
            f"The head is tilted {abs(roll):.0f} deg during {task_id} (maximum {MAX_HEAD_ROLL_DEG:.0f} deg). "
            "Keep the head level and repeat the task.",
        ))
        return False

    for name, rest_value, key in (("yaw", rest_yaw, "yaw_proxy"), ("pitch", rest_pitch, "pitch_proxy")):
        current = _median([item[key] for item in frames])
        if rest_value is None or current is None:
            continue
        if abs(current - rest_value) > MAX_POSE_DRIFT_FROM_REST_IPD:
            issues.append(_issue(
                f"head-{name}-drift", BLOCKING, task_id,
                f"Head {name} during {task_id} differs from the rest baseline by "
                f"{abs(current - rest_value):.2f} IPD (maximum {MAX_POSE_DRIFT_FROM_REST_IPD:.2f}). "
                "Rest-relative measurement needs the same head pose in both windows; repeat the task facing the camera.",
            ))
            return False
        spread = float(np.percentile([item[key] for item in frames], 90) - np.percentile([item[key] for item in frames], 10))
        if spread > MAX_POSE_SPREAD_WITHIN_TASK_IPD:
            issues.append(_issue(
                f"head-{name}-unsteady", BLOCKING, task_id,
                f"The head moved in {name} during {task_id} (spread {spread:.2f} IPD, maximum "
                f"{MAX_POSE_SPREAD_WITHIN_TASK_IPD:.2f}). Hold the head still and repeat the task.",
            ))
            return False
    return True


def _upper_versus_lower(brow: dict[str, Any], smile: dict[str, Any]) -> dict[str, Any]:
    """How upper-face and lower-face weakness compare on the same side.

    Whether the forehead is involved is the classic discriminator between an
    upper motor neuron lesion, which tends to spare it, and a peripheral facial
    nerve palsy, which does not. Both halves of that comparison were already
    being measured and never put together.

    Reported as a raw measurement with no cut-off. Turning the gap into a
    pattern label requires the labelled validation study; a threshold invented
    here would be exactly the unvalidated clinical claim the design forbids.
    """
    brow_ratio = brow.get("ratio_weaker_over_stronger")
    smile_ratio = smile.get("ratio_weaker_over_stronger")
    if brow_ratio is None or smile_ratio is None:
        return {"symmetry_gap": None, "same_weaker_side": None, "interpretation": "uncalibrated-descriptor"}
    return {
        # Positive means the upper face is more symmetric than the lower face,
        # i.e. the direction consistent with forehead sparing.
        "symmetry_gap": float(brow_ratio - smile_ratio),
        "same_weaker_side": (
            brow.get("weaker_side") == smile.get("weaker_side")
            if brow.get("weaker_side") and smile.get("weaker_side")
            else None
        ),
        "interpretation": "uncalibrated-descriptor",
    }


def _downsample(values: list[float] | np.ndarray, target: int = 600) -> list[float]:
    """Thin a series for transport. Charts cannot resolve more than a few
    hundred points across a panel, and the raw arrays are per-sample."""
    array = np.asarray(values, dtype=np.float64)
    if array.size <= target:
        return [float(value) for value in array]
    step = int(np.ceil(array.size / target))
    return [float(value) for value in array[::step]]


def _blank_face_metrics() -> dict[str, Any]:
    return {
        "side_convention": SIDE_CONVENTION,
        "resting_mouth_corner_vertical_asymmetry_ipd": None,
        "smile_excursion_ipd": _side_ratio(None, None),
        "brow_excursion_ipd": _side_ratio(None, None),
        "eye_closure_residual_ratio": _side_ratio(None, None),
        "ocular_narrowing_during_smile": _side_ratio(None, None),
        "upper_versus_lower_face": _upper_versus_lower({}, {}),
    }


def _face_metrics(
    task_frames: dict[str, list[dict[str, float]]],
    face_quality: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Derive facial measurements, or refuse to.

    Every voluntary-movement measure is expressed relative to the subject's own
    neutral frame, so without a usable rest window there is no baseline and no
    measurement. Earlier revisions substituted the current frame for a missing
    baseline, which made the deltas exactly zero and the left/right ratios
    exactly 1.0 - a missing capture rendered as a perfectly symmetric face. The
    gates below fail closed instead: metrics stay null and the reason is named.
    """
    issues: list[dict[str, str]] = []
    metrics = _blank_face_metrics()

    ratio = face_quality["valid_face_frame_ratio"]
    if ratio < MIN_VALID_FACE_FRAME_RATIO:
        issues.append(_issue(
            "face-visibility-low", BLOCKING, "face",
            f"A usable face was found in only {ratio:.0%} of sampled frames "
            f"(minimum {MIN_VALID_FACE_FRAME_RATIO:.0%}). Re-capture with the face centred and unoccluded.",
        ))
    brightness = face_quality["brightness_median_0_255"]
    if brightness is None or brightness < MIN_BRIGHTNESS_0_255:
        issues.append(_issue(
            "illumination-low", BLOCKING, "face",
            "Facial illumination is too low for reliable landmark geometry. Add diffuse front lighting and re-capture.",
        ))
    blur = face_quality["blur_variance_median"]
    if blur is None or blur < MIN_BLUR_VARIANCE:
        issues.append(_issue(
            "image-blurred", BLOCKING, "face",
            "The video is too blurred for landmark precision. Hold the camera steady, clean the lens and re-capture.",
        ))

    rest = task_frames.get("face_rest") or []
    if len(rest) < MIN_TASK_FACE_FRAMES:
        issues.append(_issue(
            "rest-baseline-missing", BLOCKING, "face_rest",
            f"The rest window yielded {len(rest)} usable frames (minimum {MIN_TASK_FACE_FRAMES}). "
            "Voluntary-movement measures need a neutral baseline, so none can be reported.",
        ))

    if _blocking(issues):
        return metrics, issues, {"series": {}, "key_frame_t_ms": {}}

    metrics["resting_mouth_corner_vertical_asymmetry_ipd"] = _median(
        [item["mouth_corner_vertical_asymmetry"] for item in rest]
    )
    rest_mouth_left = np.median(np.array([[item["mouth_left_u"], item["mouth_left_v"]] for item in rest]), axis=0)
    rest_mouth_right = np.median(np.array([[item["mouth_right_u"], item["mouth_right_v"]] for item in rest]), axis=0)
    rest_brow_left = _median([item["brow_left"] for item in rest])
    rest_brow_right = _median([item["brow_right"] for item in rest])
    rest_eye_left = _median([item["eye_left"] for item in rest])
    rest_eye_right = _median([item["eye_right"] for item in rest])

    rest_yaw = _median([item["yaw_proxy"] for item in rest])
    rest_pitch = _median([item["pitch_proxy"] for item in rest])

    def movement_frames(task_id: str) -> list[dict[str, float]] | None:
        frames = task_frames.get(task_id) or []
        if len(frames) < MIN_TASK_FACE_FRAMES:
            issues.append(_issue(
                "task-window-unusable", BLOCKING, task_id,
                f"The {task_id} window yielded {len(frames)} usable frames (minimum {MIN_TASK_FACE_FRAMES}); "
                "this measurement is withheld.",
            ))
            return None
        if not _head_pose_stable(frames, rest_yaw, rest_pitch, task_id, issues):
            return None
        return frames

    series: dict[str, Any] = {}
    key_frames: dict[str, float] = {"rest": _median([item["t_ms"] for item in rest]) or 0.0}

    def record_series(task_id: str, frames: list[dict[str, float]], label: str, unit: str,
                      left: list[float], right: list[float], peak_key: str, use_trough: bool = False) -> None:
        """Keep the per-frame trace behind each summary number.

        A single ratio cannot show whether the subject performed the movement
        twice as asked, whether the two sides peaked together, or whether the
        window caught a mistrack - all of which a reviewer needs before
        trusting the summary.
        """
        combined = [(a + b) / 2 for a, b in zip(left, right)]
        index = int(np.argmin(combined) if use_trough else np.argmax(combined))
        key_frames[peak_key] = frames[index]["t_ms"]
        series[task_id] = {
            "label": label,
            "unit": unit,
            "t_ms": [item["t_ms"] for item in frames],
            "left": left,
            "right": right,
            "peak_t_ms": frames[index]["t_ms"],
        }

    smile = movement_frames("face_smile_show_teeth")
    if smile is not None:
        # Coordinates are already IPD-normalised and head-motion compensated.
        left = [
            float(math.hypot(item["mouth_left_u"] - rest_mouth_left[0], item["mouth_left_v"] - rest_mouth_left[1]))
            for item in smile
        ]
        right = [
            float(math.hypot(item["mouth_right_u"] - rest_mouth_right[0], item["mouth_right_v"] - rest_mouth_right[1]))
            for item in smile
        ]
        metrics["smile_excursion_ipd"] = _side_ratio(_peak(left), _peak(right))
        record_series("face_smile_show_teeth", smile, "Mouth-corner excursion from rest", "IPD", left, right, "smile_peak")

    brow = movement_frames("face_brow_raise")
    if brow is not None and rest_brow_left is not None and rest_brow_right is not None:
        # The window holds two raises separated by relaxed periods, so its
        # median is dominated by rest and lands near zero; dividing two
        # near-zero medians produced noise. Take the excursion at its peak, as
        # the smile measure already did.
        left = [max(0.0, item["brow_left"] - rest_brow_left) for item in brow]
        right = [max(0.0, item["brow_right"] - rest_brow_right) for item in brow]
        metrics["brow_excursion_ipd"] = _side_ratio(_peak(left), _peak(right))
        record_series("face_brow_raise", brow, "Brow elevation from rest", "IPD", left, right, "brow_peak")

    if smile is not None and rest_eye_left and rest_eye_right:
        # Synkinesis proxy: involuntary eye narrowing while smiling, which is a
        # Sunnybrook component the battery already captures but never read. The
        # frames are already in hand from the smile window.
        metrics["ocular_narrowing_during_smile"] = _side_ratio(
            _trough([item["eye_left"] / rest_eye_left for item in smile]),
            _trough([item["eye_right"] / rest_eye_right for item in smile]),
        )

    metrics["upper_versus_lower_face"] = _upper_versus_lower(
        metrics["brow_excursion_ipd"], metrics["smile_excursion_ipd"]
    )

    closure = movement_frames("face_eye_closure")
    if closure is not None and rest_eye_left and rest_eye_right:
        # Residual aperture at maximum closure. A low percentile rather than the
        # outright minimum, so one mistracked frame cannot define the result.
        left = [item["eye_left"] / rest_eye_left for item in closure]
        right = [item["eye_right"] / rest_eye_right for item in closure]
        metrics["eye_closure_residual_ratio"] = _side_ratio(_trough(left), _trough(right))
        record_series(
            "face_eye_closure", closure, "Eye aperture relative to rest", "ratio",
            left, right, "eye_closed", use_trough=True,
        )

    return metrics, issues, {"series": series, "key_frame_t_ms": key_frames}


# Series colours, matched to the frontend charts so a landmark drawn on a face
# and a line on a plot mean the same side. Left is blue, right is green; both
# are also labelled, so identity never rests on colour alone.
_SIDE_BGR = {"left": (229, 135, 57), "right": (0, 131, 0)}


def _annotate_frame(
    cv2: Any,
    frame: np.ndarray,
    points: np.ndarray,
    caption: str,
    rest_mouth: dict[str, tuple[float, float]] | None = None,
) -> np.ndarray:
    """Draw the measurement onto the frame it was taken from.

    A reviewer cannot judge a landmark-derived number without seeing where the
    landmarks landed. This renders the face-local axes the measurement uses, the
    two mouth corners in their series colours, and - when a rest reference is
    available - the displacement vector that the excursion figure is the length
    of.
    """
    canvas = frame.copy()
    geometry = _face_frame(points)
    if geometry is not None:
        origin, u, v, ipd = geometry
        # The facial midline: the axis every symmetry measure is taken across.
        top = origin - v * ipd * 0.9
        bottom = origin + v * ipd * 1.6
        cv2.line(canvas, tuple(top.astype(int)), tuple(bottom.astype(int)), (120, 120, 120), 1, cv2.LINE_AA)
        # The interocular line, which sets scale and in-plane rotation.
        cv2.line(
            canvas,
            tuple(points[EYE_OUTER_R].astype(int)),
            tuple(points[EYE_OUTER_L].astype(int)),
            (120, 120, 120), 1, cv2.LINE_AA,
        )
        for side, index in (("left", MOUTH_CORNER_L), ("right", MOUTH_CORNER_R)):
            point = points[index].astype(int)
            colour = _SIDE_BGR[side]
            if rest_mouth and side in rest_mouth:
                anchor = origin + u * (rest_mouth[side][0] * ipd) + v * (rest_mouth[side][1] * ipd)
                cv2.arrowedLine(canvas, tuple(anchor.astype(int)), tuple(point), colour, 2, cv2.LINE_AA, tipLength=0.25)
            cv2.circle(canvas, tuple(point), 5, colour, -1, cv2.LINE_AA)
            cv2.circle(canvas, tuple(point), 5, (255, 255, 255), 1, cv2.LINE_AA)
            label_x = point[0] + (12 if side == "left" else -28)
            cv2.putText(canvas, side[0].upper(), (label_x, point[1] + 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
        for index in (BROW_L, BROW_R, LID_UPPER_L, LID_UPPER_R, LID_LOWER_L, LID_LOWER_R):
            cv2.circle(canvas, tuple(points[index].astype(int)), 3, (200, 200, 200), -1, cv2.LINE_AA)

    cv2.rectangle(canvas, (0, 0), (canvas.shape[1], 28), (20, 20, 20), -1)
    cv2.putText(canvas, caption, (10, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (240, 240, 240), 1, cv2.LINE_AA)
    return canvas


def _render_key_frames(
    cv2: Any,
    mp: Any,
    video_path: str,
    targets: dict[str, float],
    rest_mouth: dict[str, tuple[float, float]] | None,
    width: int = 480,
) -> dict[str, str]:
    """Re-decode only the handful of frames worth showing.

    A second pass is cheaper than it looks and far cheaper than holding every
    sampled frame in memory against the chance it turns out to be the peak.
    """
    if not targets:
        return {}
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {}
    wanted = sorted(targets.items(), key=lambda item: item[1])
    rendered: dict[str, str] = {}
    face_mesh = mp.solutions.face_mesh.FaceMesh(
        static_image_mode=True, max_num_faces=1, refine_landmarks=True, min_detection_confidence=0.5
    )
    try:
        for name, t_ms in wanted:
            cap.set(cv2.CAP_PROP_POS_MSEC, float(t_ms))
            ok, frame = cap.read()
            if not ok:
                continue
            height, frame_width = frame.shape[:2]
            detected = face_mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).multi_face_landmarks
            if not detected:
                continue
            points = _pixel_points(detected[0].landmark, frame_width, height)
            caption = f"{name.replace('_', ' ')}  ·  t = {t_ms / 1000.0:.1f}s"
            annotated = _annotate_frame(
                cv2, frame, points, caption, rest_mouth if name != "rest" else None
            )
            scale = width / annotated.shape[1]
            annotated = cv2.resize(annotated, (width, int(annotated.shape[0] * scale)), interpolation=cv2.INTER_AREA)
            ok, buffer = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 78])
            if ok:
                rendered[name] = "data:image/jpeg;base64," + base64.b64encode(buffer.tobytes()).decode("ascii")
    finally:
        face_mesh.close()
        cap.release()
    return rendered


def analyze_facial_speech(video_path: str, payload: dict[str, Any], progress: Progress) -> dict[str, Any]:
    tasks = payload.get("tasks") or []
    if not tasks:
        raise ValueError("Metadata has no completed task windows. Complete every task before processing.")

    progress("face_quality", 20, "Checking face visibility, framing, and facial movement windows")
    try:
        import cv2
        import mediapipe as mp
    except ImportError as exc:
        raise RuntimeError("MediaPipe/OpenCV are not installed. Rebuild the Docker backend after updating requirements.") from exc

    stream_starts = _stream_start_times(video_path)
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("Unable to open the uploaded capture video.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = 0
    sampled_frames = 0
    valid_frames = 0
    next_sample_ms = 0.0
    timestamps_usable = True
    brightness: list[float] = []
    blur: list[float] = []
    task_frames: dict[str, list[dict[str, float]]] = {task["id"]: [] for task in tasks if task.get("id")}
    task_windows = {task["id"]: _window_samples(tasks, task["id"]) for task in tasks if task.get("id")}

    face_mesh = mp.solutions.face_mesh.FaceMesh(
        static_image_mode=False,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame_count += 1
            # Sample on the media clock, not on the frame index. MediaRecorder
            # WebM is variable frame rate, so taking every other frame both
            # sampled unevenly in time and made the valid-frame ratio a
            # per-frame rather than per-second figure.
            t_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
            if not t_ms and frame_count > 1:
                timestamps_usable = False
            if not timestamps_usable:
                t_ms = (frame_count - 1) * 1000.0 / fps
            if t_ms < next_sample_ms:
                continue
            next_sample_ms = t_ms + SAMPLE_INTERVAL_MS
            sampled_frames += 1
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            brightness.append(float(np.mean(gray)))
            blur.append(float(cv2.Laplacian(gray, cv2.CV_64F).var()))
            detected = face_mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).multi_face_landmarks
            if not detected:
                continue
            height, width = frame.shape[:2]
            features = _face_features(_pixel_points(detected[0].landmark, width, height))
            if features is None:
                continue
            valid_frames += 1
            features["t_ms"] = t_ms
            for task_id, window in task_windows.items():
                if window and window[0] <= t_ms <= window[1]:
                    task_frames[task_id].append(features)
    finally:
        face_mesh.close()
        cap.release()

    face_quality = {
        "decoded_frames": frame_count,
        "sampled_frames": sampled_frames,
        "valid_face_frame_ratio": float(valid_frames / max(sampled_frames, 1)),
        "brightness_median_0_255": _median(brightness),
        "blur_variance_median": _median(blur),
        "frame_timestamps_from_container": timestamps_usable,
    }
    face_metrics, face_issues, face_visuals = _face_metrics(task_frames, face_quality)

    progress("key_frames", 42, "Rendering annotated frames at rest and at each movement peak")
    rest_frames = task_frames.get("face_rest") or []
    rest_mouth = (
        {
            "left": (float(np.median([item["mouth_left_u"] for item in rest_frames])),
                     float(np.median([item["mouth_left_v"] for item in rest_frames]))),
            "right": (float(np.median([item["mouth_right_u"] for item in rest_frames])),
                      float(np.median([item["mouth_right_v"] for item in rest_frames]))),
        }
        if rest_frames
        else None
    )
    try:
        key_frame_images = _render_key_frames(cv2, mp, video_path, face_visuals["key_frame_t_ms"], rest_mouth)
    except Exception:  # illustration must never take the measurement down with it
        logger.exception("failed to render facial-speech key frames")
        key_frame_images = {}

    progress("speech", 58, "Extracting audio windows and acoustic speech features")
    with tempfile.TemporaryDirectory(prefix="facial-speech-") as temp_dir:
        wav_path = Path(temp_dir) / "audio.wav"
        command = ["ffmpeg", "-y", "-i", video_path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav_path)]
        proc = subprocess.run(command, capture_output=True, text=True, check=False)
        if proc.returncode != 0 or not wav_path.exists():
            raise RuntimeError("FFmpeg could not extract audio from the WebM recording.")
        sample_rate, audio = _read_wav(wav_path)
        speech_tasks: dict[str, Any] = {}
        speech_issues: list[dict[str, str]] = []
        # The WAV starts at the audio stream's first sample; shift task windows
        # onto that timeline rather than assuming both streams share an origin.
        audio_offset_s = stream_starts.get("audio", 0.0) - stream_starts.get("video", 0.0)
        if not stream_starts:
            speech_issues.append(_issue(
                "stream-timing-unknown", ADVISORY, "speech",
                "ffprobe reported no per-stream start times, so audio and video are assumed to share an origin. "
                "Any container-level A/V offset is uncorrected.",
            ))
        def window_slice(task_id: str) -> np.ndarray | None:
            window = _window_samples(tasks, task_id)
            if not window:
                return None
            start = max(0, int((window[0] / 1000.0 - audio_offset_s) * sample_rate))
            end = min(len(audio), int((window[1] / 1000.0 - audio_offset_s) * sample_rate))
            return audio[start:end] if end > start else None

        # Measure the room directly rather than inferring it from speech.
        silence = window_slice(NOISE_FLOOR_TASK)
        session_noise_floor = float(np.sqrt(np.mean(silence ** 2))) if silence is not None and silence.size else None
        if session_noise_floor is None:
            speech_issues.append(_issue(
                "noise-floor-not-captured", ADVISORY, NOISE_FLOOR_TASK,
                "The silence task is missing, so SNR is estimated from quiet moments inside each speech window. "
                "That is unreliable for continuously voiced tasks such as the sustained vowel.",
            ))

        for task_id in MIN_SPEECH_DURATION_S:
            window = _window_samples(tasks, task_id)
            if not window:
                speech_issues.append(_issue(
                    "task-window-missing", BLOCKING, task_id,
                    f"The capture metadata has no completed {task_id} window; the task was not performed.",
                ))
                continue
            segment = window_slice(task_id)
            report, issues = _speech_features(
                segment if segment is not None else np.zeros(0, dtype=np.float32),
                sample_rate,
                task_id,
                include_ddk=task_id == "speech_ddk_patka",
                session_noise_floor=session_noise_floor,
            )
            speech_tasks[task_id] = report
            speech_issues.extend(issues)

    progress("summary", 88, "Summarising measurement quality and clinical-review flags")
    issues = face_issues + speech_issues
    passed = not _blocking(issues)
    speech_quality = {task_id: report.get("quality") for task_id, report in speech_tasks.items()}

    progress("complete", 100, "Analysis complete")
    return {
        "version": "facial-speech-analysis-v0.1",
        # A blocking gate means the capture could not be measured. It is
        # deliberately a distinct status from a measurement that came back
        # normal, and no score is emitted for the affected modality.
        "status": "ok" if passed else "insufficient-quality",
        "interpretation": "measurement-and-clinical-review only; not a standalone diagnosis or NIHSS score",
        # Recorded so a reviewer can confirm which timeline each window was cut
        # from, rather than having to trust that the streams were aligned.
        "timeline": {
            "stream_start_times_s": stream_starts,
            "audio_offset_applied_s": audio_offset_s,
            "recorder_start_latency_ms": (payload.get("segmentation") or {}).get("recorderStartLatencyMs"),
            "video_frame_sample_hz": 1000.0 / SAMPLE_INTERVAL_MS,
        },
        "quality": {
            "face": face_quality,
            "speech": speech_quality,
            "issues": issues,
            "flags": [issue["message"] for issue in issues],
            "passed": passed,
        },
        "face": {
            "available": not _blocking(face_issues),
            "metrics": face_metrics,
            "task_frame_counts": {key: len(value) for key, value in task_frames.items()},
            "series": face_visuals["series"],
            "key_frames": key_frame_images,
        },
        "speech": {"tasks": speech_tasks, "asr": {"available": False, "reason": "ASR/phoneme alignment is a later language-specific validation stage."}},
    }


def parse_payload(payload: str) -> dict[str, Any]:
    try:
        value = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid facial-speech metadata JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError("Facial-speech metadata must be a JSON object.")
    return value
