import amqp from "amqplib";
import type { ChannelModel, ConfirmChannel } from "amqplib";
import type { JobPublisher, QueueMessage } from "./types.js";

export interface QueueOptions {
  url: string;
  queueName: string;
  maxLength: number;
}

const MAX_RETRY_DELAY_MS = 10_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Declares the request queue and its dead-letter queue.
 * Must match worker/inference_worker/rabbit.py exactly, or RabbitMQ rejects
 * the second declaration with PRECONDITION_FAILED.
 */
export async function declareTopology(channel: ConfirmChannel, opts: QueueOptions): Promise<void> {
  const deadLetterExchange = `${opts.queueName}.dlx`;
  const deadLetterQueue = `${opts.queueName}.dead`;
  await channel.assertExchange(deadLetterExchange, "fanout", { durable: true });
  await channel.assertQueue(deadLetterQueue, { durable: true });
  await channel.bindQueue(deadLetterQueue, deadLetterExchange, "");
  await channel.assertQueue(opts.queueName, {
    durable: true,
    arguments: {
      // A full queue nacks new publishes instead of exhausting broker memory;
      // the gateway turns that nack into a fast 503.
      "x-max-length": opts.maxLength,
      "x-overflow": "reject-publish",
      "x-dead-letter-exchange": deadLetterExchange,
    },
  });
}

/**
 * Publishes with publisher confirms: publish() resolves only after RabbitMQ
 * has stored the message, so a 202 never refers to a job that could be lost.
 */
export class RabbitPublisher implements JobPublisher {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private closing = false;

  constructor(
    private readonly opts: QueueOptions,
    private readonly log: (msg: string) => void,
  ) {}

  isReady(): boolean {
    return this.channel !== null;
  }

  /** Retries with exponential backoff; RabbitMQ usually boots slower than we do. */
  async connect(): Promise<void> {
    for (let delayMs = 500; ; delayMs = Math.min(delayMs * 2, MAX_RETRY_DELAY_MS)) {
      try {
        await this.openChannel();
        this.log("connected to rabbitmq");
        return;
      } catch (err) {
        this.log(`rabbitmq not ready (${(err as Error).message}); retrying in ${delayMs}ms`);
        await sleep(delayMs);
      }
    }
  }

  publish(message: QueueMessage): Promise<void> {
    const channel = this.channel;
    if (!channel) return Promise.reject(new Error("rabbitmq connection is down"));
    const body = Buffer.from(JSON.stringify(message));
    const properties = { persistent: true, contentType: "application/json", messageId: message.job_id };
    return new Promise((resolve, reject) => {
      channel.sendToQueue(this.opts.queueName, body, properties, (err) =>
        err ? reject(new Error("broker nacked the message (queue full?)")) : resolve(),
      );
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.connection?.close();
  }

  private async openChannel(): Promise<void> {
    const connection = await amqp.connect(this.opts.url);
    const channel = await connection.createConfirmChannel();
    await declareTopology(channel, this.opts);
    connection.on("close", () => this.handleDisconnect());
    connection.on("error", (err) => this.log(`rabbitmq connection error: ${err.message}`));
    this.connection = connection;
    this.channel = channel;
  }

  private handleDisconnect(): void {
    this.channel = null;
    this.connection = null;
    if (this.closing) return;
    this.log("rabbitmq connection lost; reconnecting");
    void this.connect();
  }
}
