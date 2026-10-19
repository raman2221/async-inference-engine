// Composition root: builds each piece once and wires them together.
import "./styles.css";
import { InferenceClient } from "./api/client";
import { Chat } from "./ui/chat";
import { mountComposer } from "./ui/composer";
import { byId } from "./ui/dom";
import { Sessions } from "./ui/sessions";
import { mountSidebar } from "./ui/sidebar";
import { mountStatusDot } from "./ui/statusDot";

const client = new InferenceClient(window.location);
const sessions = new Sessions();
const sidebar = mountSidebar();
const composer = mountComposer((message) => void chat.send(message));
const chat = new Chat(client, sessions, composer);

mountStatusDot(client);
byId("new-chat").addEventListener("click", () => {
  sessions.startNew();
  sidebar.closeIfNarrow();
  composer.focus();
});
byId("history-list").addEventListener("click", () => sidebar.closeIfNarrow());
composer.focus();
