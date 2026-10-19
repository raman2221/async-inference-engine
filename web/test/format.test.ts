import { describe, expect, it } from "vitest";
import { formatMs, formatPercent } from "../src/lib/format";

describe("formatMs", () => {
  it.each([
    [1.234, "1.2 ms"],
    [87.6, "88 ms"],
    [1530, "1.53 s"],
  ])("formats %d as %s", (ms, expected) => {
    expect(formatMs(ms)).toBe(expected);
  });
});

describe("formatPercent", () => {
  it("rounds a fraction to a whole percent", () => {
    expect(formatPercent(0.9987)).toBe("100%");
  });
});
