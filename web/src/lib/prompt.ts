/** Most lines one message may fan out into; matches the worker's largest batch times two. */
export const MAX_LINES_PER_MESSAGE = 32;

/** Each non-empty line of a message becomes its own inference request. */
export function splitIntoRequests(message: string): string[] {
  return message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_LINES_PER_MESSAGE);
}
