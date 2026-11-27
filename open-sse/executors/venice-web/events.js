// Venice answers with newline-delimited JSON, served as text/html. Event shape
// from OmniRoute open-sse/executors/venice-web.ts (MIT):
// {kind: "content", content?, reasoning_content?}; other kinds carry no text.
import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";
import { VeniceWebError, malformedReply } from "./errors.js";

const MAX_LINE_CHARS = 1_000_000;
const TEXT_FIELDS = ["reasoning_content", "content"];

const oversized = () => malformedReply("an oversized event");

/** The text deltas of one line, as `{content}` or `{reasoning_content}`. */
function lineDeltas(raw) {
  if (raw.length > MAX_LINE_CHARS) throw oversized();
  const line = raw.trim();
  if (!line) return [];
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    // The source skips noise lines. A broken object is a damaged or cut event.
    if (line.startsWith("{")) throw malformedReply("a damaged or truncated event");
    return [];
  }
  if (!isRecord(event)) return [];
  // The source names no error event; this refuses the obvious shapes.
  if (event.kind === "error" || event.error) throw new VeniceWebError(502, "Venice Web reported an error while answering");
  if (event.kind !== "content") return [];
  return TEXT_FIELDS.flatMap((field) => {
    const value = event[field];
    if (value === undefined || value === null || value === "") return [];
    if (!isString(value)) throw malformedReply("an event with non-text content");
    return [{ [field]: value }];
  });
}

/**
 * Yield text deltas until the body ends. The source defines no terminal event,
 * so end of body completes the answer, but only if some text arrived: an HTML
 * challenge page or an empty body is an error.
 */
export async function* veniceWebDeltas(reader) {
  const decoder = new TextDecoder();
  let buffer = "";
  let answered = false;
  for (let done = false; !done;) {
    const chunk = await reader.read();
    done = chunk.done;
    buffer += decoder.decode(chunk.value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop();
    for (const line of lines) {
      for (const delta of lineDeltas(line)) {
        answered = true;
        yield delta;
      }
    }
    // Checked after the complete lines, so earlier text is delivered however the body was split.
    if (buffer.length > MAX_LINE_CHARS) throw oversized();
  }
  if (!answered) throw malformedReply("no answer text");
}
