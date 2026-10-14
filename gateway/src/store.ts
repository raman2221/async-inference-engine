import { Redis } from "ioredis";
import type { JobRecord, JobStore } from "./types.js";

export const jobKey = (jobId: string) => `job:${jobId}`;
export const STATS_KEY = "stats:worker";

export class RedisJobStore implements JobStore {
  constructor(private readonly redis: Redis) {}

  isReady(): boolean {
    return this.redis.status === "ready";
  }

  async create(record: JobRecord, ttlSeconds: number): Promise<void> {
    // NX: never overwrite. Job ids are random UUIDs so this only matters as a
    // guard against a worker having already written the finished result.
    await this.redis.set(jobKey(record.job_id), JSON.stringify(record), "EX", ttlSeconds, "NX");
  }

  async get(jobId: string): Promise<JobRecord | null> {
    const raw = await this.redis.get(jobKey(jobId));
    return raw ? (JSON.parse(raw) as JobRecord) : null;
  }

  async markFailed(jobId: string, error: string, ttlSeconds: number): Promise<void> {
    const existing = await this.get(jobId);
    if (!existing) return;
    const failed: JobRecord = { ...existing, status: "failed", error };
    await this.redis.set(jobKey(jobId), JSON.stringify(failed), "EX", ttlSeconds);
  }

  async stats(): Promise<Record<string, string>> {
    return this.redis.hgetall(STATS_KEY);
  }
}
