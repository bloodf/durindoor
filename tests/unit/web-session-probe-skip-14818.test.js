import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { isConversationProbeProvider, probeOutcome } from "../../src/lib/providers/conversationProbe.js";

// OmniRoute #14780/#14818: no diagnostic path may create a conversation on a web-session
// account, and "skipped" must never read as failed (UI badge, summary, persisted testStatus).
const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(() => Promise.resolve(new Response("", { status: 400 }))),
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig }));
vi.mock("@/models", () => ({ getProviderConnections: vi.fn(), getProviderConnectionById: vi.fn(), getProviderNodeById: vi.fn() }));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: mocks.testProxyUrl }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn().mockResolvedValue("machine-id-test") }));

const originalFetch = global.fetch;

describe("web-session probe skip (#14818)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ user: { id: "u" } }), { status: 200 }));
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each(["grok-web", "copilot-web", "zenmux-free"])("testSingleConnection skips %s: no request, no DB write", async (provider) => {
    mocks.getProviderConnectionById.mockResolvedValue({ id: "c", provider, authType: "cookie", apiKey: "sso=abc; ctoken=t" });
    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection("c");
    expect(result).toMatchObject({ valid: false, skipped: true });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(proxyAwareFetch).not.toHaveBeenCalled();
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it.each(["grok-web", "copilot-web", "zenmux-free"])("validate route skips %s without any request", async (provider) => {
    const { POST } = await import("../../src/app/api/providers/validate/route.js");
    const res = await POST(new Request("http://x/api/providers/validate", {
      method: "POST",
      body: JSON.stringify({ provider, apiKey: "sso=abc; ctoken=t" }),
    }));
    expect(await res.json()).toMatchObject({ valid: false, skipped: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a ZenMux cookie without ctoken locally, without a conversation request", async () => {
    const { POST } = await import("../../src/app/api/providers/validate/route.js");
    const res = await POST(new Request("http://x/api/providers/validate", {
      method: "POST",
      body: JSON.stringify({ provider: "zenmux-free", apiKey: "other=present" }),
    }));
    expect(await res.json()).toMatchObject({ valid: false, error: expect.stringContaining("ctoken") });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("saved ZenMux connection without ctoken is rejected locally, not skipped", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({ id: "c", provider: "zenmux-free", authType: "cookie", apiKey: "other=present" });
    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection("c");
    expect(result).toMatchObject({ valid: false, error: expect.stringContaining("ctoken") });
    expect(result.skipped).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("batch toast does not claim all passed when tests were skipped", async () => {
    const { testSummaryToast } = await import("../../src/app/(dashboard)/dashboard/providers/testSummaryToast.js");
    expect(testSummaryToast({ total: 2, passed: 0, failed: 0, skipped: 2 })).toEqual({ level: "warning", message: "0/2 passed, 2 skipped" });
    expect(testSummaryToast({ total: 2, passed: 2, failed: 0, skipped: 0 }).level).toBe("success");
    expect(testSummaryToast({ total: 3, passed: 1, failed: 1, skipped: 1 }).message).toBe("1/3 passed, 1 failed, 1 skipped");
  });

  it("validate route checks perplexity-web read-only (session GET, never the ask endpoint)", async () => {
    const { POST } = await import("../../src/app/api/providers/validate/route.js");
    const res = await POST(new Request("http://x/api/providers/validate", {
      method: "POST",
      body: JSON.stringify({ provider: "perplexity-web", apiKey: "tok" }),
    }));
    expect((await res.json()).valid).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(String(url)).toContain("/api/auth/session");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("batch model test streams skipped (not failed) for web models and never dispatches", async () => {
    const { POST } = await import("../../src/app/api/models/test/batch/route.js");
    const res = await POST(new Request("http://x/api/models/test/batch", {
      method: "POST",
      body: JSON.stringify({ models: [{ model: "grok-web/grok-4", kind: "llm" }, { model: "pw/pplx-auto", kind: "llm" }] }),
    }));
    const events = (await res.text()).split("\n\n").filter(Boolean).map((l) => JSON.parse(l.slice(6)));
    const items = events.filter((e) => e.model);
    expect(items).toHaveLength(2);
    for (const item of items) expect(probeOutcome(item)).toBe("skipped");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("provider-unavailable batch fallout is skipped, not an error the UI would mark", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 401 }));
    const { POST } = await import("../../src/app/api/models/test/batch/route.js");
    const res = await POST(new Request("http://x/api/models/test/batch", {
      method: "POST",
      body: JSON.stringify({ models: [{ model: "openai/a", kind: "llm" }, { model: "openai/b", kind: "llm" }] }),
    }));
    const items = (await res.text()).split("\n\n").filter(Boolean).map((l) => JSON.parse(l.slice(6))).filter((e) => e.model);
    expect(probeOutcome(items[0])).toBe("error");
    expect(probeOutcome(items[1])).toBe("skipped");
  });

  it("connection test route exposes skipped and never probes", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({ id: "c1", provider: "grok-web", authType: "cookie", apiKey: "sso=abc" });
    const route = await import("../../src/app/api/providers/[id]/test/route.js");
    const single = await (await route.POST(new Request("http://x"), { params: Promise.resolve({ id: "c1" }) })).json();
    expect(single).toMatchObject({ valid: false, skipped: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("test-batch summary counts skipped separately from failed", async () => {
    const { getProviderConnections } = await import("@/models");
    vi.mocked(getProviderConnections).mockResolvedValue([
      { id: "c1", provider: "grok-web", authType: "cookie", apiKey: "sso=abc" },
      { id: "c2", provider: "openai", authType: "apikey", apiKey: "k" },
    ]);
    mocks.getProviderConnectionById.mockImplementation(async (id) =>
      id === "c1" ? { id, provider: "grok-web", authType: "cookie", apiKey: "sso=abc" } : null);
    const { POST } = await import("../../src/app/api/providers/test-batch/route.js");
    const body = await (await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ mode: "all" }) }))).json();
    expect(body.summary).toMatchObject({ total: 2, skipped: 1, failed: 1, passed: 0 });
  });
  it("probeOutcome / provider set", () => {
    expect(probeOutcome({ ok: true })).toBe("ok");
    expect(probeOutcome({ ok: false, error: "x" })).toBe("error");
    expect(probeOutcome({ ok: false, skipped: true })).toBe("skipped");
    expect(probeOutcome({ valid: true }, "valid")).toBe("ok");
    expect(isConversationProbeProvider("openai")).toBe(false);
  });
});
