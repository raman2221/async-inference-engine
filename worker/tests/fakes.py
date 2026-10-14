from inference_worker.jobs import PendingJob


class FakeMessage:
    def __init__(self, body: bytes = b""):
        self.body = body
        self.acked = False
        self.requeued = False
        self.rejected = False

    async def ack(self):
        self.acked = True

    async def nack(self, requeue=True):
        self.requeued = requeue

    async def reject(self, requeue=False):
        self.rejected = True


class BrokenModel:
    def predict(self, texts):
        raise RuntimeError("CUDA out of memory")


class DownRedis:
    def pipeline(self, transaction=False):
        raise ConnectionError("redis down")


def make_jobs(*texts: str) -> list[PendingJob]:
    return [PendingJob(f"id-{i}", text, accepted_at_ms=1_000, message=FakeMessage()) for i, text in enumerate(texts)]
