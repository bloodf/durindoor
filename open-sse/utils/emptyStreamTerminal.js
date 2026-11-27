import { createSseFrameDispatcher } from "./sseFrames.js";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { FORMATS } from "../translator/formats.js";
import { buildStreamErrorBytes, formatSSE } from "./streamHelpers.js";
import { hasResponsesContentItem } from "./responsesContent.js";
import { isSafetyStopPayload } from "./safetyStopFrame.js";
import { emittedFormatTerminalKind } from "./streamTerminal.js";

const encoder = new TextEncoder();
const GRACE_MS = 1000;

/** Recognize actual native Responses snapshot output, never arbitrary metadata. */
export function hasResponsesSnapshotOutput(payload) {
  if (!["response.completed", "response.done"].includes(payload?.type) || payload?.response?.status === "failed") return false;
  return Array.isArray(payload?.response?.output) && payload.response.output.some((item) => {
    if (item?.type === "image_generation_call") {
      return payload.response.status === "completed" && item.status === "completed" && hasResponsesContentItem(item);
    }
    if (item?.type === "message" && Array.isArray(item.content)) {
      return item.content.some((part) =>
        part?.type === "output_text" && isString(part.text) && part.text.trim() ||
        part?.type === "refusal" && isString(part.refusal) && part.refusal.trim());
    }
    return ["function_call", "custom_tool_call"].includes(item?.type) &&
      [item.name, item.arguments, item.input].some((value) => isString(value) && value.trim());
  });
}

/** Hold only success terminals while the completion classifier is still pending. */
export function createEmptyTerminalGuard(format, getVerdict, getSnapshot) {
  let held = "";
  let timer = null;
  let released = false;
  let sawError = false;
  let sawOutput = false;
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
    return sawOutput || snapshot?.hasTokenLimitTerminal || snapshot?.upstreamError || snapshot?.content?.trim?.() || snapshot?.thinking?.trim?.() || snapshot?.hadToolCalls ||
      Number(snapshot?.usage?.completion_tokens ?? snapshot?.usage?.output_tokens ?? snapshot?.usage?.candidatesTokenCount ?? 0) > 0;
  };
  const process = (controller, observation) => {
    const { wire: frame, payload } = observation;
    const event = observation.eventName || payload?.type;
    const error = payload?.error || payload?.response?.error || event === "error" || event === "response.failed";
    if (error) { sawError = true; held = ""; clear(); send(controller, frame); return; }
    // Native Claude and Responses passthrough content is not accumulated by
    // the OpenAI-oriented accounting snapshot, so observe client output too.
    // An explicit provider safety/refusal stop is the provider's answer, not an
    // empty completion: keep its terminal instead of replacing it with an error.
    if (isSafetyStopPayload(payload) ||
        format === FORMATS.OPENAI_RESPONSES && hasResponsesSnapshotOutput(payload) ||
        event === "content_block_delta" && (payload?.delta?.text?.trim?.() || payload?.delta?.thinking?.trim?.()) ||
        event === "content_block_start" && payload?.content_block?.type === "tool_use" ||
        ["response.output_text.delta", "response.reasoning_text.delta", "response.reasoning_summary_text.delta"].includes(event) && payload?.delta?.trim?.() ||
        event === "response.output_item.added" && ["function_call", "custom_tool_call"].includes(payload?.item?.type)) {
      sawOutput = true;
    }
    const reason = payload?.choices?.find((choice) => choice.finish_reason)?.finish_reason;
    const kind = emittedFormatTerminalKind(format, frame);
    // Same end as the client tracker: [DONE], message_stop, response.completed
    // / failed, or a final Gemini candidate. finish_reason is not that end.
    const terminal = kind === "success" || kind === "done";
    // Hold an empty OpenAI stop until the real end so it can still be replaced
    // together with [DONE]. The stop frame itself does not terminate the stream.
    const pendingOpenAIStop = format === FORMATS.OPENAI && reason === "stop";
    if ((terminal || pendingOpenAIStop) && !released && !sawError && !hasOutput()) {
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
  // One incremental decoder owns split UTF-8 and frame boundaries for this guard.
  let outputController;
  const frames = createSseFrameDispatcher([(frame) => process(outputController, frame)]);
  return new TransformStream({
    transform(chunk, controller) {
      outputController = controller;
      frames.push(chunk);
    },
    flush(controller) {
      outputController = controller;
      frames.flush();
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
