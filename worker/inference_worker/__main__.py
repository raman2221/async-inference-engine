"""Entry point: builds every dependency, wires them together, and runs the worker."""

import asyncio
import logging
import signal

from redis.asyncio import Redis

from .batcher import DynamicBatcher
from .config import Config
from .model import load_model
from .processor import BatchProcessor
from .rabbit import connect_with_retry, declare_topology
from .worker import Worker

log = logging.getLogger("worker")


def stop_on_signals(worker: Worker) -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, worker.stop)
        except NotImplementedError:  # Windows: Ctrl+C still raises KeyboardInterrupt
            pass


async def main(cfg: Config) -> None:
    log.info("loading model backend=%s name=%s", cfg.model_backend, cfg.model_name)
    model = load_model(cfg.model_backend, cfg.model_name, cfg.torch_threads)
    model.predict(["warm up"] * cfg.max_batch_size)  # first call allocates; keep it out of the stats

    redis = Redis.from_url(cfg.redis_url)
    connection = await connect_with_retry(cfg.rabbit_url)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=cfg.prefetch_count)
    queue = await declare_topology(channel, cfg.queue_name, cfg.queue_max_length)

    worker = Worker(
        DynamicBatcher(cfg.max_batch_size, cfg.max_wait_ms),
        BatchProcessor(model, redis, cfg.job_ttl_seconds),
    )
    stop_on_signals(worker)
    consumer_tag = await queue.consume(worker.on_message)
    log.info("consuming %s (max_batch=%d, max_wait=%.0fms, prefetch=%d)",
             cfg.queue_name, cfg.max_batch_size, cfg.max_wait_ms, cfg.prefetch_count)
    try:
        await worker.run()
    finally:
        # Unacked deliveries return to the queue for another worker.
        log.info("shutting down")
        await queue.cancel(consumer_tag)
        await connection.close()
        await redis.aclose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="[worker] %(asctime)s %(levelname)s %(message)s")
    asyncio.run(main(Config.from_env()))
