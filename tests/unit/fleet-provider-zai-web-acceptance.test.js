/**
 * Scope note (issue #1251, zai-web vs installed `zai`). Offline only: fetch is mocked, no network,
 * credentials or account. Positive candidate = installed native `zai` (api.z.ai Anthropic transport).
 * Negative candidate = `zai-web`, which is NOT registered; it must not borrow `zai` identity or
 * any fallback transport. Static registry exports prove metadata only. Live account-backed
 * verification is UNAVAILABLE here, so no web-session support is claimed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: transport.fetch }));
// Prevent the unrelated import-time updater from loading native fetch or timers.
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/offline-fixture",
  updateKimchiUserAgent: vi.fn().mockResolvedValue("kimchi/offline-fixture"),
}));

import { PROVIDERS } from "open-sse/config/providers.js";
import { getProviderModels } from "open-sse/config/providerModels.js";
import { getExecutor, hasSpecializedExecutor } from "open-sse/executors/index.js";
import { probeRegistryProvider } from "@/app/api/providers/providerProbe.js";
import { fetchConnectionModels } from "@/app/api/providers/[id]/models/fetchConnectionModels.js";

const KEY = "zai-test-secret";

beforeEach(() => {
  transport.fetch.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected global fetch in offline acceptance"); }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("zai-web acceptance (offline)", () => {
  it("installed zai validates against api.z.ai with x-api-key", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = await probeRegistryProvider("zai", KEY, fetcher);
    expect(result?.valid).toBe(true);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/api\.z\.ai\/api\/anthropic\/v1\/messages/);
    expect(init.headers["x-api-key"]).toBe(KEY);
  });

  it("installed zai rejects a 401 key", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 401 }));
    const result = await probeRegistryProvider("zai", KEY, fetcher);
    expect(result?.valid).toBe(false);
  });

  it("installed zai executor sends Anthropic-format request to api.z.ai", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "m", type: "message", content: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    transport.fetch.mockImplementation(fetchMock);
    const body = { model: "glm-4.7", max_tokens: 8, messages: [{ role: "user", content: "hi" }] };
    await getExecutor("zai").execute({ model: "glm-4.7", body, stream: false, credentials: { apiKey: KEY }, log: null });
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.z.ai/api/anthropic/v1/messages?beta=true");
    expect(init.method).toBe("POST");
    expect(typeof init.body).toBe("string");
    expect(JSON.parse(init.body)).toMatchObject({
      model: "glm-4.7", max_tokens: 8, messages: [{ role: "user", content: "hi" }],
    });
    expect(init.headers["x-api-key"]).toBe(KEY);
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("installed zai: static catalog only, no live discovery, raw x-api-key auth", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "m", type: "message", content: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    transport.fetch.mockImplementation(fetchMock);
    expect(getProviderModels("zai").map(({ id }) => id)).toContain("glm-4.7");
    const discovery = await fetchConnectionModels({ provider: "zai", apiKey: KEY });
    expect(discovery).toMatchObject({ status: 400, error: expect.stringMatching(/does not support models listing/) });
    expect(fetchMock).not.toHaveBeenCalled();
    await getExecutor("zai").execute({ model: "glm-4.7", body: { model: "glm-4.7", max_tokens: 8, messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: { apiKey: KEY }, log: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.z.ai/api/anthropic/v1/messages?beta=true");
    expect(init.headers["x-api-key"]).toBe(KEY);
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("zai-web has no registration, probe, or model discovery", async () => {
    expect(PROVIDERS["zai-web"]).toBeUndefined();
    expect(hasSpecializedExecutor("zai-web")).toBe(false);
    const fetcher = vi.fn();
    expect(await probeRegistryProvider("zai-web", KEY, fetcher)).toBeNull();
    const models = await fetchConnectionModels({ provider: "zai-web", apiKey: KEY });
    expect(models).toEqual({ error: "Provider zai-web does not support models listing", status: 400 });
    expect(getProviderModels("zai-web")).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("zai-web credentials are never sent to another vendor's endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    transport.fetch.mockImplementation(fetchMock);
    const executor = getExecutor("zai-web");
    const buildHeaders = vi.spyOn(executor, "buildHeaders");
    const rejected = executor.execute({
      model: "glm-4.7",
      body: { model: "glm-4.7", messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: KEY },
      log: null,
    });
    await expect(rejected).rejects.toBeInstanceOf(Error);
    await expect(rejected).rejects.toMatchObject({
      message: 'Unknown provider "zai-web": no supported transport endpoint',
      status: 400,
    });
    expect(buildHeaders).not.toHaveBeenCalled();
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
