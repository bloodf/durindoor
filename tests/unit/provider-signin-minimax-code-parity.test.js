import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Closed network only: every account and gateway call below reaches the mocked transport, and
// every token is synthetic. A private data directory is created before any module loads.
const privateRoot = vi.hoisted(() => {
  const { mkdtempSync, mkdirSync } = process.getBuiltinModule("node:fs");
  const { join } = process.getBuiltinModule("node:path");
  const { tmpdir } = process.getBuiltinModule("node:os");
  const root = mkdtempSync(join(tmpdir(), "minimax-code-parity-"));
  mkdirSync(join(root, "home"), { recursive: true });
  process.env.DATA_DIR = join(root, "data");
  process.env.HOME = join(root, "home");
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) delete process.env[key];
  return root;
});
const transport = vi.hoisted(() => vi.fn());
// The device-route block stubs connection storage; the chat-route block uses the real store.
const storage = vi.hoisted(() => ({ create: vi.fn(), realDb: false }));
const usage = vi.hoisted(() => ({ saveRequestUsage: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}) }));
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init) => ({ status: init?.status || 200, body }) },
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn(async () => {}) }));
vi.mock("@/lib/localDb", async (importOriginal) => {
  const actual = await importOriginal();
  const stubbed = { createProviderConnection: storage.create, getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn(), getProxyPoolById: vi.fn() };
  const pick = (name) => (...args) => (storage.realDb ? actual[name] : stubbed[name])(...args);
  return { ...actual, ...Object.fromEntries(Object.keys(stubbed).map((name) => [name, pick(name)])) };
});
vi.mock("@/lib/usageDb.js", async (importOriginal) => ({
  ...(await importOriginal()), appendRequestLog: vi.fn(async () => {}), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(),
  saveRequestDetail: usage.saveRequestDetail, saveRequestUsage: async (...args) => {
    await usage.saveRequestUsage(...args);
    if (storage.realDb) return (await importOriginal()).saveRequestUsage(...args);
  },
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({ connectionProxyEnabled: false, connectionProxyUrl: "", vercelRelayUrl: "" })),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({ ...(await importOriginal()), proxyAwareFetch: transport }));
import { minimaxCodeOAuthProvider as provider } from "../../src/lib/oauth/services/minimax-code.js";

beforeEach(() => { transport.mockReset(); });
afterAll(async () => {
  await global._dbAdapter?.instance?.close?.();
  const { rmSync } = await import("node:fs");
  rmSync(privateRoot, { recursive: true, force: true });
});
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

const GATEWAY_URL = "https://agent.minimax.io/mavis/api/v1/llm/v1/messages";
const SECRET = "upstream-secret-sk-synthetic-0000";
const anthropicOk = (text = "hello") => Response.json({ id: "msg_synthetic", type: "message", role: "assistant", model: "MiniMax-M3", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } });
const gatewayError = (status, headers = {}) => new Response(JSON.stringify({ type: "error", error: { type: status === 429 ? "rate_limit_error" : "api_error", message: `${SECRET} at /internal/node-7` } }), { status, headers: { "content-type": "application/json", ...headers } });
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`${code} ${SECRET}`), { code }) });
const bearerOf = (init) => new Headers(init.headers).get("authorization");
const gatewaySends = () => transport.mock.calls.filter(([url]) => String(url) === GATEWAY_URL);

describe("MiniMax Code gateway replay and disclosure contract", () => {
  let MinimaxCodeExecutor;
  beforeEach(async () => {
    vi.stubEnv("MINIMAX_CODE_GATEWAY_RETRIES", "1");
    ({ MinimaxCodeExecutor } = await import("../../open-sse/executors/minimax-code.js"));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

  const credentials = (token, region = "en") => ({ accessToken: token, providerSpecificData: { enableSessionDispatch: true, region } });
  const run = (extra = {}) => new MinimaxCodeExecutor({ retryBaseMs: 1 }).execute({
    model: "MiniMax-M3", body: { model: "MiniMax-M3", messages: [{ role: "user", content: "ping" }] }, stream: false, credentials: credentials("access-synthetic"), ...extra,
  });
  const errorOf = async (result) => (await result.response.json()).error;

  it.each([429])("replays only a definite %i refusal, and never echoes its body", async (status) => {
    transport.mockResolvedValue(gatewayError(status, { "retry-after": "17" }));
    const result = await run();
    expect(gatewaySends()).toHaveLength(2);
    expect(result.response.status).toBe(status);
    const text = await result.response.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("/internal/");
    if (status === 429) expect(result.response.headers.get("retry-after")).toBe("17");
  });

  it.each([500, 503, 529, 502, 504])("sends a %i once and reports the outcome as unknown", async (status) => {
    transport.mockResolvedValue(gatewayError(status));
    const result = await run();
    expect(gatewaySends()).toHaveLength(1);
    expect(result.response.status).toBe(status);
    const error = await errorOf(result);
    expect(error.code).toBe("upstream_outcome_unknown");
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(error.message.length).toBeGreaterThan(0);
    expect(error.message.length).toBeLessThan(400);
  });

  it.each(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "ETIMEDOUT"])("never replays a connection lost after sending (%s)", async (code) => {
    transport.mockRejectedValueOnce(transportError(code)).mockResolvedValue(anthropicOk());
    const result = await run();
    expect(gatewaySends()).toHaveLength(1);
    expect(result.response.status).toBe(502);
    const error = await errorOf(result);
    expect(error.code).toBe("upstream_outcome_unknown");
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(error.message.length).toBeGreaterThan(0);
    expect(error.message.length).toBeLessThan(400);
  });

  it.each([500, 503, 529, 502, 504, "drop"])("operator retries cannot replay uncertain %s", async (status) => {
    if (status === "drop") transport.mockRejectedValue(transportError("ECONNRESET"));
    else transport.mockResolvedValue(gatewayError(status));
    const result = await run({ requestPolicy: { maxTransportAttempts: 4, skipRules: [{ provider: "minimax-code", action: "retry", match: { status: status === "drop" ? 502 : status } }] } });
    expect(gatewaySends()).toHaveLength(1);
    expect((await errorOf(result)).code).toBe("upstream_outcome_unknown");
  });

  it("treats a transport error without a proven code as possibly accepted", async () => {
    transport.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValue(anthropicOk());
    expect((await errorOf(await run())).code).toBe("upstream_outcome_unknown");
    expect(gatewaySends()).toHaveLength(1);
  });

  it("retries a provably unsent connection on the same token and proxy, then stops", async () => {
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-a.invalid" };
    transport.mockRejectedValueOnce(transportError("ECONNREFUSED")).mockResolvedValue(anthropicOk());
    expect((await run({ proxyOptions })).response.status).toBe(200);
    expect(gatewaySends().map(([, init, proxy]) => [bearerOf(init), proxy])).toEqual([
      ["Bearer access-synthetic", proxyOptions], ["Bearer access-synthetic", proxyOptions],
    ]);
    transport.mockReset();
    transport.mockRejectedValue(transportError("ENOTFOUND"));
    const unreachable = await run();
    expect(gatewaySends()).toHaveLength(2);
    expect(unreachable.response.status).toBe(503);
    const error = await errorOf(unreachable);
    expect(error.code).toBe("gateway_unreachable");
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(error.message.length).toBeGreaterThan(0);
    expect(error.message.length).toBeLessThan(400);
  });

  it("preserves cancellation during the unsent-retry backoff", async () => {
    vi.useFakeTimers();
    transport.mockRejectedValue(transportError("ECONNREFUSED"));
    const controller = new AbortController();
    const pending = new MinimaxCodeExecutor({ retryBaseMs: 10_000 }).execute({
      model: "MiniMax-M3", body: { model: "MiniMax-M3", messages: [{ role: "user", content: "ping" }] }, stream: false, credentials: credentials("access-synthetic"), signal: controller.signal,
    });
    const settled = pending.then(() => "resolved", () => "rejected");
    await vi.advanceTimersByTimeAsync(10);
    expect(gatewaySends()).toHaveLength(1);
    controller.abort(new DOMException("client went away", "AbortError"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await settled).toBe("rejected");
    expect(gatewaySends()).toHaveLength(1);
  });

  it("maps 4xx, context and 200 error envelopes to fixed public messages", async () => {
    for (const [status, body, expected] of [
      [400, { type: "error", error: { type: "invalid_request_error", message: `context window exceeds limit ${SECRET}` } }, [413, "context_length_exceeded"]],
      [403, { type: "error", error: { type: "permission_error", message: SECRET } }, [403, "gateway_error"]],
      [200, { type: "error", error: { type: "rate_limit_error", message: SECRET } }, [429, "quota_exceeded"]],
      [200, { type: "error", error: { type: "api_error", message: SECRET } }, [500, "upstream_outcome_unknown"]],
    ]) {
      transport.mockReset();
      transport.mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "retry-after": `${SECRET}` } }));
      const result = await run();
      expect([result.response.status, (await result.response.clone().json()).error.code]).toEqual(expected);
      expect(result.response.headers.get("retry-after")).toBeNull();
      expect(await result.response.text()).not.toContain(SECRET);
      expect(gatewaySends()).toHaveLength(1);
    }
  });

  it("keeps concurrent accounts on their own token and proxy route", async () => {
    transport.mockImplementation(async (_url, init) => anthropicOk(bearerOf(init)));
    const proxies = [{ connectionProxyUrl: "http://proxy-a.invalid" }, { connectionProxyUrl: "http://proxy-b.invalid" }];
    const results = await Promise.all(["access-a", "access-b"].map((token, i) => run({ credentials: credentials(token), proxyOptions: proxies[i] })));
    expect(await Promise.all(results.map(async (result) => (await result.response.json()).content[0].text))).toEqual(["Bearer access-a", "Bearer access-b"]);
    const sent = gatewaySends().map(([, init, proxy]) => [bearerOf(init), proxy]).sort(([a], [b]) => a.localeCompare(b));
    expect(sent).toEqual([["Bearer access-a", proxies[0]], ["Bearer access-b", proxies[1]]]);
  });
});

describe("MiniMax Code chat route never replays possibly accepted work", () => {
  let handleChat, repo;
  beforeEach(async () => {
    storage.realDb = true;
    vi.stubEnv("MINIMAX_CODE_GATEWAY_RETRIES", "1");
    usage.saveRequestUsage.mockClear();
    ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
    repo = await import("../../src/lib/db/repos/connectionsRepo.js");
    for (const [name, token] of [["mmc-a", "access-a"], ["mmc-b", "access-b"]]) {
      await repo.createProviderConnection({
        provider: "minimax-code", authType: "oauth", name, accessToken: token, refreshToken: `refresh-${token}`, isActive: true,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(), providerSpecificData: { authKind: "oauth", region: "en", enableSessionDispatch: true },
      });
    }
  });
  afterEach(async () => {
    for (const row of await repo.getProviderConnections({ provider: "minimax-code" })) await repo.deleteProviderConnection(row.id);
    storage.realDb = false;
    vi.unstubAllEnvs();
  });

  const chat = (model = "mmcode/MiniMax-M3", signal) => handleChat(new Request("http://gateway.invalid/v1/chat/completions", {
    method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }] }),
  }));

  it.each([
    ["a connection lost after sending", () => Promise.reject(transportError("ECONNRESET")), 502],
    ...[500, 503, 529].map((status) => [`an uncertain ${status}`, async () => gatewayError(status), status]),
    ["an intermediary 504", async () => gatewayError(504), 504],
    ["an intermediary 502", async () => gatewayError(502), 502],
  ])("submits exactly once on %s, with no sibling replay and no invented usage", async (_name, answer, status) => {
    transport.mockImplementation(answer);
    const response = await chat();
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toMatch(/"usage"/);
    expect(gatewaySends()).toHaveLength(1);
    expect(usage.saveRequestUsage).toHaveBeenCalledTimes(1);
    const receipt = usage.saveRequestUsage.mock.calls[0][0];
    const selected = await repo.getProviderConnections({ provider: "minimax-code" });
    expect(selected.find((row) => row.id === receipt.connectionId).accessToken).toBe(bearerOf(gatewaySends()[0][1]).slice(7));
    expect(receipt).toMatchObject({ cost: null, costStatus: "unknown", status: "error", meta: { outcome: "unknown", tokenStatus: "unknown" } });
    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    const rowsForReceipt = await adapter.all("SELECT * FROM usageHistory WHERE connectionId = ?", [receipt.connectionId]);
    expect(rowsForReceipt).toHaveLength(1);
    expect(rowsForReceipt[0].cost).toBeNull();
    expect(JSON.parse(rowsForReceipt[0].meta)).toMatchObject({ costStatus: "unknown", outcome: "unknown" });
    // The account that may have done the work is not cooled down on a guess.
    const rows = await repo.getProviderConnections({ provider: "minimax-code" });
    expect(rows.every((row) => row.testStatus !== "unavailable" && !Object.entries(row).some(([key, value]) => key.startsWith("modelLock_") && value))).toBe(true);
  });

  it("submits exactly once when the response headers never arrive", async () => {
    vi.stubEnv("MINIMAX_CODE_GATEWAY_TIMEOUT_MS", "5000");
    vi.stubEnv("MINIMAX_CODE_RESPONSE_HEADERS_TIMEOUT_MS", "50");
    transport.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));
    const response = await chat();
    expect(response.status).toBe(502);
    const error = (await response.json()).error;
    expect(error.code).toBe("upstream_outcome_unknown");
    expect(error.message).toContain("response headers within 50 ms");
    expect(error.message.length).toBeGreaterThan(0);
    expect(error.message.length).toBeLessThan(400);
    expect(error.message).not.toContain(SECRET);
    expect(gatewaySends()).toHaveLength(1);
    expect(usage.saveRequestUsage).toHaveBeenCalledTimes(1);
    const receipt = usage.saveRequestUsage.mock.calls[0][0];
    const selected = await repo.getProviderConnections({ provider: "minimax-code" });
    expect(selected.find((row) => row.id === receipt.connectionId).accessToken).toBe(bearerOf(gatewaySends()[0][1]).slice(7));
    expect(receipt).toMatchObject({ cost: null, costStatus: "unknown", status: "error", meta: { outcome: "unknown", tokenStatus: "unknown" } });
    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    const rowsForReceipt = await adapter.all("SELECT * FROM usageHistory WHERE connectionId = ?", [receipt.connectionId]);
    expect(rowsForReceipt).toHaveLength(1);
    expect(rowsForReceipt[0].cost).toBeNull();
    expect(JSON.parse(rowsForReceipt[0].meta)).toMatchObject({ costStatus: "unknown", outcome: "unknown" });
  });

  it("does not advance a combo after uncertain accepted work", async () => {
    const combos = await import("../../src/lib/db/repos/combosRepo.js");
    const combo = await combos.createCombo({ name: "mmc-uncertain", models: ["mmcode/MiniMax-M3", "mmcode/MiniMax-M3.1-Flash"] });
    try {
      transport.mockResolvedValue(gatewayError(503));
      expect((await chat(combo.name)).status).toBe(503);
      expect(gatewaySends()).toHaveLength(1);
      expect(usage.saveRequestUsage).toHaveBeenCalledTimes(1);
    } finally { await combos.deleteCombo(combo.id); }
  });

  it("records uncertainty on the whole-call deadline", async () => {
    vi.stubEnv("MINIMAX_CODE_GATEWAY_TIMEOUT_MS", "40");
    transport.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));
    expect((await chat()).status).toBe(500);
    expect(gatewaySends()).toHaveLength(1);
    expect(usage.saveRequestUsage).toHaveBeenCalledTimes(1);
  });

  it("preserves abort after dispatch and records uncertainty once", async () => {
    const controller = new AbortController();
    transport.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      controller.abort(new DOMException("cancelled", "AbortError"));
    }));
    expect((await chat(undefined, controller.signal)).status).toBe(499);
    expect(gatewaySends()).toHaveLength(1);
    expect(usage.saveRequestUsage).toHaveBeenCalledTimes(1);
  });

  it("lets a sibling serve a request the first account provably never sent", async () => {
    transport.mockImplementation(async (_url, init) => {
      if (bearerOf(init) === "Bearer access-a") throw transportError("ECONNREFUSED");
      return anthropicOk("from-b");
    });
    const response = await chat();
    expect(response.status).toBe(200);
    expect((await response.json()).choices[0].message.content).toBe("from-b");
    const bearers = gatewaySends().map(([, init]) => bearerOf(init));
    expect(bearers.filter((bearer) => bearer === "Bearer access-b")).toHaveLength(1);
    expect(bearers.every((bearer) => ["Bearer access-a", "Bearer access-b"].includes(bearer))).toBe(true);
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
