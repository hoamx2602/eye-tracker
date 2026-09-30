"""Geometry tests for the facial-speech feature extractor.

These cover the two failure modes that silently corrupt a facial-asymmetry
report rather than crashing it: mixing MediaPipe's separately-normalised x/y
axes, and reporting weakness on the wrong anatomical side.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.facial_speech import (  # noqa: E402
    EYE_OUTER_L,
    EYE_OUTER_R,
    LID_LOWER_L,
    LID_LOWER_R,
    LID_UPPER_L,
    LID_UPPER_R,
    MOUTH_CORNER_L,
    MOUTH_CORNER_R,
    NOSE_BRIDGE,
    NOSE_TIP,
    PHILTRUM,
    BROW_L,
    BROW_R,
    _face_features,
    _peak,
    _pixel_points,
    _side_ratio,
    _trough,
)


class _Landmark:
    """Stands in for a MediaPipe NormalizedLandmark."""

    def __init__(self, x: float, y: float) -> None:
        self.x = x
        self.y = y


def _synthetic_face(
    width: int,
    height: int,
    *,
    mouth_drop_px_left: float = 0.0,
    brow_raise_px_left: float = 0.0,
    philtrum_shift_px: float = 0.0,
) -> list[_Landmark]:
    """A synthetic face in pixel space, converted back to MediaPipe normals.

    The face is symmetric apart from the requested left-side deficits, so any
    asymmetry the extractor reports is attributable to the injected deficit.
    """
    centre_x, centre_y = width / 2.0, height / 2.0
    # Every offset is proportional to frame width, so the *same* face is
    # rendered at any resolution and only the pixel scale changes. Deficits are
    # supplied by the caller already in that scale.
    eye_half = width * 0.1  # 20% of frame width between outer eye corners
    mouth_half = width * 0.06
    lid_half = width * (5.0 / 1280.0)
    brow_gap = width * (30.0 / 1280.0)
    mouth_drop = width * (60.0 / 1280.0)
    points = [_Landmark(0.5, 0.5) for _ in range(478)]

    def place(index: int, px: float, py: float) -> None:
        points[index] = _Landmark(px / width, py / height)

    place(EYE_OUTER_R, centre_x - eye_half, centre_y)
    place(EYE_OUTER_L, centre_x + eye_half, centre_y)
    # Symmetric palpebral aperture of 2 * lid_half on both sides.
    place(LID_UPPER_R, centre_x - eye_half / 2, centre_y - lid_half)
    place(LID_LOWER_R, centre_x - eye_half / 2, centre_y + lid_half)
    place(LID_UPPER_L, centre_x + eye_half / 2, centre_y - lid_half)
    place(LID_LOWER_L, centre_x + eye_half / 2, centre_y + lid_half)
    # Brows sit brow_gap above the upper lid, minus any left-side raise deficit.
    place(BROW_R, centre_x - eye_half / 2, centre_y - lid_half - brow_gap)
    place(BROW_L, centre_x + eye_half / 2, centre_y - lid_half - brow_gap - brow_raise_px_left)
    # Mouth corners level, except for a left-side droop (y grows downward).
    place(MOUTH_CORNER_R, centre_x - mouth_half, centre_y + mouth_drop)
    place(MOUTH_CORNER_L, centre_x + mouth_half, centre_y + mouth_drop + mouth_drop_px_left)
    # Midline landmarks. Placed off the frame centre so a test that expects a
    # zero deviation is testing the projection rather than a coincidence.
    place(NOSE_BRIDGE, centre_x, centre_y - width * (10.0 / 1280.0))
    place(NOSE_TIP, centre_x, centre_y + width * (35.0 / 1280.0))
    place(PHILTRUM, centre_x + philtrum_shift_px, centre_y + mouth_drop * 0.8)
    return points


def _features(width: int, height: int, **deficits: float) -> dict[str, float]:
    landmarks = _synthetic_face(width, height, **deficits)
    features = _face_features(_pixel_points(landmarks, width, height))
    assert features is not None
    return features


def test_ipd_is_measured_in_pixels_not_mixed_axes() -> None:
    # Outer eye corners are 20% of the frame width apart and vertically level.
    assert _features(1280, 720)["ipd"] == pytest.approx(0.2 * 1280)


@pytest.mark.parametrize(("width", "height"), [(1280, 720), (640, 480), (1920, 1080)])
def test_metrics_are_invariant_to_frame_aspect_ratio(width: int, height: int) -> None:
    """The same face filmed at 4:3 and 16:9 must produce the same measurements.

    Normalising x by width and y by height means a naive hypot() stretches the
    horizontal axis by the aspect ratio, so this is the regression guard for
    cross-device comparability.
    """
    reference = _features(1280, 720, mouth_drop_px_left=8.0)
    scale = width / 1280.0
    subject = _features(width, height, mouth_drop_px_left=8.0 * scale)
    for key in ("mouth_corner_vertical_asymmetry", "brow_left", "brow_right", "eye_left", "eye_right"):
        assert subject[key] == pytest.approx(reference[key], rel=1e-6), key


def test_a_symmetric_face_reports_no_asymmetry() -> None:
    features = _features(1280, 720)
    assert features["mouth_corner_vertical_asymmetry"] == pytest.approx(0.0)
    assert features["brow_left"] == pytest.approx(features["brow_right"])
    assert features["eye_left"] == pytest.approx(features["eye_right"])


def test_left_sided_droop_is_attributed_to_the_left_side() -> None:
    """Guards the anatomical side convention.

    MediaPipe names sides from the subject's perspective, so index 291 is the
    subject's LEFT mouth corner even though it appears on the right of an
    unmirrored frame. Swapping these would report weakness on the wrong side.
    """
    features = _features(1280, 720, mouth_drop_px_left=10.0)
    # v points down the face's own vertical axis, so the dropped corner is larger.
    assert features["mouth_left_v"] > features["mouth_right_v"]
    assert features["mouth_corner_vertical_asymmetry"] == pytest.approx(10.0 / (0.2 * 1280))


def test_reduced_left_brow_excursion_names_the_left_side() -> None:
    features = _features(1280, 720, brow_raise_px_left=-12.0)
    assert features["brow_left"] < features["brow_right"]
    measure = _side_ratio(features["brow_left"], features["brow_right"])
    assert measure["weaker_side"] == "left"
    assert measure["ratio_weaker_over_stronger"] == pytest.approx(18.0 / 30.0)


def test_side_ratio_preserves_direction() -> None:
    assert _side_ratio(4.0, 8.0)["weaker_side"] == "left"
    assert _side_ratio(8.0, 4.0)["weaker_side"] == "right"
    assert _side_ratio(4.0, 4.0)["weaker_side"] is None
    # Both orderings share a ratio, which is exactly why the label is needed.
    assert _side_ratio(4.0, 8.0)["ratio_weaker_over_stronger"] == _side_ratio(8.0, 4.0)["ratio_weaker_over_stronger"]


def test_side_ratio_refuses_missing_or_degenerate_input() -> None:
    for measure in (_side_ratio(None, 4.0), _side_ratio(4.0, None), _side_ratio(0.0, 0.0)):
        assert measure["ratio_weaker_over_stronger"] is None
        assert measure["weaker_side"] is None
    assert _side_ratio(float("nan"), 4.0)["ratio_weaker_over_stronger"] is None


def test_philtrum_deviation_is_zero_on_a_symmetric_face() -> None:
    assert _features(1280, 720)["philtrum_deviation"] == pytest.approx(0.0, abs=1e-9)


def test_a_deviated_philtrum_is_measured_and_signed() -> None:
    shifted = _features(1280, 720, philtrum_shift_px=12.0)
    # u points toward the subject's left, normalised by an IPD of 0.2 * width.
    assert shifted["philtrum_deviation"] == pytest.approx(12.0 / (0.2 * 1280))
    assert _features(1280, 720, philtrum_shift_px=-12.0)["philtrum_deviation"] < 0


def test_philtrum_deviation_follows_the_face_axis_not_the_image_axis() -> None:
    """A tilted head must not read as a deviated philtrum."""
    landmarks = _synthetic_face(1280, 720)
    rolled = _rigid_transform(landmarks, 1280, 720, roll_deg=14.0, shift_px=(50.0, -30.0))
    features = _face_features(_pixel_points(rolled, 1280, 720))
    assert features is not None
    assert features["philtrum_deviation"] == pytest.approx(0.0, abs=1e-6)


def test_mouth_corner_spread_is_measured_per_side() -> None:
    features = _features(1280, 720)
    # 6% of frame width either side of the midline, over a 20%-width IPD.
    assert features["mouth_left_spread"] == pytest.approx(0.3, abs=1e-6)
    assert features["mouth_right_spread"] == pytest.approx(0.3, abs=1e-6)


def test_peak_reads_the_movement_not_the_rest_around_it() -> None:
    """A movement window is mostly rest, so a central statistic misses it."""
    window = [0.0] * 80 + [0.30] * 20  # two brief raises inside a relaxed window
    assert _peak(window) == pytest.approx(0.30)
    assert float(np.median(window)) == pytest.approx(0.0)


def test_trough_ignores_a_single_mistracked_frame() -> None:
    closure = [0.20] * 40 + [0.0]  # one frame where the landmark collapsed
    assert _trough(closure) == pytest.approx(0.20, abs=0.02)


def test_peak_and_trough_refuse_an_empty_window() -> None:
    assert _peak([]) is None
    assert _trough([]) is None


def test_a_face_too_small_for_geometry_is_rejected() -> None:
    landmarks = [_Landmark(0.5, 0.5) for _ in range(478)]
    assert _face_features(_pixel_points(landmarks, 1280, 720)) is None


def _rigid_transform(
    landmarks: list[_Landmark],
    width: int,
    height: int,
    *,
    shift_px: tuple[float, float] = (0.0, 0.0),
    roll_deg: float = 0.0,
    scale: float = 1.0,
) -> list[_Landmark]:
    """Move the whole head without changing a single facial expression."""
    pixels = _pixel_points(landmarks, width, height)
    centre = pixels.mean(axis=0)
    theta = np.radians(roll_deg)
    rotation = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]])
    moved = (pixels - centre) @ rotation.T * scale + centre + np.array(shift_px)
    return [_Landmark(point[0] / width, point[1] / height) for point in moved]


@pytest.mark.parametrize(
    "transform",
    [
        {"shift_px": (90.0, -45.0)},
        {"roll_deg": 12.0},
        {"scale": 1.25},
        {"shift_px": (-60.0, 30.0), "roll_deg": -8.0, "scale": 0.85},
    ],
)
def test_measurements_are_invariant_to_rigid_head_motion(transform: dict) -> None:
    """Head movement between the rest and movement windows must not register.

    The subject leans in or tilts between tasks as a matter of course. Charging
    that motion to the facial measurement inflated both mouth corners equally,
    pulling the left/right ratio toward 1.0 and hiding real asymmetry, while
    head roll faked a dropped mouth corner outright.
    """
    landmarks = _synthetic_face(1280, 720, mouth_drop_px_left=10.0)
    baseline = _face_features(_pixel_points(landmarks, 1280, 720))
    moved = _face_features(_pixel_points(_rigid_transform(landmarks, 1280, 720, **transform), 1280, 720))
    assert baseline is not None and moved is not None
    for key in ("mouth_corner_vertical_asymmetry", "mouth_left_u", "mouth_left_v", "mouth_right_u", "mouth_right_v"):
        assert moved[key] == pytest.approx(baseline[key], abs=1e-6), key


def test_head_roll_alone_does_not_create_mouth_corner_asymmetry() -> None:
    landmarks = _synthetic_face(1280, 720)  # a perfectly symmetric face
    rolled = _rigid_transform(landmarks, 1280, 720, roll_deg=15.0)
    features = _face_features(_pixel_points(rolled, 1280, 720))
    assert features is not None
    assert features["mouth_corner_vertical_asymmetry"] == pytest.approx(0.0, abs=1e-6)


def test_pixel_points_applies_each_axis_scale() -> None:
    converted = _pixel_points([_Landmark(0.25, 0.5)], 1280, 720)
    assert np.allclose(converted[0], [320.0, 360.0])
