"""The dynamic batching algorithm, independent of RabbitMQ and Redis.

When the first request arrives, a window of `max_wait_ms` opens. The batch
closes as soon as the window expires OR `max_batch_size` items are collected.

  - Heavy load: the batch fills at once, so nobody waits and one forward pass
    serves many requests.
  - Light load: a lone request waits at most `max_wait_ms`.
  - max_wait_ms=0: never wait; take whatever queued up during the previous
    forward pass. Batch size then follows the load automatically.
"""

from __future__ import annotations

import asyncio
from typing import Generic, TypeVar

T = TypeVar("T")


class DynamicBatcher(Generic[T]):
    def __init__(self, max_batch_size: int = 16, max_wait_ms: float = 50.0) -> None:
        if max_batch_size < 1:
            raise ValueError(f"max_batch_size must be >= 1, got {max_batch_size}")
        if max_wait_ms < 0:
            raise ValueError(f"max_wait_ms must be >= 0, got {max_wait_ms}")
        self.max_batch_size = max_batch_size
        self.max_wait_s = max_wait_ms / 1000.0
        self._queue: asyncio.Queue[T] = asyncio.Queue()

    async def put(self, item: T) -> None:
        await self._queue.put(item)

    async def next_batch(self) -> list[T]:
        """Blocks until at least one item exists; the window starts only then."""
        batch = [await self._queue.get()]
        deadline = asyncio.get_running_loop().time() + self.max_wait_s
        await self._fill_until(batch, deadline)
        return batch

    async def _fill_until(self, batch: list[T], deadline: float) -> None:
        loop = asyncio.get_running_loop()
        while len(batch) < self.max_batch_size:
            if not self._queue.empty():
                batch.append(self._queue.get_nowait())
                continue
            remaining = deadline - loop.time()
            if remaining <= 0:
                return
            try:
                batch.append(await asyncio.wait_for(self._queue.get(), timeout=remaining))
            except asyncio.TimeoutError:
                return
