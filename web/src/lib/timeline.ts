import type { ClientResult } from "../api/types";

export interface StageTimings {
  /** Browser: POST sent -> 202 received. */
  acceptMs: number;
  /** Server: gateway accepted -> worker started the batch. */
  queueMs: number;
  /** Server: one forward pass over the whole batch. */
  modelMs: number;
  /** Browser: POST sent -> result arrived on the WebSocket. */
  totalMs: number;
}

/**
 * Splits one request's life into stages. Browser and server clocks are never
 * mixed: the first and last stages use performance.now(), the middle two use
 * the worker's own timestamps.
 */
export function stageTimings(result: ClientResult): StageTimings {
  const { record } = result;
  const started = record.started_at_ms ?? record.accepted_at_ms;
  const completed = record.completed_at_ms ?? started;
  return {
    acceptMs: result.acceptMs,
    queueMs: started - record.accepted_at_ms,
    modelMs: completed - started,
    totalMs: result.totalMs,
  };
}
