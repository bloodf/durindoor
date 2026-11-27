import { advancePendingSseLineBytes } from "../../utils/pendingSseLine.js";
import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";
import { InnerAiWebError, malformedReply } from "./errors.js";

const QUOTA_EVENTS = {
  missing_credits: "Inner.ai Web account has no credits left",
  reached_limit: "Inner.ai Web usage limit reached",
  rate_limit_reached: "Inner.ai Web rate limit reached",
  rate_limit_longer_reached: "Inner.ai Web rate limit reached",
};

/** One upstream line as `{ text }`, `{ end: true }` or null (nothing to relay). */
function readLine(line) {
  if (!line.startsWith("data:")) return null;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  let event;
  try {
    event = JSON.parse(data);
  } catch {
    throw malformedReply("a malformed stream event");
  }
  if (!isRecord(event) || !isString(event.type)) throw malformedReply("a malformed stream event");
  if (Object.hasOwn(QUOTA_EVENTS, event.type)) throw new InnerAiWebError(429, QUOTA_EVENTS[event.type], "rate_limit_error", event.type);
  if (event.type === "end_stream") return { end: true };
  if (event.type !== "text") return null; // `status` and other progress events
  if (!isString(event.item)) throw malformedReply("a malformed text event");
  return event.item ? { text: event.item } : null;
}

/**
 * Yield the answer's text deltas. Only `end_stream` completes it: a body that
 * simply stops is a truncated answer and throws.
 */
export async function* innerAiWebText(reader) {
  const decoder = new TextDecoder();
  let pending = "";
  let pendingBytes = 0;
  let open = true;
  while (open) {
    const { done, value } = await reader.read();
    open = !done;
    if (value) pendingBytes = advancePendingSseLineBytes(pendingBytes, value);
    if (pendingBytes === null) throw malformedReply("an oversized stream event");
    pending += done ? `${decoder.decode()}\n` : decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    for (const line of lines) {
      const event = readLine(line);
      if (event?.end) return;
      if (event) yield event.text;
    }
  }
  throw malformedReply("a stream that ended before completion");
}
