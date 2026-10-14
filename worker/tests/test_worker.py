import asyncio

from inference_worker.batcher import DynamicBatcher
from inference_worker.worker import Worker
from tests.fakes import FakeMessage


class RecordingProcessor:
    def __init__(self):
        self.batches = []

    async def process(self, batch):
        self.batches.append([job.job_id for job in batch])


def make_worker():
    processor = RecordingProcessor()
    return Worker(DynamicBatcher(max_batch_size=4, max_wait_ms=10), processor), processor


async def test_valid_messages_are_batched_and_processed():
    worker, processor = make_worker()
    for i in range(2):
        await worker.on_message(FakeMessage(f'{{"job_id": "j{i}", "text": "t", "accepted_at_ms": 1}}'.encode()))

    run = asyncio.create_task(worker.run())
    await asyncio.sleep(0.05)
    worker.stop()
    await run

    assert processor.batches == [["j0", "j1"]]


async def test_malformed_message_is_dead_lettered():
    worker, _ = make_worker()
    message = FakeMessage(b"not json")

    await worker.on_message(message)

    assert message.rejected


async def test_stop_ends_run_while_idle():
    worker, _ = make_worker()
    run = asyncio.create_task(worker.run())

    worker.stop()

    await asyncio.wait_for(run, timeout=1)
