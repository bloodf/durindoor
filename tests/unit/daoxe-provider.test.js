import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.hoisted(() => vi.stubGlobal("fetch", vi.fn()));
vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "fixture", updateKimchiUserAgent: vi.fn() }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));
vi.mock("../../open-sse/utils/requestLogger.js", async (original) => ({ ...(await original()), createRequestLogger: vi.fn(async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() })) }));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { APIKEY_PROVIDERS, isRoutableProvider } from "../../src/shared/constants/providers.js";
import { parseModel } from "../../open-sse/services/model.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { saveRequestUsage } from "@/lib/usageDb.js";
import { POST as validate } from "../../src/app/api/providers/validate/route.js";

const connection = { id: "fixture", provider: "daoxe", apiKey: "synthetic-key" };
const model = "vendor/model:exact";
beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); proxyAwareFetch.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe("DaoXE offline provider contract", () => {
  it("exposes an API-key provider and retains complete model IDs", () => {
    expect(APIKEY_PROVIDERS.daoxe).toBeDefined();
    expect(isRoutableProvider("daoxe")).toBe(true);
    expect(parseModel(`daoxe/${model}`)).toMatchObject({ provider: "daoxe", model });
  });
  it.each([[200, true], [401, false]])("validates the key using the models endpoint: %i", async (status, valid) => {
    fetch.mockResolvedValueOnce(new Response("{}", { status }));
    const request = new Request("http://localhost/api/providers/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "daoxe", apiKey: connection.apiKey }) });
    expect((await (await validate(request)).json()).valid).toBe(valid);
    expect(fetch).toHaveBeenCalledWith("https://api.daoxe.com/v1/models", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer synthetic-key" }) }));
  });
  it("discovers the key-scoped catalog", async () => {
    proxyAwareFetch.mockResolvedValueOnce(Response.json({ data: [{ id: model }] }));
    expect(await fetchConnectionModels(connection)).toMatchObject({ models: [{ id: model }] });
    expect(proxyAwareFetch).toHaveBeenCalledWith("https://api.daoxe.com/v1/models", expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Authorization: "Bearer synthetic-key" }) }), expect.anything());
  });
  it.each([401, 403, 503])("reports discovery status %i", async (status) => {
    proxyAwareFetch.mockResolvedValueOnce(new Response("error", { status }));
    expect(await fetchConnectionModels(connection)).toEqual({ error: `Failed to fetch models: ${status}`, status });
  });
  it.each([false, true])("routes chat through the standard gateway, stream=%s", async (stream) => {
    const body = { model, messages: [{ role: "user", content: "hello" }], stream };
    const response = stream
      ? new Response('data: {"id":"fixture","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } })
      : Response.json({ id: "fixture", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } });
    proxyAwareFetch.mockResolvedValueOnce(response);
    const result = await handleChatCore({ body, modelInfo: { provider: "daoxe", model }, credentials: connection, clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, connectionId: connection.id, log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
    expect(result.success).toBe(true);
    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.daoxe.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer synthetic-key");
    expect(JSON.parse(init.body)).toMatchObject(body);
    expect(await result.response.text()).toContain("hi");
    expect(fetch).not.toHaveBeenCalled();
    if (!stream) expect(saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: "daoxe", model, tokens: expect.objectContaining({ prompt_tokens: 2, completion_tokens: 1 }) }));
  });
  it("translates a Messages request and response through OpenAI chat", async () => {
    proxyAwareFetch.mockResolvedValueOnce(Response.json({ id: "fixture", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content: "translated reply" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
    const body = { model, max_tokens: 64, messages: [{ role: "user", content: "hello" }], stream: false };
    const result = await handleChatCore({ body, modelInfo: { provider: "daoxe", model }, credentials: connection, clientRawRequest: { endpoint: "/v1/messages", body, headers: {} }, connectionId: connection.id, log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
    expect(result.success).toBe(true);
    const wire = JSON.parse(proxyAwareFetch.mock.calls[0][1].body);
    expect(wire.model).toBe(model);
    expect(wire.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "user", content: "hello" })]));
    expect(await result.response.text()).toContain("translated reply");
  });
  it.each([403, 503])("preserves model-group failure %i", async (status) => {
    proxyAwareFetch.mockImplementation(async () => new Response(JSON.stringify({ error: { message: "no available channel for model in group" } }), { status, headers: { "Content-Type": "application/json" } }));
    const body = { model, messages: [{ role: "user", content: "hello" }], stream: false };
    const result = await handleChatCore({ body, modelInfo: { provider: "daoxe", model }, credentials: connection, clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, connectionId: connection.id, log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(status);
    expect(await result.response.text()).toContain("no available channel for model in group");
  });
});
