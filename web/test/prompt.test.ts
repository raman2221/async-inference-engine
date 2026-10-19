import { describe, expect, it } from "vitest";
import { MAX_LINES_PER_MESSAGE, splitIntoRequests } from "../src/lib/prompt";

describe("splitIntoRequests", () => {
  it("turns each non-empty line into one request, trimmed", () => {
    expect(splitIntoRequests("  great day \n\n  awful night ")).toEqual(["great day", "awful night"]);
  });

  it("returns nothing for a blank message", () => {
    expect(splitIntoRequests(" \n \n")).toEqual([]);
  });

  it("caps how many requests one message can fan out into", () => {
    const message = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");

    expect(splitIntoRequests(message)).toHaveLength(MAX_LINES_PER_MESSAGE);
  });
});
