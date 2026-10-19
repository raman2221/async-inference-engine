import { describe, expect, it } from "vitest";
import type { JobRecord } from "../src/api/types";
import { batchNumbers, summarizeBurst } from "../src/lib/burst";

function job(started: number, completed: number, batchSize: number): JobRecord {
  return {
    job_id: `${started}`,
    status: "done",
    accepted_at_ms: 0,
    started_at_ms: started,
    completed_at_ms: completed,
    batch_size: batchSize,
  };
}

describe("batchNumbers", () => {
  it("gives jobs from the same forward pass the same number, in first-seen order", () => {
    const records = [job(10, 40, 2), job(50, 70, 1), job(10, 40, 2)];

    expect(batchNumbers(records)).toEqual([0, 1, 0]);
  });
});

describe("summarizeBurst", () => {
  it("counts forward passes, average size, and the largest batch", () => {
    const records = [job(10, 40, 3), job(10, 40, 3), job(10, 40, 3), job(50, 70, 1)];

    expect(summarizeBurst(records)).toEqual({ requests: 4, batches: 2, avgBatchSize: 2, largestBatch: 3 });
  });

  it("handles an empty burst without dividing by zero", () => {
    expect(summarizeBurst([])).toEqual({ requests: 0, batches: 0, avgBatchSize: 0, largestBatch: 0 });
  });
});
