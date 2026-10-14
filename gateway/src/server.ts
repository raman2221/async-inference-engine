import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { RabbitPublisher } from "./queue.js";
import { RedisJobStore } from "./store.js";

const log = (msg: string) => console.log(`[gateway] ${msg}`);

async function main() {
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
  const publisher = new RabbitPublisher(
    { url: config.rabbitUrl, queueName: config.queueName, maxLength: config.queueMaxLength },
    log,
  );
  await publisher.connect();

  const app = buildApp({
    publisher,
    store: new RedisJobStore(redis),
    jobTtlSeconds: config.jobTtlSeconds,
    maxTextLength: config.maxTextLength,
    notifierPublicUrl: config.notifierPublicUrl,
  });

  // Graceful shutdown: stop accepting, let in-flight requests finish, then
  // close broker/cache connections. Docker sends SIGTERM on `compose down`.
  const shutdown = async () => {
    log("shutting down");
    await app.close();
    await publisher.close();
    redis.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await app.listen({ port: config.port, host: config.host });
  log(`listening on ${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
