// Expose bugs caused by OpenAI being the intermediate format: data lost/wrong on source → openai → target.
// Each test describes the EXPECTED-correct behavior. A FAIL is evidence of the bug (with source file:line).
import { describe, it, expect, vi } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { MimocodeExecutor } from "../../open-sse/executors/mimocode.js";
import { CliproxyapiExecutor, clearCliproxyapiUrlCache } from "../../open-sse/executors/cliproxyapi.js";
import { MimoFreeExecutor, __test__ as mimoFreeTest } from "../../open-sse/executors/mimo-free.js";
import { TheOldLlmExecutor } from "../../open-sse/executors/theoldllm.js";
import { openAIToBedrockConverse } from "../../open-sse/executors/bedrock.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";
import { VertexExecutor } from "../../open-sse/executors/vertex.js";
import { QoderExecutor } from "../../open-sse/executors/qoder.js";
import { XiaomiMimoExecutor } from "../../open-sse/executors/xiaomi-mimo.js";
import { getMimoAccountCookie } from "../../open-sse/shared/mimoAccount.js";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ cliproxyapi_url: "http://sidecar.invalid" }) }));
vi.mock("../../open-sse/shared/mimoAccount.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getMimoAccountCookie: vi.fn(),
  invalidateMimoAccountCookieCache: vi.fn(),
}));
vi.mock("../../open-sse/services/qoderModels.js", () => ({
  getQoderModelConfig: vi.fn(async () => ({ key: "auto", max_output_tokens: 8192 })),
  resolveQoderModels: vi.fn(),
}));

const T = (src, tgt, body, provider = null) =>
  translateRequest(src, tgt, "m", body, true, null, provider);

describe("bug: Claude → OpenAI bridge data loss", () => {
  // claude-to-openai.js — a URL image source maps to an image_url part.
  it("image with source.type=url is preserved (NOT dropped)", () => {
    const out = T(FORMATS.CLAUDE, FORMATS.OPENAI, {
      messages: [{ role: "user", content: [
        { type: "text", text: "look" },
        { type: "image", source: { type: "url", url: "https://x.com/a.png" } },
      ] }],
    });
    const json = JSON.stringify(out);
    expect(json, "remote image url silently dropped").toContain("a.png");
  });

  // claude-to-openai.js:128 switch — missing thinking/redacted_thinking case
  it("thinking block survives round-trip Claude→OpenAI→Claude", () => {
    const body = {
      messages: [{ role: "assistant", content: [
        { type: "thinking", thinking: "secret reasoning", signature: "sig" },
        { type: "text", text: "answer" },
      ] }, { role: "user", content: "go" }],
    };
    const out = T(FORMATS.CLAUDE, FORMATS.CLAUDE, body);
    const json = JSON.stringify(out);
    expect(json, "thinking content lost via OpenAI bridge").toContain("secret reasoning");
  });

  // Nested tool-result images must not become raw JSON / a data URI leak.
  it("tool_result with image block is not turned into raw JSON / dropped", () => {
    const payload = "ZZZ".repeat(1000);
    const out = T(FORMATS.CLAUDE, FORMATS.OPENAI, {
      messages: [
        { role: "assistant", content: [
          { type: "tool_use", id: "call_1", name: "shot", input: {} },
        ] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "call_1", content: [
            { type: "text", text: "captured screenshot" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: payload } },
          ] },
        ] },
      ],
    });
    const toolMsg = out.messages.find((m) => m.role === "tool");
    const json = JSON.stringify(out);
    expect(toolMsg?.content, "keeps surrounding text").toContain("captured screenshot");
    expect(toolMsg?.content, "image turned into raw JSON").not.toMatch(/^\[/);
    expect(toolMsg?.content, "placeholder names the media").toContain("image/png");
    expect(json, "base64 payload leaked into request").not.toContain(payload);
  });

  it("serializes failed tool results without leaking bridge metadata to OpenAI", async () => {
    const body = T(FORMATS.CLAUDE, FORMATS.OPENAI, {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "f", input: {} }] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "call_1", is_error: true, content: "boom" },
        ] },
      ],
    });
    fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
    const executor = new BaseExecutor("openai", { format: FORMATS.OPENAI, baseUrl: "https://wire.invalid/v1/chat/completions" });
    await executor.execute({ model: "m", body, stream: false, credentials: {} });
    const wire = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(wire.messages.find((m) => m.role === "tool")).toEqual({
      role: "tool", tool_call_id: "call_1", content: "[Tool error]\nboom",
    });
    expect(body.messages.find((m) => m.role === "tool")).toMatchObject({ is_error: true, content: "boom" });
  });

  it.each([401, 403])("cleans Mimocode tool errors on initial dispatch and auth retry after %s", async (status) => {
    const body = { messages: [
      { role: "tool", tool_call_id: "e", is_error: true, content: "boom" },
      { role: "tool", tool_call_id: "a", is_error: true, content: [{ type: "text", text: "failed command" }] },
      { role: "tool", tool_call_id: "s", is_error: false, content: "ok" },
    ] };
    const original = structuredClone(body);
    const executor = new MimocodeExecutor();
    executor.getJwtForAccount = vi.fn().mockResolvedValueOnce("old-jwt").mockResolvedValueOnce("new-jwt");
    const calls = [];
    executor.fetchWithProxy = vi.fn(async (url, init) => {
      calls.push({ url, authorization: init.headers.Authorization, body: JSON.parse(init.body) });
      return new Response("{}", { status: calls.length === 1 ? status : 200 });
    });

    const result = await executor.execute({ model: "mimo-auto", body, stream: false, credentials: {} });

    expect(result.response.status).toBe(200);
    expect(calls.map((call) => call.authorization)).toEqual(["Bearer old-jwt", "Bearer new-jwt"]);
    for (const call of calls) {
      expect(call.body.messages.filter((message) => message.role === "tool")).toEqual([
        { role: "tool", tool_call_id: "e", content: "[Tool error]\nboom" },
        { role: "tool", tool_call_id: "a", content: [{ type: "text", text: "[Tool error]" }, { type: "text", text: "failed command" }] },
        { role: "tool", tool_call_id: "s", content: "ok" },
      ]);
    }
    expect(body).toEqual(original);
    expect(result.transformedBody.messages.filter((message) => message.role === "tool")).toEqual(original.messages);
  });

  it.each([
    ["cliproxyapi", 200],
    ["mimo-free", 200],
    ["mimo-free", 401],
    ["mimo-free", 403],
    ["theoldllm", 200],
    ["theoldllm", 401],
    ["theoldllm", 403],
  ])("preserves tool failure meaning on %s wire and retry after %s", async (provider, status) => {
    const body = { messages: [
      { role: "tool", tool_call_id: "e", is_error: true, content: "boom" },
      { role: "tool", tool_call_id: "a", is_error: true, content: [{ type: "text", text: "failed command" }] },
      { role: "tool", tool_call_id: "s", is_error: false, content: "ok" },
      { role: "tool", tool_call_id: "u", content: "unchanged" },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "native", is_error: true, content: "native error" }] },
    ] };
    const original = structuredClone(body);
    const calls = [];
    let bootstraps = 0;
    const mockFetch = async (url, init) => {
      if (url === mimoFreeTest.BOOTSTRAP_URL) {
        bootstraps += 1;
        return Response.json({ jwt: `jwt-${bootstraps}` });
      }
      calls.push({ url, authorization: init.headers.Authorization, body: JSON.parse(init.body) });
      return new Response('data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n', {
        status: calls.length === 1 ? status : 200,
      });
    };
    fetchMock.mockReset().mockImplementation(mockFetch);
    const directFetch = vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);
    mimoFreeTest.resetJwtCache();
    clearCliproxyapiUrlCache();
    try {
      const executor = provider === "cliproxyapi" ? new CliproxyapiExecutor() :
        provider === "mimo-free" ? new MimoFreeExecutor() : new TheOldLlmExecutor();
      const result = await executor.execute({ model: "gpt-5.4", body, stream: false, credentials: {} });
      expect(result.response.status).toBe(200);
      expect(calls).toHaveLength(status === 200 ? 1 : 2);
      for (const call of calls) {
        expect(call.body.messages.filter((message) => message.role === "tool")).toEqual([
          { role: "tool", tool_call_id: "e", content: "[Tool error]\nboom" },
          { role: "tool", tool_call_id: "a", content: [{ type: "text", text: "[Tool error]" }, { type: "text", text: "failed command" }] },
          { role: "tool", tool_call_id: "s", content: "ok" },
          { role: "tool", tool_call_id: "u", content: "unchanged" },
        ]);
        expect(call.body.messages.find((message) => message.role === "user")).toEqual(original.messages[4]);
      }
      if (provider === "mimo-free") {
        expect(bootstraps).toBe(calls.length);
        expect(calls.map((call) => call.authorization)).toEqual(status === 200 ?
          ["Bearer jwt-1"] : ["Bearer jwt-1", "Bearer jwt-2"]);
      }
      expect(body).toEqual(original);
      expect(result.transformedBody.messages.filter((message) => message.role !== "system")).toEqual(original.messages);
    } finally {
      directFetch.mockRestore();
      fetchMock.mockReset();
      mimoFreeTest.resetJwtCache();
      clearCliproxyapiUrlCache();
    }
  });

  it.each(["vertex-partner", "vertex"])("cleans only the Vertex partner wire: %s", async (provider) => {
    const body = provider === "vertex-partner" ? { messages: [
      { role: "tool", tool_call_id: "e", is_error: true, content: "boom" },
      { role: "tool", tool_call_id: "s", is_error: false, content: "ok" },
    ] } : { contents: [{ role: "user", parts: [
      { functionResponse: { name: "run", response: { is_error: true, error: "boom" } } },
    ] }] };
    const original = structuredClone(body);
    fetchMock.mockReset().mockResolvedValue(Response.json({}));
    const result = await new VertexExecutor(provider).execute({
      model: "m", body, stream: false,
      credentials: { accessToken: "token", providerSpecificData: { projectId: "project" } },
    });
    const wire = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(wire).toEqual(provider === "vertex-partner" ? { messages: [
      { role: "tool", tool_call_id: "e", content: "[Tool error]\nboom" },
      { role: "tool", tool_call_id: "s", content: "ok" },
    ] } : original);
    expect(body).toEqual(original);
    expect(result.transformedBody).toEqual(original);
  });

  it.each(["qoder", "qoder-cn"])("cleans %s encoded bytes on initial dispatch and caller retry", async (provider) => {
    const body = { messages: [
      { role: "tool", tool_call_id: "e", is_error: true, content: "boom" },
      { role: "tool", tool_call_id: "a", is_error: true, content: [{ type: "text", text: "failed command" }] },
      { role: "tool", tool_call_id: "s", is_error: false, content: "ok" },
    ] };
    const original = structuredClone(body);
    // Decode captured transport bytes, not a mocked encoder or pre-wire payload.
    const decode = (bytes) => {
      const standard = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
      const custom = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!$";
      const shuffled = [...bytes.toString("latin1")].map((c) => standard[custom.indexOf(c)]).join("");
      const third = Math.floor(shuffled.length / 3);
      const base64 = shuffled.slice(-third) + shuffled.slice(third, -third) + shuffled.slice(0, third);
      return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
    };
    // Qoder does not retry internally: the caller re-enters execute with fresh signing.
    fetchMock.mockReset().mockImplementation(async () => Response.json({ error: "retry" }, { status: 401 }));
    const executor = new QoderExecutor(provider);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await executor.execute({ model: "auto", body, stream: true,
        credentials: { accessToken: "dt-test", providerSpecificData: { userId: "test-user" } },
      });
      expect(result.response.status).toBe(401);
      expect(result.transformedBody.messages).toEqual([
        original.messages[0], { ...original.messages[1], content: "failed command" }, original.messages[2],
      ]);
    }
    expect(fetchMock.mock.calls).toHaveLength(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(decode(init.body).messages).toEqual([
        { role: "tool", tool_call_id: "e", content: "[Tool error]\nboom" },
        { role: "tool", tool_call_id: "a", content: "[Tool error]\nfailed command" },
        { role: "tool", tool_call_id: "s", content: "ok" },
      ]);
    }
    expect(body).toEqual(original);
  });

  // Account models declare OpenAI-only support; the inherited wire cleanup
  // already covers their Chat Completions route, including cookie refresh.
  it("cleans Xiaomi account initial and retry wire through the inherited path", async () => {
    const body = { messages: [
      { role: "tool", tool_call_id: "e", is_error: true, content: "boom" },
      { role: "tool", tool_call_id: "a", is_error: true, content: [{ type: "text", text: "failed command" }] },
      { role: "tool", tool_call_id: "s", is_error: false, content: "ok" },
    ] };
    const originalMessages = structuredClone(body.messages);
    getMimoAccountCookie.mockReset().mockResolvedValueOnce("old-cookie").mockResolvedValueOnce("new-cookie");
    fetchMock.mockReset().mockResolvedValueOnce(Response.json({}, { status: 401 })).mockResolvedValueOnce(Response.json({}));
    const result = await new XiaomiMimoExecutor().execute({
      model: "mimo-v2.6-pro", body, stream: false,
      credentials: { providerSpecificData: { mimoPassToken: "token" },
        runtimeTransport: { format: FORMATS.OPENAI, baseUrl: "https://cloud.invalid/v1/chat/completions" } },
    });
    expect(result.response.status).toBe(200);
    expect(fetchMock.mock.calls.map(([, init]) => init.headers.Cookie)).toEqual(["old-cookie", "new-cookie"]);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(new URL(url).pathname).toBe("/api/route/chat/completions");
      expect(JSON.parse(init.body).messages).toEqual([
        { role: "tool", tool_call_id: "e", content: "[Tool error]\nboom" },
        { role: "tool", tool_call_id: "a", content: [{ type: "text", text: "[Tool error]" }, { type: "text", text: "failed command" }] },
        { role: "tool", tool_call_id: "s", content: "ok" },
      ]);
    }
    expect(body.messages).toEqual(originalMessages);
    expect(result.transformedBody.messages).toEqual([
      { role: "tool", tool_call_id: "e", content: "[Tool error]\nboom" },
      { role: "tool", tool_call_id: "a", content: [{ type: "text", text: "[Tool error]" }, { type: "text", text: "failed command" }] },
      { role: "tool", tool_call_id: "s", content: "ok" },
    ]);
  });

  it("leaves Xiaomi native Claude cloud tool results unchanged", async () => {
    const body = { messages: [{ role: "user", content: [
      { type: "tool_result", tool_use_id: "e", is_error: true, content: "boom" },
    ] }] };
    const originalMessages = structuredClone(body.messages);
    getMimoAccountCookie.mockReset().mockResolvedValue(null);
    fetchMock.mockReset().mockResolvedValue(Response.json({}));
    await new XiaomiMimoExecutor().execute({ model: "mimo-v2.5-pro", body, stream: false,
      credentials: { apiKey: "key", providerSpecificData: { mimoPassToken: "token" },
        runtimeTransport: { format: FORMATS.CLAUDE, baseUrl: "https://cloud.invalid/v1/messages" } },
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://cloud.invalid/v1/messages");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages).toEqual(originalMessages);
  });

  it.each([
    ["openai", {}, "/v1/chat/completions", true],
    ["azure", {}, "/openai/deployments/gpt-4/chat/completions?api-version=2024-10-01-preview", true],
    ["groq", {}, "/openai/v1/chat/completions", true],
    ["openai-compatible-responses-test", { providerSpecificData: { apiType: "chat" } }, "/unused", true],
    ["openai-compatible-test", { providerSpecificData: { apiType: "responses" } }, "/unused", false],
    ["minimax", { runtimeTransport: { format: "openai-apikey" } }, "/custom", true],
    ["custom", { runtimeTransport: { format: "openai-oauth" } }, "/custom", true],
    ["openai", { runtimeTransport: { format: "claude" } }, "/v1/chat/completions", false],
    ["openai", { runtimeTransport: { format: "openai-responses" } }, "/v1/chat/completions", false],
    ["anthropic-compatible-test", {}, "/v1/messages", false],
    ["unknown-provider", {}, "/native", false],
    ["kiro", {}, "/generateAssistantResponse", false],
    ["commandcode", {}, "/alpha/generate", false],
    ["unknown-provider", {}, "/native?redirect=/chat/completions", false],
    ["bedrock", {}, "/model/m/converse", false],
  ])("uses resolved wire contract: %s %j %s", async (provider, credentials, path, converts) => {
    const body = { messages: [
      { role: "tool", tool_call_id: "e", is_error: true, content: [{ type: "text", text: "boom" }] },
      { role: "tool", tool_call_id: "s", is_error: false, content: "ok" },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "native", is_error: true, content: "native error" }] },
    ] };
    fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
    const executor = new BaseExecutor(provider, { format: FORMATS.OPENAI, baseUrl: `https://wire.invalid${path}` });
    await executor.execute({ model: "m", body, stream: false, credentials });
    const wire = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(wire.messages).toEqual(converts ? [
      { role: "tool", tool_call_id: "e", content: [{ type: "text", text: "[Tool error]" }, { type: "text", text: "boom" }] },
      { role: "tool", tool_call_id: "s", content: "ok" },
      body.messages[2],
    ] : body.messages);
    expect(body.messages[0].is_error).toBe(true);
  });

  it.each(["openai", "claude-blocks", "claude-direct"])("preserves Kiro error status and salvage through %s", (route) => {
    const results = [
      { id: "e", content: "boom", is_error: true },
      { id: "s", content: "ok" },
      { id: "f", content: "fine", is_error: false },
    ];
    const messages = route === "openai" ? [
      { role: "assistant", tool_calls: results.map(({ id }) => ({ id, type: "function", function: { name: "run", arguments: "{}" } })) },
      ...results.map(({ id, ...result }) => ({ role: "tool", tool_call_id: id, ...result })),
    ] : [
      { role: "assistant", content: results.map(({ id }) => ({ type: "tool_use", id, name: "run", input: {} })) },
      { role: "user", content: results.map(({ id, ...result }) => ({ type: "tool_result", tool_use_id: id, ...result })) },
    ];
    const tools = route === "claude-direct" ? [{ name: "run", input_schema: { type: "object" } }] :
      [{ type: "function", function: { name: "run", parameters: { type: "object" } } }];
    const translate = route === "claude-direct" ? claudeToKiroRequest : openaiToKiroRequest;
    const body = { messages, tools };
    const original = structuredClone(body);
    const native = translate("claude-sonnet-4.6", body, false, {});
    expect(native.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults).toEqual([
      { toolUseId: "e", status: "error", content: [{ text: "boom" }] },
      { toolUseId: "s", status: "success", content: [{ text: "ok" }] },
      { toolUseId: "f", status: "success", content: [{ text: "fine" }] },
    ]);
    for (const salvagedBody of [{ messages, tools: [] }, { messages: messages.slice(1), tools }]) {
      const state = translate("claude-sonnet-4.6", salvagedBody, false, {}).conversationState;
      const carriers = [...(state.history || []), state.currentMessage];
      const text = carriers.map((item) => item.userInputMessage?.content || "").join("\n");
      expect(text).toContain("[Tool error: boom]");
      expect(text).toContain("[Tool result: ok]");
      expect(text).toContain("[Tool result: fine]");
      expect(carriers.flatMap((item) => item.userInputMessage?.userInputMessageContext?.toolResults || [])).toEqual([]);
    }
    expect(body).toEqual(original);
  });

  it("maps bridged CommandCode failures to error-text without changing successes", () => {
    const out = T(FORMATS.CLAUDE, FORMATS.COMMANDCODE, {
      messages: [
        { role: "assistant", content: ["e", "s", "f"].map((id) => ({ type: "tool_use", id, name: "run", input: {} })) },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "e", is_error: true, content: "boom" },
          { type: "tool_result", tool_use_id: "s", content: "ok" },
          { type: "tool_result", tool_use_id: "f", is_error: false, content: "fine" },
        ] },
      ],
    });
    expect(out.params.messages.filter((m) => m.role === "tool").flatMap((m) => m.content)).toEqual([
      { type: "tool-result", toolCallId: "e", toolName: "run", output: { type: "error-text", value: "boom" } },
      { type: "tool-result", toolCallId: "s", toolName: "run", output: { type: "text", value: "ok" } },
      { type: "tool-result", toolCallId: "f", toolName: "run", output: { type: "text", value: "fine" } },
    ]);
  });

  it.each([FORMATS.OPENAI, FORMATS.CLAUDE])("retains internal tool errors on same-format %s translation", (format) => {
    const body = { messages: format === FORMATS.OPENAI ? [
      { role: "assistant", tool_calls: [{ id: "e", type: "function", function: { name: "run", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "e", is_error: true, content: "boom" },
    ] : [
      { role: "assistant", content: [{ type: "tool_use", id: "e", name: "run", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "e", is_error: true, content: "boom" }] },
    ] };
    const out = T(format, format, body);
    const result = format === FORMATS.OPENAI ? out.messages.find((m) => m.role === "tool") :
      out.messages.flatMap((m) => m.content).find((b) => b.type === "tool_result");
    expect(result).toMatchObject({ is_error: true, content: "boom" });
  });

  it("maps bridged errors and successes to Bedrock native tool status", () => {
    const bridge = T(FORMATS.CLAUDE, FORMATS.OPENAI, {
      messages: [
        { role: "assistant", content: ["e", "s", "f"].map((id) => ({ type: "tool_use", id, name: "run", input: {} })) },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "e", is_error: true, content: "boom" },
          { type: "tool_result", tool_use_id: "s", content: "ok" },
          { type: "tool_result", tool_use_id: "f", is_error: false, content: "fine" },
        ] },
      ],
    });
    const native = openAIToBedrockConverse("m", { ...bridge, messages: bridge.messages.map((m) => ({ ...m })) });
    const results = native.messages.flatMap((m) => m.content).filter((b) => b.toolResult).map((b) => b.toolResult);
    expect(results).toEqual([
      { toolUseId: "e", status: "error", content: [{ text: "boom" }] },
      { toolUseId: "s", status: "success", content: [{ text: "ok" }] },
      { toolUseId: "f", status: "success", content: [{ text: "fine" }] },
    ]);
  });

  it("tool_result is_error flag sits on the tool message, not on success results", () => {
    const out = T(FORMATS.CLAUDE, FORMATS.OPENAI, {
      messages: [
        { role: "assistant", content: [
          { type: "tool_use", id: "c1", name: "f", input: {} },
          { type: "tool_use", id: "c2", name: "g", input: {} },
          { type: "tool_use", id: "c3", name: "h", input: {} },
        ] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "c1", is_error: true, content: "boom" },
          { type: "tool_result", tool_use_id: "c2", content: "ok" },
          { type: "tool_result", tool_use_id: "c3", is_error: false, content: "fine" },
        ] },
      ],
    });
    const tools = out.messages.filter((m) => m.role === "tool");
    expect(tools.find((m) => m.tool_call_id === "c1").is_error).toBe(true);
    expect("is_error" in tools.find((m) => m.tool_call_id === "c2")).toBe(false);
    expect("is_error" in tools.find((m) => m.tool_call_id === "c3")).toBe(false);
  });

  it("OpenAI tool message is_error:true round-trips to Claude tool_result is_error", () => {
    const out = T(FORMATS.OPENAI, FORMATS.CLAUDE, {
      messages: [
        { role: "assistant", content: null, tool_calls: [
          { id: "c1", type: "function", function: { name: "f", arguments: "{}" } },
          { id: "c2", type: "function", function: { name: "g", arguments: "{}" } },
        ] },
        { role: "tool", tool_call_id: "c1", is_error: true, content: "boom" },
        { role: "tool", tool_call_id: "c2", content: "ok" },
      ],
    });
    const results = out.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((b) => b.type === "tool_result");
    expect(results.find((b) => b.tool_use_id === "c1").is_error).toBe(true);
    expect("is_error" in results.find((b) => b.tool_use_id === "c2")).toBe(false);
  });

  // claude-to-openai.js:24-27 — system array only takes .text, drops cache_control/non-text
  it("system array non-text parts are not silently dropped", () => {
    const out = T(FORMATS.CLAUDE, FORMATS.OPENAI, {
      system: [
        { type: "text", text: "rule1", cache_control: { type: "ephemeral" } },
        { type: "text", text: "rule2" },
      ],
      messages: [{ role: "user", content: "hi" }],
    });
    const sys = out.messages.find((m) => m.role === "system");
    expect(sys?.content).toContain("rule1");
    expect(sys?.content).toContain("rule2");
  });
});

describe("bug: tool_call id stability across bridge", () => {
  // toolCallHelper.js:29-31 — sanitize changes tc.id but tool_call_id in another message may drift
  it("sanitized tool id stays matched between call and result", () => {
    const out = T(FORMATS.OPENAI, FORMATS.OPENAI, {
      messages: [
        { role: "assistant", tool_calls: [
          { id: "call/with:bad*chars", type: "function", function: { name: "f", arguments: "{}" } },
        ] },
        { role: "tool", tool_call_id: "call/with:bad*chars", content: "ok" },
      ],
    });
    const asst = out.messages.find((m) => m.role === "assistant");
    const tool = out.messages.find((m) => m.role === "tool");
    expect(tool.tool_call_id, "id mismatch after sanitize").toBe(asst.tool_calls[0].id);
  });
});

describe("bug: empty content message handling", () => {
  // openaiHelper.js:49-51,66-71 — empty content → {text:""} then filtered out
  it("assistant message with only tool_calls is not dropped", () => {
    const out = T(FORMATS.OPENAI, FORMATS.OPENAI, {
      messages: [
        { role: "user", content: "do it" },
        { role: "assistant", content: "", tool_calls: [
          { id: "call_1", type: "function", function: { name: "f", arguments: "{}" } },
        ] },
        { role: "tool", tool_call_id: "call_1", content: "done" },
      ],
    });
    const asst = out.messages.find((m) => m.role === "assistant" && m.tool_calls);
    expect(asst, "assistant tool_calls message dropped").toBeTruthy();
  });
});
