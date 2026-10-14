"""Runs one batch through the model and stores the results."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable

from redis.asyncio import Redis

from .contract import EVENTS_CHANNEL, STATS_KEY, job_key
from .jobs import BatchTiming, PendingJob, completed_record, failed_record, now_ms
from .model import Model

log = logging.getLogger("worker")


class BatchProcessor:
    def __init__(self, model: Model, redis: Redis, job_ttl_seconds: int) -> None:
        self._model = model
        self._redis = redis
        self._job_ttl_seconds = job_ttl_seconds

    async def process(self, batch: list[PendingJob]) -> None:
        records, timing = await self._infer(batch)
        try:
            await self._save(records, timing)
        except Exception:
            log.exception("redis write failed; requeueing %d jobs", len(batch))
            await requeue_all(batch)
            return
        # Ack only after results are stored: if we crash first, RabbitMQ
        # redelivers and no job is silently lost (at-least-once delivery).
        await ack_all(batch)
        log.info("batch=%d inference_ms=%d", timing.batch_size, timing.completed_at_ms - timing.started_at_ms)

    async def _infer(self, batch: list[PendingJob]) -> tuple[list[dict[str, Any]], BatchTiming]:
        started = now_ms()
        try:
            # In a thread: the forward pass is CPU-bound and would otherwise
            # block the event loop, stopping message consumption.
            predictions = await asyncio.to_thread(self._model.predict, [job.text for job in batch])
            timing = BatchTiming(started, now_ms(), len(batch))
            return [completed_record(job, timing, p) for job, p in zip(batch, predictions)], timing
        except Exception as exc:
            # Acked as failed rather than retried: a model error on this input
            # would most likely fail again on every redelivery.
            log.exception("inference failed for batch of %d", len(batch))
            timing = BatchTiming(started, now_ms(), len(batch))
            return [failed_record(job, timing, f"inference error: {exc}") for job in batch], timing

    async def _save(self, records: list[dict[str, Any]], timing: BatchTiming) -> None:
        """One round trip: SET each result, PUBLISH it for WebSocket listeners, bump counters."""
        pipe = self._redis.pipeline(transaction=False)
        for record in records:
            encoded = json.dumps(record)
            pipe.set(job_key(record["job_id"]), encoded, ex=self._job_ttl_seconds)
            pipe.publish(EVENTS_CHANNEL, encoded)
        pipe.hincrby(STATS_KEY, "batches", 1)
        pipe.hincrby(STATS_KEY, "jobs", timing.batch_size)
        pipe.hincrby(STATS_KEY, "inference_ms_total", timing.completed_at_ms - timing.started_at_ms)
        pipe.hincrby(STATS_KEY, f"batch_size:{timing.batch_size}", 1)
        await pipe.execute()


async def ack_all(batch: list[PendingJob]) -> None:
    for job in batch:
        await _settle_quietly(job, job.message.ack())


async def requeue_all(batch: list[PendingJob]) -> None:
    for job in batch:
        await _settle_quietly(job, job.message.nack(requeue=True))


async def _settle_quietly(job: PendingJob, settle: Awaitable[None]) -> None:
    try:
        await settle
    except Exception:
        # The channel may have reconnected since delivery. The broker then
        # redelivers on its own, and rewriting a result is harmless.
        log.warning("could not settle message for job %s", job.job_id)
