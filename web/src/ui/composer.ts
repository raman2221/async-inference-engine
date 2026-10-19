import { byId } from "./dom";

const MAX_HEIGHT_PX = 200;

export interface Composer {
  setBusy(busy: boolean): void;
  focus(): void;
}

/** The message box: grows with its text, sends on Enter, and fills from suggestion chips. */
export function mountComposer(onSend: (message: string) => void): Composer {
  const form = byId<HTMLFormElement>("composer");
  const input = byId<HTMLTextAreaElement>("composer-input");
  const sendButton = byId<HTMLButtonElement>("send-button");
  let busy = false;

  const refresh = () => {
    sendButton.disabled = busy || input.value.trim() === "";
    autoGrow(input);
  };
  const send = () => {
    if (sendButton.disabled) return;
    onSend(input.value);
    input.value = "";
    refresh();
  };

  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (event) => sendOnEnter(event, send));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    send();
  });
  wireSuggestions(input, () => {
    refresh();
    send();
  });

  return {
    setBusy: (value) => {
      busy = value;
      refresh();
    },
    focus: () => input.focus(),
  };
}

function sendOnEnter(event: KeyboardEvent, send: () => void): void {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}

function autoGrow(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, MAX_HEIGHT_PX)}px`;
}

function wireSuggestions(input: HTMLTextAreaElement, send: () => void): void {
  document.querySelectorAll<HTMLButtonElement>(".suggestion[data-text]").forEach((chip) => {
    chip.addEventListener("click", () => {
      input.value = chip.dataset.text ?? "";
      send();
    });
  });
}
