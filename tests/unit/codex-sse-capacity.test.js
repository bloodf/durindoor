import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

function sseResponse(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("Codex SSE transient error peek", () => {
  const executor = new CodexExecutor();

  it("classifies capacity events as account fallback", async () => {
    const capacity = await executor._peekSseTransientError(sseResponse([
      "event: error\n",
      'data: {"error":{"message":"Selected model is at capacity. Please try a different model."}}\n\n',
    ]));

    expect(capacity.matched).toBe("selected model is at capacity");
    expect(capacity.accountFallback).toBe(true);
    expect(capacity.message).toBe("Selected model is at capacity. Please try a different model.");
  });

  it("does not classify split capacity events as same-account retries", async () => {
    const capacity = await executor._peekSseTransientError(sseResponse([
      "event: error\n",
      'data: {"error":{"type":"service_unavailable_error",',
      '"code":"model_at_capacity","message":"Selected model is at capacity. Please try a different model."}}\n\n',
    ]));

    expect(capacity.matched).toBe("selected model is at capacity");
    expect(capacity.accountFallback).toBe(true);
  });

  it("uses the official model_at_capacity code even when the message is generic", async () => {
    const capacity = await executor._peekSseTransientError(sseResponse([
      'data: {"error":{"type":"service_unavailable_error","code":"model_at_capacity","message":"Please retry"}}\n\n',
    ]));
    expect(capacity.matched).toBe("model_at_capacity");
    expect(capacity.accountFallback).toBe(true);
  });

  it("does not let an earlier benign event complete a later split retry envelope", async () => {
    const capacity = await executor._peekSseTransientError(sseResponse([
      'event: response.created\ndata: {"type":"response.created"}\n\n',
      'data: {"error":{"type":"service_unavailable_error",',
      '"code":"model_at_capacity","message":"Selected model is at capacity. Please try a different model."}}\n\n',
    ]));
    expect(capacity.matched).toBe("selected model is at capacity");
    expect(capacity.accountFallback).toBe(true);
  });

  it("does not classify model output that mentions retry sentinel phrases", async () => {
    const output = await executor._peekSseTransientError(sseResponse([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"service_unavailable_error; selected model is at capacity"}\n\n',
    ]));
    expect(output.matched).toBeNull();
    expect(output.accountFallback).toBe(false);
    expect(output.replacementBody).toBeTruthy();
  });

  it("reassembles non-error streams after peeking", async () => {
    const normal = await executor._peekSseTransientError(sseResponse([
      "event: response.output_text.delta\n",
      'data: {"delta":"OK"}\n\n',
    ]));

    expect(normal.matched).toBeNull();
    expect(normal.replacementBody).toBeTruthy();

    const text = await new Response(normal.replacementBody).text();
    expect(text).toMatch(/response\.output_text\.delta/);
    expect(text).toMatch(/OK/);
  });
});
