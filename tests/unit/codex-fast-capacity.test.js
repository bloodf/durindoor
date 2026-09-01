import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { buildErrorBody } from "../../open-sse/utils/error.js";

function streamFromText(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function streamFromChunks(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("Codex fast tier and capacity handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps Codex fast tier to priority and unsupported max reasoning to xhigh", () => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest("gpt-5.5", {
      model: "gpt-5.5",
      input: "hi",
      reasoning_effort: "max",
      service_tier: "fast",
    }, true, {});

    expect(body.service_tier).toBe("priority");
    expect(body.reasoning.effort).toBe("xhigh");
  });

  // Official openai/codex serializes semantic Ultra as Max for requests.
  // Sol/Terra keep semantic ultra via resolveOpenAiEffort; Codex wire alias maps ultra→max.
  it.each([
    ["gpt-5.6-sol", "max", "max"],
    ["gpt-5.6-sol", "ultra", "max"],
    ["gpt-5.6-terra", "max", "max"],
    ["gpt-5.6-terra", "ultra", "max"],
    ["gpt-5.6-luna", "max", "max"],
    ["gpt-5.6-luna", "ultra", "max"],
    ["gpt-5.5", "max", "xhigh"],
    ["gpt-5.5", "ultra", "xhigh"],
    ["gpt-5.5", "ULTRA", "ULTRA"],
    ["gpt-5.5", "Ultra", "Ultra"],
    ["gpt-5.6-sol", "xhigh", "xhigh"],
    ["gpt-5.6-sol", "high", "high"],
  ])("normalizes nested reasoning.effort for %s: %s → %s", (model, requested, expected) => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest(model, {
      model,
      input: "hi",
      reasoning: { effort: requested },
    }, true, {});

    expect(body.reasoning.effort).toBe(expected);
  });

  // Legacy reasoning_effort also converges through the same semantic→wire path.
  it.each([
    ["gpt-5.6-sol", "ultra", "max"],
    ["gpt-5.6-terra", "ultra", "max"],
    ["gpt-5.6-sol", "max", "max"],
    ["gpt-5.6-luna", "ultra", "max"],
    ["gpt-5.5", "ultra", "xhigh"],
    ["gpt-5.5", "ULTRA", "ULTRA"],
  ])("normalizes legacy reasoning_effort for %s: %s → %s", (model, requested, expected) => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest(model, {
      model,
      input: "hi",
      reasoning_effort: requested,
    }, true, {});

    expect(body.reasoning.effort).toBe(expected);
    expect(body.reasoning_effort).toBeUndefined();
  });

  it.each([
    ["gpt-5.6-sol-ultra", "gpt-5.6-sol", "max"],
    ["gpt-5.6-terra-ultra", "gpt-5.6-terra", "max"],
    ["gpt-5.6-terra-max", "gpt-5.6-terra", "max"],
    ["gpt-5.6-luna-ultra", "gpt-5.6-luna", "max"],
  ])("normalizes effort suffix %s → model %s effort %s", (model, expectedModel, expectedEffort) => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest(model, { model, input: "hi" }, true, {});

    expect(body.model).toBe(expectedModel);
    expect(body.reasoning.effort).toBe(expectedEffort);
  });

  it.each([
    ["gpt-5.3-codex-spark", "gpt-5.3-codex-spark"],
    ["gpt-5.3-codex-spark-review", "gpt-5.3-codex-spark"],
  ])("omits reasoning summary for Spark request %s", (model, expectedModel) => {
    const body = new CodexExecutor().transformRequest(model, {
      model,
      input: "hi",
      reasoning: { effort: "low", summary: "detailed" },
    }, true, {});

    expect(body.model).toBe(expectedModel);
    expect(body.reasoning).toEqual({ effort: "low" });
  });

  it("omits Spark summary while retaining normalized effort from the model suffix", () => {
    const body = new CodexExecutor().transformRequest("gpt-5.3-codex-spark-high", {
      model: "gpt-5.3-codex-spark-high",
      input: "hi",
    }, true, {});

    expect(body.model).toBe("gpt-5.3-codex-spark");
    expect(body.reasoning).toEqual({ effort: "high" });
  });

  it("keeps the reasoning summary default for non-Spark Codex models", () => {
    const body = new CodexExecutor().transformRequest("gpt-5.5", {
      model: "gpt-5.5",
      input: "hi",
    }, true, {});

    expect(body.reasoning).toEqual({ effort: "low", summary: "auto" });
  });

  it.each([
    [75000, 75000],
    [100001, 100000],
  ])("normalizes Spark compaction threshold %s to %s", (requested, expected) => {
    const body = new CodexExecutor().transformRequest("gpt-5.3-codex-spark", {
      model: "gpt-5.3-codex-spark",
      input: "hi",
      context_management: [
        { type: "retention", retain: 2 },
        { type: "compaction", compact_threshold: requested },
        { type: "compaction", compact_threshold: 1 },
      ],
    }, true, {});

    expect(body.context_management).toEqual([
      { type: "compaction", compact_threshold: expected },
    ]);
  });

  it.each([
    [undefined],
    [[]],
    [[{ type: "compaction", compact_threshold: 0 }]],
    [[{ type: "compaction", compact_threshold: -1 }]],
    [[{ type: "compaction", compact_threshold: Number.POSITIVE_INFINITY }]],
    [[{ type: "compaction", compact_threshold: "50000" }]],
    [[{ type: "retention", compact_threshold: 50000 }]],
    [{ type: "compaction", compact_threshold: 50000 }],
  ])("defaults invalid Spark context management %# to the 100K policy", (contextManagement) => {
    const body = new CodexExecutor().transformRequest("gpt-5.3-codex-spark", {
      model: "gpt-5.3-codex-spark",
      input: "hi",
      ...(contextManagement === undefined ? {} : { context_management: contextManagement }),
    }, true, {});

    expect(body.context_management).toEqual([
      { type: "compaction", compact_threshold: 100000 },
    ]);
  });

  it("removes context management from request-scoped standalone compact requests", () => {
    const body = new CodexExecutor().transformRequest("gpt-5.3-codex-spark", {
      model: "gpt-5.3-codex-spark",
      input: "hi",
      context_management: [{ type: "compaction", compact_threshold: 50000 }],
      tool_choice: "auto",
      text: { format: { type: "text" } },
    }, false, {}, { compact: true });

    expect(body.context_management).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.text).toEqual({ format: { type: "text" } });
  });

  it("uses ChatGPT workspace header fallback", () => {
    const executor = new CodexExecutor();
    const headers = executor.buildHeaders({
      accessToken: "token",
      connectionId: "conn_1",
      providerSpecificData: { chatgptAccountId: "acct_1" },
    });

    expect(headers["ChatGPT-Account-ID"]).toBe("acct_1");
  });

  it("falls back to accountId when ChatGPT-Account-ID has no workspaceId or chatgptAccountId", () => {
    const executor = new CodexExecutor();
    const headers = executor.buildHeaders({
      accessToken: "token",
      connectionId: "conn_1",
      providerSpecificData: { accountId: "acc_1" },
    });

    expect(headers["ChatGPT-Account-ID"]).toBe("acc_1");
  });

  it("classifies 200-SSE model capacity as account fallback", async () => {
    const executor = new CodexExecutor();
    const response = new Response(streamFromText(
      'event: error\ndata: {"error":{"message":"Selected model is at capacity. Please try a different model."}}\n\n',
    ), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.accountFallback).toBe(true);
    expect(peek.message).toBe("Selected model is at capacity. Please try a different model.");
  });

  it("maps a complete response.failed context code to HTTP 413", async () => {
    const upstream = new Response(streamFromText([
      "event: response.failed",
      'data: {"type":"response.failed","response":{"status":"failed","error":{"code":"context_length_exceeded","message":"Prompt is too long"}}}',
      "",
      "",
    ].join("\n")), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
    const baseExecute = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({ response: upstream });

    const result = await new CodexExecutor().execute({
      body: {},
      credentials: { providerSpecificData: {} },
      log: {},
    });

    expect(baseExecute).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(413);
    await expect(result.response.json()).resolves.toEqual({
      error: {
        message: "Prompt is too long",
        type: "invalid_request_error",
        code: "context_length_exceeded",
      },
    });
  });

  it("classifies a complete context-window message without an explicit code", async () => {
    const response = new Response(streamFromText([
      "event: response.failed",
      'data: {"type":"response.failed","response":{"error":{"message":"Your input exceeds the context window of this model."}}}',
      "",
      "",
    ].join("\n")), { status: 200 });

    await expect(new CodexExecutor()._peekSseTransientError(response)).resolves.toMatchObject({
      matched: "exceeds the context window",
      message: "Your input exceeds the context window of this model.",
      contextOverflow: true,
      accountFallback: false,
    });
  });

  it("does not classify a partial context-overflow frame", async () => {
    const partial = [
      "event: response.failed",
      'data: {"type":"response.failed","response":{"error":{"code":"context_length_exceeded"}}}',
    ].join("\n");
    const response = new Response(streamFromChunks([partial]), { status: 200 });

    const peek = await new CodexExecutor()._peekSseTransientError(response);

    expect(peek.contextOverflow).toBe(false);
    expect(peek.matched).toBeNull();
    await expect(new Response(peek.replacementBody).text()).resolves.toBe(partial);
  });

  it("keeps capacity, retry-overload, and fake-overload classifications unchanged", async () => {
    const capacity = new Response(streamFromText(
      'event: error\ndata: {"error":{"message":"Selected model is at capacity. Please try a different model."}}\n\n',
    ), { status: 200 });
    const retry = new Response(streamFromText(
      'event: error\ndata: {"error":{"code":"server_is_overloaded","message":"retry"}}\n\n',
    ), { status: 200 });
    const fakeOverload = new Response(streamFromText(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Our servers are currently overloaded. Please try again later."}\n\n',
    ), { status: 200 });

    await expect(new CodexExecutor()._peekSseTransientError(capacity)).resolves.toMatchObject({
      matched: "selected model is at capacity",
      accountFallback: true,
      contextOverflow: false,
    });
    await expect(new CodexExecutor()._peekSseTransientError(retry)).resolves.toMatchObject({
      matched: "server_is_overloaded",
      accountFallback: false,
      contextOverflow: false,
    });
    await expect(new CodexExecutor()._peekSseTransientError(fakeOverload)).resolves.toMatchObject({
      matched: "codex_overloaded_output",
      accountFallback: false,
      contextOverflow: false,
    });
  });

  it("treats 413 as terminal for account fallback, model fallback, and cooldown", async () => {
    const terminal = checkFallbackError(413, "maximum context length exceeded", 4, "codex");
    expect(terminal.shouldFallback).toBe(false); // no account fallback
    expect(terminal.cooldownMs).toBe(0); // no cooldown

    const attemptedModels = [];
    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["codex/first", "codex/second"],
      comboName: "codex-context-overflow-3386",
      handleSingleModel: async (_body, model) => {
        attemptedModels.push(model);
        return new Response(JSON.stringify(buildErrorBody(413, "maximum context length exceeded")), {
          status: 413,
          headers: { "Content-Type": "application/json" },
        });
      },
      log: { info() {}, warn() {}, debug() {}, error() {} },
    });

    expect(attemptedModels).toHaveLength(1); // no model fallback
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { type: "invalid_request_error", code: "context_length_exceeded" },
    });
  });

  it("reassembles normal SSE after peeking", async () => {
    const executor = new CodexExecutor();
    const text = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"OK"}\n\n';
    const response = new Response(streamFromText(text), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.matched).toBeNull();
    await expect(new Response(peek.replacementBody).text()).resolves.toBe(text);
  });
});
