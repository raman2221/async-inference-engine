"""RabbitMQ connection and queue topology."""

from __future__ import annotations

import asyncio
import logging

import aio_pika
from aio_pika.abc import AbstractChannel, AbstractQueue, AbstractRobustConnection

log = logging.getLogger("worker")

MAX_RETRY_DELAY_S = 10.0


async def connect_with_retry(url: str) -> AbstractRobustConnection:
    """connect_robust reconnects after the first success; the first attempt
    still needs a retry loop while RabbitMQ boots."""
    delay = 0.5
    while True:
        try:
            return await aio_pika.connect_robust(url)
        except Exception as exc:
            log.info("rabbitmq not ready (%s); retrying in %.1fs", exc, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, MAX_RETRY_DELAY_S)


async def declare_topology(channel: AbstractChannel, queue_name: str, max_length: int) -> AbstractQueue:
    """Must mirror declareTopology in gateway/src/queue.ts exactly."""
    dead_letter_exchange = await channel.declare_exchange(
        f"{queue_name}.dlx", aio_pika.ExchangeType.FANOUT, durable=True
    )
    dead_letter_queue = await channel.declare_queue(f"{queue_name}.dead", durable=True)
    await dead_letter_queue.bind(dead_letter_exchange)
    return await channel.declare_queue(
        queue_name,
        durable=True,
        arguments={
            "x-max-length": max_length,
            "x-overflow": "reject-publish",
            "x-dead-letter-exchange": f"{queue_name}.dlx",
        },
    )
