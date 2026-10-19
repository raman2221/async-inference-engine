import type { InferenceClient } from "../api/client";
import { toRequests } from "../lib/prompt";
import type { Composer, SendOptions } from "./composer";
import type { LineOutcome } from "./replyView";
import type { Sessions } from "./sessions";
import type { Thread } from "./thread";

/**
 * One message in, one reply out. With line batching on, every line becomes its
 * own request and all are sent at once, so they can land in the same batch.
 */
export class Chat {
  constructor(
    private readonly client: InferenceClient,
    private readonly sessions: Sessions,
    private readonly composer: Composer,
  ) {}

  async send(message: string): Promise<void> {
    const options = this.composer.options();
    const requests = toRequests(message, options.splitLines);
    if (requests.length === 0) return;
    const shown = requests.join("\n");
    const thread = this.sessions.threadFor(shown);
    thread.addUserMessage(shown);
    await this.answer(thread, requests, options);
  }

  private async answer(thread: Thread, requests: string[], options: SendOptions): Promise<void> {
    const reply = thread.addPendingReply();
    this.composer.setBusy(true);
    try {
      const outcomes = await this.classifyAll(requests);
      reply.show(outcomes, { trace: options.trace, onRegenerate: () => void this.answer(thread, requests, options) });
    } finally {
      this.composer.setBusy(false);
      this.composer.focus();
    }
  }

  private classifyAll(lines: string[]): Promise<LineOutcome[]> {
    return Promise.all(
      lines.map((text) =>
        this.client
          .classify(text)
          .then((result): LineOutcome => ({ text, result }))
          .catch((err: Error): LineOutcome => ({ text, error: err.message })),
      ),
    );
  }
}
