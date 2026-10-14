import { buildApp } from "../src/app.js";
import type { JobPublisher, JobRecord, JobStore, QueueMessage } from "../src/types.js";

export class FakePublisher implements JobPublisher {
  published: QueueMessage[] = [];
  rejectNext = false;

  async publish(message: QueueMessage): Promise<void> {
    if (this.rejectNext) throw new Error("queue full");
    this.published.push(message);
  }

  isReady(): boolean {
    return true;
  }
}

export class FakeStore implements JobStore {
  records = new Map<string, JobRecord>();
  unavailable = false;

  async create(record: JobRecord): Promise<void> {
    if (this.unavailable) throw new Error("connection refused");
    if (!this.records.has(record.job_id)) this.records.set(record.job_id, record);
  }

  async get(jobId: string): Promise<JobRecord | null> {
    return this.records.get(jobId) ?? null;
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    const record = this.records.get(jobId);
    if (record) this.records.set(jobId, { ...record, status: "failed", error });
  }

  async stats(): Promise<Record<string, string>> {
    return { batches: "3" };
  }

  isReady(): boolean {
    return !this.unavailable;
  }
}

export function createTestApp() {
  const publisher = new FakePublisher();
  const store = new FakeStore();
  const app = buildApp({
    publisher,
    store,
    jobTtlSeconds: 60,
    maxTextLength: 20,
    notifierPublicUrl: "ws://notifier",
  });
  return { app, publisher, store };
}
