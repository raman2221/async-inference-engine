import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./routes/health.js";
import { registerInferRoute } from "./routes/infer.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { JobSubmitter } from "./submitter.js";
import type { JobPublisher, JobStore } from "./types.js";

export interface AppDependencies {
  publisher: JobPublisher;
  store: JobStore;
  jobTtlSeconds: number;
  maxTextLength: number;
  notifierPublicUrl: string;
}

/**
 * Builds the HTTP app without starting it, so tests can call app.inject()
 * with in-memory fakes instead of real RabbitMQ and Redis.
 */
export function buildApp(deps: AppDependencies): FastifyInstance {
  // removeAdditional=false rejects unknown fields with a 400 instead of
  // silently stripping them (Fastify's default).
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  const submitter = new JobSubmitter(deps.publisher, deps.store, deps.jobTtlSeconds);

  registerInferRoute(app, {
    submitter,
    maxTextLength: deps.maxTextLength,
    notifierPublicUrl: deps.notifierPublicUrl,
  });
  registerJobRoutes(app, deps.store);
  registerHealthRoutes(app, { queue: deps.publisher, store: deps.store });
  return app;
}
