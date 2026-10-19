import type { JobRecord } from "../api/types";
import { summarizeBurst } from "./burst";
import { formatPercent } from "./format";

/** "Positive" from the model's "POSITIVE". */
export function sentimentName(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}

export function confidenceText(score: number): string {
  return `${formatPercent(score)} confident`;
}

/** How one request was batched. batch_size also counts other users' requests. */
export function sharingText(record: JobRecord): string {
  const others = (record.batch_size ?? 1) - 1;
  if (others <= 0) return "Ran in its own forward pass";
  return `Shared a forward pass with ${others} other request${others === 1 ? "" : "s"}`;
}

/** Headline for a multi-line message, e.g. "5 lines → 1 forward pass". */
export function batchingHeadline(records: JobRecord[]): string {
  const { requests, batches } = summarizeBurst(records);
  const passes = `${batches} forward pass${batches === 1 ? "" : "es"}`;
  return `${requests} lines → ${passes}`;
}
