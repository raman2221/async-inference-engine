import type { JobRecord } from "../api/types";

export interface BurstSummary {
  requests: number;
  batches: number;
  avgBatchSize: number;
  largestBatch: number;
}

/**
 * Jobs that ran in the same forward pass share the worker's start and finish
 * timestamps, so that pair identifies the batch. Returns a batch number per
 * job (0, 1, 2, ... in the order batches were first seen).
 */
export function batchNumbers(records: JobRecord[]): number[] {
  const numberByKey = new Map<string, number>();
  return records.map((record) => {
    const key = `${record.started_at_ms}-${record.completed_at_ms}`;
    if (!numberByKey.has(key)) numberByKey.set(key, numberByKey.size);
    return numberByKey.get(key)!;
  });
}

export function summarizeBurst(records: JobRecord[]): BurstSummary {
  const batches = new Set(batchNumbers(records)).size;
  const largestBatch = Math.max(0, ...records.map((record) => record.batch_size ?? 0));
  return {
    requests: records.length,
    batches,
    avgBatchSize: batches > 0 ? records.length / batches : 0,
    largestBatch,
  };
}
