"""Names shared with the gateway (TypeScript) and notifier (C#).
Change them in all three services together."""

EVENTS_CHANNEL = "job-events"
STATS_KEY = "stats:worker"


def job_key(job_id: str) -> str:
    return f"job:{job_id}"
