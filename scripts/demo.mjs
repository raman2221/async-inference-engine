// End-to-end demo client (Node 22+, no dependencies).
//
//   node scripts/demo.mjs "I loved this movie" "worst purchase ever"
//
// For each text: POST to the gateway, get 202 + job id, then open a WebSocket
// to the notifier and print the result the moment it is pushed.

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8080";

async function submitJob(text) {
  const response = await fetch(`${GATEWAY}/v1/infer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await response.json();
  if (response.status !== 202) throw new Error(`gateway answered ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function waitForResult(streamUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(streamUrl);
    socket.onmessage = (event) => {
      const record = JSON.parse(event.data);
      if (record.status !== "queued") resolve(record); // the first frame may be the queued snapshot
    };
    socket.onerror = () => reject(new Error(`websocket error on ${streamUrl}`));
  });
}

function describe(text, record, acceptMs, totalMs) {
  const outcome = record.result ? `${record.result.label} (${record.result.score})` : record.error ?? "";
  return [
    JSON.stringify(text),
    `  202 in ${acceptMs.toFixed(1)} ms -> ${record.status} ${outcome}`,
    `  total ${totalMs.toFixed(1)} ms, batch_size=${record.batch_size}, ` +
      `queue_wait=${record.started_at_ms - record.accepted_at_ms} ms, ` +
      `inference=${record.completed_at_ms - record.started_at_ms} ms`,
  ].join("\n");
}

async function classify(text) {
  const start = performance.now();
  const accepted = await submitJob(text);
  const acceptMs = performance.now() - start;
  const record = await waitForResult(accepted.stream_url);
  console.log(describe(text, record, acceptMs, performance.now() - start));
}

const texts = process.argv.slice(2);
await Promise.all((texts.length ? texts : ["This project is great!", "The service was terrible."]).map(classify));
