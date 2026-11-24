import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), connection: vi.fn() }));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch, resolveProxyForRequest: () => ({ source: "direct", proxyUrl: null }) }));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: mocks.connection }));
vi.mock("@/lib/db/repos/monitoringUsageRepo.js", () => ({ getConnectionUsageSummary: vi.fn() }));
vi.mock("@/lib/usage/xaiQuotaAdapter.js", () => ({ fetchXaiQuota: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/oauth/services/cursorLocalStore.js", () => ({ backfillCursorConnectionIdentity: vi.fn(async (c) => c) }));
vi.mock("@/shared/services/providerCredentials", () => ({ refreshAndUpdateCredentials: vi.fn(async (c) => ({ connection: c })) }));
vi.mock("@/dashboardGuard", () => ({ isNonAdminApiKeyCaller: vi.fn(async () => false) }));

import { GET } from "../../src/app/api/usage/[connectionId]/route.js";


beforeEach(() => {
  mocks.fetch.mockReset().mockRejectedValue(new Error("No mocked Cursor response"));
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Outbound network disabled"));
});
afterEach(() => vi.restoreAllMocks());

const json = (value, status = 200) => Response.json(value, { status });
const request = () => GET(new Request("http://localhost/api/usage/test"), { params: Promise.resolve({ connectionId: "test" }) });

describe("Cursor usage parity through the usage route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.mockResolvedValue({ provider: "cursor", authType: "oauth", accessToken: "synthetic", providerSpecificData: {} });
  });

  it("returns sorted per-model billed usage alongside the existing quota", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ planUsage: { includedSpend: 100, limit: 1000 } }))
      .mockResolvedValueOnce(json({ planInfo: { planName: "Pro" } }))
      .mockResolvedValueOnce(json({ aggregations: [
        { modelIntent: "small", inputTokens: "12", totalCents: 5 },
        { modelIntent: "large", outputTokens: "8", totalCents: 12.345 },
        { modelIntent: "", totalCents: 500 },
      ] }));
    const response = await request();
    expect(response.status).toBe(200);
    const usage = await response.json();
    expect(usage.quotas["Included spend"].used).toBe(1);
    expect(usage.modelUsage).toEqual([
      { model: "large", inputTokens: 0, outputTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.1235 },
      { model: "small", inputTokens: 12, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.05 },
    ]);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps quota data when aggregated usage exceeds the response limit", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ planUsage: { includedSpend: 100, limit: 1000 } }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ padding: "x".repeat(1024 * 1024), aggregations: [{ modelIntent: "large", totalCents: 1 }] }));
    const usage = await (await request()).json();
    expect(usage.quotas["Included spend"].used).toBe(1);
    expect(usage.modelUsage).toBeUndefined();
  });

  it("keeps quota data when aggregated usage fails", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ planUsage: { includedSpend: 100, limit: 1000 } }))
      .mockResolvedValueOnce(json({}))
      .mockRejectedValueOnce(new Error("offline"));
    const usage = await (await request()).json();
    expect(usage.quotas["Included spend"].used).toBe(1);
    expect(usage.modelUsage).toBeUndefined();
  });
});

const loginMocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), update: vi.fn(), machine: vi.fn() }));
vi.mock("@/models", () => ({ createProviderConnection: loginMocks.create, getProviderConnections: loginMocks.list, updateProviderConnection: loginMocks.update }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: loginMocks.machine }));
import { POST as startLogin } from "../../src/app/api/oauth/cursor/login/start/route.js";
import { POST as pollLogin } from "../../src/app/api/oauth/cursor/login/poll/route.js";
import { POST as cancelLogin } from "../../src/app/api/oauth/cursor/login/cancel/route.js";
import { refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";
import { createHash } from "node:crypto";
import crypto from "node:crypto";

const post = (body = {}) => new Request("http://localhost/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("Cursor login and refresh routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loginMocks.machine.mockResolvedValue("synthetic-machine");
    loginMocks.list.mockResolvedValue([]);
    loginMocks.create.mockImplementation(async (c) => ({ ...c, id: "connection" }));
  });

  it("keeps the verifier server-side, polls pending and persists successful credentials once", async () => {
    const start = await (await startLogin(post())).json();
    const url = new URL(start.loginUrl);
    expect(start.verifier).toBeUndefined();
    expect(url.searchParams.get("redirectTarget")).toBe("cli");
    const token = `x.${Buffer.from(JSON.stringify({ sub: "account", email: "USER@EXAMPLE.COM", exp: 2000000000 })).toString("base64url")}.x`;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(json({ accessToken: token, refreshToken: "synthetic-refresh" }));
    expect((await (await pollLogin(post({ sessionId: start.sessionId }))).json()).status).toBe("pending");
    const pollUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(createHash("sha256").update(pollUrl.searchParams.get("verifier")).digest("base64url")).toBe(url.searchParams.get("challenge"));
    const result = await (await pollLogin(post({ sessionId: start.sessionId }))).json();
    expect(result).toMatchObject({ status: "ok", connection: { id: "connection", email: "user@example.com" } });
    expect(loginMocks.create).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: "synthetic-refresh", providerSpecificData: expect.objectContaining({ accountId: "account", machineId: "synthetic-machine" }) }), { createOnly: true });
    expect((await pollLogin(post({ sessionId: start.sessionId }))).status).toBe(410);
  });

  it("cancels sessions without calling Cursor", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const start = await (await startLogin(post())).json();
    expect(await (await cancelLogin(post({ sessionId: start.sessionId }))).json()).toMatchObject({ cancelled: true });
    expect((await pollLogin(post({ sessionId: start.sessionId }))).status).toBe(410);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries throttled refresh and keeps the rotated refresh token", async () => {
    const fetchMock = mocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(json({ accessToken: "new-access", refreshToken: "new-refresh" }));
    const result = await refreshTokenByProvider("cursor", { refreshToken: "old-refresh" }, null);
    expect(result).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves the expiry of a short-lived access token returned on refresh", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const accessToken = `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.x`;
    mocks.fetch.mockResolvedValueOnce(json({ accessToken }));
    const result = await refreshTokenByProvider("cursor", { refreshToken: "synthetic-short-refresh" }, null);
    expect(result.expiresAt).toBe(new Date(exp * 1000).toISOString());
  });

  it("refreshes via the configured proxy and retains an unrotated refresh token", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ accessToken: "new-opaque-token" }));
    const proxy = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid" };
    const result = await refreshTokenByProvider("cursor", { refreshToken: "refresh" }, null, proxy);
    expect(result).toMatchObject({ accessToken: "new-opaque-token", refreshToken: "refresh" });
    expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining("exchange_user_api_key"), expect.objectContaining({ method: "POST" }), proxy);
  });
});

import { EventEmitter } from "node:events";
import { resolveCursorModels, clearCursorModelCache } from "../../open-sse/services/cursorModels.js";
import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { cursorRequestDirectives } from "../../open-sse/executors/cursor.js";
import { decodeMessage, encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";
const h2 = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("http2", () => ({ default: h2, ...h2 }));

function failedModelConnection() {
  const client = new EventEmitter();
  const req = new EventEmitter();
  req.destroy = vi.fn();
  req.end = () => queueMicrotask(() => { req.emit("response", { ":status": 503 }); req.emit("end"); });
  client.request = () => req;
  client.destroy = vi.fn();
  return client;
}

function runConversationId(run) {
  const id = Buffer.from(run.get(5)[0].value).toString();
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(Buffer.from(run.get(16)[0].value).toString()).toBe(id);
  return id;
}

describe("Cursor catalog and request envelope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCursorModelCache();
    h2.connect.mockImplementation(failedModelConnection);
  });

  it("falls back from GetUsableModels to the JSON AvailableModels catalog", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ models: [{ modelId: "new-model", displayName: "New", contextTokenLimit: 1234 }, { id: "hidden", disabled: true }] }));
    const result = await resolveCursorModels({ accessToken: "token", providerSpecificData: { machineId: "machine" } }, { proxyOptions: { disableEnvProxy: true } });
    expect(result.models).toEqual([{ id: "auto", name: "Auto" }, { id: "new-model", name: "New", contextLength: 1234 }]);
    expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining("AiService/AvailableModels"), expect.objectContaining({ method: "POST", body: "{}" }), expect.any(Object));
  });

  it("uses a fresh conversation ID per request and reuses it on the tail-only retry", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ models: [] }));
    const executor = new CursorExecutor();
    const ids = [];
    executor.openAgentHttp2Stream = async () => ({
      responseHeaders: Promise.resolve({ ":status": 200 }),
      write(frame) {
        const run = decodeMessage(decodeMessage(frame.subarray(5)).get(1)[0].value);
        ids.push(runConversationId(run));
      },
      close() {}, end() {},
      read: async () => ({ done: true }),
    });
    const credentials = { accessToken: "token", providerSpecificData: { machineId: "machine" } };
    const body = {
      conversation_id: "client-supplied-id",
      messages: Array.from({ length: 100 }, () => ({ role: "user", content: "hello" })),
    };
    await executor.executeAgent({ model: "model", stream: false, credentials, body });
    await executor.executeAgent({ model: "model", stream: false, credentials, body });
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);
  });

  it("omits stop directives when there are no usable stop strings", () => {
    expect(cursorRequestDirectives({ stop: [] })).toBe("");
    expect(cursorRequestDirectives({ stop: ["", null, 0] })).toBe("");
    expect(cursorRequestDirectives({ stop: ["", "END"] })).toContain("sequences: END");
  });

  it("sends output constraints in the actual AgentService frame and removes disabled tools", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("conversation-test");
    mocks.fetch.mockResolvedValueOnce(json({ models: [] }));
    const executor = new CursorExecutor();
    const writes = [];
    const text = encodeField(1, 2, "ok");
    const frames = [wrapConnectRPCFrame(encodeField(1, 2, encodeField(1, 2, text))), wrapConnectRPCFrame(encodeField(1, 2, encodeField(14, 2, new Uint8Array())))];
    executor.openAgentHttp2Stream = async () => ({ responseHeaders: Promise.resolve({ ":status": 200 }), write: (frame) => writes.push(Buffer.from(frame)), close() {}, end() {}, read: async () => frames.length ? { value: frames.shift(), done: false } : { done: true } });
    const result = await executor.executeAgent({ model: "model", stream: false, credentials: { accessToken: "token", providerSpecificData: { machineId: "machine" } }, body: { conversation_id: "conversation-test", messages: [{ role: "user", content: "hello" }], tools: [{ type: "function", function: { name: "unwanted_tool", parameters: {} } }], tool_choice: "none", max_tokens: 100, response_format: { type: "json_object" } } });
    expect(result.response.status).toBe(200);
    const wire = writes[0].toString();
    expect(wire).toContain("100 output tokens");
    expect(wire).toContain("valid JSON object");
    expect(wire).not.toContain("unwanted_tool");
    const run = decodeMessage(decodeMessage(writes[0].subarray(5)).get(1)[0].value);
    expect(Buffer.from(run.get(5)[0].value).toString()).toBe("conversation-test");
    expect(Buffer.from(run.get(16)[0].value).toString()).toBe("conversation-test");
    expect(run.has(4)).toBe(false);
  });
});

describe("Cursor fallback and error behavior", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("uses summary usage when older endpoints return no quota", async () => {
    mocks.connection.mockResolvedValue({ provider: "cursor", authType: "oauth", accessToken: "synthetic", providerSpecificData: {} });
    mocks.fetch.mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ individualUsage: { plan: { used: 25, limit: 100 } } }));
    const result = await (await request()).json();
    expect(result.quotas.Total).toMatchObject({ used: 25, remaining: 75 });
    expect(mocks.fetch.mock.calls[3][0]).toContain("/api/usage/summary");
  });

  it.each([
    ["unavailable: temporarily overloaded", 502, "api_error"],
    ["permission_denied", 401, "authentication_error"],
    ["invalid argument", 400, "invalid_request_error"],
    ["not_found", 404, "invalid_request_error"],
  ])("classifies and sanitizes Connect error %s", async (message, status, type) => {
    const payload = Buffer.from(JSON.stringify({ error: { message: `${message} cursor_token=synthetic-secret /home/person/private` } }));
    const header = Buffer.alloc(5);
    header.writeUInt32BE(payload.length, 1);
    const response = new CursorExecutor().transformProtobufToJSON(Buffer.concat([header, payload]), "model", {});
    const result = await response.json();
    expect(response.status).toBe(status);
    expect(result.error.type).toBe(type);
    expect(result.error.message).not.toContain("synthetic-secret");
    expect(result.error.message).not.toContain("/home/person");
  });

  it("redacts an unlabeled synthetic Bearer credential from AgentService transport errors", async () => {
    const executor = new CursorExecutor();
    executor.executeAgent = vi.fn().mockRejectedValue(new Error("connection failed with Bearer synthetic-transport-token"));
    const result = await executor.execute({
      model: "model",
      body: { messages: [{ role: "user", content: "hello" }] },
    });
    const { error } = await result.response.json();
    expect(error.message).toBe("connection failed with Bearer [redacted]");
  });

  it("treats rejected refresh credentials as unrecoverable without retry", async () => {
    mocks.fetch.mockResolvedValueOnce(json({}, 401));
    const result = await refreshTokenByProvider("cursor", { refreshToken: "invalid-refresh" }, null, null);
    expect(result).toMatchObject({ error: "unrecoverable_refresh_error", code: "unauthorized" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Cursor Connect trailer errors", () => {
  it.each([false, true])("surfaces quota errors from HTTP 200 trailers (stream=%s)", async (stream) => {
    clearCursorModelCache();
    h2.connect.mockImplementation(failedModelConnection);
    mocks.fetch.mockResolvedValueOnce(json({ models: [] }));
    const payload = Buffer.from(JSON.stringify({ error: { code: "resource_exhausted", message: "quota exceeded cursor_token=secret" } }));
    const header = Buffer.alloc(5); header[0] = 2; header.writeUInt32BE(payload.length, 1);
    const frames = [Buffer.concat([header, payload])];
    const executor = new CursorExecutor();
    executor.openAgentHttp2Stream = async () => ({ responseHeaders: Promise.resolve({ ":status": 200 }), write() {}, close() {}, end() {}, read: async () => frames.length ? { value: frames.shift(), done: false } : { done: true } });
    const result = await executor.executeAgent({ model: "model", stream, credentials: { accessToken: "token", providerSpecificData: { machineId: "machine" } }, body: { messages: [{ role: "user", content: "hello" }] } });
    if (!stream) expect(result.response.status).toBe(429);
    const text = await result.response.text();
    expect(text).toContain("rate_limit_error");
    expect(text).not.toContain("cursor_token=secret");
  });
});

describe("Cursor HTTP error projection", () => {
  it("projects typed protobuf details from a non-200 response", async () => {
    clearCursorModelCache();
    h2.connect.mockImplementation(failedModelConnection);
    mocks.fetch.mockResolvedValueOnce(json({ models: [] }));
    const details = encodeField(2, 2, encodeField(1, 2, "quota exceeded"));
    const body = Buffer.from(JSON.stringify({ error: { code: "resource_exhausted", details: [{ type: "aiserver.v1.ErrorDetails", value: Buffer.from(details).toString("base64") }] } }));
    const frames = [body];
    const executor = new CursorExecutor();
    executor.openAgentHttp2Stream = async () => ({ responseHeaders: Promise.resolve({ ":status": 400 }), write() {}, close() {}, end() {}, read: async () => frames.length ? { value: frames.shift(), done: false } : { done: true } });
    const result = await executor.executeAgent({ model: "model", stream: false, credentials: { accessToken: "token", providerSpecificData: { machineId: "machine" } }, body: { messages: [{ role: "user", content: "hello" }] } });
    expect(result.response.status).toBe(429);
    expect((await result.response.json()).error.message).toContain("quota exceeded");
  });
});
