import { createSseFrameReader } from "./sseFrames.js";

/** Decode SSE frames across byte boundaries, including multiple data lines. */
export function mapInteractionEvents(body, map, onEnd = () => "") {
  const reader = createSseFrameReader();
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
      for (const frame of reader.push(chunk)) emit(frame, controller);
    },
    flush(controller) {
      for (const frame of reader.flush()) emit(frame, controller);
      const output = onEnd();
      if (output) controller.enqueue(encoder.encode(output));
    },
  }));
}

export const interactionEvent = (event) => `data: ${JSON.stringify(event)}\n\n`;
