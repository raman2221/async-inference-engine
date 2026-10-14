// All settings come from environment variables so the same image runs
// locally, in docker-compose, or anywhere else without code changes.
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return value;
}

export const config = {
  port: intEnv("PORT", 8080),
  host: process.env.HOST ?? "0.0.0.0",
  rabbitUrl: process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  // Must match the worker's declaration exactly, or RabbitMQ refuses the
  // second declare with PRECONDITION_FAILED.
  queueName: process.env.QUEUE_NAME ?? "inference.requests",
  queueMaxLength: intEnv("QUEUE_MAX_LENGTH", 100_000),
  jobTtlSeconds: intEnv("JOB_TTL_SECONDS", 3600),
  maxTextLength: intEnv("MAX_TEXT_LENGTH", 2000),
  // Public URL of the C# notifier, returned to clients so they know where to
  // open a WebSocket.
  notifierPublicUrl: process.env.NOTIFIER_PUBLIC_URL ?? "ws://localhost:8081",
};

export type Config = typeof config;
