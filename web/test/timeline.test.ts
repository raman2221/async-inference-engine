import { describe, expect, it } from "vitest";
import { stageTimings } from "../src/lib/timeline";

describe("stageTimings", () => {
  it("uses browser timings for the ends and server timestamps for the middle", () => {
    const timings = stageTimings({
      acceptMs: 3,
      totalMs: 120,
      record: { job_id: "a", status: "done", accepted_at_ms: 1_000, started_at_ms: 1_055, completed_at_ms: 1_085 },
    });

    expect(timings).toEqual({ acceptMs: 3, queueMs: 55, modelMs: 30, totalMs: 120 });
  });

  it("reports zero server time when the worker timestamps are missing", () => {
    const timings = stageTimings({
      acceptMs: 3,
      totalMs: 50,
      record: { job_id: "a", status: "failed", accepted_at_ms: 1_000 },
    });

    expect([timings.queueMs, timings.modelMs]).toEqual([0, 0]);
  });
});
