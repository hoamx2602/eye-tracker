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
    BROW_L,
    BROW_R,
    _face_features,
    _pixel_points,
    _side_ratio,
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
    # y grows downward, so the dropped corner has the larger y.
    assert features["mouth_left_y"] > features["mouth_right_y"]
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


def test_a_face_too_small_for_geometry_is_rejected() -> None:
    landmarks = [_Landmark(0.5, 0.5) for _ in range(478)]
    assert _face_features(_pixel_points(landmarks, 1280, 720)) is None


def test_pixel_points_applies_each_axis_scale() -> None:
    converted = _pixel_points([_Landmark(0.25, 0.5)], 1280, 720)
    assert np.allclose(converted[0], [320.0, 360.0])
