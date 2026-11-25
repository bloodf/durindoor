import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { PEEK_PROGRESS_GRACE_MS, peekStreamForContent } from "../../open-sse/utils/streamContentPeek.js";

// Issue #2553: with unavailable-notice detection on, a bare lifecycle frame must
// not commit a combo member; a late notice or in-stream error still fails over.

const NOTICE = "Claude Opus 4.5 is no longer available. Please switch to Claude Opus 4.6.";
const OPTIONS = { detectUnavailableNotice: true, releaseOnProgress: true };

const encoder = new TextEncoder();
const frame = (data) => `data: ${JSON.stringify(data)}\n\n`;
const delta = (value) => frame({ type: "content_block_delta", index: 0, delta: value });

const messageStart = frame({ type: "message_start", message: { id: "msg_1", role: "assistant", content: [] } });
const thinkingStart = frame({ type: "content_block_start", index: 0, content_block: { type: "thinking" } });
const emptyThinking = delta({ type: "thinking_delta", thinking: "" });
const messageStop = frame({ type: "message_stop" });

function scripted() {
  let controller;
  const cancel = vi.fn();
  const body = new ReadableStream({ start(value) { controller = value; }, cancel });
  return {
    response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
    push: (value) => controller.enqueue(encoder.encode(value)),
    close: () => controller.close(),
    cancel,
  };
}

function track(promise) {
  const state = { settled: null };
  promise.then((value) => { state.settled = value; });
  return state;
}

function runCombo(first) {
  const sibling = new Response(delta({ type: "text_delta", text: "sibling answer" }) + messageStop, {
    headers: { "content-type": "text/event-stream" },
  });
  const handleSingleModel = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(sibling);
  const response = handleComboChat({
    body: { messages: [{ role: "user", content: "hi" }], stream: true },
    models: ["antigravity/claude-opus-4-5", "openai/gpt-5.4"],
    handleSingleModel,
    log: { info: vi.fn(), warn: vi.fn() },
    comboName: "progress-release",
    comboStrategy: "fallback",
  });
  return { response, handleSingleModel };
}

describe("issue 2553: combo progress release must not skip late failover", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    ["a notice", delta({ type: "text_delta", text: NOTICE }) + messageStop],
    ["an in-stream error", frame({ type: "error", error: { type: "overloaded_error", message: "busy" } })],
  ])("fails over %s that starts 1.5 s after message_start", async (_name, late) => {
    const upstream = scripted();
    const { response, handleSingleModel } = runCombo(upstream.response);
    await vi.advanceTimersByTimeAsync(0);
    upstream.push(messageStart + thinkingStart);
    await vi.advanceTimersByTimeAsync(1500);
    upstream.push(late);
    upstream.close();
    await vi.advanceTimersByTimeAsync(0);

    await expect((await response).text()).resolves.toContain("sibling answer");
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["message_start", messageStart],
    ["content_block_start", thinkingStart],
    ["role-only delta", frame({ choices: [{ index: 0, delta: { role: "assistant" } }] })],
    ["response.created", frame({ type: "response.created", response: { id: "resp_1" } })],
    ["response.in_progress", frame({ type: "response.in_progress", response: { id: "resp_1" } })],
  ])("keeps peeking after a bare %s until the existing timeout", async (_name, first) => {
    const upstream = scripted();
    const state = track(peekStreamForContent(upstream.response, 60_000, OPTIONS));
    upstream.push(first);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(state.settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.settled).toMatchObject({ outcome: "timeout", hasContent: false });
    await state.settled.body.cancel();
  });

  it.each([
    ["thinking delta", emptyThinking],
    ["signature delta", delta({ type: "signature_delta", signature: "sig" })],
    ["input_json delta", delta({ type: "input_json_delta", partial_json: "" })],
  ])("releases a long silent turn one grace window after a %s, losing no bytes", async (_name, silent) => {
    const upstream = scripted();
    const state = track(peekStreamForContent(upstream.response, 60_000, OPTIONS));
    upstream.push(messageStart + thinkingStart);
    await vi.advanceTimersByTimeAsync(PEEK_PROGRESS_GRACE_MS * 5);
    expect(state.settled).toBeNull();
    upstream.push(silent);
    await vi.advanceTimersByTimeAsync(PEEK_PROGRESS_GRACE_MS - 1);
    expect(state.settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.settled).toMatchObject({ outcome: "progress", hasContent: true });

    const text = delta({ type: "text_delta", text: "hello" });
    upstream.push(text);
    upstream.close();
    await expect(new Response(state.settled.body).text()).resolves.toBe(messageStart + thinkingStart + silent + text);
  });

  it("combo passes releaseOnProgress: long silent thinking is handed to the client while still open", async () => {
    const upstream = scripted();
    const { response, handleSingleModel } = runCombo(upstream.response);
    const state = track(response);
    await vi.advanceTimersByTimeAsync(0);
    upstream.push(messageStart + thinkingStart + emptyThinking);
    await vi.advanceTimersByTimeAsync(PEEK_PROGRESS_GRACE_MS);

    expect(state.settled).not.toBeNull();
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    upstream.push(delta({ type: "text_delta", text: "late answer" }) + messageStop);
    upstream.close();
    await expect(state.settled.text()).resolves.toContain("late answer");
    expect(upstream.cancel).not.toHaveBeenCalled();
  });
});
