import { randomUUID } from "node:crypto";
import { createSseFrameReader } from "../utils/sseFrames.js";

/** Repair Copilot chat chunks (#864), preserving upstream errors and terminals. */
export function normalizeGithubChatStream(response) {
  const reader = createSseFrameReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let fallbackId = `chatcmpl-${randomUUID()}`;
  let started = false;

  const emit = (frames, controller) => {
    for (const frame of frames) {
      let parsed;
      try { parsed = JSON.parse(frame.data); } catch { /* comments, DONE and malformed frames pass through */ }
      if (parsed && Array.isArray(parsed.choices) && (!frame.eventName || frame.eventName === "message")) {
        if (!parsed.id) parsed.id = fallbackId;
        else fallbackId = parsed.id;
        if (!started && parsed.choices.length === 0) {
          parsed.choices = [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null, logprobs: null }];
        }
        if (parsed.choices.length) started = true;
        for (const choice of parsed.choices) {
          if (choice?.delta?.content === null) delete choice.delta.content;
        }
        const metadata = frame.raw.split(/\r\n|\r|\n/).filter((line) => line !== "data" && !line.startsWith("data:"));
        controller.enqueue(encoder.encode([...metadata, `data: ${JSON.stringify(parsed)}`, "", ""].join("\n")));
      } else {
        controller.enqueue(encoder.encode(frame.wire ?? `${frame.raw}\n\n`));
      }
    }
  };

  return new Response(response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) { emit(reader.push(decoder.decode(chunk, { stream: true })), controller); },
    flush(controller) {
      emit(reader.push(decoder.decode(), true), controller);
      emit(reader.flush(), controller);
    },
  })), { status: response.status, statusText: response.statusText, headers: response.headers });
}
