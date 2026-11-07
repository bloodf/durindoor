import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getRouteRegex } from "next/dist/shared/lib/router/utils/route-regex.js";
import { getRouteMatcher } from "next/dist/shared/lib/router/utils/route-matcher.js";

// #1115 route matrix. Every request runs the real guard, encoded dispatch, Next
// route matching and handler, with the real file/batch store, media job repo and
// native owner records on disposable storage. Only the key/connection catalog and
// provider transport are fixtures. Complements security-authorization-matrix.test.js.
const fixture = vi.hoisted(() => ({ keys: new Map(), scopes: new Map(), connections: [], settings: {}, fetch: vi.fn(), core: vi.fn() }));
vi.mock("@/lib/apiKeyLimits.js", () => ({ enforceApiKeyLimits: async () => null }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "matrix-cli" }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: async (value) => value === "matrix-session" }));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => fixture.settings,
  getApiKeyByKey: async (secret) => fixture.keys.get(secret) ?? null,
  getApiKeyById: async (id) => [...fixture.keys.values()].find((key) => key.id === id) ?? null,
  validateApiKey: async (secret) => {
    const key = fixture.keys.get(secret);
    return !!key?.isActive && (!key.expiresAt || Date.parse(key.expiresAt) > Date.now());
  },
  validateGatewayKey: async () => false,
  getApiKeyUsageLimitStatus: async () => ({ exceeded: false }),
  getApiKeyUsageTotals: async () => ({ totalTokens: 0, totalCost: 0 }),
  saveRequestUsage: async () => true,
  getApiKeyProviderConnectionIds: async (id) => fixture.scopes.get(id) ?? [],
  getProviderConnections: async (query = {}) => fixture.connections.filter((row) => !query.provider || row.provider === query.provider),
  getProviderConnectionById: async (id) => fixture.connections.find((row) => row.id === id),
  updateProviderConnection: async (id, patch) => ({ ...fixture.connections.find((row) => row.id === id), ...patch }),
  getProxyPools: async () => [], getQuotaReservationPressure: async () => new Map(),
  getCombos: async () => [], getComboForModel: async () => null, getComboByName: async () => null,
  getModelAliases: async () => ({}), getProviderNodes: async () => [], getCustomModels: async () => [],
  getSyncedModelCatalog: async () => null, getSyncedModelCatalogs: async () => [],
}));
vi.mock("@/sse/services/auth.js", async (original) => {
  const auth = await original();
  return { ...auth, getProviderCredentialsWithQuotaPreflight: (provider, excluded, model, options) =>
    auth.getProviderCredentials(provider, excluded, model, { ...options, quotaSnapshotsLoader: async () => [], quotaFetchStateLoader: async () => [] }) };
});
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fixture.fetch }));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: fixture.core }));
vi.mock("open-sse/services/liveModelLimits.js", () => ({ warmLiveModelLimits: vi.fn() }));
vi.mock("@/lib/usageDb", () => ({ recordTokenSaverEvent: vi.fn() }));
vi.mock("@/app/api/v1/models/buildModelsList.js", () => ({ buildModelsList: async ([kind]) => (fixture.settings.mediaRoutes?.[kind] || []).map((id) => ({ id, kind })) }));

const { default: proxy } = await import("../../src/proxy.js");
const { uploadFile, createOpenAIBatch, createAnthropicBatch, _waitForBatch, _resetBatches } = await import("open-sse/services/localFilesBatches.js");
const { makeDefaultExecutor } = await import("open-sse/handlers/localBatchExecutor.js");
const { createMediaJob, finishMediaJob } = await import("@/lib/db/repos/mediaJobsRepo.js");
const { getBillingEpoch } = await import("@/lib/db/repos/usageRepo.js");
const { getAdapter } = await import("@/lib/db/driver.js");
const { createNativeResourceOwner, readNativeResourceOwner } = await import("@/sse/services/nativeResourceOwners.js");
const { NATIVE_OPERATIONS } = await import("@/sse/handlers/nativeProviderConfig.js");
const { default: registry } = await import("open-sse/providers/registry/index.js");

const routes = [
  ["/api/v1/files", await import("@/app/api/v1/files/route.js")],
  ["/api/v1/files/[id]", await import("@/app/api/v1/files/[id]/route.js")],
  ["/api/v1/files/[id]/content", await import("@/app/api/v1/files/[id]/content/route.js")],
  ["/api/v1/batches", await import("@/app/api/v1/batches/route.js")],
  ["/api/v1/batches/[id]", await import("@/app/api/v1/batches/[id]/route.js")],
  ["/api/v1/batches/[id]/cancel", await import("@/app/api/v1/batches/[id]/cancel/route.js")],
  ["/api/v1/messages/batches", await import("@/app/api/v1/messages/batches/route.js")],
  ["/api/v1/messages/batches/[id]", await import("@/app/api/v1/messages/batches/[id]/route.js")],
  ["/api/v1/messages/batches/[id]/results", await import("@/app/api/v1/messages/batches/[id]/results/route.js")],
  ["/api/v1/messages/batches/[id]/cancel", await import("@/app/api/v1/messages/batches/[id]/cancel/route.js")],
  ["/api/v1/music/generations", await import("@/app/api/v1/music/generations/route.js")],
  ["/api/v1/music/generations/[request_id]", await import("@/app/api/v1/music/generations/[request_id]/route.js")],
  ["/api/v1/video/generations", await import("@/app/api/v1/video/generations/route.js")],
  ["/api/v1/videos/[[...path]]", await import("@/app/api/v1/videos/[[...path]]/route.js")],
  ["/api/v1/images/generations", await import("@/app/api/v1/images/generations/route.js")],
  ["/api/v1/audio/speech", await import("@/app/api/v1/audio/speech/route.js")],
  ["/api/v1/audio/voices", await import("@/app/api/v1/audio/voices/route.js")],
  ["/api/v1/native/[provider]/[...operation]", await import("@/app/api/v1/native/[provider]/[...operation]/route.js")],
].map(([pattern, handlers]) => ({ match: getRouteMatcher(getRouteRegex(pattern)), handlers }));

const principals = ["dashboard", "cli", "owner", "foreign", "inactive", "expired", "anonymous"];
const rejected = ["dashboard", "inactive", "expired", "anonymous"];
const encode = (value) => value.replace(/[a-z0-9]/gi, (char) => `%${char.charCodeAt(0).toString(16)}`);
const spellings = {
  canonical: (value) => `/api${value}`,
  alias: (value) => value,
  "double-v1": (value) => `/v1${value}`,
  encoded: encode,
};
const credentials = (principal) => ({
  ...(["owner", "foreign", "inactive", "expired"].includes(principal) ? { authorization: `Bearer matrix-${principal}` } : {}),
  ...(principal === "cli" ? { "x-9r-cli-token": "matrix-cli" } : {}),
  ...(principal === "dashboard" ? { cookie: "auth_token=matrix-session" } : {}),
});

// Walk the same steps as a served request. A guard denial never reaches a handler.
async function send(target, principal, { method = "GET", body, headers = {} } = {}) {
  const url = new URL(target, "http://gateway.test");
  const init = () => ({
    method,
    headers: { host: "gateway.test", ...credentials(principal), ...(typeof body === "string" ? { "content-type": "application/json" } : {}), ...headers },
    ...(body === undefined ? {} : { body, duplex: "half" }),
  });
  const gate = await proxy(new NextRequest(url, init()));
  const rewrite = gate.headers.get("x-middleware-rewrite");
  if (!rewrite && gate.headers.get("x-middleware-next") !== "1") return gate;
  let pathname = rewrite ? new URL(rewrite).pathname : url.pathname;
  // next.config rewrites for unencoded spellings.
  if (pathname.startsWith("/v1/v1/")) pathname = `/api/v1/${pathname.slice(7)}`;
  else if (pathname.startsWith("/v1/")) pathname = `/api${pathname}`;
  for (const { match, handlers } of routes) {
    const params = match(pathname);
    if (!params) continue;
    if (!handlers[method]) return new Response(null, { status: 405 });
    return handlers[method](new Request(`http://gateway.test${pathname}${url.search}`, init()), { params: Promise.resolve(params) });
  }
  throw new Error(`No route fixture for ${pathname}`);
}

const keyRecord = (id, patch = {}) => ({ id, key: `matrix-${id}`, name: id, isActive: true, expiresAt: null, policy: {}, ...patch });
const completion = { id: "matrix", choices: [{ message: { role: "assistant", content: "fixture answer" }, finish_reason: "stop" }] };
const okExecutor = async () => ({ status_code: 200, body: completion });
const row = (custom_id, model, content = "hello") => JSON.stringify({ custom_id, method: "POST", url: "/v1/chat/completions", body: { model, messages: [{ role: "user", content }] } });
let tempDir;
let previous;
let seeded;
let adapter;

async function seedOwner(ownerId) {
  const content = `${ownerId}-secret`;
  const file = await uploadFile({ filename: `${ownerId}.txt`, bytes: Buffer.from(content), purpose: "assistants" }, { ownerId });
  const input = await uploadFile({ filename: `${ownerId}.jsonl`, bytes: Buffer.from(row("one", "openai/gpt-4o")), purpose: "batch" }, { ownerId });
  const batch = await createOpenAIBatch({ input_file_id: input.id, endpoint: "/v1/chat/completions" }, { executor: okExecutor, ownerId });
  const message = await createAnthropicBatch({ requests: [{ custom_id: "one", params: { model: "anthropic/claude-haiku-4-5", max_tokens: 1, messages: [{ role: "user", content: "hello" }] } }] }, { executor: okExecutor, ownerId });
  await _waitForBatch(batch.id);
  await _waitForBatch(message.id);
  return { file: file.id, input: input.id, batch: batch.id, message: message.id };
}

const seedResources = async () => { seeded = { owner: await seedOwner("owner"), foreign: await seedOwner("foreign") }; };

beforeAll(async () => {
  previous = { HOME: process.env.HOME, DATA_DIR: process.env.DATA_DIR, DURINDOOR_DATABASE_ENGINE: process.env.DURINDOOR_DATABASE_ENGINE };
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "security-routes-"));
  process.env.HOME = tempDir;
  process.env.DATA_DIR = tempDir;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  adapter = await getAdapter();
});

afterAll(async () => {
  await adapter?.close?.();
  delete global._dbAdapter;
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access in route matrix"); }));
  _resetBatches();
  fs.rmSync(path.join(tempDir, ".9router"), { recursive: true, force: true });
  fs.rmSync(path.join(tempDir, "native-resource-owners"), { recursive: true, force: true });
  adapter.run("DELETE FROM kv WHERE scope = 'mediaJobs'");
  fixture.keys.clear(); fixture.scopes.clear();
  fixture.settings = { requireApiKey: true, requireLogin: true, comboStrategy: "fallback", visionBridgeEnabled: false };
  fixture.keys.set("matrix-owner", keyRecord("owner"));
  fixture.keys.set("matrix-foreign", keyRecord("foreign"));
  fixture.keys.set("matrix-inactive", keyRecord("inactive", { isActive: false }));
  fixture.keys.set("matrix-expired", keyRecord("expired", { expiresAt: "2000-01-01T00:00:00Z" }));
  fixture.connections = [...Object.keys(NATIVE_OPERATIONS), "suno"].map((provider) => ({ id: `${provider}-account`, provider, authType: "apikey", apiKey: "matrix-upstream", isActive: true, priority: 1, testStatus: "active", providerSpecificData: {} }));
  fixture.fetch.mockImplementation(async () => Response.json({ id: "fixture", task_id: "fixture", request_id: "fixture", voice_id: "fixture", file: { file_id: "fixture" } }));
  fixture.core.mockImplementation(async () => ({ success: true, response: Response.json(completion) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  _resetBatches();
});

const noDispatch = () => {
  expect(fixture.fetch).not.toHaveBeenCalled();
  expect(fixture.core).not.toHaveBeenCalled();
};

const itemRoutes = [
  ["GET", "/v1/files/{file}", "file"],
  ["GET", "/v1/files/{file}/content", "file"],
  ["DELETE", "/v1/files/{file}", "file"],
  ["GET", "/v1/batches/{batch}", "batch"],
  ["POST", "/v1/batches/{batch}/cancel", "batch"],
  ["GET", "/v1/messages/batches/{message}", "message"],
  ["GET", "/v1/messages/batches/{message}/results", "message"],
  ["POST", "/v1/messages/batches/{message}/cancel", "message"],
];
const listRoutes = [
  ["/v1/files", "file", (json) => json.data],
  ["/v1/batches", "batch", (json) => json.data],
  ["/v1/messages/batches", "message", (json) => json.data],
];
const itemPath = (template, kind, ownerId) => template.replace(`{${kind}}`, seeded[ownerId][kind]);

describe.each(Object.keys(spellings))("#1115 local file and batch routes, %s spelling", (variant) => {
  beforeEach(seedResources);

  describe.each(principals)("principal %s", (principal) => {
    it.each(itemRoutes)("%s %s", async (method, template, kind) => {
      const spell = spellings[variant];
      const response = await send(spell(itemPath(template, kind, "owner")), principal, { method });
      if (rejected.includes(principal)) expect(response.status).toBe(401);
      else if (principal === "foreign") {
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain("owner-secret");
      } else {
        // A finished batch has nothing left to cancel; the owner still reaches it.
        expect(response.status, template).toBeLessThan(template.endsWith("/cancel") ? 500 : 300);
        expect(response.status, template).not.toBe(404);
        if (template.endsWith("/content")) expect(await response.text()).toBe("owner-secret");
      }
    });

    it.each(listRoutes)("lists %s", async (route, kind, entries) => {
      const response = await send(spellings[variant](route), principal);
      if (rejected.includes(principal)) { expect(response.status).toBe(401); return; }
      expect(response.status).toBe(200);
      const ids = entries(await response.json()).map((entry) => entry.id);
      const own = principal === "cli" ? ["owner", "foreign"] : [principal];
      for (const ownerId of ["owner", "foreign"]) {
        expect(ids.includes(seeded[ownerId][kind]), `${ownerId} ${kind}`).toBe(own.includes(ownerId));
      }
    });

    it("binds created files and batches to the caller", async () => {
      const form = new FormData();
      form.set("file", new File([row("one", "openai/gpt-4o")], "created.jsonl"));
      form.set("purpose", "batch");
      const upload = await send(spellings[variant]("/v1/files"), principal, { method: "POST", body: form });
      if (rejected.includes(principal)) { expect(upload.status).toBe(401); return; }
      expect(upload.status).toBe(201);
      const { id } = await upload.json();
      const other = principal === "owner" ? "foreign" : "owner";
      expect((await send(spellings[variant](`/v1/files/${id}`), principal)).status).toBe(200);
      expect((await send(spellings[variant](`/v1/files/${id}`), other)).status).toBe(404);

      const created = await send(spellings[variant]("/v1/batches"), principal, { method: "POST", body: JSON.stringify({ input_file_id: id, endpoint: "/v1/chat/completions" }) });
      expect(created.status).toBe(200);
      const batch = await created.json();
      await _waitForBatch(batch.id);
      expect((await send(spellings[variant](`/v1/batches/${batch.id}`), principal)).status).toBe(200);
      expect((await send(spellings[variant](`/v1/batches/${batch.id}`), other)).status).toBe(404);
    });
  });

  it("refuses a batch built from another caller's input file", async () => {
    const response = await send(spellings[variant]("/v1/batches"), "foreign", { method: "POST", body: JSON.stringify({ input_file_id: seeded.owner.input, endpoint: "/v1/chat/completions" }) });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(fixture.core).not.toHaveBeenCalled();
  });
});

describe("#1115 local route identities", () => {
  beforeEach(seedResources);

  it("uses the authenticated x-api-key owner when Bearer is stale", async () => {
    const headers = { authorization: "Bearer stale-placeholder", "x-api-key": "matrix-owner" };
    expect((await send(`/v1/files/${seeded.owner.file}`, "anonymous", { headers })).status).toBe(200);
    expect((await send(`/v1/files/${seeded.foreign.file}`, "anonymous", { headers })).status).toBe(404);
  });

  it("gives the first valid credential precedence over a second valid key", async () => {
    const headers = { authorization: "Bearer matrix-owner", "x-api-key": "matrix-foreign" };
    expect((await send(`/v1/files/${seeded.owner.file}`, "anonymous", { headers })).status).toBe(200);
    expect((await send(`/v1/files/${seeded.foreign.file}`, "anonymous", { headers })).status).toBe(404);
  });

  it.each(["../meta.json", "file_00", "..%2f..%2fmeta.json", "%2e%2e"])("does not resolve the unsafe id %s", async (id) => {
    const response = await send(`/v1/files/${id}/content`, "owner").catch((error) => error);
    expect([400, 404, 405].includes(response.status) || /No route fixture/.test(response.message)).toBe(true);
  });

  it.each([[false, 200], [true, 401]])("treats a loopback caller without a key as local (requireApiKey=%s)", async (requireApiKey, status) => {
    vi.stubEnv("NINEROUTER_PEER_TOKEN", "matrix-peer");
    fixture.settings.requireApiKey = requireApiKey;
    const local = await uploadFile({ filename: "local.txt", bytes: Buffer.from("local"), purpose: "assistants" }, {});
    const headers = { "x-9r-peer-token": "matrix-peer", "x-9r-real-ip": "127.0.0.1" };
    expect((await send(`/v1/files/${local.id}`, "anonymous", { headers })).status).toBe(status);
    expect((await send(`/v1/files/${seeded.owner.file}`, "anonymous", { headers })).status).toBe(requireApiKey ? 401 : 404);
    expect((await send(`/v1/files/${local.id}`, "owner")).status).toBe(404);
  });

  it("resolves a percent-encoded id to the same owned resource", async () => {
    const id = seeded.owner.file;
    const spelled = `${id.slice(0, 5)}${encode(id.slice(5))}`;
    expect((await send(`/v1/files/${spelled}`, "owner")).status).toBe(200);
    expect((await send(`/v1/files/${spelled}`, "foreign")).status).toBe(404);
  });
});

// Terminal jobs replay stored evidence, so ownership is the only gate exercised.
const mediaPolls = [
  { label: "video", modality: "video", provider: "xai", model: "grok-imagine-video", route: "/v1/videos", endpoint: "/v1/videos/generations" },
  { label: "music", modality: "music", provider: "suno", model: "chirp-v4", route: "/v1/music/generations", endpoint: "/v1/music/generations" },
];
async function seedJob({ modality, provider, model, endpoint }) {
  const job = await createMediaJob({ modality, provider, model, endpoint, connectionId: `${provider}-account`, resourceId: "job-1", apiKeyId: "owner", usageEventId: "matrix-event", billingEpoch: await getBillingEpoch() });
  await finishMediaJob(job, "owner", { status: "failed", response: { body: JSON.stringify({ request_id: "job-1", status: "failed" }), status: 200, contentType: "application/json" } });
}
describe.each(mediaPolls)("#1115 $label job polling", (poll) => {
  const pin = () => ({ "x-connection-id": `${poll.provider}-account` });
  describe.each(Object.keys(spellings))("%s spelling", (variant) => {
    it.each(principals)("principal %s", async (principal) => {
      await seedJob(poll);
      const response = await send(spellings[variant](`${poll.route}/job-1`), principal, { headers: pin() });
      const expected = rejected.includes(principal) ? 401 : principal === "owner" ? 200 : principal === "foreign" ? 404 : 403;
      expect(response.status).toBe(expected);
      if (principal === "owner") expect((await response.json()).request_id).toBe("job-1");
      noDispatch();
    });
  });

  it("requires the creating account and the key's scope and model policy", async () => {
    await seedJob(poll);
    const owner = fixture.keys.get("matrix-owner");
    expect((await send(`${poll.route}/job-1`, "owner")).status).toBe(403);
    expect((await send(`${poll.route}/job-1`, "owner", { headers: { "x-connection-id": "anthropic-account" } })).status).toBe(404);
    fixture.scopes.set("owner", ["anthropic-account"]);
    expect((await send(`${poll.route}/job-1`, "owner", { headers: pin() })).status).toBe(403);
    fixture.scopes.clear();
    owner.policy = { allowedModels: ["openai/gpt-4o"] };
    expect((await send(`${poll.route}/job-1`, "owner", { headers: pin() })).status).toBe(403);
    noDispatch();
  });
});

// Scope denials must stop before any provider call on every media creation route.
const mediaCreates = [
  ["/v1/images/generations", { model: "openai/gpt-image-1", prompt: "x" }],
  ["/v1/audio/speech", { model: "openai/tts-1", input: "x", voice: "alloy" }],
  ["/v1/video/generations", { model: "xai/grok-imagine-video", prompt: "x" }],
  ["/v1/videos/generations", { model: "xai/grok-imagine-video", prompt: "x" }],
  ["/v1/music/generations", { model: "suno/chirp-v4", prompt: "x" }],
];
describe.each(mediaCreates)("#1115 media creation %s", (route, payload) => {
  const post = (target, principal) => send(target, principal, { method: "POST", body: JSON.stringify(payload) });

  describe.each(Object.keys(spellings))("%s spelling", (variant) => {
    it.each(rejected)("rejects %s", async (principal) => {
      expect((await post(spellings[variant](route), principal)).status).toBe(401);
      noDispatch();
    });
    it("enforces model policy", async () => {
      fixture.keys.get("matrix-owner").policy = { allowedModels: ["anthropic/claude-haiku-4-5"] };
      expect((await post(spellings[variant](route), "owner")).status).toBe(403);
      noDispatch();
    });
    it("enforces provider account scope", async () => {
      fixture.scopes.set("owner", ["anthropic-account"]);
      const response = await post(spellings[variant](route), "owner");
      expect(response.status).toBeGreaterThanOrEqual(400);
      noDispatch();
    });
  });
});

// A request without a model picks from the saved route; the pick is still policy-checked.
describe.each([
  ["/v1/images/generations", "image", "openai/gpt-image-1", { prompt: "x" }],
  ["/v1/audio/speech", "tts", "openai/tts-1", { input: "x", voice: "alloy" }],
  ["/v1/music/generations", "music", "suno/chirp-v4", { prompt: "x" }],
])("#1115 default media route %s", (route, kind, model, payload) => {
  const post = () => send(route, "owner", { method: "POST", body: JSON.stringify(payload) });
  beforeEach(() => { fixture.settings.mediaRoutes = { [kind]: [model] }; });

  it("denies a routed model outside the key's model policy", async () => {
    fixture.keys.get("matrix-owner").policy = { allowedModels: ["anthropic/claude-haiku-4-5"] };
    expect((await post()).status).toBe(403);
    noDispatch();
  });

  it("drops a routed model outside the key's account scope", async () => {
    fixture.scopes.set("owner", ["anthropic-account"]);
    expect((await post()).status).toBeGreaterThanOrEqual(400);
    noDispatch();
  });
});

// Rows re-enter the chat handler, so they must keep the creating key's limits.
describe("#1115 batch rows as rerouted requests", () => {
  async function runBatch(rows, principal = "owner") {
    const form = new FormData();
    form.set("file", new File([rows.join("\n")], "rows.jsonl"));
    form.set("purpose", "batch");
    const { id } = await (await send("/v1/files", principal, { method: "POST", body: form })).json();
    const batch = await (await send("/v1/batches", principal, { method: "POST", body: JSON.stringify({ input_file_id: id, endpoint: "/v1/chat/completions" }) })).json();
    await _waitForBatch(batch.id);
    const view = await (await send(`/v1/batches/${batch.id}`, principal)).json();
    const read = async (fileId) => fileId ? (await (await send(`/v1/files/${fileId}/content`, principal)).text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    const results = [...await read(view.output_file_id), ...await read(view.error_file_id)];
    return { view, status: Object.fromEntries(results.map((entry) => [entry.custom_id, entry.response?.status_code])) };
  }

  it("applies the creating key's model policy to each row", async () => {
    fixture.keys.get("matrix-owner").policy = { allowedModels: ["openai/gpt-4o"] };
    const { status } = await runBatch([row("allowed", "openai/gpt-4o"), row("denied", "anthropic/claude-haiku-4-5")]);
    expect(status.allowed).toBe(200);
    expect(status.denied).toBe(403);
    expect(fixture.core).toHaveBeenCalledOnce();
    expect(fixture.core.mock.calls[0][0].modelInfo.provider).toBe("openai");
  });

  it("applies the creating key's provider account scope to each row", async () => {
    fixture.scopes.set("owner", ["openai-account"]);
    const { status } = await runBatch([row("allowed", "openai/gpt-4o"), row("denied", "anthropic/claude-haiku-4-5")]);
    expect(status.allowed).toBe(200);
    expect(status.denied).toBeGreaterThanOrEqual(400);
    expect(fixture.core).toHaveBeenCalledOnce();
  });

  it.each([["allowed", "openai", ["minimax/MiniMax-M2.1", "openai/gpt-4o"]], ["denied", "minimax", ["minimax/MiniMax-M2.1"]]])("rechecks a %s vision target from a row", async (_label, provider, allowedModels) => {
    fixture.settings.visionBridgeEnabled = true;
    fixture.settings.visionBridgeModel = "openai/gpt-4o";
    fixture.keys.get("matrix-owner").policy = { allowedModels };
    const image = [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }];
    const { status } = await runBatch([row("vision", "minimax/MiniMax-M2.1", image)]);
    expect(status.vision).toBe(200);
    expect(fixture.core).toHaveBeenCalledOnce();
    expect(fixture.core.mock.calls[0][0].modelInfo.provider).toBe(provider);
  });

  it("keeps row output with the creating key", async () => {
    const { view } = await runBatch([row("one", "openai/gpt-4o")]);
    expect((await send(`/v1/files/${view.output_file_id}/content`, "foreign")).status).toBe(404);
    expect((await send(`/v1/files/${view.output_file_id}/content`, "cli")).status).toBe(200);
  });

  it("stops dispatching rows once the creating key is deactivated", async () => {
    const executor = makeDefaultExecutor(new Request("http://gateway.test/v1/batches", { headers: credentials("owner") }));
    fixture.keys.get("matrix-owner").isActive = false;
    const result = await executor({ url: "/v1/chat/completions", body: { model: "openai/gpt-4o", messages: [{ role: "user", content: "hello" }] } });
    expect(result.status_code).toBe(401);
    noDispatch();
  });

  it("does not carry a dashboard cookie or account pin into rows", async () => {
    const executor = makeDefaultExecutor(new Request("http://gateway.test/v1/batches", { headers: { cookie: "auth_token=matrix-session", "x-connection-id": "openai-account" } }));
    const result = await executor({ url: "/v1/chat/completions", body: { model: "openai/gpt-4o", messages: [{ role: "user", content: "hello" }] } });
    expect(result.status_code).toBe(401);
    noDispatch();
  });
});

const tracked = Object.entries(NATIVE_OPERATIONS).flatMap(([provider, rows]) => rows
  .filter((op) => op.resourceParam || op.resourceQuery || op.resourceBodyField)
  .map((op) => ({ ...op, provider, label: `${provider} ${op.method} ${op.path}` })));
const modelFor = (provider) => `${provider}/${registry.find((entry) => entry.id === provider).models[0].id}`;
async function ownNative(provider, resourceId, ownerId) {
  await createNativeResourceOwner({ ownerId, provider, connectionId: `${provider}-account`, resourceId, usageEventId: `matrix:${provider}:${resourceId}`, billingEpoch: await getBillingEpoch() });
}
function nativeTarget(op, id, spell = spellings.alias) {
  const operation = op.path.replace(/\{[^}]+\}/g, id);
  const query = new URLSearchParams({ model: modelFor(op.provider), ...(op.resourceQuery ? { [op.resourceQuery]: id } : {}) });
  return `${spell(`/v1/native/${op.provider}${operation}`)}?${query}`;
}
const nativeOptions = (op, id, extra = {}) => ({
  method: op.method,
  headers: { "x-connection-id": `${op.provider}-account`, ...extra },
  ...(op.method === "POST" ? { body: JSON.stringify(op.resourceBodyField ? { [op.resourceBodyField]: id } : {}) } : {}),
});

describe.each(Object.keys(spellings))("#1115 native tracked resources, %s spelling", (variant) => {
  describe.each(principals)("principal %s", (principal) => {
    it.each(tracked)("$label", async (op) => {
      await ownNative(op.provider, "resource", "owner");
      const response = await send(nativeTarget(op, "resource", spellings[variant]), principal, nativeOptions(op, "resource"));
      const expected = rejected.includes(principal) ? 401 : principal === "foreign" ? 403 : 200;
      expect(response.status).toBe(expected);
      if (expected !== 200) { noDispatch(); return; }
      await response.text();
      expect(fixture.fetch).toHaveBeenCalledOnce();
      const [upstream, init] = fixture.fetch.mock.calls[0];
      expect(`${upstream} ${init.body ?? ""}`).toContain("resource");
    });

    it.each(tracked)("unknown owner fails closed: $label", async (op) => {
      const response = await send(nativeTarget(op, "resource", spellings[variant]), principal, nativeOptions(op, "resource"));
      expect(response.status).toBe(rejected.includes(principal) ? 401 : 403);
      noDispatch();
    });
  });
});

describe("#1115 native resource identifiers", () => {
  const byQuery = tracked.filter((op) => op.resourceQuery);
  const byBody = tracked.filter((op) => op.resourceBodyField);
  const byPath = tracked.filter((op) => op.resourceParam);

  it.each(byQuery)("accepts exactly one query identifier: $label", async (op) => {
    await ownNative(op.provider, "mine", "owner");
    await ownNative(op.provider, "other", "foreign");
    for (const order of [["mine", "other"], ["other", "mine"], ["mine", "mine"]]) {
      const target = `${nativeTarget(op, order[0])}&${op.resourceQuery}=${order[1]}`;
      expect((await send(target, "owner", nativeOptions(op, order[0]))).status).toBe(400);
    }
    const name = op.resourceQuery;
    for (const extra of [name.toUpperCase(), name.replace(/^./, (char) => char.toUpperCase()), name === "task_id" ? "file_id" : "task_id", "id"]) {
      const target = `${nativeTarget(op, "mine")}&${extra}=other`;
      expect((await send(target, "owner", nativeOptions(op, "mine"))).status, extra).toBe(400);
    }
    noDispatch();
  });

  it.each(byPath)("forwards no second identifier beside a path identifier: $label", async (op) => {
    await ownNative(op.provider, "mine", "owner");
    await ownNative(op.provider, "other", "foreign");
    for (const name of [op.resourceParam, op.resourceParam.toUpperCase(), "task_id", "file_id", "voice_id", "id", "request_id"]) {
      const target = `${nativeTarget(op, "mine")}&${name}=other`;
      expect((await send(target, "owner", nativeOptions(op, "mine"))).status, name).toBe(400);
    }
    noDispatch();
  });

  it.each(byBody)("accepts exactly one body identifier: $label", async (op) => {
    await ownNative(op.provider, "mine", "owner");
    await ownNative(op.provider, "other", "foreign");
    await ownNative(op.provider, "1", "owner");
    const field = op.resourceBodyField;
    for (const body of [
      `{"${field}":"mine","${field}":"other"}`,
      `{"${field}":"other","${field}":"mine"}`,
      `{"${field}":1,"${field}":"other"}`,
      `{"${field}":"mine","voice\\u005fid":"other"}`,
      `{"${field}":"mine","${field.toUpperCase()}":"other"}`,
    ]) {
      expect((await send(nativeTarget(op, "mine"), "owner", { ...nativeOptions(op, "mine"), body })).status, body).toBe(400);
    }
    for (const name of [field, field.toUpperCase(), "task_id", "id"]) {
      const inQuery = `${nativeTarget(op, "mine")}&${name}=other`;
      expect((await send(inQuery, "owner", nativeOptions(op, "mine"))).status, name).toBe(400);
    }
    noDispatch();
  });

  it.each(byPath)("sends upstream the same path identifier it authorized: $label", async (op) => {
    await ownNative(op.provider, "mine_1", "owner");
    const encoded = `/v1/native/${op.provider}${op.path.replace(/\{[^}]+\}/g, encode("mine_1"))}`;
    const response = await send(`${encoded}?model=${modelFor(op.provider)}`, "owner", nativeOptions(op, "mine_1"));
    expect(response.status).toBe(200);
    await response.text();
    expect(new URL(fixture.fetch.mock.calls[0][0]).pathname).toBe(op.path.replace(/\{[^}]+\}/g, "mine_1"));
  });

  it.each(byPath)("rejects encoded separators in a path identifier: $label", async (op) => {
    await ownNative(op.provider, "mine", "owner");
    const target = `/v1/native/${op.provider}${op.path.replace(/\{[^}]+\}/g, "mine%2F..%2Fother")}?model=${modelFor(op.provider)}`;
    expect((await send(target, "owner", nativeOptions(op, "mine"))).status).toBe(400);
    noDispatch();
  });
});

describe("#1115 native creation responses", () => {
  const create = async (text, principal = "owner") => {
    fixture.fetch.mockImplementation(async () => new Response(text, { headers: { "content-type": "application/json" } }));
    const response = await send(`/v1/native/anthropic/v1/files?model=${modelFor("anthropic")}`, principal, { method: "POST", body: "{}" });
    await response.text().catch(() => null);
  };
  const owner = async (id) => (await readNativeResourceOwner("anthropic", "anthropic-account", id))?.ownerId ?? null;

  it("never moves an existing owner when a response repeats its id field", async () => {
    await ownNative("anthropic", "taken", "foreign");
    await create('{"id":"taken","id":"fresh"}');
    expect(await owner("taken")).toBe("foreign");
    await create('{"id":"fresh2","id":"taken"}');
    expect(await owner("taken")).toBe("foreign");
  });

  it("records only the top-level id, not a nested one", async () => {
    await create('{"meta":{"id":"nested"},"id":"top"}');
    expect(await owner("top")).toBe("owner");
    expect(await owner("nested")).toBeNull();
  });
});

describe("#1115 native voices", () => {
  const op = (path) => ({ ...NATIVE_OPERATIONS.minimax.find((row) => row.path === path), provider: "minimax" });
  const clone = op("/v1/voice_clone");
  const list = op("/v1/get_voice");
  const remove = { ...op("/v1/delete_voice") };
  const model = () => modelFor("minimax");

  it("never transfers an owned voice through cloning", async () => {
    await ownNative("minimax", "voice-1", "owner");
    const cloned = await send(`/v1/native/minimax/v1/voice_clone?model=${model()}`, "foreign", { method: "POST", body: JSON.stringify({ voice_id: "voice-1", file_id: 1 }), headers: { "x-connection-id": "minimax-account" } });
    expect(cloned.status).toBe(403);
    expect((await readNativeResourceOwner("minimax", "minimax-account", "voice-1")).ownerId).toBe("owner");
    const denied = await send(nativeTarget(remove, "voice-1"), "foreign", nativeOptions(remove, "voice-1"));
    expect(denied.status).toBe(403);
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("lets the cloning key, and only it, delete the cloned voice", async () => {
    fixture.fetch.mockImplementation(async () => Response.json({ base_resp: { status_code: 0 } }));
    const cloned = await send(`/v1/native/minimax/v1/voice_clone?model=${model()}`, "owner", { method: "POST", body: JSON.stringify({ voice_id: "cloned", file_id: 1 }), headers: { "x-connection-id": "minimax-account" } });
    expect(cloned.status).toBe(200);
    await cloned.text();
    expect(clone.createsResource).toBe(true);
    expect((await send(nativeTarget(remove, "cloned"), "foreign", nativeOptions(remove, "cloned"))).status).toBe(403);
    const removed = await send(nativeTarget(remove, "cloned"), "owner", nativeOptions(remove, "cloned"));
    expect(removed.status).toBe(200);
    await removed.text();
  });

  it("fails closed when deleting a voice with no recorded owner", async () => {
    const response = await send(nativeTarget(remove, "unrecorded"), "owner", nativeOptions(remove, "unrecorded"));
    expect(response.status).toBe(403);
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("binds the account voice list to a pinned account within key scope", async () => {
    const target = `/v1/native/minimax/v1/get_voice?model=${model()}`;
    const body = JSON.stringify({ voice_type: "all" });
    expect((await send(target, "owner", { method: "POST", body })).status).toBe(400);
    fixture.scopes.set("owner", ["anthropic-account"]);
    expect((await send(target, "owner", { method: "POST", body, headers: { "x-connection-id": "minimax-account" } })).status).toBe(503);
    expect(fixture.fetch).not.toHaveBeenCalled();
    expect(list.accountBound).toBe(true);
  });
});
