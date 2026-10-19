import type { ClientResult } from "../api/types";
import { summarizeBurst } from "./burst";
import { formatMs } from "./format";
import { sharingText } from "./reply";
import { stageTimings } from "./timeline";

/** One row of the "Traced in N ms" block shown above an answer. */
export interface TraceStep {
  label: string;
  detail: string;
}

/** The path one request took through the pipeline, stage by stage. */
export function traceSteps(result: ClientResult): TraceStep[] {
  const timings = stageTimings(result);
  return [
    { label: "Accepted by the gateway", detail: formatMs(timings.acceptMs) },
    { label: "Waited in the queue", detail: formatMs(timings.queueMs) },
    { label: sharingText(result.record), detail: `batch of ${result.record.batch_size ?? 1}` },
    { label: "Model forward pass", detail: formatMs(timings.modelMs) },
    { label: "Pushed back over a WebSocket", detail: `${formatMs(timings.totalMs)} total` },
  ];
}

/** The same idea for a multi-line message: how the requests were grouped. */
export function traceStepsForMany(results: ClientResult[]): TraceStep[] {
  const { requests, batches, largestBatch } = summarizeBurst(results.map((r) => r.record));
  return [
    { label: "Sent every line as its own request, all at once", detail: `${requests} requests` },
    { label: "The worker grouped waiting requests", detail: `${batches} forward pass${batches === 1 ? "" : "es"}` },
    { label: "Largest batch", detail: `${largestBatch} requests` },
    { label: "Slowest answer arrived", detail: formatMs(slowestMs(results)) },
  ];
}

export function traceTitle(results: ClientResult[]): string {
  return `Traced in ${formatMs(slowestMs(results))}`;
}

function slowestMs(results: ClientResult[]): number {
  return Math.max(0, ...results.map((r) => r.totalMs));
}
