"""The capture UI and the processor must agree on what is long enough.

The UI holds the finish control back until a task has run, and unlocks a quiet
early exit at the processor's minimum. If the two drift apart the subject is
allowed to end a window the processor will then reject, and they only find out
after the upload - which is exactly the wasted capture the timer exists to
prevent. This parses the protocol definition rather than duplicating it.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.facial_speech import MIN_SPEECH_DURATION_S, NOISE_FLOOR_TASK  # noqa: E402

PROTOCOL = Path(__file__).resolve().parents[2] / "lib" / "facialSpeechProtocol.ts"

TASK_BLOCK = re.compile(
    r"id: '(?P<id>[a-z_]+)',.*?durationSec: (?P<duration>\d+),\s*\n\s*minimumSec: (?P<minimum>\d+),",
    re.S,
)


def _protocol_tasks() -> dict[str, dict[str, int]]:
    source = PROTOCOL.read_text(encoding="utf-8")
    tasks = {
        match.group("id"): {
            "durationSec": int(match.group("duration")),
            "minimumSec": int(match.group("minimum")),
        }
        for match in TASK_BLOCK.finditer(source)
    }
    assert tasks, f"no tasks parsed from {PROTOCOL}"
    return tasks


def test_the_protocol_file_is_parseable_and_covers_the_battery() -> None:
    tasks = _protocol_tasks()
    for task_id in MIN_SPEECH_DURATION_S:
        assert task_id in tasks, f"{task_id} is gated by the processor but absent from the protocol"
    assert NOISE_FLOOR_TASK in tasks


@pytest.mark.parametrize("task_id", sorted(MIN_SPEECH_DURATION_S))
def test_the_early_exit_never_unlocks_below_the_processor_gate(task_id: str) -> None:
    task = _protocol_tasks()[task_id]
    assert task["minimumSec"] >= MIN_SPEECH_DURATION_S[task_id], (
        f"{task_id} lets the subject stop at {task['minimumSec']}s but the processor "
        f"rejects anything under {MIN_SPEECH_DURATION_S[task_id]}s"
    )


def test_every_task_has_a_minimum_below_its_intended_duration() -> None:
    for task_id, task in _protocol_tasks().items():
        assert 0 < task["minimumSec"] <= task["durationSec"], task_id
