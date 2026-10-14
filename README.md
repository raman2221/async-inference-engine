# Async Inference Engine

A distributed, asynchronous ML inference pipeline with **dynamic request batching**.
Clients get an instant `202 Accepted`; a background worker groups requests into
batches of up to 16 (or whatever arrives within 50 ms) and runs them through a
DistilBERT sentiment model in a single forward pass. Results land in Redis and are
pushed to clients over WebSockets.

Four languages, each where it fits best:

| Service | Language | Role |
|---|---|---|
| `gateway/` | **TypeScript** (Node 24, Fastify) | Ingress API: validate → record → enqueue → `202` in a few ms |
| `worker/` | **Python** (asyncio, PyTorch, Transformers) | Dynamic batcher + model inference |
| `notifier/` | **C#** (.NET 10, ASP.NET Core) | WebSocket result delivery, one Redis subscription fanned out in memory |
| `loadtest/` | **C++20** (cpp-httplib) | Open-loop load generator for stress tests and benchmarks |

Infrastructure: **RabbitMQ** (durable work queue), **Redis** (result store + pub/sub),
**Docker Compose** (runs all of it).

## Architecture

```
 Client ──POST /v1/infer──► Gateway (TS) ──1. SET job:<id> = queued──► Redis
   ▲                           │
   │ 202 + job_id              └──2. publish (confirmed, persistent)──► RabbitMQ
   │                                                                     │
   │                                         prefetch=64, competing consumers
   │                                                                     ▼
   │                                   Worker (Python): DynamicBatcher
   │                                     wait ≤50 ms OR until 16 requests
   │                                     → one tensor batch → DistilBERT
   │                                     → SET job:<id> = done  + PUBLISH job-events
   │                                     → ack messages (only after Redis write)
   │                                                                     │
   ├──GET /v1/jobs/<id> (poll)──► Gateway ──GET──► Redis ◄───────────────┘
   │                                                 │ SUBSCRIBE job-events
   └──WS /ws/jobs/<id> (push)───► Notifier (C#) ◄────┘
```

## Quick start

Requires Docker Desktop.

```bash
docker compose up --build -d          # rabbitmq, redis, gateway, worker, notifier
node scripts/demo.mjs "I loved it" "terrible service"
```

```
"I loved it"
  202 in 51.7 ms -> done POSITIVE (0.9998)
  total 145.1 ms, batch_size=2, queue_wait=54 ms, inference=28 ms
```

Or by hand:

```bash
curl -s -XPOST localhost:8080/v1/infer -H 'content-type: application/json' -d '{"text":"great movie"}'
# {"job_id":"…","status":"queued","status_url":"/v1/jobs/…","stream_url":"ws://localhost:8081/ws/jobs/…"}
curl -s localhost:8080/v1/jobs/<job_id>
```

RabbitMQ management UI: http://localhost:15672 (guest / guest).

## API

| Method | Path | Service | Description |
|---|---|---|---|
| `POST` | `/v1/infer` | gateway :8080 | Body `{"text": "..."}` (1–2000 chars). `202` + job id, `400` on bad input, `503` + `Retry-After` when the queue is full |
| `GET` | `/v1/jobs/{id}` | gateway :8080 | Job record: `queued` / `done` / `failed`, result, timestamps, batch size |
| `GET` | `/v1/stats` | gateway :8080 | Worker counters: batches, jobs, batch-size histogram |
| `GET` | `/healthz`, `/readyz` | gateway :8080 | Liveness / readiness (RabbitMQ + Redis connected) |
| `WS` | `/ws/jobs/{id}` | notifier :8081 | Pushes the final job record, then closes |

## Configuration

Set in the shell or a `.env` file (see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `MAX_BATCH_SIZE` | 16 | Largest batch the worker builds |
| `MAX_WAIT_MS` | 50 | How long the batch window stays open after the first request |
| `MODEL_BACKEND` | `hf` | `hf` = DistilBERT, `fake` = simulated cost model (no download) |
| `WORKER_REPLICAS` | 1 | Number of competing worker containers |
| `TORCH_THREADS` | 4 | CPU threads per worker for PyTorch |

## Load testing & benchmark

```bash
# Stress the ingress path
docker compose --profile tools run --rm loadtest --url http://gateway:8080 --rps 2000 --duration 30

# Batching vs. no batching under the same load
bash scripts/benchmark.sh 150 30 1 16
```

## Design decisions

- **Redis write before publish.** The gateway records `queued` *before* enqueuing so a fast
  worker's `done` can never be overwritten by a late `queued`.
- **Publisher confirms + persistent messages.** `202` is only sent after RabbitMQ has the job on disk.
- **Bounded queue with `reject-publish`.** Under overload RabbitMQ nacks new messages and the gateway
  returns a fast `503 Retry-After` instead of growing memory without limit.
- **Ack after the result is stored.** If a worker dies mid-batch, RabbitMQ redelivers; jobs are never
  silently lost (at-least-once delivery; results are idempotent).
- **Poison messages go to a dead-letter queue** (`inference.requests.dead`) instead of crash-looping.
- **Inference runs in a thread** (`asyncio.to_thread`) so the worker keeps receiving messages and
  the next batch fills while the current one computes.
- **`prefetch_count = 4 × batch size`**, otherwise RabbitMQ never delivers enough messages to fill a batch.
- **One Redis subscription per notifier**, routed in memory, rather than one per WebSocket. Register
  interest *before* checking Redis so a result can't slip through the gap.
- **Open-loop load testing.** Latency is measured from each request's scheduled send time,
  avoiding coordinated omission.

## Tests

```bash
cd gateway  && npm install && npm test                              # 5 tests (Vitest, app.inject)
cd worker   && pip install -r requirements-dev.txt && pytest        # 11 tests (batcher + processor)
cd notifier && dotnet test                                          # 7 tests (xUnit)
```
