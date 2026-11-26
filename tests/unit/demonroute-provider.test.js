import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: network.fetch }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "offline-fixture",
  updateKimchiUserAgent: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: vi.fn(), getProviderNodeById: vi.fn() }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({
  startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn(),
}));
vi.mock("../../open-sse/utils/requestLogger.js", async (original) => ({
  ...(await original()),
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  })),
}));

import "../translator/registerAll.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { saveRequestUsage } from "@/lib/usageDb.js";
import { isModelAutoSyncEnabled } from "../../src/lib/modelAutoSync/catalog.js";
import { isModelAutoSyncEligible } from "../../src/lib/modelAutoSync/runner.js";
import { POST as validate } from "../../src/app/api/providers/validate/route.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { parseModel } from "../../open-sse/services/model.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";

const key = "fixture-only-key";
const model = "TheDrummer/Artemis-31B-v1.2";
const connection = { id: "fixture", provider: "demonroute", apiKey: key };
const catalogUrl = "https://api.demonroute.com/v1/models";
const chatUrl = "https://api.demonroute.com/v1/chat/completions";
const usage = { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 };

function validateRequest() {
  return validate(new Request("http://localhost/api/providers/validate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "demonroute", apiKey: key }),
  }));
}

function execute(stream) {
  return new DefaultExecutor("demonroute").execute({
    model, stream, credentials: connection,
    body: { model, stream, messages: [{ role: "user", content: "Hello" }] },
    requestPolicy: { maxTransportAttempts: 1 },
  });
}

function chatCore(options = {}) {
  const body = { model, messages: [{ role: "user", content: "Hello" }], stream: false, ...(options.body || {}) };
  return handleChatCore({
    ...options,
    body,
    modelInfo: { provider: "demonroute", model: body.model },
    credentials: connection,
    clientRawRequest: options.clientRawRequest || { endpoint: "/v1/chat/completions", body, headers: {} },
    connectionId: connection.id,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    rtkEnabled: false, headroomEnabled: false, compressionEnabled: false,
  });
}

beforeEach(() => {
  network.fetch.mockReset();
  // Any route that reaches the network outside the mocked transports fails loudly.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
  vi.mocked(saveRequestUsage).mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("DemonRoute offline provider routes", () => {
  it("registers API-key discovery and preserves case-sensitive nested model ids", () => {
    expect(AI_PROVIDERS.demonroute.modelsFetcher.url).toBe(catalogUrl);
    expect(parseModel(`demonroute/${model}`)).toMatchObject({ provider: "demonroute", model });
  });

  it("validates and discovers the account catalog using the supplied key", async () => {
    fetch.mockResolvedValue(Response.json({ data: [{ id: model }] }));
    network.fetch.mockResolvedValue(Response.json({ data: [{ id: model }] }));
    expect(await (await validateRequest()).json()).toEqual({ valid: true, error: null });
    expect((await fetchConnectionModels(connection)).models).toEqual([{ id: model }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(network.fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(catalogUrl);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${key}`);
    expect(network.fetch.mock.calls[0][0]).toBe(catalogUrl);
    expect(network.fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${key}`);
  });

  it("never uses provider-wide auto-sync for an account-scoped catalog", () => {
    expect(isModelAutoSyncEligible("demonroute")).toBe(false);
    expect(isModelAutoSyncEnabled("demonroute", { modelAutoSyncProviders: { demonroute: true } })).toBe(false);
  });

  it.each([false, true])("sends chat requests and preserves reported usage (stream=%s)", async (stream) => {
    const completion = { id: "fixture", choices: [], usage };
    const wire = `data: ${JSON.stringify(completion)}\n\ndata: [DONE]\n\n`;
    network.fetch.mockResolvedValue(stream
      ? new Response(wire, { headers: { "Content-Type": "text/event-stream" } })
      : Response.json(completion));
    const result = await execute(stream);
    const [url, init] = network.fetch.mock.calls[0];
    expect(url).toBe(chatUrl);
    expect(init.headers.Authorization).toBe(`Bearer ${key}`);
    expect(JSON.parse(init.body)).toMatchObject({ model, stream });
    if (stream) expect(await result.response.text()).toBe(wire);
    else expect(await result.response.json()).toEqual(completion);
  });

  it.each([401, 429])("preserves catalog and upstream chat HTTP %s", async (status) => {
    const error = { error: { message: "fixture rejection" } };
    network.fetch.mockImplementation(async () => Response.json(error, { status }));
    expect((await fetchConnectionModels(connection)).status).toBe(status);
    const result = await execute(false);
    expect(result.response.status).toBe(status);
    expect(await result.response.json()).toEqual(error);
  });
});

describe("DemonRoute chat route", () => {
  it("preserves upstream usage through chatCore and accounts it", async () => {
    const completion = { id: "fixture", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }], usage };
    network.fetch.mockResolvedValue(new Response(JSON.stringify(completion), { headers: { "content-type": "application/json" } }));
    const result = await chatCore();
    expect(result.success).toBe(true);
    const output = await result.response.json();
    // The non-streaming path adds the gateway's standard context buffer to the
    // prompt side, so the upstream's reported completion tokens stay exact and
    // the prompt side only grows.
    expect(output.usage.completion_tokens).toBe(usage.completion_tokens);
    expect(output.usage.prompt_tokens).toBeGreaterThanOrEqual(usage.prompt_tokens);
    expect(JSON.parse(network.fetch.mock.calls[0][1].body).model).toBe(model);
    await vi.waitFor(() => expect(saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      provider: "demonroute", model, connectionId: connection.id,
      tokens: expect.objectContaining({ prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens }),
    })));
  });

  it("preserves upstream usage on the streaming path", async () => {
    const sse = `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model, choices: [], usage })}\n\ndata: [DONE]\n\n`;
    network.fetch.mockResolvedValue(new Response(sse, { headers: { "content-type": "text/event-stream" } }));
    const result = await chatCore({ body: { stream: true, stream_options: { include_usage: true } } });
    expect(result.success).toBe(true);
    const output = await result.response.text();
    expect(output).toContain('"prompt_tokens":8');
    expect(output).toContain('"completion_tokens":4');
  });

  it("translates a Claude message through the OpenAI-compatible chat path", async () => {
    network.fetch.mockResolvedValue(Response.json({
      id: "fixture", object: "chat.completion", model,
      choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
      usage,
    }));
    const result = await chatCore({
      body: { max_tokens: 32, stream: false },
      sourceFormatOverride: "claude",
      clientRawRequest: { endpoint: "/v1/messages", body: { model, max_tokens: 32, messages: [{ role: "user", content: "Hello" }], stream: false }, headers: {} },
    });
    expect(result.success).toBe(true);
    const wire = JSON.parse(network.fetch.mock.calls[0][1].body);
    expect(wire).toMatchObject({ model, messages: [{ role: "user", content: "Hello" }] });
    const output = await result.response.json();
    expect(output.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: "hello" })]));
    expect(output.usage).toMatchObject({ input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens });
  });

  it.each([401, 429])("preserves chat upstream status %s", async (status) => {
    network.fetch.mockResolvedValue(Response.json({ error: { message: "fixture rejection", type: "fixture" } }, { status }));
    const result = await chatCore();
    expect(result.response.status).toBe(status);
  });
});
