// #1118: webhook routes require a dashboard JWT or CLI token; emit points fire.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canModify: vi.fn(),
  notify: vi.fn(),
  settings: {},
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/settings/settingsPatchAuth", async (orig) => ({ ...(await orig()), canModifySecurityCriticalSettings: mocks.canModify }));
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => structuredClone(mocks.settings)),
  updateSettings: vi.fn(async (u) => { mocks.settings = { ...mocks.settings, ...(typeof u === "function" ? u(structuredClone(mocks.settings)) : u) }; return mocks.settings; }),
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  getProviderConnectionById: vi.fn(async () => null),
  validateApiKey: vi.fn(),
}));
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: vi.fn(),
  clearProviderRateLimitEvidence: vi.fn(),
}));

const listRoute = await import("../../src/app/api/settings/webhooks/route.js");
const itemRoute = await import("../../src/app/api/settings/webhooks/[id]/route.js");
const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

const req = (body) => new Request("http://localhost/api/settings/webhooks", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("webhook routes", () => {
  beforeEach(() => {
    mocks.settings = {};
    mocks.canModify.mockReset();
  });

  it("refuse callers without a dashboard session or CLI token", async () => {
    mocks.canModify.mockResolvedValue(false);
    expect((await listRoute.GET(new Request("http://localhost/x"))).status).toBe(403);
    expect((await listRoute.POST(req({ url: "https://hooks.example.com/x", events: ["test.ping"] }))).status).toBe(403);
    expect((await itemRoute.DELETE(new Request("http://localhost/x"), { params: Promise.resolve({ id: "a" }) })).status).toBe(403);
    expect(mocks.settings.operatorWebhooks).toBeUndefined();
  });

  it("create returns the secret once; list never does; validation errors are 400; delete is 204", async () => {
    mocks.canModify.mockResolvedValue(true);
    const created = await listRoute.POST(req({ url: "https://hooks.example.com/x", events: ["test.ping"] }));
    expect(created.status).toBe(201);
    const { webhook, secret } = await created.json();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const list = await (await listRoute.GET(new Request("http://localhost/x"))).json();
    expect(JSON.stringify(list)).not.toContain(secret);
    expect(list.webhooks[0]).toMatchObject({ id: webhook.id, hasSecret: true });
    expect((await listRoute.POST(req({ url: "https://10.0.0.1/x", events: ["test.ping"] }))).status).toBe(400);
    const del = await itemRoute.DELETE(new Request("http://localhost/x"), { params: Promise.resolve({ id: webhook.id }) });
    expect(del.status).toBe(204);
    expect(mocks.settings.operatorWebhooks).toEqual([]);
  });
});

describe("emit points", () => {
  it("markAccountUnavailable emits account.cooldown with a truncated connection id", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "conn-abcdef-123", provider: "openai", backoffLevel: 0 }]);
    mocks.updateProviderConnection.mockResolvedValue({});
    // Observe the real dispatch: a configured destination receives the event.
    const fetcher = vi.fn(async () => new Response("", { status: 200 }));
    mocks.settings = { operatorWebhooks: [{ id: "h", url: "https://hooks.example.com/x", secret: "s", events: ["account.cooldown"], enabled: true, history: [] }] };
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
      await markAccountUnavailable("conn-abcdef-123", 503, "upstream down", "openai", "gpt-4o");
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    } finally {
      globalThis.fetch = realFetch;
    }
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.event).toBe("account.cooldown");
    expect(body.data).toMatchObject({ provider: "openai", connection: "conn-abc", status: 503 });
    expect(JSON.stringify(body)).not.toContain("conn-abcdef-123");
  });
});
