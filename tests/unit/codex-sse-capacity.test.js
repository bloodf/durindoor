import { describe, expect, it, vi } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const encoder = new TextEncoder();

function sseResponse(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("Codex SSE transient error peek", () => {
  const executor = new CodexExecutor();

  it.each(["\n", "\r\n"])("classifies complete capacity frames with %j line endings", async (eol) => {
    const capacity = await executor._peekSseTransientError(sseResponse([
      `event: error${eol}`,
      `data: {"error":{"message":"Selected model is at capacity. Please try a different model."}}${eol}${eol}`,
    ]));

    expect(capacity.matched).toBe("selected model is at capacity");
    expect(capacity.accountFallback).toBe(true);
    expect(capacity.message).toBe("Selected model is at capacity. Please try a different model.");
  });

  it("classifies an event split across chunks and across a CRLF delimiter", async () => {
    const capacity = await executor._peekSseTransientError(sseResponse([
      "event: error\r\n",
      'data: {"error":{"type":"service_unavailable_error",',
      '"code":"model_at_capacity","message":"Selected model is at capacity. Please try a different model."}}\r\n',
      "\r\n",
    ]));

    expect(capacity.matched).toBe("selected model is at capacity");
    expect(capacity.accountFallback).toBe(true);
  });

  it("joins multiline data fields before parsing structured errors", async () => {
    const retry = await executor._peekSseTransientError(sseResponse([
      "event: error\n",
      'data: {"error":{"type":"service_unavailable_error",\n',
      'data: "message":"Please retry"}}\n\n',
    ]));

    expect(retry.matched).toBe("service_unavailable_error");
    expect(retry.accountFallback).toBe(false);
    expect(retry.message).toBe("Please retry");
  });

  it.each(["type", "event"])("classifies a JSON root %s=error envelope", async (field) => {
    const result = await executor._peekSseTransientError(sseResponse([
      `data: ${JSON.stringify({ [field]: "error", code: "server_is_overloaded", message: "Please retry" })}\n\n`,
    ]));

    expect(result.matched).toBe("server_is_overloaded");
    expect(result.message).toBe("Please retry");
  });

  it("classifies text sent under an explicit error event", async () => {
    const result = await executor._peekSseTransientError(sseResponse([
      "event: error\ndata: service_unavailable_error\n\n",
    ]));

    expect(result.matched).toBe("service_unavailable_error");
  });

  it("lets account fallback win over a same-account retry type", async () => {
    const capacity = await executor._peekSseTransientError(sseResponse([
      'data: {"error":{"type":"service_unavailable_error","code":"model_at_capacity","message":"Please retry"}}\n\n',
    ]));

    expect(capacity.matched).toBe("model_at_capacity");
    expect(capacity.accountFallback).toBe(true);
  });

  it("processes a later error in the same network chunk after user output", async () => {
    const result = await executor._peekSseTransientError(sseResponse([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hello"}\n\n'
        + 'event: error\ndata: {"error":{"type":"server_is_overloaded","message":"retry"}}\n\n',
    ]));

    expect(result.matched).toBe("server_is_overloaded");
    expect(result.accountFallback).toBe(false);
  });

  it("prefers a later account-capacity frame over a retry frame in the same chunk", async () => {
    const result = await executor._peekSseTransientError(sseResponse([
      'event: error\ndata: {"error":{"type":"server_is_overloaded"}}\n\n'
        + 'event: error\ndata: {"error":{"code":"model_at_capacity","message":"Please retry"}}\n\n',
    ]));

    expect(result.matched).toBe("model_at_capacity");
    expect(result.accountFallback).toBe(true);
  });

  it("does not classify sentinel text in output, comments, or ordinary data", async () => {
    const text = [
      ': service_unavailable_error and model_at_capacity\n\n',
      'data: service_unavailable_error\n\n',
      'event: response.output_text.delta\n',
      'data: {"type":"response.output_text.delta","delta":"selected model is at capacity; server_is_overloaded"}\n\n',
    ].join("");
    const output = await executor._peekSseTransientError(sseResponse([text]));

    expect(output.matched).toBeNull();
    expect(output.accountFallback).toBe(false);
    await expect(new Response(output.replacementBody).text()).resolves.toBe(text);
  });

  it("never classifies an incomplete frame at EOF", async () => {
    const partial = 'event: error\ndata: {"error":{"type":"service_unavailable_error"}}\n';
    const result = await executor._peekSseTransientError(sseResponse([partial]));

    expect(result.matched).toBeNull();
    await expect(new Response(result.replacementBody).text()).resolves.toBe(partial);
  });

  it("does not inspect an error frame beyond the 256 KiB byte limit", async () => {
    const prefix = "x".repeat(256 * 1024);
    const text = `${prefix}event: error\ndata: {"error":{"type":"service_unavailable_error"}}\n\n`;
    const result = await executor._peekSseTransientError(sseResponse([text]));

    expect(result.matched).toBeNull();
    await expect(new Response(result.replacementBody).text()).resolves.toBe(text);
  });

  it("replays non-error bytes exactly once before continuing the same reader", async () => {
    const chunks = [
      "event: response.output_text.delta\n",
      'data: {"type":"response.output_text.delta","delta":"✓"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed"}\n\n',
    ];
    const result = await executor._peekSseTransientError(sseResponse(chunks));

    expect(result.matched).toBeNull();
    await expect(new Response(result.replacementBody).text()).resolves.toBe(chunks.join(""));
  });

  it("replays consumed bytes and then propagates the original upstream read error", async () => {
    const upstreamError = new Error("upstream exploded");
    let pullCount = 0;
    const response = new Response(new ReadableStream({
      pull(controller) {
        pullCount++;
        if (pullCount === 1) controller.enqueue(encoder.encode('event: response.created\ndata: {"type":"response.created"}\n\n'));
        else controller.error(upstreamError);
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } });

    const result = await executor._peekSseTransientError(response);
    const reader = result.replacementBody.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("response.created");
    await expect(reader.read()).rejects.toBe(upstreamError);
  });

  it("awaits downstream cancellation and forwards the exact reason", async () => {
    let cancelReason;
    let cancelFinished = false;
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n',
        ));
      },
      async cancel(reason) {
        cancelReason = reason;
        await Promise.resolve();
        cancelFinished = true;
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } });

    const result = await executor._peekSseTransientError(response);
    const reader = result.replacementBody.getReader();
    await reader.read();
    await reader.cancel("client disconnected");

    expect(cancelReason).toBe("client disconnected");
    expect(cancelFinished).toBe(true);
    expect(response.body.locked).toBe(false);
  });

  it("cancels and releases a matched upstream stream before returning", async () => {
    const cancel = vi.fn(async () => Promise.resolve());
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: error\ndata: {"error":{"type":"service_unavailable_error"}}\n\n',
        ));
      },
      cancel,
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } });

    const result = await executor._peekSseTransientError(response);

    expect(result.matched).toBe("service_unavailable_error");
    expect(cancel).toHaveBeenCalledWith("codex-sse-retry");
    expect(response.body.locked).toBe(false);
  });
});
