/**
 * Scope note (issue #1251, zai-web vs installed `zai`). Offline only: fetch is mocked, no network,
 * credentials or account. Positive candidate = installed native `zai` (api.z.ai Anthropic transport).
 * Negative candidate = `zai-web`, which is NOT registered; it must not borrow `zai` identity or
 * any fallback transport. Static registry exports prove metadata only. Live account-backed
 * verification is UNAVAILABLE here, so no web-session support is claimed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "open-sse/config/providers.js";
import { getExecutor, hasSpecializedExecutor } from "open-sse/executors/index.js";
import { probeRegistryProvider } from "@/app/api/providers/providerProbe.js";
import { fetchConnectionModels } from "@/app/api/providers/[id]/models/fetchConnectionModels.js";

const KEY = "zai-test-secret";

afterEach(() => vi.unstubAllGlobals());

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
    vi.stubGlobal("fetch", fetchMock);
    const body = { model: "glm-4.7", max_tokens: 8, messages: [{ role: "user", content: "hi" }] };
    await getExecutor("zai").execute({ model: "glm-4.7", body, stream: false, credentials: { apiKey: KEY }, log: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("api.z.ai");
    expect(JSON.stringify(init.headers)).toContain(KEY);
  });

  it("zai-web has no registration, probe, or model discovery", async () => {
    expect(PROVIDERS["zai-web"]).toBeUndefined();
    expect(hasSpecializedExecutor("zai-web")).toBe(false);
    const fetcher = vi.fn();
    expect(await probeRegistryProvider("zai-web", KEY, fetcher)).toBeNull();
    const models = await fetchConnectionModels({ provider: "zai-web", apiKey: KEY });
    expect(models.error).toMatch(/does not support models listing/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("zai-web credentials are never sent to another vendor's endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    let threw = null;
    try {
      await getExecutor("zai-web").execute({
        model: "glm-4.7",
        body: { model: "glm-4.7", messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: { apiKey: KEY },
        log: null,
      });
    } catch (e) {
      threw = e;
    }
    const sent = fetchMock.mock.calls.map(([u]) => String(u));
    expect(sent, `unregistered zai-web dispatched to ${sent.join(",")}`).toEqual([]);
    void threw;
  });
});
