import { afterEach, describe, expect, it, vi } from "vitest";
import { default as provider } from "../../open-sse/providers/private/g4f-gemini.js";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
vi.mock("../../open-sse/providers/registry/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const { default: staged } = await import("../../open-sse/providers/private/g4f-gemini.js");
  return { ...original, default: [...original.default, staged] };
});
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

const model = "models/gemini-2.5-flash";
const keyA = "fixture-gemini-alpha";
const keyB = "fixture-gemini-beta";
const json = (body, status = 200) => Response.json(body, { status });
afterEach(() => vi.clearAllMocks());

describe("g4f Gemini staged provider", () => {
  it("validates keys and discovers models per connection", async () => {
    expect(await probeRegistryProvider(provider.id, keyA, vi.fn(async () => json({ data: [{ id: model }] })))).toMatchObject({ valid: true });
    expect(await probeRegistryProvider(provider.id, keyA, vi.fn(async () => json({}, 401)))).toMatchObject({ valid: false, status: 401 });
    fetchMock.mockResolvedValueOnce(json({ data: [{ id: model }] })).mockResolvedValueOnce(json({ data: [{ id: "models/gemini-2.5-pro" }] }));
    expect((await fetchConnectionModels({ id: "a", provider: provider.id, apiKey: keyA })).models[0].id).toBe(model);
    expect((await fetchConnectionModels({ id: "b", provider: provider.id, apiKey: keyB })).models[0].id).toBe("models/gemini-2.5-pro");
    expect(fetchMock.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual([`Bearer ${keyA}`, `Bearer ${keyB}`]);
  });
  it.each([401, 403, 402, 429])("preserves upstream status %i", async (status) => {
    fetchMock.mockResolvedValue(json({ error: { message: "fixture error" } }, status));
    const result = await new DefaultExecutor(provider.id).execute({ model, body: { model, messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: keyA } });
    expect(result.response.status).toBe(status);
  });
  it("forwards JSON usage and SSE responses", async () => {
    const executor = new DefaultExecutor(provider.id);
    fetchMock.mockResolvedValueOnce(json({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
    expect((await (await executor.execute({ model, body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: keyA } })).response.json()).usage.total_tokens).toBe(3);
    fetchMock.mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }));
    const stream = await executor.execute({ model, stream: true, body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: keyA } });
    expect(await stream.response.text()).toContain("[DONE]");
  });
});
