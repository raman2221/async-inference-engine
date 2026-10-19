import type { InferenceClient } from "../api/client";
import { byId, repeatEvery } from "./dom";

const READINESS_POLL_MS = 5000;

/** The "Engine online / offline" indicator in the top bar. */
export function mountStatusDot(client: InferenceClient): void {
  const status = byId("engine-status");
  repeatEvery(READINESS_POLL_MS, async () => {
    const online = await client
      .fetchReadiness()
      .then((readiness) => readiness.queue && readiness.store)
      .catch(() => false);
    status.dataset.state = online ? "online" : "offline";
    status.textContent = online ? "Engine online" : "Engine offline";
  });
}
