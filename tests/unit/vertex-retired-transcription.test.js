// Vertex Gemini transcription refuses the retired gemini-2.0-flash and keeps
// the current gemini-2.5-flash and gemini-2.5-pro rows (issue #2034).
//
// Retirement evidence: Google's model lifecycle table
// https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions
// lists gemini-2.0-flash as retired on June 1, 2026 (checked 2026-11-27).
//
// The public transcriptions route, the real STT core and the staged private
// adapter run against one closed fetch. Every credential is synthetic, token
// minting is injected and recorded, and an unexpected request fails the test.
// Passing proves the gateway contract only, not live provider acceptance.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ dir: "", credentials: null, save: null, rows: new Map(), selected: null, mints: [] }));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: vi.fn(async () => true),
  canManageAccessConfig: vi.fn(async () => true),
}));
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
  getSyncedModelCatalogs: vi.fn(async () => ({})),
  getProviderNodes: vi.fn(async () => []),
  getProviderNodeById: vi.fn(async () => null),
  getProviderConnections: vi.fn(async ({ provider } = {}) => [...m.rows.values()].filter((row) => !provider || row.provider === provider).map((row) => ({ ...row }))),
  getProviderConnectionById: vi.fn(async (id) => m.rows.get(id) ?? null),
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  getProxyPoolById: vi.fn(async () => null),
  saveRequestUsage: (...args) => m.save(...args),
  updateProviderConnection: vi.fn(async () => null),
  recordProviderConnectionFallbackState: vi.fn(async () => ({ applied: true })),
}));
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: vi.fn(async () => {}),
  clearProviderRateLimitEvidence: vi.fn(async () => {}),
}));
vi.mock("@/lib/webhooks/index.js", () => ({ notifyWebhookEvent: vi.fn() }));
vi.mock("@/lib/db/repos/mediaJobsRepo.js", () => ({ createMediaJob: vi.fn(), getMediaJob: vi.fn(), finishMediaJob: vi.fn() }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: (...args) => m.credentials(...args),
  getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
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
// Free no-auth providers stay off so root discovery never leaves the gateway.
vi.mock("@/sse/services/freeProviderGate.js", () => ({ isFreeNoAuthProviderDisabled: (id) => id !== "vertex" }));
vi.mock("@/lib/modelAutoSync/sharedMetadata.js", () => ({ getSharedModelMetadata: vi.fn(async () => null) }));
// The real transcriber with recorded, synthetic token minting.
vi.mock("../../open-sse/services/providerParity/native-vertex-tts-stt/transcription.js", async (original) => {
  const actual = await original();
  return {
    ...actual,
    transcribeVertex: actual.createVertexSttTranscriber({
      requestTimeoutMs: 400,
      mintServiceAccountToken: async (saJson) => { m.mints.push(saJson.project_id); return TOKEN; },
      refreshAdcToken: async () => { m.mints.push("adc"); return TOKEN; },
    }),
  };
});

import { POST as transcriptions } from "../../src/app/api/v1/audio/transcriptions/route.js";
import { GET as typedModels } from "../../src/app/api/v1/models/[...model]/route.js";
import { GET as rootModels } from "../../src/app/api/v1/models/route.js";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";
import { clearLiveModelLimitsCache } from "../../open-sse/services/liveModelLimits.js";
import vertexRegistry from "../../open-sse/providers/registry/vertex.js";
import registration from "../../open-sse/services/providerParity/native-vertex-tts-stt/registration.json" with { type: "json" };
import {
  VERTEX_STT_CONFIG,
  VERTEX_STT_MODEL_IDS,
  createVertexSttTranscriber,
  listVertexAudioModels,
} from "../../open-sse/services/providerParity/native-vertex-tts-stt/index.js";

const RETIRED = "gemini-2.0-flash";
const ACTIVE = ["gemini-2.5-flash", "gemini-2.5-pro"];
const PROJECT = "synthetic-retire-proj";
const TOKEN = "ya29.SYNTHETIC-retire-token";
const EXPRESS_KEY = "AQ.SYNTHETIC-retire-express";
const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nSYNTHETIC\n-----END PRIVATE KEY-----\n";
const SA_JSON = JSON.stringify({ type: "service_account", project_id: PROJECT, client_email: `svc@${PROJECT}.iam.gserviceaccount.com`, private_key: PRIVATE_KEY });
const SA = { apiKey: SA_JSON, providerSpecificData: { location: "us-central1" } };
const EXPRESS = { apiKey: EXPRESS_KEY };
const regional = (model) => `https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/publishers/google/models/${model}:generateContent`;
const express = (model) => `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(EXPRESS_KEY)}`;
// One stable WAV-shaped upload shared by every case.
const AUDIO = Buffer.from("RIFF....WAVEfmt synthetic-retire-audio");
const audioFile = () => new File([AUDIO], "clip.wav", { type: "audio/wav" });
function form(model, fields = {}) {
  const fd = new FormData();
  fd.append("file", audioFile());
  if (model) fd.append("model", model);
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  return fd;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const transcriptAnswer = () => json({
  candidates: [{ content: { role: "model", parts: [{ text: " the forest gate opens " }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 8, totalTokenCount: 308 },
});
const bodyOf = (call) => JSON.parse(call.init.body);
const usage = () => m.save.mock.calls.map(([row]) => row);
const sttPost = (model) => transcriptions(new Request("http://localhost/v1/audio/transcriptions", { method: "POST", body: form(model) }));

let calls;
let steps;
beforeEach(() => {
  vi.clearAllMocks();
  clearLiveModelLimitsCache();
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-retired-stt-"));
  m.rows.clear();
  m.rows.set("vertex-sa", { id: "vertex-sa", provider: "vertex", authType: "apikey", isActive: true, ...SA });
  m.selected = "vertex-sa";
  m.mints = [];
  m.credentials = vi.fn(async (provider, excluded) => {
    if (provider !== "vertex" || excluded?.has?.(m.selected)) return null;
    const row = m.rows.get(m.selected);
    return { ...row, connectionId: row.id, connectionName: row.id, _connection: { ...row } };
  });
  m.save = vi.fn(async () => true);
  calls = []; steps = [];
  vi.stubGlobal("fetch", vi.fn(async (input, init = {}) => {
    const url = String(input?.url ?? input);
    calls.push({ url, init });
    const next = steps.shift();
    if (!next) throw new Error(`closed network: ${init.method || "GET"} ${url}`);
    return next(url, init);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); fs.rmSync(m.dir, { recursive: true, force: true }); });

describe("catalog and discovery", () => {
  it("drops only the retired id from the staged config, manifest and registry", () => {
    expect(VERTEX_STT_MODEL_IDS).toEqual(ACTIVE);
    expect(VERTEX_STT_CONFIG.models.map(({ id }) => id)).toEqual(ACTIVE);
    expect(listVertexAudioModels("stt").map(({ id }) => id)).toEqual(ACTIVE);
    expect(registration.services.stt.models).toEqual(ACTIVE);
    expect(vertexRegistry.sttConfig.models.map(({ id }) => id)).toEqual(ACTIVE);
    expect(JSON.stringify([vertexRegistry.sttConfig, vertexRegistry.models])).not.toContain(RETIRED);
    expect(registration.services.stt.retiredModels).toEqual([expect.objectContaining({
      id: RETIRED,
      retired: "2026-06-01",
      evidence: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions",
    })]);
  });

  it("typed /v1/models/stt lists both current models and not the retired one, without a provider call", async () => {
    const response = await typedModels(new Request("http://localhost/v1/models/stt"), { params: Promise.resolve({ model: ["stt"] }) });
    expect(response.status).toBe(200);
    const rows = (await response.json()).data.filter((row) => row.owned_by === "vx");
    expect(rows.map(({ id }) => id).sort()).toEqual(ACTIVE.map((id) => `vx/${id}`).sort());
    expect(rows.every((row) => row.kind === "stt")).toBe(true);
    expect(calls).toEqual([]);
  });

  it("keeps the vertex chat catalog and root /v1/models chat rows unchanged", async () => {
    const chat = vertexRegistry.models.filter((row) => !row.kind).map(({ id }) => id);
    expect(chat).toEqual(["gemini-4-argon", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite-preview", "gemini-3-flash-preview", "gemini-2.5-flash"]);
    expect(vertexRegistry).toMatchObject({ id: "vertex", alias: "vertex", aliases: ["vx"], transport: { baseUrl: "https://aiplatform.googleapis.com", format: "vertex" } });
    const response = await rootModels(new Request("http://localhost/v1/models"));
    expect(response.status).toBe(200);
    const rows = (await response.json()).data.filter((row) => row.owned_by === "vx");
    expect(rows.map(({ id }) => id)).toEqual(chat.map((id) => `vx/${id}`));
    expect(calls).toEqual([]);
  });
});

describe("private adapter", () => {
  const deps = () => ({
    requestTimeoutMs: 400,
    mintServiceAccountToken: async (saJson) => { m.mints.push(saJson.project_id); return TOKEN; },
    refreshAdcToken: async () => { m.mints.push("adc"); return TOKEN; },
  });

  it.each([["service account", SA], ["express key", EXPRESS]])("refuses %s requests for the retired id with 400 before minting or HTTP", async (_name, credentials) => {
    const result = await createVertexSttTranscriber(deps())({ model: RETIRED, formData: form(), credentials });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(m.mints).toEqual([]);
    expect(calls).toEqual([]);
  });

  it.each(ACTIVE)("transcribes %s with the same fixtures", async (model) => {
    steps.push(() => transcriptAnswer());
    const result = await createVertexSttTranscriber(deps())({ model, formData: form(), credentials: SA });
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "the forest gate opens" });
    expect(m.mints).toEqual([PROJECT]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(regional(model));
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(bodyOf(calls[0]).contents[0].parts[1].inlineData).toEqual({ mimeType: "audio/wav", data: AUDIO.toString("base64") });
  });
});

describe("STT core", () => {
  const core = (model) => handleSttCore({ provider: "vertex", model, formData: form(), credentials: SA, sttConfig: vertexRegistry.sttConfig });

  it("refuses the retired id with 400 before minting or HTTP", async () => {
    const result = await core(RETIRED);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(m.mints).toEqual([]);
    expect(calls).toEqual([]);
  });

  it.each(ACTIVE)("dispatches %s once to its own endpoint", async (model) => {
    steps.push(() => transcriptAnswer());
    const result = await core(model);
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "the forest gate opens" });
    expect(m.mints).toEqual([PROJECT]);
    expect(calls.map(({ url }) => url)).toEqual([regional(model)]);
  });

  it("keeps the express-key endpoint for current models", async () => {
    steps.push(() => transcriptAnswer());
    const result = await handleSttCore({ provider: "vertex", model: ACTIVE[1], formData: form(), credentials: EXPRESS, sttConfig: vertexRegistry.sttConfig });
    expect(result.success).toBe(true);
    expect(calls.map(({ url }) => url)).toEqual([express(ACTIVE[1])]);
    expect(m.mints).toEqual([]);
  });
});

describe("POST /v1/audio/transcriptions", () => {
  it.each(["vx", "vertex"])("refuses %s/gemini-2.0-flash with 400 before minting, HTTP or usage", async (prefix) => {
    const response = await sttPost(`${prefix}/${RETIRED}`);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(TOKEN);
    expect(m.mints).toEqual([]);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });

  it.each(ACTIVE)("transcribes vx/%s once with the selected account and records usage once", async (model) => {
    steps.push((url, init) => {
      expect(url).toBe(regional(model));
      expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(bodyOf({ init }).contents[0].parts[1].inlineData).toEqual({ mimeType: "audio/wav", data: AUDIO.toString("base64") });
      return transcriptAnswer();
    });
    const response = await sttPost(`vx/${model}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "the forest gate opens" });
    expect(m.mints).toEqual([PROJECT]);
    expect(calls).toHaveLength(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "vertex", model, connectionId: "vertex-sa", modality: "stt" });
  });
});
