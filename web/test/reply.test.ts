import { describe, expect, it } from "vitest";
import type { JobRecord } from "../src/api/types";
import { batchingHeadline, confidenceText, sentimentName, sharingText } from "../src/lib/reply";

function job(batchSize: number, started = 10): JobRecord {
  return { job_id: "a", status: "done", accepted_at_ms: 0, started_at_ms: started, completed_at_ms: 40, batch_size: batchSize };
}

describe("sentimentName", () => {
  it("turns the model's label into a readable word", () => {
    expect(sentimentName("POSITIVE")).toBe("Positive");
  });
});

describe("confidenceText", () => {
  it("shows the score as a whole percent", () => {
    expect(confidenceText(0.9871)).toBe("99% confident");
  });
});

describe("sharingText", () => {
  it.each([
    [1, "Ran in its own forward pass"],
    [2, "Shared a forward pass with 1 other request"],
    [5, "Shared a forward pass with 4 other requests"],
  ])("describes a batch of %d", (batchSize, expected) => {
    expect(sharingText(job(batchSize))).toBe(expected);
  });
});

describe("batchingHeadline", () => {
  it("counts lines and distinct forward passes", () => {
    const records = [job(2, 10), job(2, 10), job(1, 50)];

    expect(batchingHeadline(records)).toBe("3 lines → 2 forward passes");
  });

  it("uses the singular for one pass", () => {
    expect(batchingHeadline([job(2), job(2)])).toBe("2 lines → 1 forward pass");
  });
});
