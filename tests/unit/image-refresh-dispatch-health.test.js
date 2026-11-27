import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// PR #2662 review: after a 401/403 the image core refreshes the credentials and
// retries. Account health must be written for the retried dispatch (its secret
// and send time), not the snapshot taken before the refresh, which the stored
// row no longer matches. A concurrent credential change must stay fenced.
const m = vi.hoisted(() => ({ credentials: vi.fn(), refresh: vi.fn() }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ refreshCredentials: m.refresh }) }));
vi.mock("@/lib/network/connectionProxy.js", () => ({ resolveConnectionProxyConfig: async () => ({}) }));
vi.mock("../../src/sse/services/auth.js", async (importOriginal) => ({
  ...(await importOriginal()), getProviderCredentialsWithQuotaPreflight: m.credentials
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async () => ({ provider: "codex", model: "gpt-image-fixture" }),
  getComboModels: async () => null, getComboCanonicalName: async () => null
}));
vi.mock("../../src/sse/services/tokenRefresh.js", async (importOriginal) => ({
  ...(await importOriginal()), checkAndRefreshToken: async (_provider, credentials) => credentials
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: async () => null, recordApiKeyUsageForResponse: async (_k, response) => response,
  recordApiKeyUsage: async () => {}, recordCancelledUsage: async () => {}
}));
vi.mock("../../src/sse/utils/requestCorrelation.js", () => ({ captureRequestBillingEpoch: async () => {}, getRequestId: () => "fixture", withRequestCorrelation: (fn) => fn }));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: () => false, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: () => ({}) }));

const id = "codex-image-refresh-fixture";
let dir, oldDataDir, db, localDb, handleImageGeneration;

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;
const failure = (status) => frame("error", { error: { code: status === 429 ? "rate_limit_exceeded" : "server_error", status_code: status, message: "provider failure" } });
const completed = frame("response.completed", { response: { status: "completed", output: [{ type: "image_generation_call", result: "eA==" }] } });
const sse = (body) => new Response(body, { headers: { "content-type": "text/event-stream" } });
/** Runs `before` when the client first reads the stream, then emits `text`. */
const sseAfter = (before, text) => sse(new ReadableStream({
  async pull(controller) {
    await before();
    controller.enqueue(new TextEncoder().encode(text));
    controller.close();
  }
}));
const stored = () => localDb.getProviderConnectionById(id);
const healthOf = (row) => ({
  testStatus: row.testStatus ?? null, errorCode: row.errorCode ?? null,
  locks: Object.keys(row).filter((key) => key.startsWith("modelLock_") && row[key])
});
const generate = (stream) => handleImageGeneration(new Request("http://localhost/v1/images/generations", {
  method: "POST", headers: stream ? { accept: "text/event-stream" } : {},
  body: JSON.stringify({ model: "codex/gpt-image-fixture", prompt: "fixture" })
}));
/** The upstream answers by the bearer token the dispatch presented. */
const upstream = (byToken) => vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
  const token = new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "");
  return byToken[token]?.() ?? new Response("unexpected", { status: 500 });
}));

// One data dir for the file: its secret key is cached in-process, so a fresh
// dir per test would leave stored secrets unreadable.
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "image-refresh-dispatch-"));
  oldDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
});

afterAll(() => {
  if (oldDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  delete global._dbAdapter;
  vi.resetModules();
  vi.clearAllMocks();
  const { getAdapter } = await import("../../src/lib/db/driver.js");
  db = await getAdapter();
  // An updatedAt in the past keeps the pre-refresh dispatch older than the refresh write.
  const earlier = new Date(Date.now() - 60_000).toISOString();
  db.run("DELETE FROM providerConnections WHERE id = ?", [id]);
  db.run(`INSERT INTO providerConnections(id, provider, authType, name, priority, isActive, data, createdAt, updatedAt)
    VALUES (?, 'codex', 'oauth', 'fixture', 1, 1, ?, ?, ?)`,
  [id, JSON.stringify({ accessToken: "old-access", refreshToken: "old-refresh", providerSpecificData: {} }), earlier, earlier]);
  localDb = await import("../../src/lib/localDb.js");
  const { projectProviderCredentials } = await import("../../src/sse/services/auth.js");
  m.credentials.mockImplementationOnce(async () => projectProviderCredentials(await stored())).mockResolvedValue(null);
  m.refresh.mockResolvedValue({ accessToken: "new-access", refreshToken: "new-refresh" });
  ({ handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js"));
}, 30_000);

afterEach(() => {
  vi.unstubAllGlobals();
  global._dbAdapter?.close?.();
  delete global._dbAdapter;
});

describe("image health after a 401/403 refresh and retry", () => {
  it.each([[401, 429], [403, 503]])("a streamed terminal failure after %i and a refresh marks the retried credential (%i)", async (authStatus, status) => {
    upstream({ "old-access": () => new Response("denied", { status: authStatus }), "new-access": () => sse(failure(status)) });
    const response = await generate(true);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("event: error");

    const row = await stored();
    expect(row.accessToken).toBe("new-access");
    expect(row.errorCode).toBe(status);
    expect(row.testStatus).toBe("unavailable");
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the health write fenced when the credential changes during the retried stream", async () => {
    upstream({
      "old-access": () => new Response("denied", { status: 401 }),
      // Another account's key replaces the row while the failure is still streaming.
      "new-access": () => sseAfter(() => localDb.updateProviderConnection(id, { accessToken: "other-account-access" }), failure(429))
    });
    const response = await generate(true);
    expect(await response.text()).toContain("event: error");

    const row = await stored();
    expect(row.accessToken).toBe("other-account-access");
    expect(healthOf(row)).toEqual({ testStatus: null, errorCode: null, locks: [] });
  });

  it("keeps the health write fenced when a concurrent refresh wins and the retried token is never stored", async () => {
    m.refresh.mockImplementation(async () => {
      await localDb.updateProviderConnection(id, { accessToken: "rival-access", refreshToken: "rival-refresh" });
      return { accessToken: "new-access", refreshToken: "new-refresh" };
    });
    upstream({ "old-access": () => new Response("denied", { status: 401 }), "new-access": () => sse(failure(429)) });
    await (await generate(true)).text();

    const row = await stored();
    expect(row.accessToken).toBe("rival-access");
    expect(healthOf(row)).toEqual({ testStatus: null, errorCode: null, locks: [] });
  });

  it("a buffered failure after a refresh marks the retried credential", async () => {
    upstream({ "old-access": () => new Response("denied", { status: 401 }), "new-access": () => new Response("busy", { status: 503 }) });
    const response = await generate(false);
    expect(response.status).toBe(503);

    const row = await stored();
    expect(row.accessToken).toBe("new-access");
    expect(row.errorCode).toBe(503);
  });

  it("a buffered success after a refresh clears the retried credential's prior error", async () => {
    await localDb.updateProviderConnection(id, { testStatus: "unavailable", errorCode: 500, lastError: "earlier failure" });
    db.run("UPDATE providerConnections SET updatedAt = ? WHERE id = ?", [new Date(Date.now() - 30_000).toISOString(), id]);
    upstream({ "old-access": () => new Response("denied", { status: 401 }), "new-access": () => sse(completed) });
    const response = await generate(false);
    expect(response.status).toBe(200);

    const row = await stored();
    expect(row.accessToken).toBe("new-access");
    expect(row.errorCode ?? null).toBeNull();
    expect(row.lastError ?? null).toBeNull();
  });
});
