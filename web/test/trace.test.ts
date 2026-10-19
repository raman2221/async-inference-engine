import { describe, expect, it } from "vitest";
import type { ClientResult } from "../src/api/types";
import { traceSteps, traceStepsForMany, traceTitle } from "../src/lib/trace";

function result(totalMs: number, started: number, batchSize: number): ClientResult {
  return {
    acceptMs: 4,
    totalMs,
    record: {
      job_id: "a",
      status: "done",
      accepted_at_ms: 1_000,
      started_at_ms: started,
      completed_at_ms: started + 20,
      batch_size: batchSize,
    },
  };
}

describe("traceSteps", () => {
  it("walks one request through every stage", () => {
    const steps = traceSteps(result(90, 1_050, 3));

    expect(steps.map((s) => s.detail)).toEqual(["4.0 ms", "50 ms", "batch of 3", "20 ms", "90 ms total"]);
  });

  it("says when the request shared its batch", () => {
    expect(traceSteps(result(90, 1_050, 3))[2].label).toBe("Shared a forward pass with 2 other requests");
  });
});

describe("traceStepsForMany", () => {
  it("counts requests, forward passes, and the largest batch", () => {
    const steps = traceStepsForMany([result(80, 1_050, 2), result(85, 1_050, 2), result(120, 1_100, 1)]);

    expect(steps.slice(0, 3).map((s) => s.detail)).toEqual(["3 requests", "2 forward passes", "2 requests"]);
  });
});

describe("traceTitle", () => {
  it("reports the slowest answer", () => {
    expect(traceTitle([result(80, 1_050, 1), result(120, 1_050, 1)])).toBe("Traced in 120 ms");
  });
});
