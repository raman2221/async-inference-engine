/** Looks up an element the page is required to have; fails loudly if the markup changed. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id} in index.html`);
  return element as T;
}

/**
 * Creates an element with optional class and text. Text always goes through
 * textContent, never innerHTML, so user input can't inject markup.
 */
export function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** Runs `task` now and then every `intervalMs`, skipping ticks while the tab is hidden. */
export function repeatEvery(intervalMs: number, task: () => Promise<void>): void {
  const tick = async () => {
    if (!document.hidden) await task().catch(() => {});
    setTimeout(tick, intervalMs);
  };
  void tick();
}
