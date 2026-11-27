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
import { PNG, MP4, fakeLauncher, syntheticWorkspace, syntheticMapping, addResult } from "../fixtures/fireflyWebUi/fakeBrowser.js";
import { mergeProviderSpecificData } from "../../src/lib/db/helpers/mergeProviderMetadata.js";
import { PROFILE_MARKER, profileDir } from "../../open-sse/services/fireflyWebUi/profile.js";
const { POST: createConnection } = await import("@/app/api/providers/route.js");
const { PUT: updateConnection } = await import("@/app/api/providers/[id]/route.js");
const { POST: validateConnection } = await import("@/app/api/providers/validate/route.js");
const { fetchConnectionModels } = await import("@/app/api/providers/[id]/models/fetchConnectionModels.js");
const { POST: images } = await import("@/app/api/v1/images/generations/route.js");
const { POST: videos } = await import("@/app/api/v1/video/generations/route.js");
const rows = new Map();
let counter;
const request = (body, endpoint = "/api/providers") => new Request(`http://localhost${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const configuration = () => ({ enabled: true, mapping: syntheticMapping(), modelMap: { "synthetic-image": { label: "Synthetic Image Label", kind: "image" }, "synthetic-video": { label: "Synthetic Video Label", kind: "video" } } });
const create = (config = { enabled: false }) => createConnection(request({ provider: "adobe-firefly-web", name: `Synthetic ${counter}`, providerSpecificData: { fireflyWebUi: config } }));
const context = (id) => ({ params: Promise.resolve({ id }) });
const update = (id, body) => updateConnection(request(body), context(id));
const usage = () => m.save.mock.calls.map(([event]) => event);
const route = (kind, extra = {}, init = {}) => {
  const endpoint = kind === "image" ? "/v1/images/generations" : "/v1/video/generations";
  return (kind === "image" ? images : videos)(new Request(`http://localhost${endpoint}`, { method: "POST", headers: { "content-type": "application/json", ...init.headers }, body: JSON.stringify({ model: `adobe-firefly-web/synthetic-${kind}`, prompt: "synthetic prompt", ...extra }), ...(init.signal ? { signal: init.signal } : {}) }));
};
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

describe("registered consumer Firefly lifecycle and public media paths (closed mocks)", () => {
  it("creates a disabled auth-none profile, redacts handles, rejects handle replacement and creates distinct profiles", async () => {
    const response = await create(); expect(response.status).toBe(201);
    const value = await response.json(); expect(value.connection.authType).toBe("none");
    expect(JSON.stringify(value)).not.toMatch(/profileHandle|browser-profiles/);
    const first = rows.get(value.connection.id); const handle = first.providerSpecificData.fireflyWebUi.profileHandle;
    expect(handle).toMatch(/^[0-9a-f]{32}$/);
    expect(fs.existsSync(path.join(profileDir(m.dir, first.id, handle), PROFILE_MARKER))).toBe(true);
    expect((await update(first.id, { providerSpecificData: { fireflyWebUi: { enabled: true, profileHandle: handle } } })).status).toBe(400);
    expect((await create({ enabled: false, profileHandle: handle })).status).toBe(400);
    await create(); expect(rows.get("conn-2").providerSpecificData.fireflyWebUi.profileHandle).not.toBe(handle);
    expect(m.launcher.launches).toHaveLength(0);
  });
  it.each(["apiKey", "accessToken", "token", "cookie", "bearer"])("refuses raw %s and gateway authorization at create/update", async (key) => {
    const body = { provider: "adobe-firefly-web", [key]: "synthetic-private-value" };
    expect((await createConnection(request(body))).status).toBe(400);
    await create(); expect((await update("conn-1", body)).status).toBe(400);
    m.operator = false; expect((await create()).status).toBe(403); expect((await update("conn-1", {})).status).toBe(403);
    expect(m.launcher.launches).toHaveLength(0);
  });
  it("validates/discovers without launch, lists only stored mappings and replaces removed models", async () => {
    await create();
    const validation = await validateConnection(request({ provider: "adobe-firefly-web" }));
    expect(await validation.json()).toMatchObject({ skipped: true, valid: false, outcome: "needs_operator" });
    expect(await fetchConnectionModels(rows.get("conn-1"))).toMatchObject({ status: 403 });
    await update("conn-1", { providerSpecificData: { fireflyWebUi: configuration() } });
    const found = await fetchConnectionModels(rows.get("conn-1"));
    expect(found.source).toBe("operator_configured"); expect(found.models.map(({ kind }) => kind)).toEqual(["image", "video"]);
    const config = configuration(); delete config.modelMap["synthetic-video"];
    await update("conn-1", { providerSpecificData: { fireflyWebUi: config } });
    expect((await fetchConnectionModels(rows.get("conn-1"))).models).toHaveLength(1);
    expect(m.launcher.launches).toHaveLength(0);
  });
  it.each(["image", "video"])("serializes actual %s bytes through the public route and records usage exactly once", async (kind) => {
    await create(configuration()); m.launcher = fakeLauncher((page) => syntheticWorkspace(page, { bytes: kind === "image" ? PNG : MP4 }));
    const response = await route(kind); expect(response.status).toBe(200);
    const value = await response.json(); expect(value.data[0].b64_json).toBe((kind === "image" ? PNG : MP4).toString("base64"));
    expect(value.data[0].mime_type).toBe(kind === "image" ? "image/png" : "video/mp4");
    expect(usage()).toHaveLength(1); expect(usage()[0].connectionId).toBe("conn-1");
    expect(m.launcher.launches[0].context.created.flatMap((p) => p.calls).filter((c) => c[0] === "click" && c[1] === "Synthetic generate")).toHaveLength(1);
  });
  it.each(["image", "video"])("refuses unsupported %s formats/parameters and disabled guards before launch", async (kind) => {
    await create(); expect((await route(kind)).status).toBe(403);
    await update("conn-1", { providerSpecificData: { fireflyWebUi: configuration() } });
    for (const extra of [{ response_format: "url" }, { references: [] }, { stream: true }, { seed: 1 }, { async: true }, { seconds: 5 }]) expect((await route(kind, extra)).status).toBe(400);
    expect(m.launcher.launches).toHaveLength(0); expect(usage()).toHaveLength(0);
  });
  it("keeps two stored profiles and their output/usage isolated", async () => {
    await create(configuration()); await create(configuration());
    m.launcher = fakeLauncher((page) => syntheticWorkspace(page, { bytes: page.context.dir.includes("conn-2") ? MP4 : PNG }));
    const first = await route("image"); expect((await first.json()).data[0].b64_json).toBe(PNG.toString("base64"));
    m.credentials.mockImplementation(async () => ({ ...rows.get("conn-2"), connectionId: "conn-2" }));
    const second = await route("video"); expect((await second.json()).data[0].b64_json).toBe(MP4.toString("base64"));
    expect(m.launcher.launches[0].dir).not.toBe(m.launcher.launches[1].dir);
    expect(usage().map((event) => event.connectionId)).toEqual(["conn-1", "conn-2"]);
    const stolen = { ...rows.get("conn-1"), connectionId: "conn-1", providerSpecificData: rows.get("conn-2").providerSpecificData };
    m.credentials.mockResolvedValue(stolen);
    expect((await route("image")).status).toBe(409);
    expect(m.launcher.launches).toHaveLength(2); expect(usage()).toHaveLength(2);
  });
  it.each(["image", "video"])("keeps accepted %s cancellation unknown without replay or successful usage", async (kind) => {
    await create(configuration()); const controller = new AbortController();
    m.launcher = fakeLauncher((page) => syntheticWorkspace(page, { onSubmit: () => controller.abort() }));
    const response = await route(kind, {}, { signal: controller.signal });
    expect(response.status).toBe(499); expect(response.headers.get("x-durindoor-accepted-job")).toBe("1");
    expect(await response.text()).toContain("outcome unknown");
    expect(usage()).toHaveLength(1); expect(usage()[0].costSource).toBe("accepted-job");
    expect(usage()[0].nativeUnits).not.toHaveProperty(kind === "image" ? "images" : "videos", 1);
    expect(m.launcher.launches).toHaveLength(1);
  });
  it.each(["image", "video"])("refuses an old %s result after the deadline and records only unknown cost", async (kind) => {
    const config = configuration(); config.limits = { timeoutMs: 10000, navigationTimeoutMs: 1000, actionTimeoutMs: 500, downloadTimeoutMs: 1000, pollIntervalMs: 50 };
    await create(config);
    m.launcher = fakeLauncher((page) => { syntheticWorkspace(page, { onSubmit: () => {} }); addResult(page, { id: "old", bytes: kind === "image" ? PNG : MP4 }); });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let response; let done = false; const pending = route(kind).then((value) => { response = value; done = true; });
    for (let step = 0; step < 100 && !done; step++) { await vi.advanceTimersByTimeAsync(250); await new Promise((resolve) => setImmediate(resolve)); }
    expect(done).toBe(true); await pending;
    expect(response.status).toBe(504); expect(response.headers.get("x-durindoor-accepted-job")).toBe("1");
    expect(usage()).toHaveLength(1); expect(usage()[0].costSource).toBe("accepted-job");
    const clicks = m.launcher.launches[0].context.created.flatMap((page) => page.calls).filter((call) => call[0] === "click");
    expect(clicks.filter((call) => call[1] === "Synthetic generate")).toHaveLength(1);
    expect(clicks.some((call) => call[1] === "Synthetic download")).toBe(false);
  });
  it("declares exact media capabilities without a chat/executor, edit or async-job fallback", async () => {
    const { getCapabilitiesForModel } = await import("../../open-sse/providers/capabilities.js");
    const { getExecutor } = await import("../../open-sse/executors/index.js");
    const { mediaEndpointSupport } = await import("../../src/sse/services/mediaTransport.js");
    const { handleImageEditCore } = await import("../../open-sse/handlers/imageEditCore.js");
    expect(getCapabilitiesForModel("adobe-firefly-web", "arbitrary-gpt-6")).toMatchObject({ tools: false, imageOutput: false, videoOutput: false });
    expect(getCapabilitiesForModel("adobe-firefly-web", "synthetic-image", "image")).toMatchObject({ tools: false, imageOutput: true, videoOutput: false });
    expect(getCapabilitiesForModel("adobe-firefly-web", "synthetic-video", "video")).toMatchObject({ tools: false, imageOutput: false, videoOutput: true });
    expect(() => getExecutor("adobe-firefly-web")).toThrow(/dedicated image\/video/);
    expect(mediaEndpointSupport("video", "/v1/videos", "adobe-firefly-web").supported).toBe(false);
    const edit = await handleImageEditCore({ body: { prompt: "p" }, modelInfo: { provider: "adobe-firefly-web", model: "synthetic-image" }, credentials: {} });
    expect(edit.status).toBe(400); expect(m.launcher.launches).toHaveLength(0);
  });
  it("refuses response streaming and request-body configuration before generation", async () => {
    await create(configuration());
    expect((await route("image", {}, { headers: { accept: "text/event-stream" } })).status).toBe(400);
    expect((await route("image", { providerSpecificData: { fireflyWebUi: configuration() } })).status).toBe(400);
    expect(m.launcher.launches).toHaveLength(0); expect(usage()).toHaveLength(0);
  });
  it("stops for a human before submit, refuses old results and never counts failed usage", async () => {
    await create(configuration());
    m.launcher = fakeLauncher((page) => { syntheticWorkspace(page); page.add({ role: "dialog", name: "Synthetic sign in" }); });
    expect((await route("image")).status).toBe(409); expect(usage()).toHaveLength(0);
    m.launcher = fakeLauncher((page) => { syntheticWorkspace(page, { onSubmit: () => { throw new Error("private/path synthetic secret"); } }); addResult(page, { id: "old" }); });
    const response = await route("image"); expect(response.status).toBe(502);
    expect(await response.text()).not.toMatch(/private\/path|synthetic secret/);
    expect(usage()).toHaveLength(1); expect(usage()[0].costSource).toBe("accepted-job");
    expect(m.credentials).toHaveBeenCalledTimes(2);
  });
});
