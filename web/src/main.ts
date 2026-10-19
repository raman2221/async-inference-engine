// Composition root: builds each piece once and wires them together.
import "./styles.css";
import { InferenceClient } from "./api/client";
import { Chat } from "./ui/chat";
import { mountComposer } from "./ui/composer";
import { byId } from "./ui/dom";
import { mountStatusDot } from "./ui/statusDot";
import { Thread } from "./ui/thread";

const client = new InferenceClient(window.location);
const thread = new Thread();
const chat = new Chat(client, thread);
const composer = mountComposer((message) => void chat.send(message, composer));

mountStatusDot(client);
byId("new-chat").addEventListener("click", () => {
  thread.clear();
  composer.focus();
});
composer.focus();
