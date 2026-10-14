import { randomUUID } from "node:crypto";
import type { JobPublisher, JobRecord, JobStore } from "./types.js";

/** Thrown when the job cannot be recorded in Redis, so nothing was enqueued. */
export class StoreUnavailableError extends Error {}

/** Thrown when RabbitMQ refuses the job (connection down, or the queue is full). */
export class QueueRejectedError extends Error {}

/**
 * Accepts a job: records it as "queued" and hands it to the queue.
 * Knows nothing about HTTP, so the same logic could sit behind gRPC or a CLI.
 */
export class JobSubmitter {
  constructor(
    private readonly publisher: JobPublisher,
    private readonly store: JobStore,
    private readonly ttlSeconds: number,
  ) {}

  async submit(text: string): Promise<JobRecord> {
    const record: JobRecord = { job_id: randomUUID(), status: "queued", accepted_at_ms: Date.now() };
    // Record before enqueueing: a fast worker's "done" must never be
    // overwritten by a late "queued".
    await this.recordAsQueued(record);
    await this.enqueue(record, text);
    return record;
  }

  private async recordAsQueued(record: JobRecord): Promise<void> {
    try {
      await this.store.create(record, this.ttlSeconds);
    } catch (err) {
      throw new StoreUnavailableError(`result store unavailable: ${(err as Error).message}`);
    }
  }

  private async enqueue(record: JobRecord, text: string): Promise<void> {
    try {
      await this.publisher.publish({ job_id: record.job_id, text, accepted_at_ms: record.accepted_at_ms });
    } catch (err) {
      await this.store.markFailed(record.job_id, "not enqueued", this.ttlSeconds).catch(() => {});
      throw new QueueRejectedError(`queue rejected job ${record.job_id}: ${(err as Error).message}`);
    }
  }
}
