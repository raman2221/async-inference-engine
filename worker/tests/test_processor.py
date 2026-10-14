import json

import fakeredis
import pytest

from inference_worker.contract import EVENTS_CHANNEL, STATS_KEY
from inference_worker.model import FakeModel
from inference_worker.processor import BatchProcessor
from tests.fakes import BrokenModel, DownRedis, make_jobs


@pytest.fixture
def redis():
    return fakeredis.FakeAsyncRedis()


@pytest.fixture
def instant_model():
    return FakeModel(fixed_ms=0, per_item_ms=0)


async def read_record(redis, job_id):
    return json.loads(await redis.get(f"job:{job_id}"))


async def test_stores_each_prediction_under_its_job_id(redis, instant_model):
    jobs = make_jobs("a great film", "awful")

    await BatchProcessor(instant_model, redis, job_ttl_seconds=60).process(jobs)

    assert (await read_record(redis, "id-0"))["result"]["label"] == "POSITIVE"
    assert (await read_record(redis, "id-1"))["result"]["label"] == "NEGATIVE"


async def test_records_the_batch_size_on_every_result(redis, instant_model):
    jobs = make_jobs("a", "b", "c")

    await BatchProcessor(instant_model, redis, job_ttl_seconds=60).process(jobs)

    assert {(await read_record(redis, job.job_id))["batch_size"] for job in jobs} == {3}


async def test_publishes_a_completion_event_per_job(redis, instant_model):
    pubsub = redis.pubsub()
    await pubsub.subscribe(EVENTS_CHANNEL)
    await pubsub.get_message(timeout=1)  # discard the subscribe confirmation

    await BatchProcessor(instant_model, redis, job_ttl_seconds=60).process(make_jobs("good"))

    event = await pubsub.get_message(timeout=1)
    assert json.loads(event["data"])["job_id"] == "id-0"


async def test_updates_batch_statistics(redis, instant_model):
    await BatchProcessor(instant_model, redis, job_ttl_seconds=60).process(make_jobs("a", "b"))

    stats = await redis.hgetall(STATS_KEY)
    assert (stats[b"jobs"], stats[b"batch_size:2"]) == (b"2", b"1")


async def test_acks_messages_after_storing_results(redis, instant_model):
    jobs = make_jobs("a", "b")

    await BatchProcessor(instant_model, redis, job_ttl_seconds=60).process(jobs)

    assert all(job.message.acked for job in jobs)


async def test_inference_error_stores_failed_records(redis):
    jobs = make_jobs("x")

    await BatchProcessor(BrokenModel(), redis, job_ttl_seconds=60).process(jobs)

    record = await read_record(redis, "id-0")
    assert record["status"] == "failed" and "CUDA out of memory" in record["error"]


async def test_inference_error_still_acks_so_bad_input_is_not_retried_forever(redis):
    jobs = make_jobs("x")

    await BatchProcessor(BrokenModel(), redis, job_ttl_seconds=60).process(jobs)

    assert jobs[0].message.acked


async def test_redis_failure_requeues_instead_of_acking(instant_model):
    jobs = make_jobs("x")

    await BatchProcessor(instant_model, DownRedis(), job_ttl_seconds=60).process(jobs)

    assert jobs[0].message.requeued and not jobs[0].message.acked
