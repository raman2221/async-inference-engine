// End-to-end demo client (Node 22+, no dependencies).
//
//   node scripts/demo.mjs "I loved this movie" "worst purchase ever"
//
// For each text: POST to the gateway, get 202 + job id, then open a WebSocket
// to the notifier and print the result the moment it is pushed.

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8080";
const texts = process.argv.slice(2);
if (texts.length === 0) texts.push("This project is great!", "The service was terrible.");

async function infer(text) {
  const t0 = performance.now();
  const res = await fetch(`${GATEWAY}/v1/infer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const accepted = await res.json();
  const ackMs = performance.now() - t0;
  if (res.status !== 202) throw new Error(`gateway said ${res.status}: ${JSON.stringify(accepted)}`);

  const result = await new Promise((resolve, reject) => {
    const ws = new WebSocket(accepted.stream_url);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.status !== "queued") resolve(msg); // first frame may be the "queued" snapshot
    };
    ws.onerror = () => reject(new Error("websocket error"));
  });

  const totalMs = performance.now() - t0;
  console.log(
    `${JSON.stringify(text)}\n  202 in ${ackMs.toFixed(1)} ms -> ${result.status}` +
      (result.result ? ` ${result.result.label} (${result.result.score})` : ` ${result.error ?? ""}`) +
      `\n  total ${totalMs.toFixed(1)} ms, batch_size=${result.batch_size}, ` +
      `queue_wait=${result.started_at_ms - result.accepted_at_ms} ms, ` +
      `inference=${result.completed_at_ms - result.started_at_ms} ms`,
  );
}

await Promise.all(texts.map(infer));
