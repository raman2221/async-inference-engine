import type { FastifyInstance } from "fastify";
import { type JobSubmitter, QueueRejectedError, StoreUnavailableError } from "../submitter.js";

export interface InferRouteOptions {
  submitter: JobSubmitter;
  maxTextLength: number;
  notifierPublicUrl: string;
}

function inferBodySchema(maxTextLength: number) {
  return {
    type: "object",
    required: ["text"],
    additionalProperties: false,
    properties: { text: { type: "string", minLength: 1, maxLength: maxTextLength } },
  };
}

function isOverloadError(err: unknown): err is Error {
  return err instanceof QueueRejectedError || err instanceof StoreUnavailableError;
}

/** POST /v1/infer: validate, submit, and answer 202 in a few milliseconds. */
export function registerInferRoute(app: FastifyInstance, options: InferRouteOptions): void {
  const { submitter, maxTextLength, notifierPublicUrl } = options;

  app.post<{ Body: { text: string } }>(
    "/v1/infer",
    { schema: { body: inferBodySchema(maxTextLength) } },
    async (request, reply) => {
      try {
        const { job_id: jobId } = await submitter.submit(request.body.text);
        const statusUrl = `/v1/jobs/${jobId}`;
        const streamUrl = `${notifierPublicUrl}/ws/jobs/${jobId}`;
        return reply
          .code(202)
          .header("location", statusUrl)
          .send({ job_id: jobId, status: "queued", status_url: statusUrl, stream_url: streamUrl });
      } catch (err) {
        if (!isOverloadError(err)) throw err;
        return reply.code(503).header("retry-after", "1").send({ error: err.message });
      }
    },
  );
}
