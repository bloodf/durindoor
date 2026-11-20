/** Decode SSE frames across byte boundaries, including multiple data lines. */
export function mapInteractionEvents(body, map, onEnd = () => "") {
  let buffer = "";
  const encoder = new TextEncoder();
  function emit(frame, controller) {
    const data = frame.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data || data === "[DONE]") return;
    let event;
    try { event = JSON.parse(data); } catch { event = null; }
    const output = map(event);
    if (output) controller.enqueue(encoder.encode(output));
  }
  return body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop();
      for (const frame of frames) emit(frame, controller);
      if (buffer.length > 1024 * 1024) throw new Error("Interactions SSE frame exceeds size limit");
    },
    flush(controller) {
      if (buffer) emit(buffer, controller);
      const output = onEnd();
      if (output) controller.enqueue(encoder.encode(output));
    },
  }));
}

export const interactionEvent = (event) => `data: ${JSON.stringify(event)}\n\n`;
