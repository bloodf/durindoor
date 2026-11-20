import { describe, expect, it, vi } from "vitest";
import { advancePendingSseLineBytes, MAX_PENDING_SSE_LINE_BYTES } from "../../open-sse/utils/pendingSseLine.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";
import { createTerminalTracker } from "../../open-sse/utils/streamTerminal.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createEmptyRetryStream } from "../../open-sse/handlers/chatCore/emptyStreamGuard.js";

describe("pending SSE line limit", () => {
  it("counts bytes across chunks and checks every line, including a middle line", () => {
    const encoder = new TextEncoder();
    expect(advancePendingSseLineBytes(3, encoder.encode("é\nx"))).toBe(1);
    expect(advancePendingSseLineBytes(MAX_PENDING_SSE_LINE_BYTES - 2, encoder.encode("é\n"))).toBe(0);
    expect(advancePendingSseLineBytes(MAX_PENDING_SSE_LINE_BYTES - 1, encoder.encode("é\n"))).toBeNull();
    const chunk = new Uint8Array(MAX_PENDING_SSE_LINE_BYTES + 3).fill(97);
    chunk[0] = 10;
    chunk[chunk.length - 1] = 10;
    expect(advancePendingSseLineBytes(0, chunk)).toBeNull();
  });

  it("reports an oversized line once and does not complete the stream", async () => {
    const complete = vi.fn();
    const error = vi.fn();
    let connected = true;
    const lifecycle = {
      isConnected: () => connected,
      handleComplete: complete,
      handleError: (err) => { connected = false; error(err); },
      handleDisconnect: vi.fn(),
    };
    const transform = createSSEStream({ mode: "passthrough", targetFormat: FORMATS.OPENAI, sourceFormat: FORMATS.OPENAI, onStreamComplete: complete });
    const output = createDisconnectAwareStream(transform, lifecycle, null, createTerminalTracker(FORMATS.OPENAI));
    const writer = transform.writable.getWriter();
    const input = new Uint8Array(MAX_PENDING_SSE_LINE_BYTES + 1).fill(97);
    const write = writer.write(input).catch(() => {});
    const text = await new Response(output).text();
    await write;
    expect(text).toContain('"error"');
    expect(text.match(/\[DONE\]/g)).toHaveLength(1);
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0].code).toBe("invalid_sse_payload");
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects oversized Antigravity input without retrying", async () => {
    const reexecute = vi.fn();
    const onExhausted = vi.fn();
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(MAX_PENDING_SSE_LINE_BYTES + 1).fill(97)); },
    });
    const output = createEmptyRetryStream({ body, reexecute, onExhausted });
    await expect(output.getReader().read()).rejects.toMatchObject({ code: "invalid_sse_payload" });
    expect(reexecute).not.toHaveBeenCalled();
    expect(onExhausted).not.toHaveBeenCalled();
  });
});
