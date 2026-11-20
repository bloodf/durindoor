import { beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: network.fetch }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));

import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

const connection = (key) => ({ id: key, provider: "paraloncloud", apiKey: key, accessToken: "wrong-token", providerSpecificData: { copilotToken: "wrong-scoped-token" } });

describe("ParalonCloud account discovery and embeddings", () => {
  beforeEach(() => network.fetch.mockReset());

  it("uses each connection's API key for discovery", async () => {
    network.fetch.mockImplementation(async () => Response.json({ data: [{ id: "live-model", type: "embedding" }] }));
    for (const key of ["account-a", "account-b"]) {
      const result = await fetchConnectionModels(connection(key));
      expect(result.models).toEqual([expect.objectContaining({ id: "live-model", type: "embedding" })]);
      expect(network.fetch).toHaveBeenLastCalledWith("https://paraloncloud.com/v1/models", expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${key}` }) }), {});
    }
  });

  it("requires an API key and propagates discovery errors", async () => {
    expect((await fetchConnectionModels(connection(""))).status).toBe(401);
    expect(network.fetch).not.toHaveBeenCalled();
    network.fetch.mockResolvedValue(new Response("denied", { status: 403 }));
    expect((await fetchConnectionModels(connection("account-a"))).status).toBe(403);
  });

  it("sends embeddings with the account key and retains usage", async () => {
    const receipt = { object: "list", data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }], model: "multilingual-e5-small", usage: { prompt_tokens: 2, total_tokens: 2 } };
    network.fetch.mockResolvedValue(Response.json(receipt));
    const result = await handleEmbeddingsCore({ body: { input: "hello" }, modelInfo: { provider: "paraloncloud", model: receipt.model }, credentials: connection("account-a"), log: {} });
    expect(network.fetch).toHaveBeenCalledWith("https://paraloncloud.com/v1/embeddings", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer account-a" }), body: expect.stringContaining('"input":"hello"') }), expect.anything());
    expect(await result.response.json()).toEqual(receipt);
  });

  it.each([false, true])("dispatches chat and preserves the upstream receipt (stream=%s)", async (stream) => {
    const payload = stream ? 'data: {"choices":[],"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\n' : JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello" } }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } });
    network.fetch.mockResolvedValue(new Response(payload, { headers: { "content-type": stream ? "text/event-stream" : "application/json" } }));
    const result = await new DefaultExecutor("paralon").execute({ model: "qwen3-3b", body: { model: "qwen3-3b", messages: [{ role: "user", content: "hi" }], stream }, stream, credentials: { apiKey: "account-a" } });
    expect(network.fetch).toHaveBeenCalledWith("https://paraloncloud.com/v1/chat/completions", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer account-a" }) }), null);
    expect(await result.response.text()).toBe(payload);
  });

  it("preserves both provider names", () => {
    expect(resolveProviderAlias("paraloncloud")).toBe("paraloncloud");
    expect(resolveProviderAlias("paralon")).toBe("paraloncloud");
  });
});
