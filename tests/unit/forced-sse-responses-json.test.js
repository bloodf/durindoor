import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

function responsesSse() {
  const frames = [
    ["response.created", { response: { id: "resp-upstream", created_at: 123 } }],
    ["response.output_item.done", {
      output_index: 0,
      item: { type: "message", id: "msg-1", role: "assistant", content: [{ type: "output_text", text: "hello" }] },
    }],
    ["response.completed", { response: { usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } }],
  ];
  return frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

function chatSse() {
  return [
    `data: ${JSON.stringify({ id: "chat-upstream", created: 123, model: "gpt-test", choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ id: "chat-upstream", created: 123, model: "gpt-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
}

function makeContext({ sourceFormat, targetFormat, raw, provider = "openai" }) {
  return {
    providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    sourceFormat,
    targetFormat,
    provider,
    model: "gpt-test",
    body: { model: "gpt-test", stream: false },
    stream: true,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "connection-test",
    apiKey: null,
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    onRequestSuccess: vi.fn(async () => {}),
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    log: { line: vi.fn(), debug: vi.fn() },
    usageEventId: "event-test",
    terminalProvenance: "upstream",
  };
}

describe("forced SSE to JSON format axes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("projects a Responses upstream stream to an OpenAI client completion", async () => {
    const result = await handleForcedSSEToJson(makeContext({
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw: responsesSse(),
      provider: "codex",
    }));
    const body = await result.response.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("hello");
  });

  it("projects an OpenAI upstream stream to a Responses client object", async () => {
    const result = await handleForcedSSEToJson(makeContext({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI,
      raw: chatSse(),
    }));
    const body = await result.response.json();
    expect(body.object).toBe("response");
    expect(body.output[0].content[0].text).toBe("hello");
  });

  it("keeps Responses JSON native when client and upstream both use Responses", async () => {
    const result = await handleForcedSSEToJson(makeContext({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw: responsesSse(),
      provider: "codex",
    }));
    const body = await result.response.json();
    expect(body.object).toBe("response");
    expect(body.id).toBe("resp-upstream");
    expect(body.output[0].content[0].text).toBe("hello");
  });

  it("does not clear health when forced-stream provenance is omitted", async () => {
    const ctx = makeContext({
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw: responsesSse(),
      provider: "codex",
    });
    delete ctx.terminalProvenance;
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(true);
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
  });

  it("strips provider-only kiro credit fields from the client JSON but keeps them for internal accounting", async () => {
    const creditUsage = { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, kiro_credits: 0.0097, kiro_credit_unit: "credit" };
    const raw = [
      `data: ${JSON.stringify({ id: "chat-upstream", created: 123, model: "gpt-test", choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chat-upstream", created: 123, model: "gpt-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: creditUsage })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const ctx = makeContext({
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      raw,
      provider: "kiro",
    });
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(true);
    const body = await result.response.json();
    // Client-facing usage carries the real token counts but no provider-only credit fields.
    expect(body.usage).toMatchObject({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 });
    expect(body.usage.kiro_credits).toBeUndefined();
    expect(body.usage.kiro_credit_unit).toBeUndefined();
    // Internal accounting still receives the raw credits.
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.objectContaining({
      tokens: expect.objectContaining({ kiro_credits: 0.0097, kiro_credit_unit: "credit" }),
    }));
  });

  it("keeps nonzero Claude input/output tokens and no credit leak when the client speaks Claude", async () => {
    const creditUsage = { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, kiro_credits: 0.0097, kiro_credit_unit: "credit" };
    const raw = [
      `data: ${JSON.stringify({ id: "chat-upstream", created: 123, model: "gpt-test", choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chat-upstream", created: 123, model: "gpt-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: creditUsage })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const ctx = makeContext({
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.CLAUDE,
      raw,
      provider: "kiro",
    });
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(true);
    const body = await result.response.json();
    // Claude projection rebuilds usage from prompt/completion tokens — the
    // strip must not zero them out.
    expect(body.usage).toMatchObject({ input_tokens: 2, output_tokens: 3 });
    expect(body.usage.kiro_credits).toBeUndefined();
    expect(body.usage.kiro_credit_unit).toBeUndefined();
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.objectContaining({
      tokens: expect.objectContaining({ kiro_credits: 0.0097 }),
    }));
  });

  it.each([
    [null, 0],
    ["upstream", 1],
    ["validated", 1],
  ])("gates forced-stream cleanup by provenance %s", async (terminalProvenance, expectedCalls) => {
    const ctx = makeContext({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw: responsesSse(),
      provider: "codex",
    });
    ctx.terminalProvenance = terminalProvenance;
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(true);
    expect(ctx.onRequestSuccess).toHaveBeenCalledTimes(expectedCalls);
  });

  it.each([
    ["response.failed", { type: "response.failed", response: { status: "failed" } }],
    ["response.cancelled", { type: "response.cancelled", response: { status: "cancelled" } }],
  ])("keeps %s sticky before a later completed event", async (failureEvent, failurePayload) => {
    const raw = [
      `event: ${failureEvent}\ndata: ${JSON.stringify(failurePayload)}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}\n\n`,
    ].join("");
    const ctx = makeContext({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw,
      provider: "codex",
    });
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(false);
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
  });

  it("rejects a completed event carrying failed status", async () => {
    const raw = `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "failed" } })}\n\n`;
    const ctx = makeContext({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw,
      provider: "codex",
    });
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(false);
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
  });

  it("rejects a completed event carrying a failed payload type", async () => {
    const raw = `event: response.completed\ndata: ${JSON.stringify({ type: "response.failed", response: { status: "failed" } })}\n\n`;
    const ctx = makeContext({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw,
      provider: "codex",
    });
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(false);
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
  });

  it("rejects a completed Responses event carrying an embedded error", async () => {
    const raw = `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response: { status: "completed", error: { message: "boom" } },
    })}\n\n`;
    const ctx = makeContext({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw,
      provider: "codex",
    });
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(false);
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ["huge", 1_000_000_000],
    ["negative", -1],
    ["fractional", 1.5],
    ["string", "1"],
    ["sparse", 1],
  ])("rejects a %s Responses output index", async (_label, outputIndex) => {
    const raw = [
      `event: response.output_item.done\ndata: ${JSON.stringify({
        type: "response.output_item.done",
        output_index: outputIndex,
        item: { type: "message", role: "assistant", content: [] },
      })}`,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
      "",
    ].join("\n\n");
    const ctx = makeContext({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw,
      provider: "codex",
    });
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(false);
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
  });

  it("rejects duplicate Responses output indexes", async () => {
    const item = `event: response.output_item.done\ndata: ${JSON.stringify({
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "message", role: "assistant", content: [] },
    })}`;
    const raw = [
      item,
      item,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
      "",
    ].join("\n\n");
    const ctx = makeContext({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw,
      provider: "codex",
    });
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(false);
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
  });

  it("keeps a failure after a provisional completed event sticky", async () => {
    const raw = [
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
      `event: response.failed\ndata: ${JSON.stringify({ type: "response.failed", response: { status: "failed" } })}`,
      "",
    ].join("\n\n");
    const ctx = makeContext({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw,
      provider: "codex",
    });
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(false);
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ["response.completed", "completed"],
    ["response.incomplete", "incomplete"],
  ])("accepts %s followed by the optional DONE sentinel", async (eventType, status) => {
    const raw = [
      `event: ${eventType}\ndata: ${JSON.stringify({ type: eventType, response: { status } })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const ctx = makeContext({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw,
      provider: "codex",
    });
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(true);
    expect((await result.response.json()).status).toBe(status);
    expect(ctx.onRequestSuccess).toHaveBeenCalledOnce();
  });

  it.each([
    ["DONE before terminal", [
      "data: [DONE]",
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
    ]],
    ["duplicate DONE", [
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
      "data: [DONE]",
      "data: [DONE]",
    ]],
    ["data after DONE", [
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
      "data: [DONE]",
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "late" })}`,
    ]],
    ["failure-labeled DONE", [
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
      "event: response.failed\ndata: [DONE]",
    ]],
  ])("rejects forced Responses ordering: %s", async (_label, messages) => {
    const ctx = makeContext({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw: `${messages.join("\n\n")}\n\n`,
      provider: "codex",
    });
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(false);
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
  });

  it("accepts a valid forced stream larger than the error-body limit", async () => {
    const text = "x".repeat(70 * 1024);
    const raw = [
      `data: ${JSON.stringify({ id: "large", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "large", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const result = await handleForcedSSEToJson(makeContext({
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      raw,
    }));
    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toHaveLength(70 * 1024);
  });

  it("allows a valid terminal that arrives after the former two-second error bound", async () => {
    vi.useFakeTimers();
    try {
      const raw = chatSse();
      const body = new ReadableStream({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode(raw));
            controller.close();
          }, 3_000);
        },
      });
      const ctx = makeContext({
        sourceFormat: FORMATS.OPENAI,
        targetFormat: FORMATS.OPENAI,
        raw: "",
      });
      ctx.providerResponse = new Response(body, { headers: { "content-type": "text/event-stream" } });
      const pending = handleForcedSSEToJson(ctx);
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(pending).resolves.toMatchObject({ success: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
