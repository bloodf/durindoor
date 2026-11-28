// Native /v1/video/generations health context is captured at dispatch (#2034).
//
// Drives the public handleVideoGeneration through the real typed model
// resolution, endpoint support, registered native video adapters
// (adobe-firefly-api, adobe-firefly-web, renderhour), the real
// credentialDispatchSnapshot and the real markAccountUnavailable. Only account
// storage, credential selection, the token refresh exchange, the usage ledger,
// webhooks, logging, the network and the browser are substituted. Every
// credential is synthetic and every request is answered below.
//
// Provider work is held open while the fake clock moves on, then settled. The
// outcome write must still carry the context of the dispatch: its time, the
// fingerprint of the stored credential that was sent and that credential.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  dir: "",
  launcher: null,
  credentials: vi.fn(),
  refresh: vi.fn(),
  save: vi.fn(),
  rows: new Map(),
  fallback: [],
  writes: [],
}));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: vi.fn(async () => true),
  canManageAccessConfig: vi.fn(async () => true),
}));
vi.mock("@/lib/localDb", () => {
  const apply = (id, patch) => {
    const row = m.rows.get(id);
    if (!row) return null;
    Object.assign(row, patch);
    return row;
  };
  return {
    getSettings: vi.fn(async () => ({})),
    getApiKeyByKey: vi.fn(async () => null),
    getApiKeyById: vi.fn(async () => null),
    getApiKeyUsageTotals: vi.fn(async () => ({})),
    getComboForModel: vi.fn(async () => null),
    getCustomModels: vi.fn(async () => []),
    getSyncedModelCatalog: vi.fn(async () => null),
    getProviderNodes: vi.fn(async () => []),
    getProviderNodeById: vi.fn(async () => null),
    getProviderConnections: vi.fn(async ({ provider } = {}) => [...m.rows.values()].filter((row) => !provider || row.provider === provider).map((row) => ({ ...row }))),
    getProviderConnectionById: vi.fn(async (id) => m.rows.get(id) ?? null),
    getApiKeyProviderConnectionIds: vi.fn(async () => []),
    getProxyPoolById: vi.fn(async () => null),
    saveRequestUsage: m.save,
    createProviderConnection: vi.fn(async (data) => {
      const row = { ...data, id: `conn-${m.rows.size + 1}` };
      m.rows.set(row.id, row);
      return { ...row };
    }),
    deleteProviderConnection: vi.fn(),
    updateProviderConnection: vi.fn(async (id, patch, options = {}) => {
      m.writes.push({ id, patch });
      const connection = apply(id, patch);
      return options.returnCommitResult ? { applied: true, connection } : connection;
    }),
    recordProviderConnectionFallbackState: vi.fn(async (id, state) => {
      m.fallback.push({ id, ...state });
      const scope = state.model ? `modelLock_${state.model}` : "modelLock___all";
      return { applied: true, connection: apply(id, { [scope]: new Date(state.observedAt + state.cooldownMs).toISOString(), errorCode: state.status }) };
    }),
  };
});
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: vi.fn(async () => {}),
  clearProviderRateLimitEvidence: vi.fn(async () => {}),
}));
vi.mock("@/lib/webhooks/index.js", () => ({ notifyWebhookEvent: vi.fn() }));
vi.mock("@/lib/db/repos/mediaJobsRepo.js", () => ({ createMediaJob: vi.fn(), getMediaJob: vi.fn(), finishMediaJob: vi.fn() }));
vi.mock("../../src/sse/services/auth.js", async () => {
  // The real account-health writer, behind substituted credential selection.
  const real = await import("../../src/sse/services/auth/accountErrors.js");
  return {
    getProviderCredentialsWithQuotaPreflight: m.credentials,
    getNoAuthProviderCredentials: vi.fn(),
    markAccountUnavailable: vi.fn(real.markAccountUnavailable),
    clearAccountError: vi.fn(async () => {}),
    resolveClientApiKey: vi.fn(async () => ({ apiKey: "caller-key", auth: { ok: true, apiKeyId: "caller-id", billingEpoch: null } })),
    extractApiKey: vi.fn(),
    hasValidCliToken: vi.fn(),
  };
});
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  refreshWithRetry: vi.fn(async () => null),
  checkAndRefreshToken: m.refresh,
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

import { credentialFingerprint } from "../../src/shared/utils/credentialFingerprint.js";
import { ADOBE_FIREFLY_VIDEO_GENERATE_URL, ADOBE_IMS_TOKEN_URL } from "../../open-sse/providers/registry/adobe-firefly-api.js";
import { RENDERHOUR_GENERATIONS_URL } from "../../open-sse/providers/registry/renderhour.js";
import { defaultAdobeTokenCache } from "../../open-sse/services/adobeFireflyApi/auth.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { mediaEndpointSupport } from "../../src/sse/services/mediaTransport.js";
import { ACCEPTED_JOB_HEADER } from "../../open-sse/services/combo.js";
import { fakeLauncher, syntheticWorkspace, syntheticMapping } from "../fixtures/fireflyWebUi/fakeBrowser.js";
import * as auth from "../../src/sse/services/auth.js";

// The real request-correlation path opens SQLite using the live environment,
// independently of the mocked account store and dataDir getter. Isolate it
// before importing the routes so other test files cannot share its database.
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "video-dispatch-db-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = dbDir;
m.dir = dbDir;

const { handleVideoGeneration } = await import("../../src/sse/handlers/video.js");
const { POST: createConnection } = await import("@/app/api/providers/route.js");

afterAll(async () => {
  const state = globalThis._dbAdapter;
  if (state?.file === path.join(dbDir, "db", "data.sqlite")) {
    await state.instance?.close?.();
    state.instance = null;
    state.initPromise = null;
    state.file = null;
    state.cacheKey = null;
  }
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dbDir, { recursive: true, force: true });
});

const NOW = Math.floor(Date.now() / 1000) * 1000;
const PENDING_MS = 90_000;

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const post = (model, signal) => new Request("http://localhost/v1/video/generations", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model, prompt: "synthetic waves at dusk" }),
  ...(signal ? { signal } : {}),
});
const usage = () => m.save.mock.calls.map(([event]) => event);
const marks = () => auth.markAccountUnavailable.mock.calls;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Let queued microtasks and I/O callbacks run until `predicate` holds. If the
// route answers first, its answer is the failure.
async function until(predicate, label, pending) {
  let answered = null;
  pending.then((response) => { answered = response; }, (error) => { answered = { status: "threw", error }; });
  for (let step = 0; step < 1000; step++) {
    if (predicate()) return;
    if (answered) break;
    // Real timers: first-use module loading takes wall time, not ticks.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const detail = answered?.text ? `${answered.status} ${await answered.clone().text()}` : String(answered?.error ?? "no answer");
  throw new Error(`timed out waiting for ${label}: ${detail}`);
}

let fetchCalls;
const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  // Only the wall clock is faked: adapter deadlines keep real timers, so the
  // clock can move far past dispatch without tripping a submit timeout.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) vi.stubEnv(key, undefined);
  m.rows.clear();
  m.fallback.length = 0;
  m.writes.length = 0;
  m.save.mockResolvedValue(true);
  m.refresh.mockReset().mockImplementation(async (_provider, credentials) => credentials);
  m.credentials.mockReset();
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), "video-dispatch-snapshot-"));
  fetchCalls = [];
  defaultAdobeTokenCache.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  global.fetch = originalFetch;
  fs.rmSync(m.dir, { recursive: true, force: true });
});

describe("registered native video capability (the dependency is real)", () => {
  it.each(["adobe-firefly-api", "adobe-firefly-web", "renderhour"])("%s runs its own adapter on /v1/video/generations only", (provider) => {
    expect(typeof getVideoGenerationAdapter(provider)?.generate).toBe("function");
    expect(mediaEndpointSupport("video", "/v1/video/generations", provider).supported).toBe(true);
    expect(mediaEndpointSupport("video", "/v1/videos", provider).supported).toBe(false);
  });
});

describe("adobe-firefly-api: selected stored key on the selected account", () => {
  const CLIENT_A = "synthclienta0000000000000000000a";
  const CLIENT_B = "synthclientb0000000000000000000b";
  const PRIMARY_B = "p8e-SYNTHETIC-dispatch-primary-b";
  const EXTRA_B = "p8e-SYNTHETIC-dispatch-extra-b";

  it("a refusal settled long after dispatch is written with the dispatch time, key and fingerprint", async () => {
    const rowA = { id: "ff-a", provider: "adobe-firefly-api", authType: "apikey", isActive: true, apiKey: "p8e-SYNTHETIC-a", providerSpecificData: { clientId: CLIENT_A } };
    const rowB = { id: "ff-b", provider: "adobe-firefly-api", authType: "apikey", isActive: true, apiKey: PRIMARY_B, providerSpecificData: { clientId: CLIENT_B, extraApiKeys: [EXTRA_B] } };
    m.rows.set(rowA.id, rowA);
    m.rows.set(rowB.id, rowB);
    // Account B is selected, and of its keys the extra one is dispatched.
    const selected = { connectionId: rowB.id, provider: rowB.provider, authType: rowB.authType, apiKey: EXTRA_B, providerSpecificData: { ...rowB.providerSpecificData }, _connection: { ...rowB } };
    m.credentials.mockResolvedValueOnce(selected).mockResolvedValue({ allRateLimited: true, lastError: "unavailable" });
    const submit = deferred();
    global.fetch = vi.fn(async (url, init = {}) => {
      fetchCalls.push({ url: String(url), init });
      if (String(url) === ADOBE_IMS_TOKEN_URL) return json({ access_token: "synthetic-ims-token-b", token_type: "bearer", expires_in: 86_399 });
      if (String(url) === ADOBE_FIREFLY_VIDEO_GENERATE_URL) return submit.promise;
      throw new Error(`Unexpected request: ${url}`);
    });

    const pending = handleVideoGeneration(post("adobe-firefly-api/video1_standard"));
    await until(() => fetchCalls.some((call) => call.url === ADOBE_FIREFLY_VIDEO_GENERATE_URL), "the Firefly submit", pending);
    // While the submit is open: time passes and the credential object changes.
    vi.setSystemTime(NOW + PENDING_MS);
    selected.apiKey = "p8e-SYNTHETIC-rotated-later";
    submit.resolve(json({ error_code: "rate_limited", message: "slow down" }, 429, { "retry-after": "60" }));
    const response = await pending;

    expect(response.status).toBe(429);
    expect(fetchCalls.filter((call) => call.url === ADOBE_FIREFLY_VIDEO_GENERATE_URL)).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(marks()).toHaveLength(1);
    const [id, status, , provider, model, resetAt, context] = marks()[0];
    expect([id, status, provider, model]).toEqual(["ff-b", 429, "adobe-firefly-api", "video1_standard"]);
    expect(context).toMatchObject({ usedCredential: EXTRA_B, credentialFingerprint: credentialFingerprint(EXTRA_B), dispatchedAt: NOW });
    // Structured evidence still comes from the settled result, on its own clock.
    expect(resetAt).toBe(NOW + PENDING_MS + 60_000);
    expect(context.rateLimitEvidence).toMatchObject({ source: "retry_after", resetAtMs: NOW + PENDING_MS + 60_000 });
    // The atomic write is stamped with the dispatch, bound to the extra key only.
    expect(m.fallback).toEqual([expect.objectContaining({ id: "ff-b", status: 429, observedAt: NOW, credentialFingerprint: credentialFingerprint(EXTRA_B) })]);
    expect(m.fallback[0].credentialFingerprint).not.toBe(credentialFingerprint(PRIMARY_B));
    // The unselected account is untouched.
    expect(m.fallback.filter((entry) => entry.id === "ff-a")).toEqual([]);
    expect(m.writes.filter((entry) => entry.id === "ff-a")).toEqual([]);
    expect(Object.keys(rowA).filter((key) => key.startsWith("modelLock_"))).toEqual([]);
    expect(usage()).toEqual([]);
  });
});

describe("renderhour: the refreshed sign-in is the dispatched credential", () => {
  const STORED = "synthetic-renderhour-stored-access";
  const FRESH = "synthetic-renderhour-fresh-access";
  const row = () => ({ id: "rh-1", provider: "renderhour", authType: "oauth", isActive: true, accessToken: STORED, providerSpecificData: {} });

  function selectRow() {
    const stored = row();
    m.rows.set(stored.id, stored);
    const selected = { connectionId: stored.id, provider: stored.provider, authType: "oauth", accessToken: STORED, providerSpecificData: {}, _connection: { ...stored } };
    m.credentials.mockResolvedValueOnce(selected).mockResolvedValue({ allRateLimited: true, lastError: "unavailable" });
    // The exchange takes time; dispatch starts only once it has returned.
    m.refresh.mockImplementation(async (_provider, credentials) => {
      vi.setSystemTime(NOW + 5_000);
      return { ...credentials, accessToken: FRESH };
    });
    return selected;
  }

  function holdSubmit() {
    const submit = deferred();
    global.fetch = vi.fn((url, init = {}) => {
      fetchCalls.push({ url: String(url), init });
      if (String(url) === RENDERHOUR_GENERATIONS_URL) {
        init.signal?.addEventListener("abort", () => submit.reject(init.signal.reason), { once: true });
        return submit.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    return submit;
  }

  it("after the refresh: fresh token, post-refresh dispatch time, intentionally no fingerprint", async () => {
    selectRow();
    const submit = holdSubmit();
    const pending = handleVideoGeneration(post("renderhour/seedance-2.0-fast"));
    await until(() => fetchCalls.length === 1, "the RenderHour submit", pending);
    expect(fetchCalls[0].init.headers.Authorization).toBe(`Bearer ${FRESH}`);
    vi.setSystemTime(NOW + 5_000 + PENDING_MS);
    submit.resolve(json({ error: { message: "token rejected" } }, 401));
    const response = await pending;

    expect(response.status).toBe(401);
    expect(m.refresh).toHaveBeenCalledTimes(1);
    expect(marks()).toHaveLength(1);
    const [id, status, , , , , context] = marks()[0];
    expect([id, status]).toEqual(["rh-1", 401]);
    // The fresh token is not on the stored row yet: fail-open, not dropped.
    expect(context).toMatchObject({ usedCredential: FRESH, credentialFingerprint: null, dispatchedAt: NOW + 5_000 });
    expect(m.fallback).toEqual([expect.objectContaining({ id: "rh-1", status: 401, observedAt: NOW + 5_000, credentialFingerprint: null })]);
    expect(usage()).toEqual([]);
  });

  it("a caller abort mid-submit writes no health and records the accepted job once, never replayed", async () => {
    selectRow();
    holdSubmit();
    const controller = new AbortController();
    const pending = handleVideoGeneration(post("renderhour/seedance-2.0-fast", controller.signal));
    await until(() => fetchCalls.length === 1, "the RenderHour submit", pending);
    vi.setSystemTime(NOW + 5_000 + PENDING_MS);
    controller.abort();
    const response = await pending;

    expect(response.status).toBe(499);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(marks()).toEqual([]);
    expect(m.fallback).toEqual([]);
    expect(m.writes).toEqual([]);
    expect(fetchCalls).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ connectionId: "rh-1", costSource: "accepted-job" });
  });
});

describe("adobe-firefly-web (registered consumer Firefly): accepted job, outcome unknown", () => {
  it("the failure is written with the dispatch context, usage lands once and nothing is replayed", async () => {
    const created = await createConnection(new Request("http://localhost/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "adobe-firefly-web", name: "Synthetic", providerSpecificData: { fireflyWebUi: { enabled: true, mapping: syntheticMapping(), modelMap: { "synthetic-video": { label: "Synthetic Video Label", kind: "video" } } } } }),
    }));
    expect(created.status).toBe(201);
    const { connection } = await created.json();
    expect(connection.authType).toBe("none");
    m.credentials.mockImplementation(async () => ({ ...m.rows.get(connection.id), connectionId: connection.id }));

    const clicked = deferred();
    const release = deferred();
    m.launcher = fakeLauncher((page) => syntheticWorkspace(page, {
      onSubmit: async () => {
        clicked.resolve();
        await release.promise;
        throw new Error("synthetic browser lost the page after submit");
      },
    }));
    let started = false;
    clicked.promise.then(() => { started = true; });
    const pending = handleVideoGeneration(post("adobe-firefly-web/synthetic-video"));
    await until(() => started, "the Firefly web submit", pending);
    vi.setSystemTime(NOW + PENDING_MS);
    release.resolve();
    const response = await pending;

    expect(response.status).toBe(502);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(marks()).toHaveLength(1);
    const [id, status, , provider, , , context] = marks()[0];
    expect([id, status, provider]).toEqual([connection.id, 502, "adobe-firefly-web"]);
    // A profile-backed account sends no secret: nothing to fingerprint.
    expect(context).toMatchObject({ usedCredential: null, credentialFingerprint: null, dispatchedAt: NOW });
    expect(m.fallback).toEqual([expect.objectContaining({ id: connection.id, observedAt: NOW })]);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(m.launcher.launches).toHaveLength(1);
    const clicks = m.launcher.launches[0].context.created.flatMap((page) => page.calls).filter((call) => call[0] === "click" && call[1] === "Synthetic generate");
    expect(clicks).toHaveLength(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ connectionId: connection.id, costSource: "accepted-job" });
  });
});
