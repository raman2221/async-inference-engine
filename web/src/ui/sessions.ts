import { byId, create } from "./dom";
import { Thread } from "./thread";

const TITLE_LENGTH = 32;

interface Session {
  thread: Thread;
  title: string;
  item: HTMLLIElement | null;
}

/** The sidebar's chat list. Each chat keeps its own thread; only the active one is shown. */
export class Sessions {
  private readonly sessions: Session[] = [];
  private active!: Session;
  private readonly threads = byId("threads");
  private readonly scroller = byId("scroll");

  constructor() {
    this.startNew();
  }

  /** The thread a new message goes into; names the chat after its first message. */
  threadFor(message: string): Thread {
    if (!this.active.item) this.addToHistory(this.active, message);
    byId("main").dataset.empty = "false";
    return this.active.thread;
  }

  /** "New chat" reuses the current chat if nothing has been sent in it yet. */
  startNew(): void {
    if (this.active?.thread.isEmpty()) return;
    const container = create("div", "thread");
    this.threads.append(container);
    const session: Session = { thread: new Thread(container, this.scroller), title: "New chat", item: null };
    this.sessions.push(session);
    this.show(session);
  }

  private addToHistory(session: Session, message: string): void {
    session.title = message.split("\n")[0].slice(0, TITLE_LENGTH);
    const button = create("button", "history-item", session.title);
    button.type = "button";
    button.addEventListener("click", () => this.show(session));
    session.item = create("li");
    session.item.append(button);
    byId("history-list").prepend(session.item);
    this.show(session);
  }

  private show(session: Session): void {
    this.active = session;
    this.sessions.forEach((s) => {
      s.thread.container.hidden = s !== session;
      s.item?.classList.toggle("active", s === session);
    });
    byId("main").dataset.empty = String(session.thread.isEmpty());
    byId("main-title").textContent = session.title;
  }
}
