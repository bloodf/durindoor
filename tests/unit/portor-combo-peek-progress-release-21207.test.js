import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PEEK_PROGRESS_GRACE_MS, peekStreamForContent } from "../../open-sse/utils/streamContentPeek.js";

const encoder = new TextEncoder();
const frame = (data) => `data: ${JSON.stringify(data)}\n\n`;

const messageStart = frame({ type: "message_start", message: { id: "msg_1", role: "assistant", content: [] } });
const textDelta = frame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } });

function scripted() {
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  return {
    response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
    push: (value) => controller.enqueue(encoder.encode(value)),
    close: () => controller.close(),
  };
}

function track(promise) {
  const state = { settled: null };
  promise.then((value) => { state.settled = value; });
  return state;
}

describe("port(omniroute) #21207 033eaa7fc0aa: the combo peek releases after lifecycle progress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    ["Claude message_start", messageStart],
    ["content_block_start", frame({ type: "content_block_start", index: 0, content_block: { type: "thinking" } })],
    ["empty thinking delta", frame({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "" } })],
    ["signature delta", frame({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } })],
    ["OpenAI role chunk", frame({ choices: [{ index: 0, delta: { role: "assistant" } }] })],
    ["response.created", frame({ type: "response.created", response: { id: "resp_1" } })],
  ])("releases within the grace window after a %s and loses no bytes", async (_name, first) => {
    const upstream = scripted();
    const state = track(peekStreamForContent(upstream.response, 60_000, { releaseOnProgress: true }));
    upstream.push(first);
    await vi.advanceTimersByTimeAsync(PEEK_PROGRESS_GRACE_MS - 1);
    expect(state.settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.settled).toMatchObject({ outcome: "progress", hasContent: true });
    upstream.push(textDelta);
    upstream.close();
    await expect(new Response(state.settled.body).text()).resolves.toBe(first + textDelta);
  });

  it("still reports an empty turn that ends inside the window", async () => {
    const upstream = scripted();
    const peek = peekStreamForContent(upstream.response, 60_000, { releaseOnProgress: true });
    upstream.push(messageStart);
    upstream.push(frame({ type: "message_stop" }));
    upstream.close();
    await expect(peek).resolves.toMatchObject({ outcome: "empty", hasContent: false });
  });

  it("does not release for pings or after an in-stream error", async () => {
    const pings = scripted();
    const pingState = track(peekStreamForContent(pings.response, 60_000, { releaseOnProgress: true }));
    pings.push(frame({ type: "ping" }));
    const failed = scripted();
    const failedState = track(peekStreamForContent(failed.response, 60_000, { releaseOnProgress: true }));
    failed.push(messageStart + frame({ type: "error", error: { type: "overloaded_error", message: "busy" } }));
    await vi.advanceTimersByTimeAsync(PEEK_PROGRESS_GRACE_MS * 3);
    expect(pingState.settled).toBeNull();
    expect(failedState.settled).toBeNull();
    pings.close();
    failed.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(failedState.settled).toMatchObject({ outcome: "empty", hasContent: false });
  });

  it("keeps holding without the option (single-model early-EOF failover)", async () => {
    const upstream = scripted();
    const state = track(peekStreamForContent(upstream.response, 60_000));
    upstream.push(messageStart);
    await vi.advanceTimersByTimeAsync(PEEK_PROGRESS_GRACE_MS * 3);
    expect(state.settled).toBeNull();
    upstream.close();
  });
});
