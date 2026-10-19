import { byId } from "./dom";

const NARROW_SCREEN = window.matchMedia("(max-width: 820px)");

/** Opens and closes the sidebar; on narrow screens it starts closed and floats over the chat. */
export function mountSidebar(): { closeIfNarrow: () => void } {
  const app = byId("app");
  const setOpen = (open: boolean) => (app.dataset.sidebar = open ? "open" : "closed");

  setOpen(!NARROW_SCREEN.matches);
  byId("collapse-sidebar").addEventListener("click", () => setOpen(false));
  byId("open-sidebar").addEventListener("click", () => setOpen(true));

  return {
    closeIfNarrow: () => {
      if (NARROW_SCREEN.matches) setOpen(false);
    },
  };
}
