import { beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: network.fetch }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/offline-fixture",
  updateKimchiUserAgent: vi.fn(async () => "kimchi/offline-fixture"),
}));

import { extractUsage } from "open-sse/utils/usageTracking.js";
import { DefaultExecutor } from "open-sse/executors/default.js";
import { parseModel, resolveProviderAlias } from "open-sse/services/model.js";
import { APIKEY_PROVIDERS } from "@/shared/constants/providers";
import { buildRegistryProviderProbe, probeRegistryProvider } from "@/app/api/providers/providerProbe.js";
import { fetchConnectionModels } from "@/app/api/providers/[id]/models/fetchConnectionModels.js";

const connection = { id: "fixture", provider: "xkiro", apiKey: "synthetic-key" };
const model = "openai/gpt-5.6-sol";
beforeEach(() => vi.clearAllMocks());

describe("X-Kiro provider", () => {
  it("keeps provider identity and nested model selection separate", () => {
    expect(APIKEY_PROVIDERS.xkiro).toBeDefined();
    expect(resolveProviderAlias("xkiro")).toBe("xkiro");
    expect(resolveProviderAlias("kiro")).toBe("kiro");
    expect(parseModel(`xkiro/${model}`)).toMatchObject({ provider: "xkiro", model });
    const probe = buildRegistryProviderProbe("xkiro", connection.apiKey);
    expect(probe.url).toBe("https://api.xkiro.com/v1/usage");
    expect(probe.options.headers.Authorization).toBe("Bearer synthetic-key");
  });

  it("discovers models and preserves upstream errors", async () => {
    network.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: model }] })));
    expect((await fetchConnectionModels(connection)).models[0].id).toBe(model);
    expect(network.fetch).toHaveBeenCalledWith("https://api.xkiro.com/v1/models", expect.objectContaining({ method: "GET" }), {});
    network.fetch.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    expect(await fetchConnectionModels(connection)).toEqual({ error: "Failed to fetch models: 403", status: 403 });
  });

  it("rejects invalid credentials without treating the public catalog as validation", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("denied", { status: 401 }));
    expect(await probeRegistryProvider("xkiro", connection.apiKey, fetcher)).toMatchObject({ valid: false, status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("sends a selected model with bearer auth; stream=%s", (stream) => {
    const executor = new DefaultExecutor("xkiro");
    const body = { model, stream, messages: [{ role: "user", content: "Hello" }] };
    expect(executor.buildUrl(model, stream)).toBe("https://api.xkiro.com/v1/chat/completions");
    expect(executor.buildHeaders(connection, stream)).toMatchObject({ Authorization: "Bearer synthetic-key" });
    expect(executor.transformRequest(model, structuredClone(body), stream, connection)).toMatchObject(body);
  });
  it.each([false, true])("passes a mock upstream response and usage through the executor, stream=%s", async (stream) => {
    const usage = { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 };
    const payload = { id: "fixture", model, choices: [], usage };
    const wire = stream ? `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n` : JSON.stringify(payload);
    network.fetch.mockResolvedValueOnce(new Response(wire, { headers: { "content-type": stream ? "text/event-stream" : "application/json" } }));
    const result = await new DefaultExecutor("xkiro").execute({ model, stream, credentials: connection,
      body: { model, stream, messages: [{ role: "user", content: "Hi" }] } });
    const [url, options] = network.fetch.mock.calls[0];
    expect(url).toBe("https://api.xkiro.com/v1/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer synthetic-key");
    expect(JSON.parse(options.body)).toMatchObject({ model, stream });
    const responseText = await result.response.text();
    expect(responseText).toBe(wire);
    const responsePayload = JSON.parse(stream ? responseText.split("\n")[0].slice(6) : responseText);
    expect(extractUsage(responsePayload)).toMatchObject(usage);
  });

});
