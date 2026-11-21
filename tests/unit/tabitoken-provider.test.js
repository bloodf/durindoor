import { afterEach, describe, expect, it, vi } from "vitest";

const routedFetch = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/providers/registry/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  const entry = (await import("../../open-sse/providers/private/tabitoken.js")).default;
  return { ...actual, default: [...actual.default, entry] };
});
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: routedFetch }));

import entry from "../../open-sse/providers/private/tabitoken.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

const CHAT = "https://tabitoken.com/v1/messages";
const KEY_A = "synthetic-tabitoken-key-a";
const KEY_B = "synthetic-tabitoken-key-b";
const json = (body, status = 200) => Response.json(body, { status });

describe("staged TabiToken provider", () => {
  afterEach(() => vi.clearAllMocks());

  it("composes into the registry and validates accepted and rejected API keys", async () => {
    expect(REGISTRY).toContainEqual(entry);
    const fetcher = vi.fn().mockResolvedValueOnce(json({ data: [{ id: "claude-opus-5" }] })).mockResolvedValueOnce(json({ error: "invalid key" }, 401));
    expect(await probeRegistryProvider("tabitoken", KEY_A, fetcher)).toMatchObject({ valid: true, status: 200 });
    expect(await probeRegistryProvider("tabitoken", KEY_B, fetcher)).toMatchObject({ valid: false, status: 401 });
    expect(fetcher.mock.calls[0][1].headers["X-API-Key"]).toBe(KEY_A);
  });

  it("discovers models separately for two connections", async () => {
    routedFetch.mockResolvedValueOnce(json({ data: [{ id: "claude-opus-5" }] })).mockResolvedValueOnce(json({ data: [{ id: "claude-opus-4-8" }] }));
    const a = await fetchConnectionModels({ id: "tabi-a", provider: "tabitoken", apiKey: KEY_A });
    const b = await fetchConnectionModels({ id: "tabi-b", provider: "tabitoken", apiKey: KEY_B });
    expect(a.models.map((model) => model.id)).toContain("claude-opus-5");
    expect(b.models.map((model) => model.id)).toContain("claude-opus-4-8");
    expect(routedFetch.mock.calls.map((call) => call[1].headers["X-API-Key"])).toEqual([KEY_A, KEY_B]);
  });

  it("uses the Claude Messages endpoint and preserves JSON and SSE responses", async () => {
    const executor = new DefaultExecutor("tabitoken");
    routedFetch.mockResolvedValueOnce(json({ id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: "hello" }], usage: { input_tokens: 7, output_tokens: 3 } }));
    const result = await executor.execute({ model: "claude-opus-5", body: { model: "claude-opus-5", max_tokens: 50, messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: { apiKey: KEY_A } });
    expect(routedFetch.mock.calls[0][0]).toBe(CHAT);
    expect(routedFetch.mock.calls[0][1].headers["x-api-key"]).toBe(KEY_A);
    expect(result.response.status).toBe(200);

    const sse = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_2\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"usage\":{\"input_tokens\":4,\"output_tokens\":0}}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
    routedFetch.mockResolvedValueOnce(new Response(sse, { headers: { "content-type": "text/event-stream" } }));
    const streamed = await executor.execute({ model: "claude-opus-5", body: { model: "claude-opus-5", max_tokens: 50, messages: [{ role: "user", content: "hi" }], stream: true }, stream: true, credentials: { apiKey: KEY_B } });
    expect(streamed.response.status).toBe(200);
    expect(streamed.response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("keeps credential and quota status codes visible", async () => {
    const executor = new DefaultExecutor("tabitoken");
    for (const status of [401, 403, 402, 429]) {
      routedFetch.mockResolvedValueOnce(new Response("rejected", { status }));
      const result = await executor.execute({ model: "claude-opus-5", body: { model: "claude-opus-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: { apiKey: KEY_A } });
      expect(result.response.status).toBe(status);
    }
  });
});
