from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    rabbit_url: str
    redis_url: str
    queue_name: str
    queue_max_length: int
    max_batch_size: int
    max_wait_ms: float
    prefetch_count: int
    job_ttl_seconds: int
    model_backend: str
    model_name: str
    torch_threads: int | None

    @classmethod
    def from_env(cls) -> Config:
        max_batch = int(os.getenv("MAX_BATCH_SIZE", "16"))
        threads = os.getenv("TORCH_THREADS")
        return cls(
            rabbit_url=os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/"),
            redis_url=os.getenv("REDIS_URL", "redis://localhost:6379"),
            queue_name=os.getenv("QUEUE_NAME", "inference.requests"),
            queue_max_length=int(os.getenv("QUEUE_MAX_LENGTH", "100000")),
            max_batch_size=max_batch,
            max_wait_ms=float(os.getenv("MAX_WAIT_MS", "50")),
            # RabbitMQ only lets a consumer hold `prefetch_count` unacked
            # messages. It MUST exceed the batch size, or batches can never
            # fill. 4x lets the next batch accumulate while one is running.
            prefetch_count=int(os.getenv("PREFETCH_COUNT", str(max_batch * 4))),
            job_ttl_seconds=int(os.getenv("JOB_TTL_SECONDS", "3600")),
            model_backend=os.getenv("MODEL_BACKEND", "hf"),
            model_name=os.getenv("MODEL_NAME", "distilbert-base-uncased-finetuned-sst-2-english"),
            torch_threads=int(threads) if threads else None,
        )
