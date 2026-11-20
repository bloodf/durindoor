import { describe, expect, it } from "vitest";
import { frameCarriesContent, peekStreamForContent } from "../../open-sse/utils/streamContentPeek.js";
import { extractStreamErrorPayload, isRequestScopedStreamError } from "../../open-sse/utils/streamLifecycle.js";
import { createEmptyTerminalGuard } from "../../open-sse/utils/emptyStreamTerminal.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const wire = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const response = (text) => new Response(text, { headers: { "content-type": "text/event-stream" } });

describe("October combo terminal inventory", () => {
  it("recognizes thinking as content but does not promote empty signature metadata", () => {
    expect(frameCarriesContent(wire({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "working" } }).trim())).toBe(true);
    expect(frameCarriesContent(wire({ type: "content_block_delta", delta: { type: "signature_delta", signature: "" } }).trim())).toBe(false);
  });
  it("keeps the absolute peek timeout even while metadata arrives", async () => {
    let timer;
    const body = new ReadableStream({ start(c) { timer = setInterval(() => c.enqueue(new TextEncoder().encode('data: {}\n\n')), 2); }, cancel() { clearInterval(timer); } });
    const result = await peekStreamForContent(new Response(body, { headers: { "content-type": "text/event-stream" } }), 30);
    expect(result.outcome).toBe("timeout");
    await result.body.cancel();
  });
  it.each(["context_length_exceeded", "context_window_exceeded"])("classifies type-only %s as request scoped", async (type) => {
    const payload = { type: "response.failed", response: { error: { type, message: "too long" } } };
    const error = extractStreamErrorPayload(payload);
    expect(isRequestScopedStreamError(error)).toBe(true);
    expect((await peekStreamForContent(response(wire(payload)))).streamError).toEqual(error);
    expect(isRequestScopedStreamError({ type: "server_error" })).toBe(false);
  });
  it("currently rejects a complete zero-block Claude turn without provenance", async () => {
    const frames = [wire({ type: "message_start", message: { content: [] } }), wire({ type: "message_delta", delta: { stop_reason: "end_turn" } }), wire({ type: "message_stop" })].join("");
    const guarded = response(frames).body.pipeThrough(createEmptyTerminalGuard(FORMATS.CLAUDE, () => true, () => ({})));
    expect(await new Response(guarded).text()).toContain('"error"');
  });
});
