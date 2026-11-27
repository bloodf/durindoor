import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QoderService } from "../../src/lib/oauth/services/qoder.js";
import { pollForToken, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { QoderExecutor } from "../../open-sse/executors/qoder.js";
import { clearQoderCatalog } from "../../open-sse/services/qoderModels.js";

const transport = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: transport }));

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Qoder regional device contracts", () => {
  it("binds each concurrent login to its own PKCE, machine and token", async () => {
    const fetcher = vi.fn(async (url, init) => {
      const parsed = new URL(url);
      const cn = parsed.hostname.endsWith(".com.cn");
      if (parsed.pathname.endsWith("/poll")) return Response.json({ token: cn ? "dt-cn" : "dt-global", user_id: cn ? "cn" : "global" });
      expect(init.headers.Authorization).toBe(`Bearer dt-${cn ? "cn" : "global"}`);
      return Response.json({ email: `${cn ? "cn" : "global"}@example.invalid` });
    });
    vi.stubGlobal("fetch", fetcher);
    const flows = await Promise.all([requestDeviceCode("qoder"), requestDeviceCode("qoder-cn")]);
    for (const flow of flows) {
      const url = new URL(flow.verification_uri_complete);
      expect(url.searchParams.get("challenge")).toBe(crypto.createHash("sha256").update(flow.codeVerifier).digest("base64url"));
      expect(url.searchParams.get("nonce")).toBe(flow.device_code);
      expect(url.searchParams.get("machine_id")).toBe(flow._qoderMachineId);
    }
    expect(flows[0].codeVerifier).not.toBe(flows[1].codeVerifier);
    const results = await Promise.all(flows.map((flow, i) => pollForToken(i ? "qoder-cn" : "qoder", flow.device_code, flow.codeVerifier, flow)));
    expect(results.map(r => r.tokens.accessToken)).toEqual(["dt-global", "dt-cn"]);
    expect(results.map(r => r.tokens.providerSpecificData.machineId)).toEqual(flows.map(f => f._qoderMachineId));
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("returns pending and hides rejected upstream bodies", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 202 })).mockResolvedValueOnce(Response.json({ message: "synthetic-secret" }, { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    const service = new QoderService();
    expect(await service.pollDeviceToken({ nonce: "nonce", codeVerifier: "verifier" })).toEqual({ status: "pending" });
    await expect(service.pollDeviceToken({ nonce: "nonce", codeVerifier: "verifier" })).rejects.toThrow("HTTP 403");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not expose malformed upstream content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("synthetic-secret", { status: 200 })));
    await expect(new QoderService().pollDeviceToken({ nonce: "n", codeVerifier: "v" })).rejects.toThrow(/^Qoder device token poll: invalid JSON response$/);
  });

  it("rejects an already expired token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ token: "dt-expired", expires_in: 0 })));
    await expect(new QoderService().pollDeviceToken({ nonce: "n", codeVerifier: "v" })).rejects.toThrow("expired");
  });

  it("aborts a stalled poll at the request deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))));
    const result = new QoderService().pollDeviceToken({ nonce: "n", codeVerifier: "v" });
    const assertion = expect(result).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it.each(["qoder", "qoder-cn"])("does not refresh device credentials for %s", async provider => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const executor = new QoderExecutor(provider);
    expect(executor.needsRefresh({ accessToken: "dt-expired", refreshToken: "fake" })).toBe(false);
    expect(await executor.refreshCredentials({ accessToken: "dt-expired", refreshToken: "fake" })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});


describe("Qoder request identity and streaming", () => {
  it("keeps two regional accounts and proxies separate from catalog through accepted chat", async () => {
    clearQoderCatalog();
    transport.mockReset();
    transport.mockImplementation(async (url) => {
      if (url.includes("/model/list")) return Response.json({ chat: [{ key: "auto", display_name: "Auto", max_output_tokens: 1024 }] });
      const frame = body => `data: ${JSON.stringify({ statusCodeValue: 200, body })}\n\n`;
      return new Response(frame(JSON.stringify({ choices: [{ delta: { content: "hello" }, finish_reason: "stop" }] })) + frame("[DONE]"));
    });
    const providers = ["qoder", "qoder-cn"];
    const results = await Promise.all(providers.map(async (provider, i) => {
      const executor = new QoderExecutor(provider);
      executor.config = { timeoutMs: 1000 };
      const result = await executor.execute({
        model: `${provider}/auto`,
        body: { messages: [{ role: "system", content: "rules" }, { role: "user", content: `hello-${i}` }], max_tokens: 50 },
        stream: true,
        credentials: { accessToken: `dt-${i}`, providerSpecificData: { userId: `user-${i}`, machineId: `machine-${i}` } },
        proxyOptions: { proxyUrl: `http://proxy-${i}.invalid` },
      });
      expect(result.transformedBody.system).toBe("rules");
      expect(result.transformedBody.chat_context.text).toBe(`hello-${i}`);
      expect(result.transformedBody.parameters.max_tokens).toBe(50);
      expect(await result.response.text()).toContain("[DONE]");
    }));
    expect(results).toHaveLength(2);
    expect(transport).toHaveBeenCalledTimes(4);
    for (const [url, init, proxy] of transport.mock.calls) {
      const cn = url.includes(".com.cn");
      const i = cn ? 1 : 0;
      expect(init.headers["Cosy-User"]).toBe(`user-${i}`);
      expect(init.headers["Cosy-Machineid"]).toBe(`machine-${i}`);
      expect(init.headers.Authorization).toMatch(/^Bearer COSY\./);
      expect(proxy.proxyUrl).toBe(`http://proxy-${i}.invalid`);
      if (init.method === "POST") expect(proxy.strictProxy).toBe(true);
    }
  });

  it("rejects missing credentials before any model or chat request", async () => {
    clearQoderCatalog(); transport.mockReset();
    const executor = new QoderExecutor();
    const result = await executor.execute({ model: "qoder/auto", body: { messages: [] }, stream: true, credentials: {} });
    expect(result.response.status).toBe(401);
    expect(transport).not.toHaveBeenCalled();
  });
});

const saveConnection = vi.hoisted(() => vi.fn());
vi.mock("@/lib/localDb", () => ({
  createProviderConnection: saveConnection,
  getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn(), getProxyPoolById: vi.fn(),
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn() }));
vi.mock("@/lib/oauth/utils/server", () => ({
  clearCodexSession: vi.fn(), clearXaiSession: vi.fn(), getCodexSessionStatus: vi.fn(),
  getXaiSessionStatus: vi.fn(), registerCodexSession: vi.fn(), registerXaiSession: vi.fn(),
  startCodexProxy: vi.fn(), startXaiProxy: vi.fn(), stopCodexProxy: vi.fn(), stopXaiProxy: vi.fn(),
}));

import { clearOAuthFlowsForTests } from "../../src/lib/oauth/flowStore.js";

describe("server-owned Qoder device flows", () => {
  it.each(["qoder", "qoder-cn"])("rejects unsupported authorization and import modes for %s before network", async provider => {
    clearOAuthFlowsForTests();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
    const post = (action, body) => POST({ json: async () => body }, { params: Promise.resolve({ provider, action }) });
    const authorization = await post("authorize", {});
    expect((await authorization.json()).authUrl).toBeNull();
    for (const [action, body] of [["exchange", { code: "fake", state: "fake", flowId: "fake" }], ["import-token", { token: "fake" }]]) {
      expect((await post(action, body)).status).toBeGreaterThanOrEqual(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects cross-provider and replayed claims while retaining the original verifier and machine", async () => {
    clearOAuthFlowsForTests(); saveConnection.mockReset();
    saveConnection.mockImplementation(async (data, options) => {
      expect(options.shouldCommit()).toBe(true);
      return { id: "connection", ...data };
    });
    const fetcher = vi.fn(async url => {
      if (url.includes("/poll")) return Response.json({ token: "dt-test", user_id: "user-test" });
      return Response.json({ email: "user@example.invalid" });
    });
    vi.stubGlobal("fetch", fetcher);
    const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
    const post = (provider, action, body) => POST({ json: async () => body }, { params: Promise.resolve({ provider, action }) });
    const started = await (await post("qoder", "device-code", { proxyMode: "direct" })).json();
    expect(started).not.toHaveProperty("codeVerifier");
    expect(started).not.toHaveProperty("device_code");
    const login = new URL(started.verification_uri_complete);
    const wrong = await post("qoder-cn", "poll", { flowId: started.flowId });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(fetcher).not.toHaveBeenCalled();
    const response = await post("qoder", "poll", { flowId: started.flowId, codeVerifier: "attacker", deviceCode: "attacker" });
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    const poll = new URL(fetcher.mock.calls[0][0]);
    expect(poll.searchParams.get("nonce")).toBe(login.searchParams.get("nonce"));
    expect(crypto.createHash("sha256").update(poll.searchParams.get("verifier")).digest("base64url")).toBe(login.searchParams.get("challenge"));
    expect(saveConnection.mock.calls[0][0].providerSpecificData.machineId).toBe(login.searchParams.get("machine_id"));
    const replay = await post("qoder", "poll", { flowId: started.flowId });
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(saveConnection).toHaveBeenCalledTimes(1);
  });
});


describe("staged web registration", () => {
  it("rejects unsupported Qoder actions without affecting device or other providers", async () => {
    const { assertQoderWebAction } = await import("../../src/lib/oauth/providerParity/qoder/modes.js");
    for (const provider of ["qoder", "qoder-cn"]) {
      for (const action of ["authorize", "exchange", "import-token"]) {
        expect(() => assertQoderWebAction(provider, action)).toThrow("device sign-in");
      }
      expect(() => assertQoderWebAction(provider, "device-code")).not.toThrow();
    }
    expect(() => assertQoderWebAction("other", "authorize")).not.toThrow();
  });
});
