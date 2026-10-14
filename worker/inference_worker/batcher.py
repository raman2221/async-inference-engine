"""The dynamic batching algorithm, kept free of RabbitMQ/Redis so it can be
unit-tested on its own.

Rule: when the first request arrives, open a window of `max_wait_ms`. Close
the batch as soon as EITHER the window expires OR `max_batch_size` requests
have been collected, whichever comes first.

  - Under heavy load the batch fills instantly, so we pay ~0 ms of waiting and
    get maximum throughput from one forward pass.
  - Under light load a lone request waits at most `max_wait_ms` before running
    by itself, so latency stays bounded.
"""

from __future__ import annotations

import asyncio
from typing import Generic, TypeVar

T = TypeVar("T")


class DynamicBatcher(Generic[T]):
    def __init__(self, max_batch_size: int = 16, max_wait_ms: float = 50.0) -> None:
        if max_batch_size < 1:
            raise ValueError("max_batch_size must be >= 1")
        if max_wait_ms < 0:
            raise ValueError("max_wait_ms must be >= 0")
        self.max_batch_size = max_batch_size
        self.max_wait_s = max_wait_ms / 1000.0
        self._queue: asyncio.Queue[T] = asyncio.Queue()

    async def put(self, item: T) -> None:
        await self._queue.put(item)

    def pending(self) -> int:
        return self._queue.qsize()

    async def next_batch(self) -> list[T]:
        # Block (without busy-waiting) until there is at least one item; the
        # window only starts once real work exists.
        first = await self._queue.get()
        batch = [first]

        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.max_wait_s

        while len(batch) < self.max_batch_size:
            # Fast path: grab everything that is already waiting, no timers.
            try:
                batch.append(self._queue.get_nowait())
                continue
            except asyncio.QueueEmpty:
                pass

            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            try:
                batch.append(await asyncio.wait_for(self._queue.get(), timeout=remaining))
            except asyncio.TimeoutError:
                break

        return batch
