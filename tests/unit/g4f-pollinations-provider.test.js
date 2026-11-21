import { afterEach, describe, expect, it, vi } from "vitest";
import provider from "../../open-sse/providers/private/g4f-pollinations.js";
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
vi.mock("../../open-sse/providers/registry/index.js", async (importOriginal) => { const original = await importOriginal(); const { default: staged } = await import("../../open-sse/providers/private/g4f-pollinations.js"); return { ...original, default: [...original.default, staged] }; });
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
const model = "openai", keyA = "fixture-pollinations-a", keyB = "fixture-pollinations-b";
const json = (body, status = 200) => Response.json(body, { status });
afterEach(() => vi.clearAllMocks());
describe("g4f Pollinations staged provider", () => {
  it("validates keys and isolates discovered models", async () => { expect(await probeRegistryProvider(provider.id, keyA, vi.fn(async () => json({ data: [{ id: model }] })))).toMatchObject({ valid: true }); expect(await probeRegistryProvider(provider.id, keyA, vi.fn(async () => json({}, 401)))).toMatchObject({ valid: false, status: 401 }); fetchMock.mockResolvedValueOnce(json({ data: [{ id: model }] })).mockResolvedValueOnce(json({ data: [{ id: "openai-fast" }] })); expect((await fetchConnectionModels({ id: "a", provider: provider.id, apiKey: keyA })).models[0].id).toBe(model); expect((await fetchConnectionModels({ id: "b", provider: provider.id, apiKey: keyB })).models[0].id).toBe("openai-fast"); expect(fetchMock.mock.calls.map(([, i]) => i.headers.Authorization)).toEqual([`Bearer ${keyA}`, `Bearer ${keyB}`]); });
  it.each([401, 403, 402, 429])("preserves upstream status %i", async (status) => { fetchMock.mockResolvedValue(json({}, status)); const r = await new DefaultExecutor(provider.id).execute({ model, body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: keyA } }); expect(r.response.status).toBe(status); });
  it("forwards JSON usage and SSE", async () => { const e = new DefaultExecutor(provider.id); fetchMock.mockResolvedValueOnce(json({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } })); expect((await (await e.execute({ model, body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: keyA } })).response.json()).usage.total_tokens).toBe(3); fetchMock.mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } })); expect(await (await e.execute({ model, stream: true, body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: keyA } })).response.text()).toContain("[DONE]"); });
});
