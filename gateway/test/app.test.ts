import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { JobPublisher, JobRecord, JobStore, QueueMessage } from "../src/types.js";

class FakePublisher implements JobPublisher {
  published: QueueMessage[] = [];
  fail = false;
  async publish(message: QueueMessage) {
    if (this.fail) throw new Error("queue rejected message");
    this.published.push(message);
  }
  isReady() {
    return true;
  }
}

class FakeStore implements JobStore {
  records = new Map<string, JobRecord>();
  async create(record: JobRecord) {
    if (!this.records.has(record.job_id)) this.records.set(record.job_id, record);
  }
  async get(id: string) {
    return this.records.get(id) ?? null;
  }
  async markFailed(id: string, error: string) {
    const r = this.records.get(id);
    if (r) this.records.set(id, { ...r, status: "failed", error });
  }
  async stats() {
    return { batches: "3" };
  }
  isReady() {
    return true;
  }
}

function setup() {
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

describe("POST /v1/infer", () => {
  it("returns 202, records the job as queued, and enqueues it", async () => {
    const { app, publisher, store } = setup();
    const res = await app.inject({ method: "POST", url: "/v1/infer", payload: { text: "great movie" } });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("queued");
    expect(res.headers.location).toBe(`/v1/jobs/${body.job_id}`);
    expect(body.stream_url).toBe(`ws://notifier/ws/jobs/${body.job_id}`);
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]).toMatchObject({ job_id: body.job_id, text: "great movie" });
    expect(store.records.get(body.job_id)?.status).toBe("queued");
  });

  it("rejects missing, empty, oversized, and extra fields with 400", async () => {
    const { app, publisher } = setup();
    for (const payload of [{}, { text: "" }, { text: "x".repeat(21) }, { text: "ok", extra: 1 }]) {
      const res = await app.inject({ method: "POST", url: "/v1/infer", payload });
      expect(res.statusCode).toBe(400);
    }
    expect(publisher.published).toHaveLength(0);
  });

  it("returns 503 and marks the job failed when the queue rejects it", async () => {
    const { app, publisher, store } = setup();
    publisher.fail = true;
    const res = await app.inject({ method: "POST", url: "/v1/infer", payload: { text: "hi" } });

    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
    const [record] = [...store.records.values()];
    expect(record.status).toBe("failed");
  });
});

describe("GET /v1/jobs/:id", () => {
  it("returns the stored record", async () => {
    const { app } = setup();
    const created = (await app.inject({ method: "POST", url: "/v1/infer", payload: { text: "hi" } })).json();
    const res = await app.inject({ method: "GET", url: `/v1/jobs/${created.job_id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().job_id).toBe(created.job_id);
  });

  it("404s on unknown ids and 400s on malformed ones", async () => {
    const { app } = setup();
    const unknown = await app.inject({ method: "GET", url: "/v1/jobs/00000000-0000-0000-0000-000000000000" });
    expect(unknown.statusCode).toBe(404);
    const bad = await app.inject({ method: "GET", url: "/v1/jobs/not-a-uuid" });
    expect(bad.statusCode).toBe(400);
  });
});
