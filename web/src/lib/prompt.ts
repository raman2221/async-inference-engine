/** Most lines one message may fan out into; matches the worker's largest batch times two. */
export const MAX_LINES_PER_MESSAGE = 32;

/**
 * Turns a message into inference requests. With line batching on, every
 * non-empty line is its own request; with it off, the message is one request.
 */
export function toRequests(message: string, splitLines: boolean): string[] {
  if (splitLines) return splitIntoRequests(message);
  const whole = message.replace(/\s*\n\s*/g, " ").trim();
  return whole ? [whole] : [];
}

export function splitIntoRequests(message: string): string[] {
  return message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_LINES_PER_MESSAGE);
}
