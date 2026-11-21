import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const routedFetch = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const { PoeExecutor } = await import("../../open-sse/executors/poe.js");
  const executor = new PoeExecutor(routedFetch);
  return { ...original, getExecutor: (id) => id === "poe" ? executor : original.getExecutor(id) };
});
vi.mock("open-sse/utils/proxyFetch.js", async (importOriginal) => ({ ...(await importOriginal()), proxyAwareFetch: routedFetch }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { PoeExecutor } from "../../open-sse/executors/poe.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import provider from "../../open-sse/providers/registry/poe.js";

const KEY_A = "poe_synthetic_alpha";
const KEY_B = "poe_synthetic_beta";
const MODEL = "Grok-4";
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const completion = (content = "hello") => ({ id: "poe-test", choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
const claudeMessage = { id: "msg-poe", type: "message", role: "assistant", content: [{ type: "text", text: "hello" }], model: "claude-opus-4.8", stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } };
const claudeStream = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-poe","type":"message","role":"assistant","content":[],"model":"claude-opus-4.8","usage":{"input_tokens":3,"output_tokens":0}}}',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"chunk"}}',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
  'event: message_stop\ndata: {"type":"message_stop"}',
].join("\n\n") + "\n\n";

function chat(endpoint, body, apiKey = KEY_A) {
  return handleChatCore({ body, modelInfo: { provider: "poe", model: body.model }, credentials: { apiKey, id: "poe-test" },
    clientRawRequest: { endpoint, body, headers: {} }, sourceFormatOverride: endpoint === "/v1/messages" ? FORMATS.CLAUDE : FORMATS.OPENAI,
    connectionId: "poe-test", log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
}

describe("staged Poe provider", () => {
  afterEach(() => vi.clearAllMocks());

  it("composes the documented bearer transport and validates credentials", async () => {
    expect(REGISTRY.find((entry) => entry.id === "poe")).toBe(provider);
    expect(PROVIDERS.poe).toMatchObject({ baseUrl: "https://api.poe.com/v1/chat/completions", validateUrl: "https://api.poe.com/v1/models", messagesUrl: "https://api.poe.com/v1/messages" });
    expect(PROVIDER_MEDIA.poe.modelsFetcher).toEqual({ url: "https://api.poe.com/v1/models", type: "openai" });
    const valid = await probeRegistryProvider("poe", KEY_A, vi.fn(async () => json({ data: [{ id: MODEL }] })));
    expect(valid.valid).toBe(true);
    const invalid = await probeRegistryProvider("poe", KEY_B, vi.fn(async () => json({ error: "bad key" }, 401)));
    expect(invalid).toMatchObject({ valid: false, status: 401 });
  });

  it("discovers models and isolates keys for separate connections", async () => {
    routedFetch.mockResolvedValueOnce(json({ data: [{ id: MODEL }] })).mockResolvedValueOnce(json({ data: [{ id: "claude-opus-4.8" }] }));
    const first = await fetchConnectionModels({ id: "a", provider: "poe", apiKey: KEY_A });
    const second = await fetchConnectionModels({ id: "b", provider: "poe", apiKey: KEY_B });
    expect(first.models.map((row) => row.id)).toContain(MODEL);
    expect(second.models.map((row) => row.id)).toContain("claude-opus-4.8");
    expect(routedFetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${KEY_A}`);
    expect(routedFetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it.each(["/v1/chat/completions", "/v1/messages"])("serves JSON and streaming chat through %s", async (endpoint) => {
    routedFetch.mockResolvedValueOnce(json(endpoint === "/v1/messages" ? claudeMessage : completion()));
    const body = endpoint === "/v1/messages" ? { model: "claude-opus-4.8", max_tokens: 32, messages: [{ role: "user", content: "hi" }] }
      : { model: MODEL, messages: [{ role: "user", content: "hi" }] };
    const response = await chat(endpoint, body);
    const payload = await response.response.json();
    expect(endpoint === "/v1/messages" ? payload.content[0].text : payload.choices[0].message.content).toBe("hello");
    if (endpoint === "/v1/messages") expect(payload.usage).toEqual({ input_tokens: 3, output_tokens: 2 });
    else expect(payload.usage.completion_tokens).toBe(2);
    const [requestUrl, requestInit] = routedFetch.mock.calls.at(-1);
    expect(requestUrl).toBe(endpoint === "/v1/messages" ? "https://api.poe.com/v1/messages" : "https://api.poe.com/v1/chat/completions");
    if (endpoint === "/v1/messages") {
      expect(requestInit.headers["x-api-key"]).toBe(KEY_A);
      expect(requestInit.headers["anthropic-version"]).toBe("2023-06-01");
    }
    const openAIStream = `data: ${JSON.stringify({ choices: [{ delta: { content: "chunk" }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`;
    routedFetch.mockResolvedValueOnce(new Response(endpoint === "/v1/messages" ? claudeStream : openAIStream, { headers: { "content-type": "text/event-stream" } }));
    const streamed = await chat(endpoint, { ...body, stream: true });
    expect(await streamed.response.text()).toContain("chunk");
  });

  it("maps credential and quota responses and keeps per-connection chat keys", async () => {
    const executor = new DefaultExecutor("poe");
    routedFetch.mockResolvedValueOnce(json(completion()));
    const raw = await executor.execute({ model: MODEL, body: { model: MODEL, messages: [] }, stream: false, credentials: { apiKey: KEY_A } });
    expect((await raw.response.json()).usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
    routedFetch.mockResolvedValueOnce(json(completion())).mockResolvedValueOnce(json(completion()));
    await executor.execute({ model: MODEL, body: { model: MODEL, messages: [] }, stream: false, credentials: { apiKey: KEY_A } });
    await executor.execute({ model: MODEL, body: { model: MODEL, messages: [] }, stream: false, credentials: { apiKey: KEY_B } });
    expect(routedFetch.mock.calls.slice(-2).map(([, init]) => init.headers.Authorization)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    routedFetch.mockResolvedValueOnce(json({ error: "unauthorized" }, 401));
    expect((await executor.execute({ model: MODEL, body: {}, stream: false, credentials: { apiKey: KEY_A } })).response.status).toBe(401);
    routedFetch.mockResolvedValueOnce(json({ error: "insufficient quota" }, 429));
    expect((await executor.execute({ model: MODEL, body: {}, stream: false, credentials: { apiKey: KEY_A } })).response.status).toBe(429);
    routedFetch.mockResolvedValueOnce(json({ error: "payment required" }, 402));
    expect((await executor.execute({ model: MODEL, body: {}, stream: false, credentials: { apiKey: KEY_A } })).response.status).toBe(402);
    expect((await new PoeExecutor(routedFetch).execute({ model: "claude-opus-4.8", body: {}, stream: false, credentials: {} })).response.status).toBe(401);
  });

  it("defers proxyAwareFetch resolution until execute() when constructed without a custom fetcher", async () => {
    const executor = new PoeExecutor();
    expect(executor.fetcher).toBeNull();
    routedFetch.mockResolvedValueOnce(json(claudeMessage));
    const result = await executor.execute({
      model: "claude-opus-4.8",
      body: { model: "claude-opus-4.8", max_tokens: 32, messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: KEY_A },
    });
    expect(result.response.status).toBe(200);
    expect(routedFetch).toHaveBeenCalledTimes(1);
    expect(routedFetch.mock.calls[0][0]).toBe("https://api.poe.com/v1/messages");
  });
});
