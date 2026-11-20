import { FORMATS } from "../translator/formats.js";
import { buildStreamErrorBytes, formatSSE } from "./streamHelpers.js";

const encoder = new TextEncoder();
const GRACE_MS = 1000;

/** Hold only success terminals while the completion classifier is still pending. */
export function createEmptyTerminalGuard(format, getVerdict, getSnapshot) {
  const decoder = new TextDecoder();
  let pending = "";
  let held = "";
  let timer = null;
  let released = false;
  let sawError = false;
  const clear = () => { if (timer) clearTimeout(timer); timer = null; };
  const send = (controller, value) => { if (value) controller.enqueue(encoder.encode(value)); };
  const release = (controller) => {
    clear();
    if (!held) return;
    const value = held;
    held = "";
    released = true;
    send(controller, value);
  };
  const hasOutput = () => {
    const snapshot = getSnapshot?.();
    return snapshot?.upstreamError || snapshot?.content?.trim?.() || snapshot?.thinking?.trim?.() || snapshot?.hadToolCalls ||
      Number(snapshot?.usage?.completion_tokens ?? snapshot?.usage?.output_tokens ?? snapshot?.usage?.candidatesTokenCount ?? 0) > 0;
  };
  const process = (controller, frame) => {
    const data = frame.match(/^data:\s*(.*)$/m)?.[1];
    let payload;
    try { payload = JSON.parse(data); } catch { /* sentinel or non-JSON frame */ }
    const event = frame.match(/^event:\s*(.*)$/m)?.[1] || payload?.type;
    const error = payload?.error || payload?.response?.error || event === "error" || event === "response.failed";
    if (error) { sawError = true; held = ""; clear(); send(controller, frame); return; }
    const reason = payload?.choices?.find((choice) => choice.finish_reason)?.finish_reason;
    const terminal = data === "[DONE]" || (format === FORMATS.OPENAI && reason === "stop") ||
      (format === FORMATS.CLAUDE && event === "message_stop") ||
      (format === FORMATS.OPENAI_RESPONSES && ["response.completed", "response.done"].includes(event));
    if (terminal && !released && !sawError && !hasOutput()) {
      held += frame;
      if (!timer) {
        timer = setTimeout(() => { try { release(controller); } catch { clear(); } }, GRACE_MS);
        timer.unref?.();
      }
      return;
    }
    // A non-success terminal must retain its original meaning.
    if (reason && reason !== "stop" || ["response.incomplete", "response.cancelled", "response.canceled"].includes(event)) {
      release(controller);
      released = true;
    }
    send(controller, frame);
  };
  return new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        const end = match.index + match[0].length;
        process(controller, pending.slice(0, end));
        pending = pending.slice(end);
      }
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending) process(controller, pending);
      clear();
      if (held && !sawError && !hasOutput() && getVerdict() === true) {
        held = "";
        if (format === FORMATS.OPENAI_RESPONSES) {
          send(controller, formatSSE({ event: "response.failed", data: { type: "response.failed", response: { status: "failed", error: { type: "stream_error", message: "Provider returned empty content" } } } }, format) + "data: [DONE]\n\n");
        } else {
          controller.enqueue(buildStreamErrorBytes(502, "Provider returned empty content", format));
        }
      } else release(controller);
    }
  });
}
