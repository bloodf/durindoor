import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => vi.fn());
const storage = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init) => ({ status: init?.status || 200, body }) },
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn(async () => {}) }));
vi.mock("@/lib/localDb", () => ({
  createProviderConnection: storage.create,
  getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn(), getProxyPoolById: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({ connectionProxyEnabled: false, connectionProxyUrl: "", vercelRelayUrl: "" })),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: transport }));
import { minimaxCodeOAuthProvider as provider } from "../../src/lib/oauth/services/minimax-code.js";

beforeEach(() => { transport.mockReset(); });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

describe("MiniMax Code provider transport contract", () => {
  it("keeps concurrent regions, verifiers and proxies associated with their grants", async () => {
    transport.mockImplementation(async (url, init) => {
      const form = new URLSearchParams(init.body);
      if (url.endsWith("/device/code")) return json({ device_code: form.get("code_challenge"), user_code: "CODE" });
      return json({ access_token: form.get("code_verifier"), refresh_token: "synthetic-refresh" });
    });
    const proxies = [{ proxyUrl: "http://proxy-a" }, { proxyUrl: "http://proxy-b" }];
    const issued = await Promise.all(["en", "cn"].map((region, i) => provider.requestDeviceCode(provider.config, `challenge-${i}`, { region }, proxies[i])));
    const tokens = await Promise.all(issued.map((grant, i) => provider.pollToken(provider.config, grant.device_code, `verifier-${i}`, null, proxies[i])));
    expect(tokens.map((token) => provider.mapTokens(token.data))).toMatchObject([
      { accessToken: "verifier-0", providerSpecificData: { region: "en", clientId: "mcode-public" } },
      { accessToken: "verifier-1", providerSpecificData: { region: "cn", clientId: "mcode-public" } },
    ]);
    expect(transport.mock.calls.map(([url, , proxy]) => [new URL(url).hostname, proxy])).toEqual([
      ["account.minimax.io", proxies[0]], ["account.minimax.cn", proxies[1]],
      ["account.minimax.io", proxies[0]], ["account.minimax.cn", proxies[1]],
    ]);
    expect(transport.mock.calls).toHaveLength(4);
  });

  it("does not expose account error bodies and preserves terminal protocol states", async () => {
    transport.mockResolvedValueOnce(json({ error: "secret-token", error_description: "secret-body" }, 400));
    await expect(provider.requestDeviceCode(provider.config, "challenge")).rejects.toThrow("MiniMax Code device authorization failed.");
    transport.mockResolvedValueOnce(json({ error: "expired_token", error_description: "secret-body" }, 400));
    expect(await provider.pollToken(provider.config, "en|device", "verifier")).toEqual({ ok: false, data: { error: "expired_token", error_description: "" } });
    transport.mockResolvedValueOnce(json({ error: "secret-token" }, 400));
    expect(await provider.pollToken(provider.config, "en|device", "verifier")).toEqual({ ok: false, data: { error: "poll_failed", error_description: "" } });
  });
});


describe("registered MiniMax Code device route", () => {
  const post = async (action, body) => {
    const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
    return POST({ json: async () => body }, { params: Promise.resolve({ provider: "minimax-code", action }) });
  };
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    (await import("../../src/lib/oauth/flowStore.js")).clearOAuthFlowsForTests();
    storage.create.mockReset();
    storage.create.mockImplementation(async (data, options) => {
      if (!options.shouldCommit()) throw new Error("stale flow");
      return { id: "connection-synthetic", ...data };
    });
  });
  afterEach(() => { vi.useRealTimers(); });

  it("keeps the verifier server-side, handles pending and consumes an accepted grant once", async () => {
    transport.mockResolvedValueOnce(json({ device_code: "device-secret", user_code: "ABCD", verification_uri: "https://account.minimax.io/device", expires_in: 60 }));
    const started = await post("device-code", { proxyMode: "direct" });
    expect(started.status).toBe(200);
    expect(JSON.stringify(started.body)).not.toContain("device-secret");
    const challenge = new URLSearchParams(transport.mock.calls[0][1].body).get("code_challenge");
    transport.mockResolvedValueOnce(json({ error: "authorization_pending" }, 400));
    const pending = await post("poll", { flowId: started.body.flowId });
    expect(pending.body).toMatchObject({ pending: true, error: "authorization_pending" });
    transport.mockResolvedValueOnce(json({ access_token: "access-synthetic", refresh_token: "refresh-synthetic", expires_in: 3600 }));
    const completed = await post("poll", { flowId: started.body.flowId });
    expect(completed.body).toMatchObject({ success: true });
    const form = new URLSearchParams(transport.mock.calls[2][1].body);
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(form.get("code_verifier")).digest("base64url")).toBe(challenge);
    expect(form.get("device_code")).toBe("device-secret");
    expect(storage.create.mock.calls[0][0]).toMatchObject({ provider: "minimax-code", accessToken: "access-synthetic", refreshToken: "refresh-synthetic", providerSpecificData: { clientId: "mcode-public", region: "en" } });
    expect(JSON.stringify(completed.body)).not.toContain("access-synthetic");
    expect(JSON.stringify(completed.body)).not.toContain("refresh-synthetic");
    expect((await post("poll", { flowId: started.body.flowId })).status).toBe(410);
    expect(transport.mock.calls).toHaveLength(3);
    expect(storage.create.mock.calls).toHaveLength(1);
  });

  it("consumes denied grants and prevents overlapping submissions", async () => {
    transport.mockResolvedValueOnce(json({ device_code: "device-secret", user_code: "ABCD", expires_in: 60 }));
    const started = await post("device-code", { proxyMode: "direct" });
    let finish;
    transport.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = post("poll", { flowId: started.body.flowId });
    // Let the real route claim the flow and start its single outbound poll.
    for (let i = 0; i < 20 && !finish; i += 1) await Promise.resolve();
    expect(finish).toBeTypeOf("function");
    const duplicate = await post("poll", { flowId: started.body.flowId });
    expect(duplicate.status).toBe(409);
    finish(json({ error: "access_denied", error_description: "private upstream body" }, 400));
    const denied = await first;
    expect(denied.body).toMatchObject({ success: false, error: "access_denied", pending: false });
    expect(JSON.stringify(denied.body)).not.toContain("private upstream body");
    expect((await post("poll", { flowId: started.body.flowId })).status).toBe(410);
    expect(transport.mock.calls).toHaveLength(2);
    expect(storage.create.mock.calls).toHaveLength(0);
  });

  it("expires a device flow before polling and rejects token import before network", async () => {
    expect((await post("import-token", { accessToken: "synthetic-token" })).status).toBe(400);
    expect(transport.mock.calls).toHaveLength(0);
    transport.mockResolvedValueOnce(json({ device_code: "device-secret", user_code: "ABCD", expires_in: 1 }));
    const started = await post("device-code", { proxyMode: "direct" });
    vi.advanceTimersByTime(1001);
    expect((await post("poll", { flowId: started.body.flowId })).status).toBe(410);
    expect(transport.mock.calls).toHaveLength(1);
    expect(storage.create.mock.calls).toHaveLength(0);
  });
});

describe("MiniMax Code refresh and account deadline", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("rotates two refresh tokens without mixing region, proxy or connection metadata", async () => {
    const { refreshMinimaxCodeToken } = await import("../../open-sse/services/minimaxCodeAuth.js");
    transport.mockImplementation(async (url, init) => {
      const token = new URLSearchParams(init.body).get("refresh_token");
      return json({ access_token: `access-${token}`, refresh_token: `next-${token}`, expires_in: 7200 });
    });
    const proxies = [{ name: "a" }, { name: "b" }];
    const result = await Promise.all(["en", "cn"].map((region, i) => refreshMinimaxCodeToken({ refreshToken: `refresh-${i}`, providerSpecificData: { region, clientId: "mcode-public", marker: i } }, null, proxies[i])));
    expect(result).toMatchObject([
      { accessToken: "access-refresh-0", refreshToken: "next-refresh-0", providerSpecificData: { region: "en", marker: 0, clientId: "mcode-public" } },
      { accessToken: "access-refresh-1", refreshToken: "next-refresh-1", providerSpecificData: { region: "cn", marker: 1, clientId: "mcode-public" } },
    ]);
    expect(transport.mock.calls.map(([url, init, proxy]) => [new URL(url).hostname, new URLSearchParams(init.body).get("refresh_token"), proxy])).toEqual([
      ["account.minimax.io", "refresh-0", proxies[0]], ["account.minimax.cn", "refresh-1", proxies[1]],
    ]);
    transport.mockResolvedValueOnce(json({ error: "invalid_grant", error_description: "secret-upstream" }, 400));
    expect(await refreshMinimaxCodeToken({ refreshToken: "revoked" })).toBeNull();
  });

  it("aborts a stalled account request at its deadline", async () => {
    vi.useFakeTimers();
    transport.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const request = provider.requestDeviceCode(provider.config, "challenge");
    const assertion = expect(request).rejects.toMatchObject({ code: "account_unreachable" });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(transport.mock.calls).toHaveLength(1);
    expect(transport.mock.calls[0][1].signal.aborted).toBe(true);
  });
});

// Staged web wiring: remove this isolated block when the shared route registers the helper.
describe("staged device-only web guard", () => {
  it("rejects unsupported actions and leaves device actions to the shared flow", async () => {
    const { assertMinimaxCodeWebAction } = await import("../../src/lib/oauth/providerParity/minimax-code/web.js");
    for (const action of ["authorize", "exchange", "import-token"]) {
      expect(() => assertMinimaxCodeWebAction(action)).toThrow("device sign-in only");
    }
    expect(() => assertMinimaxCodeWebAction("device-code")).not.toThrow();
    expect(() => assertMinimaxCodeWebAction("poll")).not.toThrow();
  });
});
