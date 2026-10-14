"""RabbitMQ consumer -> DynamicBatcher -> model -> Redis.

Two concurrent loops share one asyncio event loop:

  1. The *consumer*: aio-pika calls `on_message` for every delivery; we parse
     it and drop it into the batcher. This never blocks on the model.
  2. The *batch loop*: pulls a batch from the batcher, runs the model in a
     background thread, writes results to Redis, then acks the messages.

Because the model runs in a thread (`asyncio.to_thread`), the consumer keeps
receiving while a batch is computing, so the next batch is already filling up.
"""

from __future__ import annotations

import asyncio
import json
import logging
import signal
import time
from dataclasses import dataclass
from typing import Any, Protocol

import aio_pika
from redis.asyncio import Redis

from .batcher import DynamicBatcher
from .config import Config
from .model import Model, load_model

log = logging.getLogger("worker")

EVENTS_CHANNEL = "job-events"  # the C# notifier subscribes to this
STATS_KEY = "stats:worker"


class Ackable(Protocol):
    async def ack(self) -> None: ...
    async def nack(self, requeue: bool = True) -> None: ...


@dataclass
class PendingJob:
    job_id: str
    text: str
    accepted_at_ms: int
    message: Ackable


def now_ms() -> int:
    return int(time.time() * 1000)


def parse_message(body: bytes, message: Ackable) -> PendingJob:
    payload = json.loads(body)
    return PendingJob(
        job_id=str(payload["job_id"]),
        text=str(payload["text"]),
        accepted_at_ms=int(payload["accepted_at_ms"]),
        message=message,
    )


class BatchProcessor:
    """Runs one batch through the model and records the results."""

    def __init__(self, model: Model, redis: Redis, job_ttl_seconds: int) -> None:
        self.model = model
        self.redis = redis
        self.job_ttl_seconds = job_ttl_seconds

    async def process(self, batch: list[PendingJob]) -> None:
        started = now_ms()
        error: str | None = None
        try:
            # Off the event loop: tokenization + forward pass are CPU-bound
            # and would otherwise freeze message consumption.
            predictions = await asyncio.to_thread(self.model.predict, [job.text for job in batch])
        except Exception as exc:  # a bad batch must not kill the worker
            log.exception("inference failed for batch of %d", len(batch))
            predictions, error = None, f"inference error: {exc}"
        completed = now_ms()

        records: list[dict[str, Any]] = []
        for i, job in enumerate(batch):
            record: dict[str, Any] = {
                "job_id": job.job_id,
                "status": "failed" if predictions is None else "done",
                "accepted_at_ms": job.accepted_at_ms,
                "started_at_ms": started,
                "completed_at_ms": completed,
                "batch_size": len(batch),
            }
            if predictions is None:
                record["error"] = error
            else:
                record["result"] = {"label": predictions[i].label, "score": predictions[i].score}
            records.append(record)

        try:
            # One round trip for the whole batch: SET each result, PUBLISH an
            # event per job for WebSocket subscribers, and bump the counters.
            pipe = self.redis.pipeline(transaction=False)
            for record in records:
                encoded = json.dumps(record)
                pipe.set(f"job:{record['job_id']}", encoded, ex=self.job_ttl_seconds)
                pipe.publish(EVENTS_CHANNEL, encoded)
            pipe.hincrby(STATS_KEY, "batches", 1)
            pipe.hincrby(STATS_KEY, "jobs", len(batch))
            pipe.hincrby(STATS_KEY, "inference_ms_total", completed - started)
            pipe.hincrby(STATS_KEY, f"batch_size:{len(batch)}", 1)
            await pipe.execute()
        except Exception:
            # Results not saved -> put messages back so another attempt (or
            # another worker) redoes them. At-least-once delivery.
            log.exception("redis write failed; requeueing %d jobs", len(batch))
            await _settle(batch, ack=False)
            return

        # Ack only AFTER results are durable in Redis. If we crash before this
        # line RabbitMQ redelivers the messages, so no job is silently lost.
        await _settle(batch, ack=True)
        log.info(
            "batch=%d inference_ms=%d queue_wait_ms=%d",
            len(batch),
            completed - started,
            started - min(job.accepted_at_ms for job in batch),
        )


async def _settle(batch: list[PendingJob], ack: bool) -> None:
    for job in batch:
        try:
            if ack:
                await job.message.ack()
            else:
                await job.message.nack(requeue=True)
        except Exception:
            # The channel may have reconnected since delivery; the broker will
            # redeliver these on its own, and rewriting a result is harmless.
            log.warning("could not settle message for job %s", job.job_id)


async def declare_topology(channel: aio_pika.abc.AbstractChannel, cfg: Config) -> aio_pika.abc.AbstractQueue:
    # Must mirror gateway/src/queue.ts exactly.
    dlx = await channel.declare_exchange(f"{cfg.queue_name}.dlx", aio_pika.ExchangeType.FANOUT, durable=True)
    dead = await channel.declare_queue(f"{cfg.queue_name}.dead", durable=True)
    await dead.bind(dlx)
    return await channel.declare_queue(
        cfg.queue_name,
        durable=True,
        arguments={
            "x-max-length": cfg.queue_max_length,
            "x-overflow": "reject-publish",
            "x-dead-letter-exchange": f"{cfg.queue_name}.dlx",
        },
    )


async def connect_rabbit(url: str) -> aio_pika.abc.AbstractRobustConnection:
    # connect_robust reconnects automatically after the first success, but
    # the first connection still needs a retry loop while RabbitMQ boots.
    delay = 0.5
    while True:
        try:
            return await aio_pika.connect_robust(url)
        except Exception as exc:
            log.info("rabbitmq not ready (%s); retrying in %.1fs", exc, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 10.0)


async def run(cfg: Config) -> None:
    log.info("loading model backend=%s name=%s", cfg.model_backend, cfg.model_name)
    model = load_model(cfg.model_backend, cfg.model_name, cfg.torch_threads)
    model.predict(["warm up"] * cfg.max_batch_size)  # first call allocates; keep it out of the stats

    redis = Redis.from_url(cfg.redis_url)
    connection = await connect_rabbit(cfg.rabbit_url)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=cfg.prefetch_count)
    queue = await declare_topology(channel, cfg)

    batcher: DynamicBatcher[PendingJob] = DynamicBatcher(cfg.max_batch_size, cfg.max_wait_ms)
    processor = BatchProcessor(model, redis, cfg.job_ttl_seconds)

    async def on_message(message: aio_pika.abc.AbstractIncomingMessage) -> None:
        try:
            job = parse_message(message.body, message)
        except (ValueError, KeyError, TypeError):
            # Malformed: retrying won't help. reject(requeue=False) routes it
            # to the dead-letter queue for a human to inspect.
            log.warning("malformed message %r; dead-lettering", message.body[:200])
            await message.reject(requeue=False)
            return
        await batcher.put(job)

    consumer_tag = await queue.consume(on_message)
    log.info("consuming %s (max_batch=%d, max_wait=%.0fms, prefetch=%d)",
             cfg.queue_name, cfg.max_batch_size, cfg.max_wait_ms, cfg.prefetch_count)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # Windows; Ctrl+C still raises KeyboardInterrupt
            pass

    try:
        while not stop.is_set():
            next_batch = asyncio.create_task(batcher.next_batch())
            stopping = asyncio.create_task(stop.wait())
            done, _ = await asyncio.wait({next_batch, stopping}, return_when=asyncio.FIRST_COMPLETED)
            if next_batch in done:
                await processor.process(next_batch.result())
            else:
                next_batch.cancel()
            stopping.cancel()
    finally:
        # Graceful shutdown: stop taking new messages. Anything delivered but
        # not yet processed is unacked, so RabbitMQ hands it to another worker.
        log.info("shutting down")
        await queue.cancel(consumer_tag)
        await connection.close()
        await redis.aclose()
