import type { AcceptedJob, ClientResult, JobRecord, RawWorkerStats, Readiness } from "./types";

/** The gateway or notifier could not be reached, or refused the request. */
export class EngineUnavailableError extends Error {}

/** The job was accepted but no final result arrived. */
export class JobNotFinishedError extends Error {}

interface PageLocation {
  protocol: string;
  host: string;
}

const FINAL_STATUSES = new Set(["done", "failed"]);

/**
 * Talks to the engine through the page's own origin: /api is proxied to the
 * gateway and /ws to the notifier (by nginx in Docker, by Vite in dev).
 */
export class InferenceClient {
  constructor(private readonly location: PageLocation) {}

  /** POST /v1/infer, then wait on the WebSocket; measures both legs in the browser. */
  async classify(text: string): Promise<ClientResult> {
    const start = performance.now();
    const accepted = await this.submit(text);
    const acceptMs = performance.now() - start;
    const record = await this.waitForResult(accepted.job_id);
    return { record, acceptMs, totalMs: performance.now() - start };
  }

  async submit(text: string): Promise<AcceptedJob> {
    const response = await this.request("/api/v1/infer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (response.status !== 202) {
      throw new EngineUnavailableError(`gateway answered ${response.status}`);
    }
    return response.json();
  }

  waitForResult(jobId: string): Promise<JobRecord> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.streamUrl(jobId));
      socket.onmessage = (event) => {
        const record = JSON.parse(event.data);
        if (FINAL_STATUSES.has(record.status)) resolve(record);
        else if (record.status !== "queued") reject(new JobNotFinishedError(`job ${jobId}: ${record.status}`));
      };
      socket.onerror = () => reject(new EngineUnavailableError("could not reach the notifier"));
      socket.onclose = () => reject(new JobNotFinishedError(`stream for job ${jobId} closed early`));
    });
  }

  async fetchStats(): Promise<RawWorkerStats> {
    return (await this.request("/api/v1/stats")).json();
  }

  async fetchReadiness(): Promise<Readiness> {
    return (await this.request("/api/readyz")).json();
  }

  private streamUrl(jobId: string): string {
    const scheme = this.location.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${this.location.host}/ws/jobs/${jobId}`;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(path, init);
    } catch (err) {
      throw new EngineUnavailableError(`could not reach the gateway: ${(err as Error).message}`);
    }
  }
}
