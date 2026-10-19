import { describe, expect, it } from "vitest";
import { MAX_LINES_PER_MESSAGE, toRequests } from "../src/lib/prompt";

describe("toRequests with line batching on", () => {
  it("turns each non-empty line into one request, trimmed", () => {
    expect(toRequests("  great day \n\n  awful night ", true)).toEqual(["great day", "awful night"]);
  });

  it("returns nothing for a blank message", () => {
    expect(toRequests(" \n \n", true)).toEqual([]);
  });

  it("caps how many requests one message can fan out into", () => {
    const message = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");

    expect(toRequests(message, true)).toHaveLength(MAX_LINES_PER_MESSAGE);
  });
});

describe("toRequests with line batching off", () => {
  it("joins the lines into one request", () => {
    expect(toRequests("great day\n  but awful night", false)).toEqual(["great day but awful night"]);
  });

  it("returns nothing for a blank message", () => {
    expect(toRequests("\n \n", false)).toEqual([]);
  });
});
