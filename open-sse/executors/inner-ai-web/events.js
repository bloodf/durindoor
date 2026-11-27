import { createSseFrameReader } from "../../utils/sseFrames.js";
import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";
import { InnerAiWebError, malformedReply } from "./errors.js";

const QUOTA_EVENTS = {
  missing_credits: "Inner.ai Web account has no credits left",
  reached_limit: "Inner.ai Web usage limit reached",
  rate_limit_reached: "Inner.ai Web rate limit reached",
  rate_limit_longer_reached: "Inner.ai Web rate limit reached",
};

/** One parsed SSE frame as `{ text }`, `{ end: true }` or null (nothing to relay). */
function readFrame(frame) {
  const data = frame.data.trim();
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
 * Yield the answer's text deltas. Frames are read by the shared SSE reader,
 * which bounds the pending frame size. Only `end_stream` completes the answer:
 * a body that simply stops is a truncated answer and throws.
 */
export async function* innerAiWebText(reader, { maxBytes } = {}) {
  const decoder = new TextDecoder();
  const frames = createSseFrameReader(maxBytes === undefined ? undefined : { maxBytes });
  let open = true;
  while (open) {
    const { done, value } = await reader.read();
    open = !done;
    let batch;
    try {
      batch = done
        ? [...frames.push(decoder.decode()), ...frames.flush()]
        : frames.push(decoder.decode(value, { stream: true }));
    } catch (error) {
      if (error?.code === "invalid_sse_payload") throw malformedReply("an oversized stream event");
      throw error;
    }
    for (const frame of batch) {
      const event = readFrame(frame);
      if (event?.end) return;
      if (event) yield event.text;
    }
  }
  throw malformedReply("a stream that ended before completion");
}
