import pytest

from inference_worker.jobs import BatchTiming, completed_record, failed_record, parse_message
from inference_worker.model import Prediction
from tests.fakes import FakeMessage, make_jobs

TIMING = BatchTiming(started_at_ms=1_050, completed_at_ms=1_080, batch_size=4)


def test_parse_message_reads_all_fields():
    job = parse_message(b'{"job_id": "abc", "text": "hi", "accepted_at_ms": 5}', FakeMessage())

    assert (job.job_id, job.text, job.accepted_at_ms) == ("abc", "hi", 5)


def test_parse_message_rejects_missing_fields():
    with pytest.raises(KeyError):
        parse_message(b'{"job_id": "abc"}', FakeMessage())


def test_parse_message_rejects_invalid_json():
    with pytest.raises(ValueError):
        parse_message(b"not json", FakeMessage())


def test_completed_record_includes_result_and_timing():
    [job] = make_jobs("hi")

    record = completed_record(job, TIMING, Prediction("POSITIVE", 0.98))

    assert record == {
        "job_id": "id-0",
        "status": "done",
        "accepted_at_ms": 1_000,
        "started_at_ms": 1_050,
        "completed_at_ms": 1_080,
        "batch_size": 4,
        "result": {"label": "POSITIVE", "score": 0.98},
    }


def test_failed_record_carries_the_error_instead_of_a_result():
    [job] = make_jobs("hi")

    record = failed_record(job, TIMING, "boom")

    assert (record["status"], record["error"], "result" in record) == ("failed", "boom", False)
