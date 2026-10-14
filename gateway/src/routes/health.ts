import type { FastifyInstance } from "fastify";
import type { ReadinessProbe } from "../types.js";

/** Liveness: is the process up? Readiness: can it take traffic right now? */
export function registerHealthRoutes(app: FastifyInstance, dependencies: Record<string, ReadinessProbe>): void {
  app.get("/healthz", async () => ({ ok: true }));

  app.get("/readyz", async (_request, reply) => {
    const status = Object.fromEntries(Object.entries(dependencies).map(([name, dep]) => [name, dep.isReady()]));
    const ready = Object.values(status).every(Boolean);
    return reply.code(ready ? 200 : 503).send(status);
  });
}
