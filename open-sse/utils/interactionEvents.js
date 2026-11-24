import { extractCompleteSseFrames, parseSseFrame } from "./sseFrames.js";

const MAX_PENDING_INTERACTION_CHARS = 1024 * 1024;

/** Decode SSE frames across byte boundaries, including multiple data lines. */
export function mapInteractionEvents(body, map, onEnd = () => "") {
  let pending = "";
  const encoder = new TextEncoder();
  function emit(frame, controller) {
    const trimmed = frame.data.trim();
    if (!frame.hasData || !trimmed || trimmed === "[DONE]") return;
    let event;
    try { event = JSON.parse(frame.data); } catch { event = null; }
    const output = map(event);
    if (output) controller.enqueue(encoder.encode(output));
  }
  return body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream({
    transform(chunk, controller) {
      const { frames, remainder } = extractCompleteSseFrames(pending + chunk);
      pending = remainder;
      for (const raw of frames) emit(parseSseFrame(raw), controller);
      // The interaction limit counts UTF-16 code units in the unfinished tail.
      if (pending.length > MAX_PENDING_INTERACTION_CHARS) {
        throw new Error("Interactions SSE frame exceeds size limit");
      }
    },
    flush(controller) {
      if (pending) emit(parseSseFrame(pending), controller);
      const output = onEnd();
      if (output) controller.enqueue(encoder.encode(output));
    },
  }));
}

export const interactionEvent = (event) => `data: ${JSON.stringify(event)}\n\n`;
