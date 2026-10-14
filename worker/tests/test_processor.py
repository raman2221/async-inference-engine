import json

import fakeredis
import pytest

from inference_worker.model import FakeModel, Prediction
from inference_worker.worker import EVENTS_CHANNEL, STATS_KEY, BatchProcessor, PendingJob, parse_message


class FakeMessage:
    def __init__(self):
        self.acked = False
        self.nacked = False

    async def ack(self):
        self.acked = True

    async def nack(self, requeue=True):
        self.nacked = True


class BrokenModel:
    name = "broken"

    def predict(self, texts):
        raise RuntimeError("CUDA out of memory")


def make_jobs(*texts):
    return [PendingJob(job_id=f"id-{i}", text=t, accepted_at_ms=1_000, message=FakeMessage()) for i, t in enumerate(texts)]


@pytest.fixture
def redis():
    return fakeredis.FakeAsyncRedis()


async def test_writes_results_publishes_events_and_acks(redis):
    pubsub = redis.pubsub()
    await pubsub.subscribe(EVENTS_CHANNEL)
    await pubsub.get_message(timeout=1)  # subscribe confirmation

    jobs = make_jobs("a great film", "awful")
    await BatchProcessor(FakeModel(fixed_ms=0, per_item_ms=0), redis, job_ttl_seconds=60).process(jobs)

    first = json.loads(await redis.get("job:id-0"))
    assert first["status"] == "done"
    assert first["result"]["label"] == "POSITIVE"
    assert first["batch_size"] == 2
    assert json.loads(await redis.get("job:id-1"))["result"]["label"] == "NEGATIVE"
    assert all(job.message.acked for job in jobs)

    event = await pubsub.get_message(timeout=1)
    assert json.loads(event["data"])["job_id"] == "id-0"

    stats = await redis.hgetall(STATS_KEY)
    assert stats[b"jobs"] == b"2" and stats[b"batch_size:2"] == b"1"


async def test_inference_error_marks_jobs_failed_and_still_acks(redis):
    jobs = make_jobs("x", "y")
    await BatchProcessor(BrokenModel(), redis, job_ttl_seconds=60).process(jobs)

    record = json.loads(await redis.get("job:id-1"))
    assert record["status"] == "failed"
    assert "CUDA out of memory" in record["error"]
    # A deterministic model failure would fail again; don't loop forever.
    assert all(job.message.acked for job in jobs)


async def test_redis_failure_requeues_instead_of_acking():
    class DownRedis:
        def pipeline(self, transaction=False):
            raise ConnectionError("redis down")

    jobs = make_jobs("x")
    await BatchProcessor(FakeModel(fixed_ms=0, per_item_ms=0), DownRedis(), job_ttl_seconds=60).process(jobs)

    assert jobs[0].message.nacked and not jobs[0].message.acked


def test_parse_message_validates_fields():
    msg = FakeMessage()
    job = parse_message(b'{"job_id": "abc", "text": "hi", "accepted_at_ms": 5}', msg)
    assert (job.job_id, job.text, job.accepted_at_ms) == ("abc", "hi", 5)
    with pytest.raises(KeyError):
        parse_message(b'{"job_id": "abc"}', msg)
    with pytest.raises(ValueError):
        parse_message(b"not json", msg)


def test_fake_model_labels_by_keyword():
    model = FakeModel(fixed_ms=20, per_item_ms=2)
    assert model.predict(["good"]) == [Prediction("POSITIVE", 0.9)]
