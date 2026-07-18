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

import cv2
import numpy as np
from scipy.signal import find_peaks

Progress = Callable[[str, int, str], None]


def _median(values: list[float]) -> float | None:
    valid = [value for value in values if math.isfinite(value)]
    return float(np.median(valid)) if valid else None


def _ratio(a: float | None, b: float | None) -> float | None:
    if a is None or b is None or min(a, b) <= 1e-8:
        return None
    return float(min(a, b) / max(a, b))


def _distance(points: list[Any], first: int, second: int) -> float:
    a, b = points[first], points[second]
    return math.hypot(a.x - b.x, a.y - b.y)


def _face_features(points: list[Any]) -> dict[str, float] | None:
    # MediaPipe FaceMesh semantic indices. Each measure is normalised by IPD so
    # it remains comparable despite a subject moving closer to the webcam.
    ipd = _distance(points, 33, 263)
    if ipd < 1e-5:
        return None
    mouth_left, mouth_right = points[61], points[291]
    return {
        "ipd": ipd,
        "mouth_corner_vertical_asymmetry": abs(mouth_left.y - mouth_right.y) / ipd,
        "mouth_left_x": mouth_left.x,
        "mouth_left_y": mouth_left.y,
        "mouth_right_x": mouth_right.x,
        "mouth_right_y": mouth_right.y,
        "brow_left": _distance(points, 105, 159) / ipd,
        "brow_right": _distance(points, 334, 386) / ipd,
        "eye_left": _distance(points, 159, 145) / ipd,
        "eye_right": _distance(points, 386, 374) / ipd,
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


def _speech_features(samples: np.ndarray, sample_rate: int, include_ddk: bool = False) -> dict[str, Any]:
    quality = _audio_quality(samples)
    quality["duration_s"] = float(samples.size / sample_rate) if sample_rate else 0.0
    if samples.size < sample_rate // 2:
        return {"quality": quality, "available": False, "reason": "Audio window is too short."}

    result: dict[str, Any] = {"quality": quality, "available": True}
    # A transparent energy/VAD proxy. It is not used as a clinical diagnosis.
    frame = max(1, int(sample_rate * 0.02))
    envelope = np.sqrt(np.convolve(samples ** 2, np.ones(frame) / frame, mode="same"))
    noise_floor = float(np.percentile(envelope, 15))
    speech_gate = max(noise_floor * 2.2, 0.008)
    active = envelope > speech_gate
    result["speech_activity_ratio"] = float(np.mean(active))

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
    return result


def analyze_facial_speech(video_path: str, payload: dict[str, Any], progress: Progress) -> dict[str, Any]:
    tasks = payload.get("tasks") or []
    if not tasks:
        raise ValueError("Metadata has no completed task windows. Complete every task before processing.")

    progress("face_quality", 20, "Checking face visibility, framing, and facial movement windows")
    try:
        import mediapipe as mp
    except ImportError as exc:
        raise RuntimeError("MediaPipe is not installed. Rebuild the Docker backend after updating requirements.") from exc

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
            features = _face_features(detected[0].landmark)
            if features is None:
                continue
            valid_frames += 1
            for task_id, window in task_windows.items():
                if window and window[0] <= t_ms <= window[1]:
                    task_frames[task_id].append(features)
    finally:
        face_mesh.close()
        cap.release()

    rest = task_frames.get("face_rest", [])
    rest_mouth_left = np.array([[item["mouth_left_x"], item["mouth_left_y"]] for item in rest]) if rest else np.empty((0, 2))
    rest_mouth_right = np.array([[item["mouth_right_x"], item["mouth_right_y"]] for item in rest]) if rest else np.empty((0, 2))
    rest_brow_left = _median([item["brow_left"] for item in rest])
    rest_brow_right = _median([item["brow_right"] for item in rest])
    rest_eye_left = _median([item["eye_left"] for item in rest])
    rest_eye_right = _median([item["eye_right"] for item in rest])

    smile = task_frames.get("face_smile_show_teeth", [])
    left_excursion: list[float] = []
    right_excursion: list[float] = []
    if len(rest_mouth_left) and smile:
        left_origin = np.median(rest_mouth_left, axis=0)
        right_origin = np.median(rest_mouth_right, axis=0)
        for item in smile:
            left_excursion.append(float(math.hypot(item["mouth_left_x"] - left_origin[0], item["mouth_left_y"] - left_origin[1]) / item["ipd"]))
            right_excursion.append(float(math.hypot(item["mouth_right_x"] - right_origin[0], item["mouth_right_y"] - right_origin[1]) / item["ipd"]))

    brow = task_frames.get("face_brow_raise", [])
    brow_left_peak = _median([max(0.0, item["brow_left"] - (rest_brow_left or item["brow_left"])) for item in brow])
    brow_right_peak = _median([max(0.0, item["brow_right"] - (rest_brow_right or item["brow_right"])) for item in brow])
    closure = task_frames.get("face_eye_closure", [])
    closure_left = min((item["eye_left"] / max(rest_eye_left or item["eye_left"], 1e-6) for item in closure), default=None)
    closure_right = min((item["eye_right"] / max(rest_eye_right or item["eye_right"], 1e-6) for item in closure), default=None)

    face_quality = {
        "sampled_frames": frame_count // 2,
        "valid_face_frame_ratio": float(valid_frames / max(frame_count // 2, 1)),
        "brightness_median_0_255": _median(brightness),
        "blur_variance_median": _median(blur),
    }
    face_metrics = {
        "resting_mouth_corner_vertical_asymmetry_ipd": _median([item["mouth_corner_vertical_asymmetry"] for item in rest]),
        "smile_left_excursion_ipd": float(np.percentile(left_excursion, 90)) if left_excursion else None,
        "smile_right_excursion_ipd": float(np.percentile(right_excursion, 90)) if right_excursion else None,
        "smile_excursion_ratio": _ratio(float(np.percentile(left_excursion, 90)) if left_excursion else None, float(np.percentile(right_excursion, 90)) if right_excursion else None),
        "brow_excursion_ratio": _ratio(brow_left_peak, brow_right_peak),
        "eye_closure_residual_ratio": _ratio(closure_left, closure_right),
    }

    progress("speech", 58, "Extracting audio windows and acoustic speech features")
    with tempfile.TemporaryDirectory(prefix="facial-speech-") as temp_dir:
        wav_path = Path(temp_dir) / "audio.wav"
        command = ["ffmpeg", "-y", "-i", video_path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav_path)]
        proc = subprocess.run(command, capture_output=True, text=True, check=False)
        if proc.returncode != 0 or not wav_path.exists():
            raise RuntimeError("FFmpeg could not extract audio from the WebM recording.")
        sample_rate, audio = _read_wav(wav_path)
        speech_tasks: dict[str, Any] = {}
        for task_id in ("speech_sustained_a", "speech_ddk_patka", "speech_reading", "speech_counting"):
            window = _window_samples(tasks, task_id)
            if not window:
                continue
            start = max(0, int(window[0] * sample_rate / 1000))
            end = min(len(audio), int(window[1] * sample_rate / 1000))
            speech_tasks[task_id] = _speech_features(audio[start:end], sample_rate, include_ddk=task_id == "speech_ddk_patka")

    progress("summary", 88, "Summarising measurement quality and clinical-review flags")
    quality_flags: list[str] = []
    if face_quality["valid_face_frame_ratio"] < 0.75:
        quality_flags.append("Low valid-face-frame ratio; re-capture with a centred, well-lit face.")
    if face_quality["brightness_median_0_255"] is not None and face_quality["brightness_median_0_255"] < 55:
        quality_flags.append("Low facial illumination; improve front lighting and re-capture.")
    speech_quality = {task_id: report.get("quality") for task_id, report in speech_tasks.items()}
    for task_id, quality in speech_quality.items():
        if quality and quality.get("clipping_ratio", 0) > 0.01:
            quality_flags.append(f"Audio clipping detected in {task_id}; reduce microphone gain and re-capture.")

    progress("complete", 100, "Analysis complete")
    return {
        "version": "facial-speech-analysis-v0.1",
        "interpretation": "measurement-and-clinical-review only; not a standalone diagnosis or NIHSS score",
        "quality": {"face": face_quality, "speech": speech_quality, "flags": quality_flags, "passed": not quality_flags},
        "face": {"metrics": face_metrics, "task_frame_counts": {key: len(value) for key, value in task_frames.items()}},
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
