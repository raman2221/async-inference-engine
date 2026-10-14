"""Job data: parsing queue messages and building the result records stored in
Redis. Pure functions, no I/O."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Protocol

from .model import Prediction


class Ackable(Protocol):
    async def ack(self) -> None: ...
    async def nack(self, requeue: bool = True) -> None: ...


@dataclass
class PendingJob:
    job_id: str
    text: str
    accepted_at_ms: int
    message: Ackable


@dataclass(frozen=True)
class BatchTiming:
    started_at_ms: int
    completed_at_ms: int
    batch_size: int


def now_ms() -> int:
    return int(time.time() * 1000)


def parse_message(body: bytes, message: Ackable) -> PendingJob:
    """Raises ValueError, KeyError, or TypeError for a malformed message."""
    payload = json.loads(body)
    return PendingJob(
        job_id=str(payload["job_id"]),
        text=str(payload["text"]),
        accepted_at_ms=int(payload["accepted_at_ms"]),
        message=message,
    )


def completed_record(job: PendingJob, timing: BatchTiming, prediction: Prediction) -> dict[str, Any]:
    result = {"label": prediction.label, "score": prediction.score}
    return {**_base_record(job, timing), "status": "done", "result": result}


def failed_record(job: PendingJob, timing: BatchTiming, error: str) -> dict[str, Any]:
    return {**_base_record(job, timing), "status": "failed", "error": error}


def _base_record(job: PendingJob, timing: BatchTiming) -> dict[str, Any]:
    return {
        "job_id": job.job_id,
        "accepted_at_ms": job.accepted_at_ms,
        "started_at_ms": timing.started_at_ms,
        "completed_at_ms": timing.completed_at_ms,
        "batch_size": timing.batch_size,
    }
