# Contributing

## Code style

- **Small functions that do one thing.** If a function needs a comment to explain its sections,
  those sections become functions. Aim for under ~20 lines and at most 3 parameters; no boolean
  "mode" parameters (`ack_all` / `requeue_all` instead of `settle(ack=True)`).
- **Names say why something exists.** Classes are nouns (`JobSubmitter`, `BatchProcessor`),
  functions are verbs (`submit`, `declare_topology`).
- **Errors are exceptions with context**, not sentinel values. The gateway maps typed errors
  (`QueueRejectedError`, `StoreUnavailableError`) to HTTP status codes in one place; the load
  tester uses `std::optional` rather than `-1` for "no HTTP status".
- **Construction is separate from use.** Each service wires its dependencies in one entry point
  (`gateway/src/server.ts`, `worker/inference_worker/__main__.py`, `notifier/src/NotifierSetup.cs`);
  everything else receives them through constructors, which is what makes the in-memory fakes in
  the tests possible.
- **Comments explain why, not what**: design constraints, ordering requirements, and warnings.
- **Tests check one behavior each**, are named after that behavior, and follow Arrange-Act-Assert.
- **No dead code.** Delete it; git keeps the history.
- Lines stay under 120 characters.

## Cross-service contract

The gateway (TypeScript), worker (Python), and notifier (C#) share these names. Change them in all
three together:

| Name | Kind | Defined in |
|---|---|---|
| `job:<id>` | Redis key holding the job record (JSON) | `gateway/src/store.ts`, `worker/inference_worker/contract.py`, `notifier/src/RedisNames.cs` |
| `job-events` | Redis pub/sub channel for finished jobs | `worker/inference_worker/contract.py`, `notifier/src/RedisNames.cs` |
| `stats:worker` | Redis hash of worker counters | `gateway/src/store.ts`, `worker/inference_worker/contract.py` |
| `inference.requests` (+ `.dlx`, `.dead`) | RabbitMQ queue, dead-letter exchange and queue | `gateway/src/queue.ts`, `worker/inference_worker/rabbit.py` |
| Job record fields | `job_id`, `status`, `accepted_at_ms`, `started_at_ms`, `completed_at_ms`, `batch_size`, `result`, `error` | `gateway/src/types.ts`, `worker/inference_worker/jobs.py` |

The queue must be declared with identical arguments by the gateway and the worker, or RabbitMQ
rejects the second declaration with `PRECONDITION_FAILED`.

## Before you push

```bash
cd gateway  && npm run build && npm test
cd worker   && python -m pytest
cd notifier && dotnet test
docker compose up --build -d && node scripts/demo.mjs   # end-to-end check
```
