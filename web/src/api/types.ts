// Mirrors gateway/src/types.ts. The job record is written by the gateway and
// the Python worker and read here, so field names stay snake_case.
export type JobStatus = "queued" | "done" | "failed";

export interface JobRecord {
  job_id: string;
  status: JobStatus;
  accepted_at_ms: number;
  started_at_ms?: number;
  completed_at_ms?: number;
  batch_size?: number;
  result?: { label: string; score: number };
  error?: string;
}

/** Body of the gateway's 202 Accepted response. */
export interface AcceptedJob {
  job_id: string;
  status: "queued";
  status_url: string;
  stream_url: string;
}

/** A finished job plus what the browser measured around it. */
export interface ClientResult {
  record: JobRecord;
  acceptMs: number;
  totalMs: number;
}
