import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #2313: every Antigravity refresh must take the connection-bound lease. The
// image route used to call executor.refreshCredentials() directly and persist
// the result without the presented-refresh-token guard.
const m = vi.hoisted(() => ({
  execute: vi.fn(), refresh: vi.fn(), detailed: vi.fn(), credentials: vi.fn(), mark: vi.fn(), update: vi.fn()
}));
vi.mock("open-sse/executors/index.js", () => ({
  getExecutor: () => ({ execute: m.execute, refreshCredentials: m.refresh, refreshCredentialsDetailed: m.detailed })
}));
vi.mock("@/lib/network/connectionProxy.js", () => ({ resolveConnectionProxyConfig: async () => ({}) }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: m.credentials,
  getNoAuthProviderCredentials: vi.fn(), markAccountUnavailable: m.mark, clearAccountError: vi.fn(),
  resolveClientApiKey: async () => ({ apiKey: null, auth: { ok: true, apiKeyId: null, billingEpoch: null } }),
  projectProviderCredentials: async (connection) => connection && ({
    ...connection, connectionId: connection.id, providerSpecificData: { ...connection.providerSpecificData }, _connection: connection
  })
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async () => ({ provider: "antigravity", model: "gemini-3.1-flash-image" }),
  getComboModels: async () => null, getComboCanonicalName: async () => null
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_p, c) => c, updateProviderCredentials: m.update }));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: async () => null, recordApiKeyUsageForResponse: async (_k, response) => response, recordApiKeyUsage: async (_k, response) => response
}));
vi.mock("../../src/sse/utils/requestCorrelation.js", () => ({ captureRequestBillingEpoch: async () => {}, getRequestId: () => "fixture", withRequestCorrelation: (fn) => fn }));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: () => false, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: () => ({}) }));

let dir, oldDataDir, db, handleImageGeneration, handleImageGenerationCore;
const id = "agy-image-fixture";
const original = { accessToken: "old-access", refreshToken: "old-refresh", providerSpecificData: {} };
const image = () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: "eA==" } }] } }] });
const stored = async () => (await import("../../src/lib/localDb.js")).getProviderConnectionById(id);
const generate = () => handleImageGeneration(new Request("http://localhost/v1/images/generations", {
  method: "POST", body: JSON.stringify({ model: "antigravity/gemini-3.1-flash-image", prompt: "fixture" })
}));

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-media-lease-"));
  oldDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.clearAllMocks();
  const { getAdapter } = await import("../../src/lib/db/driver.js");
  db = await getAdapter();
  const now = new Date().toISOString();
  db.run(`INSERT INTO providerConnections(id, provider, authType, name, priority, isActive, data, createdAt, updatedAt)
    VALUES (?, 'antigravity', 'oauth', 'fixture', 1, 1, ?, ?, ?)`, [id, JSON.stringify(original), now, now]);
  const { getProviderConnectionById } = await import("../../src/lib/localDb.js");
  m.credentials.mockImplementationOnce(async () => {
    const connection = await getProviderConnectionById(id);
    return { ...connection, connectionId: id, providerSpecificData: {}, _connection: connection };
  }).mockResolvedValue(null);
  m.mark.mockResolvedValue({ shouldFallback: false });
  m.execute.mockImplementation(async ({ credentials }) => ({
    response: credentials.accessToken === "new-access" ? image() : new Response("denied", { status: 401 })
  }));
  m.refresh.mockResolvedValue({ accessToken: "direct-access", refreshToken: "direct-refresh" });
  ({ handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js"));
  ({ handleImageGenerationCore } = await import("../../open-sse/handlers/imageGenerationCore.js"));
}, 30_000);

afterEach(() => {
  global._dbAdapter?.close?.();
  delete global._dbAdapter;
  if (oldDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Antigravity image generation refresh", () => {
  it("refreshes under the lease, commits once, and retries with the stored credentials", async () => {
    m.detailed.mockImplementation(async () => {
      expect(db.get("SELECT attemptState FROM antigravityRefreshLeases WHERE connectionId = ?", [id]).attemptState).toBe("dispatched");
      return { ok: true, tokens: { accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600 } };
    });
    const response = await generate();
    expect(response.status).toBe(200);
    expect(m.detailed).toHaveBeenCalledOnce();
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.execute).toHaveBeenCalledTimes(2);
    expect(await stored()).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh" });
  });

  it("does not persist or retry a stale refresh result after a concurrent rotation", async () => {
    m.detailed.mockImplementation(async () => {
      db.run("UPDATE providerConnections SET data = ? WHERE id = ?", [JSON.stringify({ ...original, accessToken: "replacement", refreshToken: "replacement-refresh" }), id]);
      return { ok: true, tokens: { accessToken: "new-access", refreshToken: "stale-refresh" } };
    });
    const response = await generate();
    expect(response.status).toBe(401);
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.execute).toHaveBeenCalledOnce();
    expect(await stored()).toMatchObject({ accessToken: "replacement", refreshToken: "replacement-refresh" });
  });

  it("never calls the executor refresh directly without the leased refresher", async () => {
    const onCredentialsRefreshed = vi.fn();
    const result = await handleImageGenerationCore({
      body: { prompt: "fixture" }, modelInfo: { provider: "agy", model: "gemini-3.1-flash-image" },
      credentials: { accessToken: "old-access", refreshToken: "old-refresh" }, onCredentialsRefreshed
    });
    expect(result.status).toBe(401);
    expect(m.refresh).not.toHaveBeenCalled();
    expect(onCredentialsRefreshed).not.toHaveBeenCalled();
  });
});

describe("embeddings refresh", () => {
  it("does not refresh an Antigravity credential outside the lease", async () => {
    const { handleEmbeddingsCore } = await import("../../open-sse/handlers/embeddingsCore.js");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 401 })));
    try {
      await handleEmbeddingsCore({
        body: { model: "agy/fixture", input: "x" }, modelInfo: { provider: "agy", model: "fixture" },
        credentials: { accessToken: "old-access", refreshToken: "old-refresh" }
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
