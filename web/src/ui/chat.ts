import type { InferenceClient } from "../api/client";
import { splitIntoRequests } from "../lib/prompt";
import type { Composer } from "./composer";
import type { LineOutcome, Thread } from "./thread";

/**
 * One message in, one reply out. Every line becomes its own request, all sent
 * at once, so lines in the same message can land in the same batch.
 */
export class Chat {
  constructor(
    private readonly client: InferenceClient,
    private readonly thread: Thread,
  ) {}

  async send(message: string, composer: Composer): Promise<void> {
    const lines = splitIntoRequests(message);
    if (lines.length === 0) return;
    this.thread.addUserMessage(lines.join("\n"));
    const reply = this.thread.addPendingReply();
    composer.setBusy(true);
    try {
      reply.show(await this.classifyAll(lines));
    } finally {
      composer.setBusy(false);
      composer.focus();
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
