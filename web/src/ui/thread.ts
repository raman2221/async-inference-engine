import type { ClientResult } from "../api/types";
import { formatMs } from "../lib/format";
import { batchingHeadline, confidenceText, sentimentName, sharingText } from "../lib/reply";
import { stageTimings } from "../lib/timeline";
import { byId, create } from "./dom";

/** One line of the user's message and what happened to it. */
export type LineOutcome = { text: string; result: ClientResult } | { text: string; error: string };

export interface PendingReply {
  show(outcomes: LineOutcome[]): void;
}

/** The conversation: user messages on the right, the engine's replies on the left. */
export class Thread {
  private readonly element = byId("thread");
  private readonly main = byId("main");

  addUserMessage(message: string): void {
    this.main.dataset.empty = "false";
    this.append(create("div", "message user", message));
  }

  addPendingReply(): PendingReply {
    const body = create("div", "reply-body");
    body.append(typingDots());
    this.append(assistantMessage(body));
    return {
      show: (outcomes) => {
        body.replaceChildren(...renderOutcomes(outcomes));
        this.scrollToEnd();
      },
    };
  }

  clear(): void {
    this.element.replaceChildren();
    this.main.dataset.empty = "true";
  }

  private append(node: HTMLElement): void {
    this.element.append(node);
    this.scrollToEnd();
  }

  private scrollToEnd(): void {
    this.main.scrollTo({ top: this.main.scrollHeight, behavior: "smooth" });
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

function typingDots(): HTMLElement {
  const dots = create("div", "typing");
  dots.setAttribute("aria-label", "Waiting for the engine");
  dots.append(create("span"), create("span"), create("span"));
  return dots;
}

function renderOutcomes(outcomes: LineOutcome[]): HTMLElement[] {
  if (outcomes.length === 1) return renderSingle(outcomes[0]);
  return renderMany(outcomes);
}

function renderSingle(outcome: LineOutcome): HTMLElement[] {
  if ("error" in outcome) return [errorParagraph(outcome.error)];
  const { record } = outcome.result;
  if (!record.result) return [errorParagraph(record.error ?? "The worker could not classify this text.")];
  const verdict = create("p", "verdict");
  verdict.append(sentimentPill(record.result.label), create("span", "confidence", confidenceText(record.result.score)));
  const note = `${sharingText(record)} · answered in ${formatMs(outcome.result.totalMs)}`;
  return [verdict, create("p", "note", note), timingDetails(outcome.result)];
}

function renderMany(outcomes: LineOutcome[]): HTMLElement[] {
  const finished = outcomes.flatMap((o) => ("result" in o ? [o.result] : []));
  const list = create("ul", "lines");
  outcomes.forEach((outcome) => list.append(lineRow(outcome)));
  const slowest = Math.max(0, ...finished.map((r) => r.totalMs));
  return [
    create("p", "headline", batchingHeadline(finished.map((r) => r.record))),
    list,
    create("p", "note", `All answered in ${formatMs(slowest)}. Lines that arrived together shared a batch.`),
  ];
}

function lineRow(outcome: LineOutcome): HTMLElement {
  const row = create("li");
  const label = "result" in outcome ? outcome.result.record.result?.label : undefined;
  row.append(label ? sentimentPill(label) : create("span", "pill failed", "Error"), create("span", "line-text", outcome.text));
  if ("result" in outcome) row.title = `batch of ${outcome.result.record.batch_size ?? "?"}`;
  return row;
}

function sentimentPill(label: string): HTMLElement {
  return create("span", `pill ${label.toLowerCase()}`, sentimentName(label));
}

function timingDetails(result: ClientResult): HTMLElement {
  const timings = stageTimings(result);
  const details = create("details", "timing");
  const stages: Array<[string, number]> = [
    ["Accepted", timings.acceptMs],
    ["Waited in queue", timings.queueMs],
    ["Model (whole batch)", timings.modelMs],
    ["Total", timings.totalMs],
  ];
  details.append(create("summary", undefined, "How long each step took"));
  stages.forEach(([name, ms]) => details.append(timingRow(name, ms)));
  return details;
}

function timingRow(name: string, ms: number): HTMLElement {
  const row = create("div", "timing-row");
  row.append(create("span", undefined, name), create("span", "timing-ms", formatMs(ms)));
  return row;
}

function errorParagraph(message: string): HTMLElement {
  return create("p", "error", `${message} Is the engine running? Start it with docker compose up -d.`);
}
