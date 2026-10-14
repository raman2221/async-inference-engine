"""The worker's two concurrent activities on one event loop:

  1. Consuming: aio-pika calls `on_message` for every delivery, which parses
     it and hands it to the batcher. It never waits on the model.
  2. Batching: `run` pulls batches from the batcher and processes them.

Because inference runs in a thread, consumption continues during a forward
pass, so the next batch is already filling up when the current one finishes.
"""

from __future__ import annotations

import asyncio
import logging

from aio_pika.abc import AbstractIncomingMessage

from .batcher import DynamicBatcher
from .jobs import PendingJob, parse_message
from .processor import BatchProcessor

log = logging.getLogger("worker")


class Worker:
    def __init__(self, batcher: DynamicBatcher[PendingJob], processor: BatchProcessor) -> None:
        self._batcher = batcher
        self._processor = processor
        self._stopping = asyncio.Event()

    async def on_message(self, message: AbstractIncomingMessage) -> None:
        try:
            job = parse_message(message.body, message)
        except (ValueError, KeyError, TypeError):
            # Retrying a malformed message cannot help: dead-letter it for inspection.
            log.warning("malformed message %r; dead-lettering", message.body[:200])
            await message.reject(requeue=False)
            return
        await self._batcher.put(job)

    def stop(self) -> None:
        self._stopping.set()

    async def run(self) -> None:
        """Processes batches until stop() is called."""
        while not self._stopping.is_set():
            batch = await self._next_batch_or_stop()
            if batch:
                await self._processor.process(batch)

    async def _next_batch_or_stop(self) -> list[PendingJob]:
        """Waits for a batch, but returns an empty list as soon as stop() is called."""
        next_batch = asyncio.create_task(self._batcher.next_batch())
        stopping = asyncio.create_task(self._stopping.wait())
        await asyncio.wait({next_batch, stopping}, return_when=asyncio.FIRST_COMPLETED)
        stopping.cancel()
        if next_batch.done():
            return next_batch.result()
        next_batch.cancel()
        return []
