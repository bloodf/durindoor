import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: vi.fn(), getProviderNodeById: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => null) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn((url, init) => globalThis.fetch(url, init)) }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));

import { POST } from "../../src/app/api/providers/validate/route.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { parseModel, resolveProviderAlias } from "../../open-sse/services/model.js";

const connection = { id: "platform-fixture", provider: "arcee-platform", apiKey: "platform-synthetic-key" };
const modelsUrl = "https://api.arcee.ai/api/v1/models";
const chatUrl = "https://api.arcee.ai/api/v1/chat/completions";
const model = "fixture/model";

function validate(provider, apiKey) {
  return POST(new Request("http://localhost/api/providers/validate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey }),
  }));
}

function execute(provider, apiKey, stream = false) {
  return new DefaultExecutor(provider).execute({
    model, stream, credentials: { apiKey },
    body: { model, stream, messages: [{ role: "user", content: "Hello" }] },
    requestPolicy: { maxTransportAttempts: 1 },
  });
}

describe("Arcee Platform and existing Conductor", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected offline fetch"); })));
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("keeps both identities, endpoints and model namespaces distinct", () => {
    expect(APIKEY_PROVIDERS["arcee-platform"].notice.apiKeyUrl).toBe("https://platform.arcee.ai/api/api-keys");
    expect(PROVIDERS["arcee-ai"].baseUrl).toBe("https://conductor.arcee.ai/v1/chat/completions");
    expect(PROVIDERS["arcee-ai"].validateUrl).toBe("https://conductor.arcee.ai/v1/models");
    expect(PROVIDERS["arcee-platform"].baseUrl).toBe(chatUrl);
    expect(PROVIDER_MODELS["arcee-platform"]).toEqual([]);
    expect(resolveProviderAlias("arcee")).toBe("arcee-ai");
    expect(parseModel(`arcee-platform/${model}`)).toMatchObject({ provider: "arcee-platform", model });
  });

  it("validates and discovers account models using the Platform key", async () => {
    fetch.mockResolvedValue(Response.json({ data: [{ id: model, name: "Fixture" }] }));
    expect(await (await validate(connection.provider, connection.apiKey)).json()).toEqual({ valid: true, error: null });
    expect((await fetchConnectionModels(connection)).models).toMatchObject([{ id: model }]);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe(modelsUrl);
      expect(init.headers.Authorization).toBe("Bearer platform-synthetic-key");
    }
  });

  it.each([false, true])("sends chat and preserves the response, stream=%s", async (stream) => {
    const payload = stream ? 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n' : JSON.stringify({ choices: [{ message: { role: "assistant", content: "Hi" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } });
    fetch.mockResolvedValue(new Response(payload, { headers: { "Content-Type": stream ? "text/event-stream" : "application/json" } }));
    const result = await execute(connection.provider, connection.apiKey, stream);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(chatUrl);
    expect(init.headers.Authorization).toBe("Bearer platform-synthetic-key");
    expect(JSON.parse(init.body)).toMatchObject({ model, stream, messages: [{ role: "user", content: "Hello" }] });
    expect(await result.response.text()).toBe(payload);
  });

  it("keeps a saved Conductor credential on the Conductor endpoint", async () => {
    fetch.mockResolvedValue(Response.json({ choices: [] }));
    await execute("arcee-ai", "conductor-synthetic-key");
    expect(fetch.mock.calls[0][0]).toBe("https://conductor.arcee.ai/v1/chat/completions");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer conductor-synthetic-key");
  });

  it.each([401, 429, 503])("surfaces upstream %i on discovery and chat", async (status) => {
    fetch.mockImplementation(async () => Response.json({ error: "fixture" }, { status }));
    expect(await fetchConnectionModels(connection)).toEqual({ error: `Failed to fetch models: ${status}`, status });
    expect((await execute(connection.provider, connection.apiKey)).response.status).toBe(status);
  });
});
