// Retired Vertex Veo models (#2034). Google retired veo-3.0-generate-001,
// veo-3.0-fast-generate-001 and veo-2.0-generate-001 on 2026-06-30
// (https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions,
// checked 2026-11-27). The source registry still lists them, so an explicit
// retired id must be refused locally with 400 before any token mint or request,
// and never be aliased to a current model.
//
// Layers: the public POST /v1/video/generations route, the real core, the
// registered adapter (the real factory with an injected token minter and fake
// clock), and the private factory directly. One closed fetch answers every
// request; an unexpected one fails the test. The fixtures are well-formed
// synthetic credentials that succeed for the active models, so a zero-network
// refusal of a retired id cannot come from bad auth. No live service is used.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  dir: "",
  credentials: null,
  save: null,
  rows: new Map(),
  selected: "vertex-sa",
  mints: [],
  clock: 0,
  async wait(ms, signal) {
    signal?.throwIfAborted?.();
    m.clock += ms;
  },
  async mint(credential) {
    m.mints.push(credential?.sa ? `sa:${credential.sa.project_id}` : "other");
    return credential?.sa ? `ya29.SYNTHETIC-minted-${credential.sa.project_id}` : null;
  },
}));

vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true), canManageAccessConfig: vi.fn(async () => true) }));
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})),
  getApiKeyByKey: vi.fn(async () => null),
  getApiKeyById: vi.fn(async () => null),
  getApiKeyUsageTotals: vi.fn(async () => ({})),
  getComboForModel: vi.fn(async () => null),
  getCombos: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getCustomModels: vi.fn(async () => []),
  getSyncedModelCatalog: vi.fn(async () => null),
  getProviderNodes: vi.fn(async () => []),
  getProviderNodeById: vi.fn(async () => null),
  getProviderConnections: vi.fn(async ({ provider } = {}) => [...m.rows.values()].filter((row) => !provider || row.provider === provider).map((row) => ({ ...row }))),
  getProviderConnectionById: vi.fn(async (id) => m.rows.get(id) ?? null),
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  getProxyPoolById: vi.fn(async () => null),
  saveRequestUsage: (...args) => m.save(...args),
  updateProviderConnection: vi.fn(async () => null),
  recordProviderConnectionFallbackState: vi.fn(async () => ({ applied: true, connection: null })),
}));
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({ recordProviderRateLimitEvidence: vi.fn(async () => {}), clearProviderRateLimitEvidence: vi.fn(async () => {}) }));
vi.mock("@/lib/webhooks/index.js", () => ({ notifyWebhookEvent: vi.fn() }));
vi.mock("@/lib/db/repos/mediaJobsRepo.js", () => ({ createMediaJob: vi.fn(), getMediaJob: vi.fn(), finishMediaJob: vi.fn() }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: (...args) => m.credentials(...args),
  getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(async () => {}),
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
  supportsTranslation: () => false,
}));
vi.mock("../../open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn(async () => null) }));
vi.mock("@/lib/dataDir.js", () => ({ get DATA_DIR() { return m.dir; } }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
// The registered instance is the real factory with a counting token minter and
// the fake clock; the dispatcher imports exactly this instance.
vi.mock("../../open-sse/services/providerParity/native-vertex-video/adapter.js", async (original) => {
  const actual = await original();
  return { ...actual, default: actual.createVertexVideoAdapter({ mintToken: (credential) => m.mint(credential), wait: (ms, signal) => m.wait(ms, signal), now: () => m.clock }) };
});

import { POST as videos } from "../../src/app/api/v1/video/generations/route.js";
import { readFileSync } from "node:fs";
import { handleVideoGenerationCore } from "../../open-sse/handlers/videoGenerationCore.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import vertexRegistry from "../../open-sse/providers/registry/vertex.js";
import registeredAdapter, { createVertexVideoAdapter } from "../../open-sse/services/providerParity/native-vertex-video/adapter.js";
import {
  VERTEX_VIDEO_MODEL_IDS,
  VERTEX_VIDEO_MODELS,
  VERTEX_VIDEO_PROVIDER_METADATA,
  vertexVideoModel,
} from "../../open-sse/services/providerParity/native-vertex-video/config.js";
import { buildVertexVideoRequest } from "../../open-sse/services/providerParity/native-vertex-video/request.js";

const ACTIVE = ["veo-3.1-generate-001", "veo-3.1-fast-generate-001"];
const RETIRED = ["veo-3.0-generate-001", "veo-3.0-fast-generate-001", "veo-2.0-generate-001"];
const RETIREMENT_URL = "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions";

const PROJECT = "synthetic-retired-proj";
const PRESET_PROJECT = "synthetic-preset-proj";
const PRESET_TOKEN = "ya29.SYNTHETIC-preset-token";
const EXPRESS_KEY = "AQ.SYNTHETIC-express-key";
const MINTED = `ya29.SYNTHETIC-minted-${PROJECT}`;
// Well-formed Service Account JSON. The injected minter accepts it, so it is a
// credential that works, not one that fails auth.
const SA = JSON.stringify({
  type: "service_account",
  project_id: PROJECT,
  client_email: `video@${PROJECT}.iam.gserviceaccount.com`,
  private_key: "-----BEGIN PRIVATE KEY-----\\nSYNTHETICKEYMATERIAL\\n-----END PRIVATE KEY-----\\n",
});
const ROWS = {
  "vertex-sa": { provider: "vertex", apiKey: SA, providerSpecificData: { location: "us-central1" } },
  "vertex-preset": { provider: "vertex", apiKey: "", accessToken: PRESET_TOKEN, providerSpecificData: { projectId: PRESET_PROJECT, location: "europe-west4" } },
  "vertex-express": { provider: "vertex", apiKey: EXPRESS_KEY, providerSpecificData: {} },
};
const CREDENTIALS = {
  "vertex-sa": { apiKey: SA, providerSpecificData: { location: "us-central1" } },
  "vertex-preset": { accessToken: PRESET_TOKEN, providerSpecificData: { projectId: PRESET_PROJECT, location: "europe-west4" } },
  "vertex-express": { apiKey: EXPRESS_KEY },
};
const SCOPES = {
  "vertex-sa": { base: (model) => `https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/publishers/google/models/${model}`, op: (model) => `projects/${PROJECT}/locations/us-central1/publishers/google/models/${model}/operations/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7`, query: "", auth: `Bearer ${MINTED}`, mints: [`sa:${PROJECT}`] },
  "vertex-preset": { base: (model) => `https://europe-west4-aiplatform.googleapis.com/v1/projects/${PRESET_PROJECT}/locations/europe-west4/publishers/google/models/${model}`, op: (model) => `projects/${PRESET_PROJECT}/locations/europe-west4/publishers/google/models/${model}/operations/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7`, query: "", auth: `Bearer ${PRESET_TOKEN}`, mints: [] },
  "vertex-express": { base: (model) => `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}`, op: (model) => `projects/123456789012/locations/us-central1/publishers/google/models/${model}/operations/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7`, query: `?key=${EXPRESS_KEY}`, auth: undefined, mints: [] },
};
const CONNECTIONS = Object.keys(ROWS);

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(12, 1)]).toString("base64");
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Answers a full, successful Veo job for `model` on `connection`, checking the
// wire scope of each request.
function serveJob(connection, model) {
  const scope = SCOPES[connection];
  const op = scope.op(model);
  steps.push((url, init) => {
    expect(url).toBe(`${scope.base(model)}:predictLongRunning${scope.query}`);
    expect(init.headers.Authorization).toBe(scope.auth);
    return json({ name: op });
  }, (url, init) => {
    expect(url).toBe(`${scope.base(model)}:fetchPredictOperation${scope.query}`);
    expect(init.headers.Authorization).toBe(scope.auth);
    expect(JSON.parse(init.body)).toEqual({ operationName: op });
    return json({ name: op, done: true, response: { videos: [{ bytesBase64Encoded: MP4, mimeType: "video/mp4" }] } });
  });
}

let calls;
let steps;
const usage = () => m.save.mock.calls.map(([row]) => row);
const post = (body) => videos(new Request("http://localhost/v1/video/generations", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));

beforeEach(() => {
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-retired-video-"));
  m.rows.clear();
  for (const [id, row] of Object.entries(ROWS)) m.rows.set(id, { id, ...row, authType: "apikey", isActive: true });
  m.selected = "vertex-sa";
  m.mints = [];
  m.clock = 1_000_000;
  m.credentials = vi.fn(async (_provider, excluded) => {
    const id = m.selected;
    if (excluded?.has?.(id)) return null;
    const row = m.rows.get(id);
    return { ...row, providerSpecificData: { ...row.providerSpecificData }, connectionId: id, connectionName: id, _connection: { ...row } };
  });
  m.save = vi.fn(async () => true);
  calls = [];
  steps = [];
  vi.stubGlobal("fetch", vi.fn(async (input, init = {}) => {
    const url = String(input?.url ?? input);
    calls.push({ url, init });
    const next = steps.shift();
    if (!next) throw new Error(`closed network: ${init.method || "GET"} ${url}`);
    return next(url, init);
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(m.dir, { recursive: true, force: true });
});

describe("model inventory", () => {
  it("the source config, metadata and per-model lookup hold only the two active Veo 3.1 ids", () => {
    expect(VERTEX_VIDEO_MODEL_IDS).toEqual(ACTIVE);
    expect(VERTEX_VIDEO_MODELS.map((model) => model.id)).toEqual(ACTIVE);
    expect(VERTEX_VIDEO_PROVIDER_METADATA.videoModels.map((model) => model.id)).toEqual(ACTIVE);
    for (const model of VERTEX_VIDEO_MODELS) expect(model.durations).toEqual([4, 6, 8]);
    for (const id of RETIRED) expect(vertexVideoModel(id)).toBeNull();
  });

  it("the manifest lists only the active ids and records the retirement source and date", () => {
    const registration = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-vertex-video/registration.json", import.meta.url), "utf8"));
    expect(registration.models.map((model) => model.id)).toEqual(ACTIVE);
    for (const model of registration.models) expect(model.durationSeconds).toEqual([4, 6, 8]);
    expect(registration.retiredModels).toMatchObject({ ids: RETIRED, retiredOn: "2026-06-30", source: RETIREMENT_URL });
    expect(JSON.stringify(registration.models)).not.toMatch(/veo-(2\.0|3\.0)/);
  });

  it("the advertised video kind lists only the active ids", () => {
    expect(vertexRegistry.serviceKinds).toContain("video");
    expect(vertexRegistry.models.filter((row) => row.kind === "video").map((row) => row.id)).toEqual(ACTIVE);
    expect(vertexRegistry.models.map((row) => row.id)).not.toEqual(expect.arrayContaining([expect.stringMatching(/^veo-(2\.0|3\.0)-/)]));
  });
});

describe("public route POST /v1/video/generations", () => {
  it.each(RETIRED.flatMap((model) => ["vx", "vertex"].flatMap((prefix) => CONNECTIONS.map((connection) => [prefix, model, connection]))))(
    "%s/%s on %s is a local 400 with no token mint, request or usage",
    async (prefix, model, connection) => {
      m.selected = connection;
      // A job is queued: if the retired id were dispatched, it would succeed.
      serveJob(connection, model);
      const response = await post({ model: `${prefix}/${model}`, prompt: "synthetic gate", duration: 6 });
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).toMatch(/Unsupported Vertex video model/);
      expect(calls).toEqual([]);
      expect(m.mints).toEqual([]);
      expect(usage()).toEqual([]);
    },
  );

  it.each(ACTIVE.flatMap((model) => CONNECTIONS.map((connection) => [model, connection])))("%s on %s still succeeds with its own scope, credential and usage", async (model, connection) => {
    m.selected = connection;
    serveJob(connection, model);
    const response = await post({ model: `vx/${model}`, prompt: "synthetic gate", duration: 8 });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ b64_json: MP4, format: "mp4" }]);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0].init.body)).toEqual({ instances: [{ prompt: "synthetic gate" }], parameters: { sampleCount: 1, durationSeconds: 8 } });
    expect(m.mints).toEqual(SCOPES[connection].mints);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "vertex", connectionId: connection, modality: "video", nativeUnits: { videos: 1 }, costStatus: "unknown" });
  });
});

describe("core and registered adapter", () => {
  it("the registered dispatcher is the real factory instance", () => {
    expect(getVideoGenerationAdapter("vertex")).toBe(registeredAdapter);
    expect(getVideoGenerationAdapter("vx")).toBe(registeredAdapter);
  });

  it.each(RETIRED.flatMap((model) => CONNECTIONS.map((connection) => [model, connection])))("core refuses %s on %s with 400 before any mint or request", async (model, connection) => {
    serveJob(connection, model);
    const result = await handleVideoGenerationCore({ provider: "vertex", model, body: { prompt: "synthetic gate" }, credentials: CREDENTIALS[connection] });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Unsupported Vertex video model/);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toEqual([]);
    expect(m.mints).toEqual([]);
  });

  it.each(ACTIVE)("core still runs %s with the minted Service Account token", async (model) => {
    serveJob("vertex-sa", model);
    const result = await handleVideoGenerationCore({ provider: "vertex", model, body: { prompt: "synthetic gate", duration: 4 }, credentials: CREDENTIALS["vertex-sa"] });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(2);
    expect(m.mints).toEqual([`sa:${PROJECT}`]);
  });
});

describe("private factory", () => {
  const factory = () => createVertexVideoAdapter({ mintToken: (credential) => m.mint(credential), wait: (ms, signal) => m.wait(ms, signal), now: () => m.clock });

  it.each(RETIRED.flatMap((model) => CONNECTIONS.map((connection) => [model, connection])))("refuses %s on %s with 400 before any mint or request", async (model, connection) => {
    serveJob(connection, model);
    const result = await factory().generate({ model, body: { prompt: "synthetic gate", duration: 6 }, credentials: CREDENTIALS[connection] });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Unsupported Vertex video model/);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toEqual([]);
    expect(m.mints).toEqual([]);
    expect(() => buildVertexVideoRequest(model, { prompt: "synthetic gate" })).toThrow(/Unsupported Vertex video model/);
  });

  it.each(ACTIVE.flatMap((model) => CONNECTIONS.map((connection) => [model, connection])))("%s on %s keeps success, credential scope and usage", async (model, connection) => {
    serveJob(connection, model);
    const result = await factory().generate({ model, body: { prompt: "synthetic gate", duration: 6 }, credentials: CREDENTIALS[connection] });
    expect(result.success).toBe(true);
    expect((await result.response.json()).data).toEqual([{ b64_json: MP4, format: "mp4" }]);
    expect(result.accounting).toMatchObject({ modality: "video", nativeUnits: { videos: 1 }, cost: null, costStatus: "unknown" });
    expect(result.accounting.meta.nativeUnitsSource).toBe("returned-videos");
    expect(calls).toHaveLength(2);
    expect(m.mints).toEqual(SCOPES[connection].mints);
  });

  it("retired ids are not mapped to a current model", async () => {
    for (const model of RETIRED) {
      expect(() => buildVertexVideoRequest(model, { prompt: "synthetic gate" })).toThrow(new RegExp(`Unsupported Vertex video model: ${model.replaceAll(".", "\\.")}\\.`));
    }
    expect(calls).toEqual([]);
  });
});
