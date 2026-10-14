import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { JobPublisher, JobRecord, JobStore } from "./types.js";

export interface AppDeps {
  publisher: JobPublisher;
  store: JobStore;
  jobTtlSeconds: number;
  maxTextLength: number;
  notifierPublicUrl: string;
  logger?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Builds the HTTP app without starting it, so tests can call app.inject()
 * with fake dependencies and no real RabbitMQ/Redis.
 *
 * The gateway never touches the model. Its whole job is: validate, record,
 * enqueue, and answer in a few milliseconds.
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  // Logging is off by default: per-request logs cost real throughput at
  // thousands of req/s. removeAdditional=false rejects unknown fields with a
  // 400 instead of Fastify's default of silently stripping them.
  const app = Fastify({
    logger: deps.logger ?? false,
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.post<{ Body: { text: string } }>(
    "/v1/infer",
    {
      // Fastify compiles this JSON schema into a fast validator; bad input is
      // rejected with a 400 before our handler runs.
      schema: {
        body: {
          type: "object",
          required: ["text"],
          additionalProperties: false,
          properties: { text: { type: "string", minLength: 1, maxLength: deps.maxTextLength } },
        },
      },
    },
    async (request, reply) => {
      const jobId = randomUUID();
      const acceptedAt = Date.now();
      const record: JobRecord = { job_id: jobId, status: "queued", accepted_at_ms: acceptedAt };

      // Order matters: write "queued" to Redis *before* publishing. If we
      // published first, a fast worker could finish and write "done", and our
      // late "queued" write would clobber the result.
      try {
        await deps.store.create(record, deps.jobTtlSeconds);
      } catch (err) {
        request.log.error({ err }, "redis write failed");
        return reply.code(503).send({ error: "result store unavailable" });
      }

      try {
        await deps.publisher.publish({ job_id: jobId, text: request.body.text, accepted_at_ms: acceptedAt });
      } catch (err) {
        await deps.store.markFailed(jobId, "not enqueued", deps.jobTtlSeconds).catch(() => {});
        return reply
          .code(503)
          .header("retry-after", "1")
          .send({ error: (err as Error).message });
      }

      return reply
        .code(202)
        .header("location", `/v1/jobs/${jobId}`)
        .send({
          job_id: jobId,
          status: "queued",
          status_url: `/v1/jobs/${jobId}`,
          stream_url: `${deps.notifierPublicUrl}/ws/jobs/${jobId}`,
        });
    },
  );

  // Polling endpoint: the simple alternative to the WebSocket stream.
  app.get<{ Params: { id: string } }>("/v1/jobs/:id", async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: "invalid job id" });
    const record = await deps.store.get(id);
    if (!record) return reply.code(404).send({ error: "job not found or expired" });
    return record;
  });

  app.get("/v1/stats", async () => deps.store.stats());

  // Liveness: is the process up? Readiness: can it actually take traffic?
  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async (_request, reply) => {
    const ready = deps.publisher.isReady() && deps.store.isReady();
    return reply.code(ready ? 200 : 503).send({ queue: deps.publisher.isReady(), store: deps.store.isReady() });
  });

  return app;
}
