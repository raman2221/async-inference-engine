import asyncio
import time

import pytest

from inference_worker.batcher import DynamicBatcher


async def test_full_batch_returns_without_waiting_for_timeout():
    batcher = DynamicBatcher(max_batch_size=4, max_wait_ms=1000)
    for i in range(4):
        await batcher.put(i)

    start = time.perf_counter()
    batch = await batcher.next_batch()

    assert batch == [0, 1, 2, 3]
    assert time.perf_counter() - start < 0.1  # did not sit out the 1s window


async def test_partial_batch_closes_when_window_expires():
    batcher = DynamicBatcher(max_batch_size=16, max_wait_ms=50)
    await batcher.put("a")
    await batcher.put("b")

    start = time.perf_counter()
    batch = await batcher.next_batch()
    elapsed = time.perf_counter() - start

    assert batch == ["a", "b"]
    assert 0.04 <= elapsed < 0.2


async def test_never_exceeds_max_batch_size_and_keeps_order():
    batcher = DynamicBatcher(max_batch_size=3, max_wait_ms=10)
    for i in range(7):
        await batcher.put(i)

    batches = [await batcher.next_batch() for _ in range(3)]

    assert batches == [[0, 1, 2], [3, 4, 5], [6]]


async def test_items_arriving_inside_the_window_join_the_batch():
    batcher = DynamicBatcher(max_batch_size=8, max_wait_ms=200)

    async def trickle():
        for i in range(3):
            await asyncio.sleep(0.02)
            await batcher.put(i)

    producer = asyncio.create_task(trickle())
    await batcher.put("first")
    batch = await batcher.next_batch()
    await producer

    assert batch == ["first", 0, 1, 2]


async def test_waits_for_first_item_without_starting_the_window():
    batcher = DynamicBatcher(max_batch_size=2, max_wait_ms=10)
    task = asyncio.create_task(batcher.next_batch())
    await asyncio.sleep(0.05)  # idle longer than the window
    assert not task.done()

    await batcher.put("x")
    await batcher.put("y")
    assert await task == ["x", "y"]


def test_rejects_invalid_settings():
    with pytest.raises(ValueError):
        DynamicBatcher(max_batch_size=0)
    with pytest.raises(ValueError):
        DynamicBatcher(max_wait_ms=-1)
