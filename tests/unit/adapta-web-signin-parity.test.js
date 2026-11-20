import { afterEach, describe, expect, it, vi } from "vitest";
import { getExecutor } from "open-sse/executors/index.js";

vi.mock("@/models", () => ({
  getProviderConnections: vi.fn(async () => []), getProviderConnectionById: vi.fn(),
  getProviderNodes: vi.fn(() => []), getProxyPoolById: vi.fn(), getProviderNodeById: vi.fn(),
  createProviderConnection: vi.fn(async (data) => ({ id: "connection-1", ...data })),
  updateProviderConnection: vi.fn(), deleteProviderConnection: vi.fn(),
}));
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true) }));

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.useRealTimers(); });

const jwt = (name, exp) => `eyJ.${Buffer.from(JSON.stringify({ name, exp })).toString("base64url")}.sig`;
const input = (key) => ({ model: "adapta-one", stream: false, credentials: { apiKey: key }, body: { messages: [{ role: "user", content: "hello" }] } });

describe("Adapta operator session", () => {
  it("exchanges each complete credential separately and uses its bearer for chat", async () => {
    const prefix = "same-prefix-".repeat(4);
    const cookies = [prefix + "a", prefix + "b"];
    const tokens = cookies.map((_, i) => jwt(String(i), Math.floor(Date.now() / 1000) + 300));
    const seen = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      if (String(url).endsWith("/v1/client")) {
        const i = cookies.indexOf(init.headers.Cookie.slice("__client=".length));
        expect(i).toBeGreaterThanOrEqual(0);
        return Response.json({ response: { sessions: [{ id: `session-${i}`, status: "active" }] } });
      }
      if (String(url).includes("/tokens")) {
        const i = Number(String(url).match(/session-(\d)/)[1]);
        expect(init.headers.Cookie).toBe(`__client=${cookies[i]}`);
        return Response.json({ jwt: tokens[i] });
      }
      expect(String(url)).toBe("https://agent.adapta.one/api/chat/stream/v1");
      seen.push(init.headers.Authorization);
      expect(JSON.parse(init.body)).toEqual({ messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }], aiModelId: 14 });
      return new Response('data: {"type":"text-delta","delta":"ok"}\n\ndata: {"type":"done"}\n\n');
    });
    for (const cookie of cookies) {
      const result = await getExecutor("adapta-web").execute(input(cookie));
      expect(result.response.status).toBe(200);
      expect((await result.response.json()).choices[0].message.content).toBe("ok");
      expect(JSON.stringify(result.headers)).not.toContain(tokens[cookies.indexOf(cookie)]);
    }
    expect(seen).toEqual(tokens.map((token) => `Bearer ${token}`));
  });
});

describe("expiry and errors", () => {
  it("refreshes at the expiry buffer and evicts a rejected token", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let issued = 0; let chats = 0;
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/v1/client")) return Response.json({ response: { sessions: [{ id: "active", status: "active" }] } });
      if (String(url).endsWith("/tokens")) { issued++; return Response.json({ jwt: jwt(String(issued), Math.floor(Date.now() / 1000) + 60) }); }
      chats++; return chats === 2 ? new Response("secret diagnostic", { status: 401 }) : new Response('data: {"type":"done"}\n\n');
    });
    const executor = getExecutor("adapta-web"); const request = input("expiry-cookie");
    expect((await executor.execute(request)).response.status).toBe(200);
    vi.advanceTimersByTime(31000);
    const rejected = await executor.execute(request);
    expect(rejected.response.status).toBe(401);
    expect(await rejected.response.text()).not.toContain("secret diagnostic");
    expect((await executor.execute(request)).response.status).toBe(200);
    expect(issued).toBe(3);
  });

  it("redacts authentication errors and never sends the cookie to chat on failure", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("fake-secret diagnostic"); });
    const result = await getExecutor("adapta-web").execute(input("fake-secret"));
    expect(result.response.status).toBe(401);
    expect(await result.response.text()).not.toContain("fake-secret");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("redacts stream error events", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/v1/client")) return Response.json({ response: { sessions: [{ id: "stream", status: "active" }] } });
      if (String(url).endsWith("/tokens")) return Response.json({ jwt: jwt("stream", Math.floor(Date.now() / 1000) + 300) });
      return new Response('data: {"type":"error","message":"private diagnostic"}\n\n');
    });
    const result = await getExecutor("adapta-web").execute({ ...input("stream-cookie"), stream: true });
    const text = await result.response.text();
    expect(text).toContain("Adapta upstream error");
    expect(text).not.toContain("private diagnostic");
    expect(text).toContain("[DONE]");
  });
});

it("saves an operator-supplied session through the provider entry point without returning it", async () => {
  const { POST } = await import("../../src/app/api/providers/route.js");
  const models = await import("@/models");
  const response = await POST(new Request("http://localhost/api/providers", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "adapta-web", name: "Adapta", apiKey: "__client=fake-cookie" }),
  }));
  expect(response.status).toBe(201);
  expect(models.createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({ provider: "adapta-web", apiKey: "__client=fake-cookie" }), expect.any(Object));
  expect(await response.text()).not.toContain("fake-cookie");
});
