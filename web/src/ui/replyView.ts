import type { ClientResult } from "../api/types";
import { batchingHeadline, confidenceText, sentimentName } from "../lib/reply";
import { type TraceStep, traceSteps, traceStepsForMany, traceTitle } from "../lib/trace";
import { create } from "./dom";

/** One line of the user's message and what happened to it. */
export type LineOutcome = { text: string; result: ClientResult } | { text: string; error: string };

export interface ReplyActions {
  trace: boolean;
  onRegenerate: () => void;
}

const OFFLINE_HINT = "Is the engine running? Start it with docker compose up -d.";

/** Builds an assistant reply: optional trace block, the answer, then copy/regenerate buttons. */
export function renderReply(outcomes: LineOutcome[], actions: ReplyActions): HTMLElement[] {
  const results = outcomes.flatMap((o) => ("result" in o ? [o.result] : []));
  const answer = outcomes.length === 1 ? renderSingle(outcomes[0]) : renderMany(outcomes, results);
  const trace = actions.trace && results.length > 0 ? [traceBlock(results)] : [];
  return [...trace, ...answer, actionRow(plainText(outcomes), actions.onRegenerate)];
}

function renderSingle(outcome: LineOutcome): HTMLElement[] {
  if ("error" in outcome) return [errorParagraph(outcome.error)];
  const verdict = outcome.result.record.result;
  if (!verdict) return [errorParagraph(outcome.result.record.error ?? "The worker could not classify this text.")];
  const sentence = create("p", "answer");
  sentence.append(
    "This reads as ",
    create("strong", verdict.label.toLowerCase(), sentimentName(verdict.label).toLowerCase()),
    ` (${confidenceText(verdict.score)}).`,
  );
  return [sentence];
}

function renderMany(outcomes: LineOutcome[], results: ClientResult[]): HTMLElement[] {
  const list = create("ul", "lines");
  outcomes.forEach((outcome) => list.append(lineRow(outcome)));
  return [create("p", "answer headline", `${batchingHeadline(results.map((r) => r.record))}.`), list];
}

function lineRow(outcome: LineOutcome): HTMLElement {
  const label = "result" in outcome ? outcome.result.record.result?.label : undefined;
  const row = create("li");
  row.append(label ? sentimentPill(label) : create("span", "pill failed", "Error"), create("span", undefined, outcome.text));
  return row;
}

function sentimentPill(label: string): HTMLElement {
  return create("span", `pill ${label.toLowerCase()}`, sentimentName(label));
}

/** Collapsible block in the style of a model's "thinking" section, but showing the real pipeline. */
function traceBlock(results: ClientResult[]): HTMLElement {
  const details = create("details", "trace");
  details.open = true;
  details.append(create("summary", undefined, traceTitle(results)));
  const steps = results.length === 1 ? traceSteps(results[0]) : traceStepsForMany(results);
  const list = create("ol", "trace-steps");
  steps.forEach((step) => list.append(traceRow(step)));
  details.append(list);
  return details;
}

function traceRow(step: TraceStep): HTMLElement {
  const row = create("li");
  row.append(create("span", undefined, step.label), create("span", "trace-detail", step.detail));
  return row;
}

function actionRow(copyText: string, onRegenerate: () => void): HTMLElement {
  const row = create("div", "actions");
  row.append(
    actionButton("Copy", COPY_ICON, () => void navigator.clipboard?.writeText(copyText)),
    actionButton("Regenerate", REGENERATE_ICON, onRegenerate),
  );
  return row;
}

function actionButton(label: string, iconPath: string, onClick: () => void): HTMLButtonElement {
  const button = create("button", "icon-button small");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(icon(iconPath));
  button.addEventListener("click", onClick);
  return button;
}

const COPY_ICON = "M9 9h10v11H9zM5 15V4h10";
const REGENERATE_ICON = "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6";

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  svg.append(shape);
  return svg;
}

function plainText(outcomes: LineOutcome[]): string {
  return outcomes
    .map((o) => ("result" in o ? `${o.result.record.result?.label ?? "ERROR"}: ${o.text}` : `ERROR: ${o.text}`))
    .join("\n");
}

function errorParagraph(message: string): HTMLElement {
  return create("p", "error", `${message} ${OFFLINE_HINT}`);
}
