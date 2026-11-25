import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: vi.fn(), getProviderNodeById: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => null) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn((url, init) => globalThis.fetch(url, init)) }));
import { POST } from "../../src/app/api/providers/validate/route.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { parseModel } from "../../open-sse/services/model.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
const apiKey = "synthetic-hetzner-token";
const model = "Qwen/Qwen3.6-35B-A3B-FP8";
const base = "https://inference.hetzner.com/api/v1";
const connection = { id: "fixture", provider: "hetzner", apiKey };
const execute = (stream = false) => new DefaultExecutor("hetzner").execute({ model, stream, credentials: connection, body: { model, stream, messages: [{ role: "user", content: "Hello" }] }, requestPolicy: { maxTransportAttempts: 1 } });
const validate = () => POST(new Request("http://localhost/api/providers/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "hetzner", apiKey }) }));
describe("Hetzner Inference offline", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); })));
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it("registers a dynamic catalog and preserves slashes", () => {
    const entries = REGISTRY.filter((entry) => entry.id === "hetzner");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ models: [], passthroughModels: true, modelsFetcher: { url: `${base}/models`, type: "openai" } });
    expect(parseModel(`hetzner/${model}`)).toMatchObject({ provider: "hetzner", model });
  });
  it("validates and discovers the authenticated list", async () => {
    const models = [{ id: model }, { id: "new/model" }];
    fetch.mockResolvedValue(Response.json({ data: models }));
    expect(await (await validate()).json()).toEqual({ valid: true, error: null });
    expect(await fetchConnectionModels(connection)).toMatchObject({ models });
    for (const [url, init] of fetch.mock.calls) { expect(url).toBe(`${base}/models`); expect(init.headers.Authorization).toBe(`Bearer ${apiKey}`); }
  });
  it.each([false, true])("forwards chat and usage with stream=%s", async (stream) => {
    const completion = { id: "fixture", choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } };
    const sse = `data: ${JSON.stringify({ choices: [], usage: completion.usage })}\n\ndata: [DONE]\n\n`;
    fetch.mockResolvedValue(stream ? new Response(sse, { headers: { "Content-Type": "text/event-stream" } }) : Response.json(completion));
    const result = await execute(stream);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${base}/chat/completions`); expect(init.headers.Authorization).toBe(`Bearer ${apiKey}`);
    expect(JSON.parse(init.body)).toMatchObject({ model, stream });
    if (stream) expect(await result.response.text()).toBe(sse); else expect(await result.response.json()).toEqual(completion);
  });
  it.each([401, 429])("propagates upstream HTTP %i", async (status) => {
    fetch.mockImplementation(async () => Response.json({ error: { message: "fixture rejection" } }, { status }));
    expect((await fetchConnectionModels(connection)).status).toBe(status);
    expect((await execute()).response.status).toBe(status);
  });
});
