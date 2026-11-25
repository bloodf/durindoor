import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: transport.fetch }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));

import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

const key = "sk-empiriolabs-synthetic";
const api = "https://api.empiriolabs.ai/v1";
const connection = { id: "offline", provider: "empiriolabs", apiKey: key };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  transport.fetch.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("EmpirioLabs offline provider", () => {
  it("validates against account usage, including rejected keys and unavailable service", async () => {
    expect(resolveProviderAlias("empiriolabs")).toBe("empiriolabs");
    for (const [status, valid] of [[200, true], [401, false], [403, false], [503, false]]) {
      const fetcher = vi.fn().mockResolvedValue(json({}, status));
      expect((await probeRegistryProvider("empiriolabs", key, fetcher)).valid).toBe(valid);
      expect(fetcher.mock.calls[0][0]).toBe(`${api}/account/usage?limit=1`);
      expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${key}`);
    }
  });

  it("discovers only models with the chat endpoint and propagates failures", async () => {
    transport.fetch.mockResolvedValueOnce(json({ data: [
      { id: "chat", display_name: "Chat", supported_endpoints: ["POST /v1/chat/completions"], input_modalities: ["text", "image"], context_window: 1000, max_output_tokens: 100 },
      { id: "image", supported_endpoints: ["POST /v1/images/generations"] },
      { id: "unknown" },
    ] }));
    expect(await fetchConnectionModels(connection)).toEqual({ models: [{ id: "chat", name: "Chat", contextLength: 1000, outputTokenLimit: 100, supportsVision: true }] });
    expect(transport.fetch.mock.calls[0][0]).toBe(`${api}/models?available=true`);
    expect(transport.fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${key}`);
    transport.fetch.mockResolvedValueOnce(json({ error: "unavailable" }, 503));
    expect((await fetchConnectionModels(connection)).status).toBe(503);
  });

  it.each([false, true])("forwards chat and billed usage with stream=%s", async (stream) => {
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    const body = { model: "chat", messages: [{ role: "user", content: "Hi" }], stream };
    const wire = stream ? `data: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n` : JSON.stringify({ choices: [], usage });
    transport.fetch.mockResolvedValueOnce(new Response(wire, { headers: { "Content-Type": stream ? "text/event-stream" : "application/json" } }));
    const result = await getExecutor("empiriolabs").execute({ model: "chat", body, stream, credentials: { apiKey: key } });
    const [url, init] = transport.fetch.mock.calls[0];
    expect(url).toBe(`${api}/chat/completions`);
    expect(init.headers.Authorization).toBe(`Bearer ${key}`);
    expect(JSON.parse(init.body)).toMatchObject(stream ? { ...body, stream_options: { include_usage: true } } : body);
    expect(await result.response.text()).toBe(wire);
  });

  it("preserves an upstream chat rejection", async () => {
    transport.fetch.mockResolvedValueOnce(json({ error: { message: "invalid model" } }, 400));
    const { response } = await getExecutor("empiriolabs").execute({ model: "bad", body: { messages: [{ role: "user", content: "Hi" }] }, stream: false, credentials: { apiKey: key } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: "invalid model" } });
  });
});
