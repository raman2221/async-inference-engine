import type { FastifyInstance } from "fastify";
import type { JobStore } from "../types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** GET /v1/jobs/:id (polling alternative to the WebSocket) and GET /v1/stats. */
export function registerJobRoutes(app: FastifyInstance, store: JobStore): void {
  app.get<{ Params: { id: string } }>("/v1/jobs/:id", async (request, reply) => {
    const { id } = request.params;
    if (!UUID_PATTERN.test(id)) return reply.code(400).send({ error: "invalid job id" });
    const record = await store.get(id);
    if (!record) return reply.code(404).send({ error: "job not found or expired" });
    return record;
  });

  app.get("/v1/stats", async () => store.stats());
}
