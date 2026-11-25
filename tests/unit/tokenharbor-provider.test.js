import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: network.fetch }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));

vi.mock("@/lib/localDb", () => ({ getProviderNodeById: vi.fn() }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));
vi.mock("../../open-sse/utils/requestLogger.js", async (original) => ({
  ...(await original()), createRequestLogger: vi.fn(async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() })),
}));
import "../translator/registerAll.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { saveRequestUsage } from "@/lib/usageDb.js";
import { isModelAutoSyncEnabled } from "../../src/lib/modelAutoSync/catalog.js";
import { isModelAutoSyncEligible } from "../../src/lib/modelAutoSync/runner.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { parseModel } from "../../open-sse/services/model.js";
import { POST as validate } from "../../src/app/api/providers/validate/route.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

const connection = { id: "fixture", provider: "tokenharbor", apiKey: "synthetic-key" };
beforeEach(() => {
  network.fetch.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access"); }));
  vi.mocked(saveRequestUsage).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("Token Harbor", () => {
  it("keeps model IDs intact and has no shared seed catalog", () => {
    expect(PROVIDER_MODELS.tokenharbor).toEqual([]);
    expect(parseModel("tokenharbor/vendor/model:free")).toMatchObject({ provider: "tokenharbor", model: "vendor/model:free" });
  });

  it("discovers each connection's catalog with its own key", async () => {
    network.fetch.mockResolvedValueOnce(Response.json({ data: [{ id: "vendor/model:free" }] }));
    network.fetch.mockResolvedValueOnce(Response.json({ data: [{ id: "other/model" }] }));
    expect((await fetchConnectionModels(connection)).models[0].id).toBe("vendor/model:free");
    expect((await fetchConnectionModels({ ...connection, id: "second", apiKey: "second-key" })).models[0].id).toBe("other/model");
    expect(network.fetch.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual(["Bearer synthetic-key", "Bearer second-key"]);
    expect(network.fetch.mock.calls[0][0]).toBe("https://tokenharbor.ai/v1/models");
  });

  it("never uses provider-wide auto-sync even with a stale enabled setting", () => {
    expect(isModelAutoSyncEligible("tokenharbor")).toBe(false);
    expect(isModelAutoSyncEnabled("tokenharbor", { modelAutoSyncProviders: { tokenharbor: true } })).toBe(false);
  });

  it.each([[200, true], [401, false]])("validates a synthetic key against the model endpoint (HTTP %i)", async (status, valid) => {
    fetch.mockResolvedValue(new Response("{}", { status }));
    const request = new Request("http://localhost/api/providers/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "tokenharbor", apiKey: "synthetic-key" }) });
    const result = await validate(request);
    expect((await result.json()).valid).toBe(valid);
    expect(fetch).toHaveBeenCalledWith("https://tokenharbor.ai/v1/models", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer synthetic-key" }) }));
  });

  it("reports upstream discovery errors", async () => {
    network.fetch.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    expect(await fetchConnectionModels(connection)).toEqual({ error: "Failed to fetch models: 401", status: 401 });
  });

  it.each([false, true])("forwards chat with bearer credentials and unchanged model, stream=%s", async (stream) => {
    const payload = stream ? 'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\ndata: [DONE]\n\n' : JSON.stringify({ choices: [], usage: { prompt_tokens: 2, completion_tokens: 1 } });
    network.fetch.mockResolvedValue(new Response(payload, { headers: { "content-type": stream ? "text/event-stream" : "application/json" } }));
    const executor = new DefaultExecutor("tokenharbor");
    const body = { model: "vendor/model:free", messages: [{ role: "user", content: "hi" }], stream };
    const { response } = await executor.execute({ model: body.model, body, stream, credentials: connection });
    expect(network.fetch.mock.calls[0][0]).toBe("https://tokenharbor.ai/v1/chat/completions");
    expect(network.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer synthetic-key");
    expect(JSON.parse(network.fetch.mock.calls[0][1].body)).toMatchObject(body);
    expect(await response.text()).toBe(payload);
  });
});


describe("Token Harbor chat route", () => {
  it.each([false, true])("preserves upstream usage through chatCore, stream=%s", async (stream) => {
    const model = "vendor/model:free";
    const usage = { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 };
    const completion = { id: "fixture", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }], usage };
    const sse = `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model, choices: [], usage })}\n\ndata: [DONE]\n\n`;
    network.fetch.mockResolvedValue(new Response(stream ? sse : JSON.stringify(completion), { headers: { "content-type": stream ? "text/event-stream" : "application/json" } }));
    const body = { model, messages: [{ role: "user", content: "hi" }], stream };
    const result = await handleChatCore({ body, modelInfo: { provider: "tokenharbor", model }, credentials: connection,
      clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, connectionId: connection.id,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
    expect(result.success).toBe(true);
    const output = await result.response.text();
    expect(output).toContain('"prompt_tokens":2');
    expect(output).toContain('"completion_tokens":1');
    expect(JSON.parse(network.fetch.mock.calls[0][1].body).model).toBe(model);
    await vi.waitFor(() => expect(saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      provider: "tokenharbor", model, connectionId: connection.id,
      tokens: expect.objectContaining({ prompt_tokens: 2, completion_tokens: 1 }),
    })));
  });

  it("translates a Claude message through the OpenAI-compatible chat path", async () => {
    const model = "vendor/model:free";
    network.fetch.mockResolvedValue(Response.json({ id: "fixture", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
    const body = { model, max_tokens: 32, messages: [{ role: "user", content: "hi" }], stream: false };
    const result = await handleChatCore({ body, modelInfo: { provider: "tokenharbor", model }, credentials: connection,
      sourceFormatOverride: "claude", clientRawRequest: { endpoint: "/v1/messages", body, headers: {} }, connectionId: connection.id,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
    expect(result.success).toBe(true);
    const wire = JSON.parse(network.fetch.mock.calls[0][1].body);
    expect(wire).toMatchObject({ model, messages: [{ role: "user", content: "hi" }] });
    const output = await result.response.json();
    expect(output.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: "hello" })]));
    expect(output.usage).toMatchObject({ input_tokens: 2, output_tokens: 1 });
  });

  it.each([401, 403, 429])("preserves chat upstream status %i", async (status) => {
    network.fetch.mockResolvedValue(Response.json({ error: { message: "fixture rejection", type: "fixture" } }, { status }));
    const body = { model: "vendor/model:free", messages: [{ role: "user", content: "hi" }], stream: false };
    const result = await handleChatCore({ body, modelInfo: { provider: "tokenharbor", model: body.model }, credentials: connection,
      clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, connectionId: connection.id,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
    expect(result.response.status).toBe(status);
  });
});
