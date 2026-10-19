import { create } from "./dom";
import { type LineOutcome, type ReplyActions, renderReply } from "./replyView";

export interface PendingReply {
  show(outcomes: LineOutcome[], actions: ReplyActions): void;
}

/** One conversation: user messages on the right, the engine's replies on the left. */
export class Thread {
  constructor(
    readonly container: HTMLElement,
    private readonly scroller: HTMLElement,
  ) {}

  isEmpty(): boolean {
    return this.container.childElementCount === 0;
  }

  addUserMessage(message: string): void {
    this.append(create("div", "message user", message));
  }

  addPendingReply(): PendingReply {
    const body = create("div", "reply-body");
    body.append(create("p", "pending", "Routing through the pipeline…"));
    this.append(assistantMessage(body));
    return {
      show: (outcomes, actions) => {
        body.replaceChildren(...renderReply(outcomes, actions));
        this.scrollToEnd();
      },
    };
  }

  private append(node: HTMLElement): void {
    this.container.append(node);
    this.scrollToEnd();
  }

  private scrollToEnd(): void {
    this.scroller.scrollTo({ top: this.scroller.scrollHeight, behavior: "smooth" });
  }
}

function assistantMessage(body: HTMLElement): HTMLElement {
  const avatar = create("img", "avatar");
  avatar.src = "/favicon.svg";
  avatar.alt = "";
  const message = create("div", "message assistant");
  message.append(avatar, body);
  return message;
}
