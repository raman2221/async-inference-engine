// The job record stored in Redis under `job:<id>`. The Python worker and the
// C# notifier read and write this exact shape, so field names are snake_case
// to stay language-neutral.
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

// What goes onto the RabbitMQ queue. Kept small: the worker only needs the
// id, the input, and when we accepted it (for latency accounting).
export interface QueueMessage {
  job_id: string;
  text: string;
  accepted_at_ms: number;
}

// Interfaces let tests swap in in-memory fakes for RabbitMQ and Redis.
export interface JobPublisher {
  publish(message: QueueMessage): Promise<void>;
  isReady(): boolean;
}

export interface JobStore {
  create(record: JobRecord, ttlSeconds: number): Promise<void>;
  get(jobId: string): Promise<JobRecord | null>;
  markFailed(jobId: string, error: string, ttlSeconds: number): Promise<void>;
  stats(): Promise<Record<string, string>>;
  isReady(): boolean;
}
