"""Offline, inspectable feature extraction for the facial-speech capture route.

This module intentionally reports measurements and quality gates, not a medical
diagnosis. Clinical decision thresholds are introduced only after the labelled
validation study described in docs/FACIAL_SPEECH_SCREENING.md.
"""
from __future__ import annotations

import json
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
MIN_TASK_FACE_FRAMES = 15  # ~1 s at the 2x-decimated sampling rate
MAX_CLIPPING_RATIO = 0.01
MIN_SPEECH_ACTIVITY_RATIO = 0.20
# Shortest window that can still carry the task's measurement. Below this the
# subject did not perform the task for long enough to measure, whatever the
# audio quality.
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


def _face_features(points: np.ndarray) -> dict[str, float] | None:
    # Every measure is normalised by IPD so it stays comparable when the subject
    # moves closer to the webcam. Sides follow SIDE_CONVENTION.
    ipd = _distance(points, EYE_OUTER_R, EYE_OUTER_L)
    if ipd < 1.0:  # pixels; a face this small cannot support landmark geometry
        return None
    mouth_r, mouth_l = points[MOUTH_CORNER_R], points[MOUTH_CORNER_L]
    return {
        "ipd": ipd,
        "mouth_corner_vertical_asymmetry": abs(mouth_l[1] - mouth_r[1]) / ipd,
        "mouth_left_x": float(mouth_l[0]),
        "mouth_left_y": float(mouth_l[1]),
        "mouth_right_x": float(mouth_r[0]),
        "mouth_right_y": float(mouth_r[1]),
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
    noise_floor = floor_estimate if has_silence else 0.0
    speech_gate = max(peak * 0.15, noise_floor * 1.5, 0.005)
    activity = float(np.mean(envelope > speech_gate)) if envelope.size else 0.0
    quality["speech_activity_ratio"] = activity
    quality["noise_floor_rms"] = noise_floor if has_silence else None
    quality["snr_db"] = (
        float(20.0 * math.log10(peak / floor_estimate))
        if has_silence and floor_estimate > 1e-9 and peak > 1e-9
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
    if activity < MIN_SPEECH_ACTIVITY_RATIO:
        issues.append(_issue(
            "speech-activity-low", BLOCKING, task_id,
            f"Only {activity:.0%} of the {task_id} window contains speech-level energy "
            f"(minimum {MIN_SPEECH_ACTIVITY_RATIO:.0%}). Speak closer to the microphone and repeat the task.",
        ))
    if _blocking(issues):
        return {"quality": quality, "available": False}, issues

    result: dict[str, Any] = {"quality": quality, "available": True, "speech_activity_ratio": activity}

    try:
        import parselmouth

        sound = parselmouth.Sound(samples, sampling_frequency=sample_rate)
        pitch = sound.to_pitch(time_step=0.01, pitch_floor=60, pitch_ceiling=500)
        f0 = pitch.selected_array["frequency"]
        f0 = f0[f0 > 0]
        result["f0_hz_median"] = float(np.median(f0)) if len(f0) else None
        result["f0_hz_sd"] = float(np.std(f0)) if len(f0) else None
        intensity = sound.to_intensity(time_step=0.01)
        values = intensity.values[0]
        result["intensity_db_median"] = float(np.median(values)) if len(values) else None
        harmonicity = sound.to_harmonicity_cc(time_step=0.01, minimum_pitch=60)
        hnr = harmonicity.values[0]
        hnr = hnr[np.isfinite(hnr)]
        result["hnr_db_median"] = float(np.median(hnr)) if len(hnr) else None
        try:
            point_process = parselmouth.praat.call([sound, pitch], "To PointProcess (cc)")
            result["jitter_local"] = float(parselmouth.praat.call(
                point_process, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3
            ))
            result["shimmer_local"] = float(parselmouth.praat.call(
                [sound, point_process], "Get shimmer (local)", 0, 0, 0.0001, 0.02, 1.3, 1.6
            ))
        except Exception:  # jitter/shimmer require a sufficiently periodic signal
            result["jitter_local"] = None
            result["shimmer_local"] = None
    except Exception as exc:  # Keep quality/result reporting alive if Praat rejects a clip.
        result["acoustic_warning"] = f"Praat feature extraction unavailable: {exc}"

    if include_ddk:
        min_distance = max(1, int(sample_rate * 0.09))
        peaks, _ = find_peaks(envelope, distance=min_distance, prominence=max(noise_floor, 0.003))
        duration = max(samples.size / sample_rate, 1e-6)
        result["energy_peak_rate_hz"] = float(len(peaks) / duration)
        if len(peaks) >= 3:
            intervals = np.diff(peaks) / sample_rate
            result["peak_interval_cv"] = float(np.std(intervals) / max(np.mean(intervals), 1e-6))
        else:
            result["peak_interval_cv"] = None
    return result, issues


def _blank_face_metrics() -> dict[str, Any]:
    return {
        "side_convention": SIDE_CONVENTION,
        "resting_mouth_corner_vertical_asymmetry_ipd": None,
        "smile_excursion_ipd": _side_ratio(None, None),
        "brow_excursion_ipd": _side_ratio(None, None),
        "eye_closure_residual_ratio": _side_ratio(None, None),
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
        return metrics, issues

    metrics["resting_mouth_corner_vertical_asymmetry_ipd"] = _median(
        [item["mouth_corner_vertical_asymmetry"] for item in rest]
    )
    rest_mouth_left = np.median(np.array([[item["mouth_left_x"], item["mouth_left_y"]] for item in rest]), axis=0)
    rest_mouth_right = np.median(np.array([[item["mouth_right_x"], item["mouth_right_y"]] for item in rest]), axis=0)
    rest_brow_left = _median([item["brow_left"] for item in rest])
    rest_brow_right = _median([item["brow_right"] for item in rest])
    rest_eye_left = _median([item["eye_left"] for item in rest])
    rest_eye_right = _median([item["eye_right"] for item in rest])

    def movement_frames(task_id: str) -> list[dict[str, float]] | None:
        frames = task_frames.get(task_id) or []
        if len(frames) < MIN_TASK_FACE_FRAMES:
            issues.append(_issue(
                "task-window-unusable", BLOCKING, task_id,
                f"The {task_id} window yielded {len(frames)} usable frames (minimum {MIN_TASK_FACE_FRAMES}); "
                "this measurement is withheld.",
            ))
            return None
        return frames

    smile = movement_frames("face_smile_show_teeth")
    if smile is not None:
        left = [
            float(math.hypot(item["mouth_left_x"] - rest_mouth_left[0], item["mouth_left_y"] - rest_mouth_left[1]) / item["ipd"])
            for item in smile
        ]
        right = [
            float(math.hypot(item["mouth_right_x"] - rest_mouth_right[0], item["mouth_right_y"] - rest_mouth_right[1]) / item["ipd"])
            for item in smile
        ]
        metrics["smile_excursion_ipd"] = _side_ratio(
            float(np.percentile(left, 90)), float(np.percentile(right, 90))
        )

    brow = movement_frames("face_brow_raise")
    if brow is not None and rest_brow_left is not None and rest_brow_right is not None:
        metrics["brow_excursion_ipd"] = _side_ratio(
            _median([max(0.0, item["brow_left"] - rest_brow_left) for item in brow]),
            _median([max(0.0, item["brow_right"] - rest_brow_right) for item in brow]),
        )

    closure = movement_frames("face_eye_closure")
    if closure is not None and rest_eye_left and rest_eye_right:
        metrics["eye_closure_residual_ratio"] = _side_ratio(
            min(item["eye_left"] / rest_eye_left for item in closure),
            min(item["eye_right"] / rest_eye_right for item in closure),
        )

    return metrics, issues


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

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("Unable to open the uploaded capture video.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = 0
    valid_frames = 0
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
            if frame_count % 2:
                continue
            t_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
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
            for task_id, window in task_windows.items():
                if window and window[0] <= t_ms <= window[1]:
                    task_frames[task_id].append(features)
    finally:
        face_mesh.close()
        cap.release()

    face_quality = {
        "sampled_frames": frame_count // 2,
        "valid_face_frame_ratio": float(valid_frames / max(frame_count // 2, 1)),
        "brightness_median_0_255": _median(brightness),
        "blur_variance_median": _median(blur),
    }
    face_metrics, face_issues = _face_metrics(task_frames, face_quality)

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
        for task_id in MIN_SPEECH_DURATION_S:
            window = _window_samples(tasks, task_id)
            if not window:
                speech_issues.append(_issue(
                    "task-window-missing", BLOCKING, task_id,
                    f"The capture metadata has no completed {task_id} window; the task was not performed.",
                ))
                continue
            start = max(0, int(window[0] * sample_rate / 1000))
            end = min(len(audio), int(window[1] * sample_rate / 1000))
            report, issues = _speech_features(
                audio[start:end], sample_rate, task_id, include_ddk=task_id == "speech_ddk_patka"
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
