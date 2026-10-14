import { describe, expect, it } from "vitest";
import { createTestApp } from "./fakes.js";

const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

describe("POST /v1/infer", () => {
  it("answers 202 with the job id and both result URLs", async () => {
    const { app } = createTestApp();

    const res = await app.inject({ method: "POST", url: "/v1/infer", payload: { text: "great movie" } });

    const body = res.json();
    expect(res.statusCode).toBe(202);
    expect(res.headers.location).toBe(`/v1/jobs/${body.job_id}`);
    expect(body.stream_url).toBe(`ws://notifier/ws/jobs/${body.job_id}`);
  });

  it("enqueues the text under the returned job id", async () => {
    const { app, publisher } = createTestApp();

    const res = await app.inject({ method: "POST", url: "/v1/infer", payload: { text: "great movie" } });

    expect(publisher.published).toEqual([
      expect.objectContaining({ job_id: res.json().job_id, text: "great movie" }),
    ]);
  });

  it.each([
    ["missing text", {}],
    ["empty text", { text: "" }],
    ["text over the length limit", { text: "x".repeat(21) }],
    ["unknown field", { text: "ok", extra: 1 }],
  ])("rejects %s with 400 and enqueues nothing", async (_case, payload) => {
    const { app, publisher } = createTestApp();

    const res = await app.inject({ method: "POST", url: "/v1/infer", payload });

    expect(res.statusCode).toBe(400);
    expect(publisher.published).toHaveLength(0);
  });

  it("answers 503 with Retry-After when the queue rejects the job", async () => {
    const { app, publisher } = createTestApp();
    publisher.rejectNext = true;

    const res = await app.inject({ method: "POST", url: "/v1/infer", payload: { text: "hi" } });

    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
  });

  it("answers 503 when the result store is down", async () => {
    const { app, store } = createTestApp();
    store.unavailable = true;

    const res = await app.inject({ method: "POST", url: "/v1/infer", payload: { text: "hi" } });

    expect(res.statusCode).toBe(503);
  });
});

describe("GET /v1/jobs/:id", () => {
  it("returns the stored record", async () => {
    const { app } = createTestApp();
    const { job_id } = (await app.inject({ method: "POST", url: "/v1/infer", payload: { text: "hi" } })).json();

    const res = await app.inject({ method: "GET", url: `/v1/jobs/${job_id}` });

    expect(res.json()).toMatchObject({ job_id, status: "queued" });
  });

  it("answers 404 for an unknown id", async () => {
    const { app } = createTestApp();

    const res = await app.inject({ method: "GET", url: `/v1/jobs/${UNKNOWN_ID}` });

    expect(res.statusCode).toBe(404);
  });

  it("answers 400 for a malformed id", async () => {
    const { app } = createTestApp();

    const res = await app.inject({ method: "GET", url: "/v1/jobs/not-a-uuid" });

    expect(res.statusCode).toBe(400);
  });
});

describe("GET /readyz", () => {
  it("answers 503 and names the dependency that is down", async () => {
    const { app, store } = createTestApp();
    store.unavailable = true;

    const res = await app.inject({ method: "GET", url: "/readyz" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ queue: true, store: false });
  });
});
