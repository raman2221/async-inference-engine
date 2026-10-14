import amqp from "amqplib";
import type { ChannelModel, ConfirmChannel } from "amqplib";
import type { JobPublisher, QueueMessage } from "./types.js";

export interface QueueOptions {
  url: string;
  queueName: string;
  maxLength: number;
}

// Declares the request queue plus a dead-letter queue. The worker declares the
// same thing with the same arguments; whoever starts first creates it.
export async function declareTopology(channel: ConfirmChannel, opts: QueueOptions) {
  const dlx = `${opts.queueName}.dlx`;
  await channel.assertExchange(dlx, "fanout", { durable: true });
  await channel.assertQueue(`${opts.queueName}.dead`, { durable: true });
  await channel.bindQueue(`${opts.queueName}.dead`, dlx, "");
  await channel.assertQueue(opts.queueName, {
    durable: true,
    arguments: {
      // Bound the backlog. When full, RabbitMQ *nacks* new publishes instead
      // of eating all its memory; the gateway turns that nack into a 503 so
      // clients get a fast, honest "try later" rather than a hang.
      "x-max-length": opts.maxLength,
      "x-overflow": "reject-publish",
      "x-dead-letter-exchange": dlx,
    },
  });
}

/**
 * Publishes jobs with *publisher confirms*: publish() only resolves once
 * RabbitMQ has written the message to the durable queue. That is what lets the
 * gateway promise "202 Accepted" honestly -- an accepted job is not lost if
 * the gateway crashes a millisecond later.
 */
export class RabbitPublisher implements JobPublisher {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private closing = false;

  constructor(private readonly opts: QueueOptions, private readonly log: (msg: string) => void) {}

  isReady(): boolean {
    return this.channel !== null;
  }

  /** Connects with exponential backoff; RabbitMQ is often slower to boot than we are. */
  async connect(): Promise<void> {
    let delayMs = 500;
    for (;;) {
      try {
        const connection = await amqp.connect(this.opts.url);
        const channel = await connection.createConfirmChannel();
        await declareTopology(channel, this.opts);
        connection.on("close", () => this.handleDisconnect());
        connection.on("error", (err) => this.log(`rabbitmq connection error: ${err.message}`));
        this.connection = connection;
        this.channel = channel;
        this.log("connected to rabbitmq");
        return;
      } catch (err) {
        this.log(`rabbitmq not ready (${(err as Error).message}); retrying in ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
        delayMs = Math.min(delayMs * 2, 10_000);
      }
    }
  }

  private handleDisconnect() {
    this.channel = null;
    this.connection = null;
    if (this.closing) return;
    this.log("rabbitmq connection lost; reconnecting");
    void this.connect();
  }

  publish(message: QueueMessage): Promise<void> {
    const channel = this.channel;
    if (!channel) return Promise.reject(new Error("queue unavailable"));
    const body = Buffer.from(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      // The callback fires when the broker confirms (err === null) or nacks
      // (err set, e.g. because the queue is at x-max-length).
      channel.sendToQueue(
        this.opts.queueName,
        body,
        { persistent: true, contentType: "application/json", messageId: message.job_id },
        (err) => (err ? reject(new Error("queue rejected message")) : resolve()),
      );
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.connection?.close();
  }
}
