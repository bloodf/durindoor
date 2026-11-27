import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  dir: "", launcher: null, operator: true,
  credentials: vi.fn(),
  markUnavailable: vi.fn(),
  save: vi.fn(),
  created: vi.fn(),
  connection: vi.fn(),
  updated: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: vi.fn(async () => m.operator),
  canManageAccessConfig: vi.fn(async () => true),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})),
  getApiKeyByKey: vi.fn(async () => null),
  getApiKeyById: vi.fn(async () => null),
  getApiKeyUsageTotals: vi.fn(async () => ({})),
  getComboForModel: vi.fn(async () => null),
  getCustomModels: vi.fn(async () => []),
  getSyncedModelCatalog: vi.fn(async () => null),
  getProviderNodes: vi.fn(async () => []),
  getProviderNodeById: vi.fn(async () => null),
  getProviderConnections: vi.fn(async () => []),
  getProviderConnectionById: m.connection,
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  getProxyPoolById: vi.fn(async () => null),
  createProviderConnection: m.created,
  updateProviderConnection: m.updated,
  deleteProviderConnection: vi.fn(),
  saveRequestUsage: m.save,
}));
vi.mock("@/lib/db/repos/mediaJobsRepo.js", () => ({ createMediaJob: vi.fn(), getMediaJob: vi.fn(), finishMediaJob: vi.fn() }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: m.credentials,
  getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: m.markUnavailable,
  clearAccountError: vi.fn(async () => {}),
  resolveClientApiKey: vi.fn(async () => ({ apiKey: "caller-key", auth: { ok: true, apiKeyId: "caller-id", billingEpoch: null } })),
  extractApiKey: vi.fn(),
  hasValidCliToken: vi.fn(),
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async (model) => {
    const [provider, ...rest] = String(model).split("/");
    return { provider, model: rest.join("/") };
  }),
  getComboModels: vi.fn(async () => null),
  getComboCanonicalName: vi.fn(async () => null),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  refreshWithRetry: vi.fn(async () => null),
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
}));
vi.mock("../../src/sse/utils/logger.js", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), request: vi.fn() }));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: () => false,
  resolveMediaRoute: vi.fn(),
  defaultRouteComboOptions: () => ({}),
  listMediaRouteCandidates: vi.fn(),
  providerOfModelId: vi.fn(),
  supportsVideoJobs: () => false,
}));
vi.mock("../../open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn(async () => null) }));


vi.mock("@/lib/dataDir.js", () => ({ get DATA_DIR() { return m.dir; } }));
vi.mock("../../open-sse/services/fireflyWebUi/browser.js", async (original) => ({
  ...await original(), playwrightLauncher: { launchPersistentContext: (...args) => m.launcher.launchPersistentContext(...args) },
}));
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeLauncher, syntheticWorkspace } from "../fixtures/fireflyWebUi/fakeBrowser.js";
import { mergeProviderSpecificData } from "../../src/lib/db/helpers/mergeProviderMetadata.js";
import { PROFILE_MARKER, profileDir } from "../../open-sse/services/fireflyWebUi/profile.js";
const { POST: createConnection } = await import("@/app/api/providers/route.js");
const { PUT: updateConnection } = await import("@/app/api/providers/[id]/route.js");
const { GET: status, POST: start, DELETE: close } = await import("@/app/api/providers/[id]/firefly-setup/route.js");

const rows = new Map();
let counter;
const request = (body, endpoint = "/api/providers") => new Request(`http://localhost${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const create = (config = { enabled: false }) => createConnection(request({ provider: "adobe-firefly-web", name: `Synthetic ${counter}`, providerSpecificData: { fireflyWebUi: config } }));
const context = (id) => ({ params: Promise.resolve({ id }) });
const update = (id, body) => updateConnection(request(body), context(id));
beforeEach(() => {
  vi.clearAllMocks(); m.save.mockResolvedValue(true); m.markUnavailable.mockResolvedValue({ shouldFallback: false }); rows.clear(); counter = 0; m.operator = true;
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-registration-"));
  m.launcher = fakeLauncher((page) => syntheticWorkspace(page));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); }));
  m.created.mockImplementation(async (data) => { const row = { ...data, id: `conn-${++counter}` }; rows.set(row.id, row); return row; });
  m.updated.mockImplementation(async (id, patch) => { const row = rows.get(id); const next = { ...row, ...patch, providerSpecificData: mergeProviderSpecificData(row.providerSpecificData, patch.providerSpecificData) }; rows.set(id, next); return next; });
  m.connection.mockImplementation(async (id) => rows.get(id));
  m.credentials.mockImplementation(async () => { const row = rows.values().next().value; return row ? { ...row, connectionId: row.id } : null; });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); fs.rmSync(m.dir, { recursive: true, force: true }); });


describe("Firefly setup API uses operator authentication and connection ownership (closed mocks)", () => {
  it("denies gateway authorization before lookup or launch", async () => {
    m.operator = false;
    for (const handler of [start, status, close]) expect((await handler(request({}), context("any"))).status).toBe(403);
    expect(m.connection).not.toHaveBeenCalled(); expect(m.launcher.launches).toHaveLength(0);
  });
  it("needs its own stored provider, explicit enable and initialized marker", async () => {
    expect((await start(request({}), context("missing"))).status).toBe(404);
    rows.set("other", { id: "other", provider: "adobe-firefly-api" });
    expect((await start(request({}), context("other"))).status).toBe(404);
    await create(); expect((await start(request({}), context("conn-1"))).status).toBe(403);
    await update("conn-1", { providerSpecificData: { fireflyWebUi: { enabled: true } } });
    const row = rows.get("conn-1"); const handle = row.providerSpecificData.fireflyWebUi.profileHandle;
    fs.writeFileSync(path.join(profileDir(m.dir, row.id, handle), PROFILE_MARKER), JSON.stringify({ connectionId: "someone-else" }));
    const response = await start(request({}), context(row.id)); expect(response.status).toBe(409);
    expect(await response.text()).not.toContain(m.dir); expect(m.launcher.launches).toHaveLength(0);
  });
  it("opens without a mapping on the host, reports honest state, and cannot close another connection", async () => {
    await create({ enabled: true }); await create({ enabled: true });
    const response = await start(request({ profileHandle: "ignored", path: "/ignored" }), context("conn-1"));
    expect(response.status).toBe(200); const value = await response.json();
    expect(value).toMatchObject({ outcome: "needs_operator", origin: "https://firefly.adobe.com" });
    expect(JSON.stringify(value)).not.toMatch(/profileHandle|browser-profiles/);
    expect(value.note).toContain("requires a display");
    expect(m.launcher.launches[0].options).toEqual({ headless: false });
    expect((await (await status(request({}), context("conn-1"))).json())).toMatchObject({ open: true, outcome: "needs_operator", liveVerified: false });
    expect((await (await close(request({}), context("conn-2"))).json()).closed).toBe(false);
    expect((await start(request({}), context("conn-1"))).status).toBe(409);
    expect((await (await close(request({}), context("conn-1"))).json()).closed).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect((await (await status(request({}), context("conn-1"))).json())).toEqual({ open: false, outcome: "unknown", liveVerified: false });
    expect(m.launcher.launches[0].context.forbidden).toEqual([]);
  });
});
