import { afterEach, describe, expect, it, vi } from "vitest";

import helyxai from "../../open-sse/providers/registry/helyxai.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const routedFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: routedFetch }));

import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";

const KEY_A = "helyx_synthetic_alpha";
const KEY_B = "helyx_synthetic_beta";
const CHAT_URL = "https://helyxai.space/v1/chat/completions/";
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

describe("staged Helyx AI provider", () => {
  afterEach(() => vi.clearAllMocks());

  it("declares the pinned OpenAI-compatible API and model discovery", () => {
    expect(helyxai).toMatchObject({
      id: "helyxai",
      category: "apikey",
      authType: "apikey",
      transport: { baseUrl: CHAT_URL, validateUrl: "https://helyxai.space/v1/models" },
      passthroughModels: true,
      modelsFetcher: { url: "https://helyxai.space/v1/models", type: "openai" },
      serviceKinds: ["llm"],
    });
  });

  it("validates a key and rejects a key refused by the provider", async () => {
    const accepted = await probeRegistryProvider("helyxai", KEY_A, vi.fn(async () => response({ data: [] })));
    const rejected = await probeRegistryProvider("helyxai", KEY_B, vi.fn(async () => response({ error: "unauthorized" }, 401)));
    expect(accepted).toMatchObject({ valid: true, status: 200 });
    expect(rejected).toMatchObject({ valid: false, status: 401 });
  });

  it("discovers models with the saved connection key", async () => {
    routedFetch.mockResolvedValue(response({ data: [{ id: "new-model", name: "New model" }] }));
    const result = await fetchConnectionModels({ id: "helyx-test", provider: "helyxai", apiKey: KEY_A });
    expect(result.models).toEqual([{ id: "new-model", name: "New model" }]);
    expect(routedFetch).toHaveBeenCalledWith("https://helyxai.space/v1/models", expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({ Authorization: `Bearer ${KEY_A}` }),
    }), expect.anything());
  });

  it("sends isolated API keys and preserves reported usage in JSON completions", async () => {
    routedFetch
      .mockResolvedValueOnce(response({ choices: [{ message: { content: "alpha" } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }))
      .mockResolvedValueOnce(response({ choices: [{ message: { content: "beta" } }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }));
    const executor = new DefaultExecutor("helyxai");
    const execute = (apiKey) => executor.execute({
      model: "openai/gpt-4o-mini",
      body: { model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "hello" }], stream: false },
      stream: false,
      credentials: { apiKey },
    });
    const a = await execute(KEY_A);
    const b = await execute(KEY_B);
    expect((await a.response.json()).usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
    expect((await b.response.json()).usage.total_tokens).toBe(6);
    expect(routedFetch).toHaveBeenCalledTimes(2);
    expect(routedFetch.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
  });

  it("forwards SSE streaming frames", async () => {
    const stream = new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "hello" }, finish_reason: null }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"), { headers: { "content-type": "text/event-stream" } });
    routedFetch.mockResolvedValue(stream);
    const result = await new DefaultExecutor("helyxai").execute({
      model: "openai/gpt-4o-mini",
      body: { model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "hello" }], stream: true },
      stream: true,
      credentials: { apiKey: KEY_A },
    });
    expect(routedFetch.mock.calls[0][0]).toBe(CHAT_URL);
    expect(await result.response.text()).toContain('"content":"hello"');
  });

  it.each([401, 403, 402, 429])("retains provider HTTP status %i for credential/quota handling", async (status) => {
    routedFetch.mockResolvedValue(response({ error: { message: "synthetic failure" } }, status));
    const result = await new DefaultExecutor("helyxai").execute({
      model: "openai/gpt-4o-mini",
      body: { model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "hello" }] },
      stream: false,
      credentials: { apiKey: KEY_A },
    });
    expect(result.response.status).toBe(status);
  });
});
