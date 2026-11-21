import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({ ...(await importOriginal()), proxyAwareFetch: fetchMock }));
vi.mock("../../open-sse/providers/registry/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const notion = (await import("../../open-sse/providers/private/notion-web.js")).default;
  return { ...original, default: [...original.default, notion] };
});
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const { NotionWebExecutor } = await import("../../open-sse/executors/notion-web.js");
  const executor = new NotionWebExecutor();
  return { ...original, getExecutor: (provider) => provider === "notion-web" || provider === "nw" ? executor : original.getExecutor(provider) };
});

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { cookieCaptureProfile } from "../../open-sse/providers/private/notion-web.js";
import { discoverNotionModels } from "../../open-sse/executors/notion-web.js";

const tokenA = "token_v2=synthetic-a; space_id=space-a; notion_user_id=user-a";
const tokenB = "token_v2=synthetic-b; space_id=space-b; notion_user_id=user-b";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const modelCatalog = { models: [{ model: "codename-one", modelMessage: "Model One" }] };
const body = (stream = false) => ({ model: "notion-web/model-one", messages: [{ role: "user", content: "hello" }], stream });

afterEach(() => { vi.clearAllMocks(); });

describe("Notion Web staged provider", () => {
  it("composes the staged registry entry and exports its cookie capture profile", () => {
    expect(REGISTRY.find((entry) => entry.id === "notion-web")).toBeDefined();
    expect(cookieCaptureProfile).toMatchObject({ cookieNames: ["token_v2"], validationProbe: { method: "POST" } });
    expect(getExecutor("nw")).toBeDefined();
  });

  it("validates a session and discovers models; rejects an expired session", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(modelCatalog));
    await expect(discoverNotionModels(tokenA, fetcher)).resolves.toMatchObject({ spaceId: "space-a", models: [{ id: "Model One" }] });
    expect(fetcher.mock.calls[0][0]).toContain("getAvailableModels");
    await expect(discoverNotionModels(tokenA, vi.fn().mockResolvedValue(json({}, 401)))).rejects.toMatchObject({ status: 401 });
  });

  it("creates JSON and buffered SSE chat completions through the composed executor", async () => {
    fetchMock.mockResolvedValueOnce(json(modelCatalog)).mockResolvedValueOnce(new Response('{"value":{"text":"answer"}}\n'));
    const result = await getExecutor("notion-web").execute({ model: "notion-web/model-one", body: body(), credentials: { apiKey: tokenA, connectionId: "one" } });
    expect((await result.response.json()).choices[0].message.content).toBe("answer");
    fetchMock.mockResolvedValueOnce(json(modelCatalog)).mockResolvedValueOnce(new Response('{"value":{"text":"stream answer"}}\n'));
    const streamed = await getExecutor("notion-web").execute({ model: "notion-web/model-one", body: body(true), credentials: { apiKey: tokenA, connectionId: "two" } });
    expect(streamed.response.headers.get("content-type")).toContain("text/event-stream");
    expect(await streamed.response.text()).toContain("stream answer");
  });

  it("maps expiry and quota errors and keeps two connection cookies isolated", async () => {
    fetchMock.mockResolvedValueOnce(json(modelCatalog)).mockResolvedValueOnce(json({}, 401));
    const expired = await getExecutor("notion-web").execute({ model: "m", body: body(), credentials: { apiKey: tokenA } });
    expect(expired.response.status).toBe(401);
    fetchMock.mockResolvedValueOnce(json(modelCatalog)).mockResolvedValueOnce(json({}, 429));
    const quota = await getExecutor("notion-web").execute({ model: "m", body: body(), credentials: { apiKey: tokenB } });
    expect(quota.response.status).toBe(429);
    fetchMock.mockResolvedValueOnce(json(modelCatalog)).mockResolvedValueOnce(new Response('{"value":{"text":"a"}}\n'));
    await getExecutor("notion-web").execute({ model: "m", body: body(), credentials: { apiKey: tokenA, connectionId: "a" } });
    fetchMock.mockResolvedValueOnce(json(modelCatalog)).mockResolvedValueOnce(new Response('{"value":{"text":"b"}}\n'));
    await getExecutor("notion-web").execute({ model: "m", body: body(), credentials: { apiKey: tokenB, connectionId: "b" } });
    expect(fetchMock.mock.calls.map(([, init]) => init.headers.cookie).filter(Boolean)).toEqual(expect.arrayContaining([expect.stringContaining("synthetic-a"), expect.stringContaining("synthetic-b")]));
  });
});
