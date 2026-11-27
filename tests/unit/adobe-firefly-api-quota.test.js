// Adobe Firefly Services API quota and rate-limit evidence (#2034) through the
// real /v1/images/generations and /v1/video/generations routes, the real image
// core, video adapter and Firefly services, and the real markAccountUnavailable,
// whose writes land in an in-memory connection store below.
//
// Contract: AdobeDocs/ffs-firefly-api at 1027f559cdb1509a61b34e2f2da9618ec431f2cb,
// static/firefly-api.json (blob 9004da2c5d57850bb72068e6e06b93e04b1bad9e),
// generateImagesV3Async and generateVideoV3: a 403 may carry `x-access-error`
// (quota_exhausted, user_non_entitled, user_profile_denied, invalid_ims_scope);
// a 429 may carry `retry-after` and `x-access-rate-limit-level` (org: the
// organization; account: the organization's tech account).
//
// Only account storage, the usage ledger rows, caller admission, webhooks and
// logging are substituted. Closed network: every request is answered below and
// every credential is synthetic. Nothing here shows how a live account behaves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  credentials: vi.fn(),
  save: vi.fn(),
  rows: new Map(),
  fallback: [],
  evidence: [],
  writes: [],
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
    getProviderConnections: vi.fn(async ({ provider } = {}) => [...m.rows.values()].filter((row) => !provider || row.provider === provider).map((row) => ({ ...row }))),
    getProviderConnectionById: vi.fn(async (id) => m.rows.get(id) ?? null),
    getApiKeyProviderConnectionIds: vi.fn(async () => []),
    getProxyPoolById: vi.fn(async () => null),
    saveRequestUsage: m.save,
    updateProviderConnection: vi.fn(async (id, patch, options = {}) => {
      const row = m.rows.get(id);
      if (row && options.shouldCommitConnection && !options.shouldCommitConnection({ ...row })) {
        return options.returnCommitResult ? { applied: false, connection: row } : row;
      }
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
  recordProviderRateLimitEvidence: vi.fn(async (write) => { m.evidence.push(write); }),
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

import {
  ADOBE_FIREFLY_GENERATE_URL,
  ADOBE_FIREFLY_VIDEO_GENERATE_URL,
  ADOBE_IMS_TOKEN_URL,
  adobeFireflyStatusUrl,
} from "../../open-sse/providers/registry/adobe-firefly-api.js";
import { defaultAdobeTokenCache } from "../../open-sse/services/adobeFireflyApi/auth.js";
import { BACKOFF_CONFIG } from "../../open-sse/config/errorConfig.js";
import { ACCEPTED_JOB_HEADER } from "../../open-sse/services/combo.js";
import * as auth from "../../src/sse/services/auth.js";

const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");
const { handleVideoGeneration } = await import("../../src/sse/handlers/video.js");

// The adapters read the real clock, so the fake one starts at the real time.
const NOW = Math.floor(Date.now() / 1000) * 1000;
const CLIENT_A = "synthclienta0000000000000000000a";
const CLIENT_B = "synthclientb0000000000000000000b";
const SECRET_A = "p8e-SYNTHETIC-quota-secret-a";
const SECRET_B = "p8e-SYNTHETIC-quota-secret-b";
const TOKEN_A = "synthetic-quota-ims-token-a";
const TOKEN_B = "synthetic-quota-ims-token-b";
const SECRETS = [SECRET_A, SECRET_B, TOKEN_A, TOKEN_B];
const JOB = "urn:ff:jobs:eso851211:86ffe2ea-d765-4bd3-b2fd-568ca8fc36ac";
const IMAGE_URL = "https://pre-signed-firefly-prod.s3-accelerate.amazonaws.com/images/quota";
const VIDEO_URL = "https://pre-signed-firefly-prod.s3-accelerate.amazonaws.com/videos/quota.mp4";
const HOSTILE = "<script>alert(1)</script> call +1-555-0100";

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const accepted = () => json({ jobId: JOB }, 202);
const imageDone = () => json({ status: "succeeded", jobId: JOB, result: { outputs: [{ seed: 1, image: { url: IMAGE_URL } }] } });
const videoDone = () => json({ status: "succeeded", jobId: JOB, result: { outputs: [{ seed: 1, video: { url: VIDEO_URL } }] } });
// A refusal whose body carries text that must never be repeated.
const refusal = (status, headers) => json({ error_code: status === 403 ? "access_error" : "rate_limited", message: `${HOSTILE} ${TOKEN_A} ${SECRET_A}` }, status, headers);

const stored = (id, clientId, apiKey) => ({ id, provider: "adobe-firefly-api", authType: "apikey", isActive: true, apiKey, providerSpecificData: { clientId } });
const selected = (row) => ({ connectionId: row.id, provider: row.provider, authType: row.authType, apiKey: row.apiKey, providerSpecificData: { ...row.providerSpecificData } });

const originalFetch = global.fetch;
let calls;
let refusalFor;

// IMS answers per client ID; account A's submit is refused with `refusalFor()`;
// account B's job succeeds.
function adobe({ kind = "image" } = {}) {
  global.fetch = vi.fn(async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? "GET", init };
    calls.push(call);
    if (call.url === ADOBE_IMS_TOKEN_URL) {
      return json({ access_token: new URLSearchParams(String(init.body)).get("client_id") === CLIENT_A ? TOKEN_A : TOKEN_B, token_type: "bearer", expires_in: 86_399 });
    }
    const submitUrl = kind === "image" ? ADOBE_FIREFLY_GENERATE_URL : ADOBE_FIREFLY_VIDEO_GENERATE_URL;
    if (call.url === submitUrl) return init.headers["x-api-key"] === CLIENT_A ? refusalFor() : accepted();
    if (call.url === adobeFireflyStatusUrl(JOB)) return kind === "image" ? imageDone() : videoDone();
    throw new Error(`Unexpected request: ${call.method} ${call.url}`);
  });
}

const header = (call, name) => call.init?.headers?.[name];
const posts = (url) => calls.filter((call) => call.method === "POST" && call.url === url);
const mintedFor = () => posts(ADOBE_IMS_TOKEN_URL).map((call) => new URLSearchParams(String(call.init.body)).get("client_id"));
const usage = () => m.save.mock.calls.map(([event]) => event);
const marks = () => auth.markAccountUnavailable.mock.calls;

async function settle(promise) {
  let done = false;
  let value;
  let error;
  promise.then((result) => { done = true; value = result; }, (failure) => { done = true; error = failure; });
  const deadline = performance.now() + 15_000;
  while (!done && performance.now() < deadline) {
    await vi.advanceTimersByTimeAsync(250);
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (!done) throw new Error(`route did not answer; calls: ${JSON.stringify(calls.map((call) => [call.method, call.url]))}`);
  if (error) throw error;
  return value;
}

const post = (url, body) => new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const image = () => settle(handleImageGeneration(post("/v1/images/generations", { prompt: "a fox in the snow", model: "adobe-firefly-api/image3" })));
const video = () => settle(handleVideoGeneration(post("/v1/video/generations", { prompt: "waves at dusk", model: "adobe-firefly-api/video1_standard" })));

async function expectClean(response) {
  const text = await response.clone().text();
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect(text).not.toMatch(/script|alert|555-0100/);
  return text;
}

// The sibling has no lock, no lockout, no error and no recorded state.
function expectHealthy(id) {
  const row = m.rows.get(id);
  expect(row.quotaLockout).toBeUndefined();
  expect(Object.keys(row).filter((key) => key.startsWith("modelLock_"))).toEqual([]);
  expect(row.errorCode).toBeUndefined();
  expect(m.fallback.filter((entry) => entry.id === id)).toEqual([]);
  expect(m.evidence.filter((entry) => entry.connectionId === id)).toEqual([]);
  expect(m.writes.filter((entry) => entry.id === id)).toEqual([]);
}

let rowA;
let rowB;

beforeEach(() => {
  calls = [];
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) vi.stubEnv(key, undefined);
  m.rows.clear();
  m.fallback.length = 0;
  m.evidence.length = 0;
  m.writes.length = 0;
  rowA = stored("ff-a", CLIENT_A, SECRET_A);
  rowB = stored("ff-b", CLIENT_B, SECRET_B);
  m.rows.set(rowA.id, rowA);
  m.rows.set(rowB.id, rowB);
  m.save.mockResolvedValue(true);
  m.credentials.mockReset()
    .mockResolvedValueOnce(selected(rowA))
    .mockResolvedValueOnce(selected(rowB))
    .mockResolvedValue({ allRateLimited: true, lastError: "unavailable" });
  defaultAdobeTokenCache.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  global.fetch = originalFetch;
});

const ACCESS_403 = [
  ["quota_exhausted", "quota_exhausted", true],
  ["user_non_entitled", "user_non_entitled", false],
  ["user_profile_denied", "user_profile_denied", false],
  ["invalid_ims_scope", "invalid_ims_scope", false],
  ["missing", undefined, false],
  ["unknown", HOSTILE, false],
  ["a case variant", "QUOTA_EXHAUSTED", false],
  ["a combined list", "quota_exhausted, user_non_entitled", false],
];

describe("image route: submit 403 x-access-error", () => {
  it.each(ACCESS_403)("%s: one submit, no remint, selected account only, the healthy sibling serves", async (_label, value, quota) => {
    refusalFor = () => refusal(403, value === undefined ? {} : { "x-access-error": value });
    adobe();
    const response = await image();

    // The sibling answered: the refused submit was never replayed to it or to A.
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ url: IMAGE_URL }]);
    expect(posts(ADOBE_FIREFLY_GENERATE_URL).map((call) => header(call, "x-api-key"))).toEqual([CLIENT_A, CLIENT_B]);
    // No 403 eviction or remint: each account minted once and A's token stays cached.
    expect(mintedFor()).toEqual([CLIENT_A, CLIENT_B]);
    expect(defaultAdobeTokenCache.size).toBe(2);

    expect(marks()).toHaveLength(1);
    const [id, status, message, provider, , resetAt, context] = marks()[0];
    expect([id, status, provider, resetAt]).toEqual(["ff-a", 403, "adobe-firefly-api", null]);
    expect(message).toBe(`Adobe Firefly Services refused image generation for this credential${quota || ["user_non_entitled", "user_profile_denied", "invalid_ims_scope"].includes(value) ? ` (${value})` : ""}`);
    expect(Boolean(context?.quotaExhausted)).toBe(quota);
    expect(context?.rateLimitEvidence).toBeUndefined();

    if (quota) {
      // Resetless quota: the existing quota lockout with no reactivation time.
      expect(rowA.quotaLockout).toMatchObject({ status: "quota_exhausted", source: "auto", reactivateAt: null });
      expect(m.fallback).toEqual([]);
    } else {
      // An ordinary 403: the usual cooldown, no quota lockout.
      expect(rowA.quotaLockout).toBeUndefined();
      expect(m.fallback).toEqual([expect.objectContaining({ id: "ff-a", status: 403, reasonCode: "authentication_error" })]);
    }
    expect(m.evidence).toEqual([]);
    expectHealthy("ff-b");
    expect(usage()).toEqual([expect.objectContaining({ connectionId: "ff-b" })]);
  });

  it.each(ACCESS_403)("%s: with one account the client gets a clean 403 naming only a documented value", async (_label, value) => {
    m.credentials.mockReset().mockResolvedValueOnce(selected(rowA)).mockResolvedValue({ allRateLimited: true, lastError: "unavailable" });
    refusalFor = () => refusal(403, value === undefined ? {} : { "x-access-error": value });
    adobe();
    const response = await image();
    expect(response.status).toBe(403);
    const text = await expectClean(response);
    const documented = ["quota_exhausted", "user_non_entitled", "user_profile_denied", "invalid_ims_scope"].includes(value);
    if (documented) expect(text).toContain(`(${value})`);
    else expect(text).not.toMatch(/\((?:quota|user|invalid)/i);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(posts(ADOBE_FIREFLY_GENERATE_URL)).toHaveLength(1);
    expect(usage()).toEqual([]);
  });
});

describe("video route: submit 403 x-access-error", () => {
  it.each(ACCESS_403)("%s: one submit, no remint, clean answer and only the selected account's state", async (_label, value, quota) => {
    refusalFor = () => refusal(403, value === undefined ? {} : { "x-access-error": value });
    adobe({ kind: "video" });
    const response = await video();
    expect(response.status).toBe(403);
    const text = await expectClean(response);
    if (["quota_exhausted", "user_non_entitled", "user_profile_denied", "invalid_ims_scope"].includes(value)) expect(text).toContain(`(${value})`);
    expect(posts(ADOBE_FIREFLY_VIDEO_GENERATE_URL)).toHaveLength(1);
    expect(mintedFor()).toEqual([CLIENT_A]);
    expect(defaultAdobeTokenCache.size).toBe(1);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBeNull();

    expect(marks()).toHaveLength(1);
    const [id, status, , , model, resetAt, context] = marks()[0];
    expect([id, status, model, resetAt]).toEqual(["ff-a", 403, "video1_standard", null]);
    expect(Boolean(context.quotaExhausted)).toBe(quota);
    if (quota) expect(rowA.quotaLockout).toMatchObject({ status: "quota_exhausted", reactivateAt: null });
    else expect(rowA.quotaLockout).toBeUndefined();
    expectHealthy("ff-b");
    expect(usage()).toEqual([]);
  });

  it("a quota-exhausted account is never resubmitted, and its sibling's next request runs untouched", async () => {
    refusalFor = () => refusal(403, { "x-access-error": "quota_exhausted" });
    adobe({ kind: "video" });
    expect((await video()).status).toBe(403);
    const second = await video();
    expect(second.status).toBe(200);
    expect(posts(ADOBE_FIREFLY_VIDEO_GENERATE_URL).map((call) => header(call, "x-api-key"))).toEqual([CLIENT_A, CLIENT_B]);
    expect(rowA.quotaLockout).toMatchObject({ reactivateAt: null });
    expectHealthy("ff-b");
  });
});

const LEVELS = [
  ["org", "org", "organization"],
  ["account", "account", "technical account"],
  ["missing", undefined, null],
  ["an undocumented membership level", "membership", null],
  ["an undocumented daily level", "daily", null],
  ["hostile text", HOSTILE, null],
];

describe("submit 429 x-access-rate-limit-level with a bounded Retry-After", () => {
  it.each(LEVELS)("image, %s: Retry-After is the selected account's only reset; nothing is invented", async (_label, level, named) => {
    refusalFor = () => refusal(429, { "retry-after": "60", ...(level === undefined ? {} : { "x-access-rate-limit-level": level }) });
    adobe();
    const response = await image();
    expect(response.status).toBe(200);
    expect(posts(ADOBE_FIREFLY_GENERATE_URL).map((call) => header(call, "x-api-key"))).toEqual([CLIENT_A, CLIENT_B]);
    expect(mintedFor()).toEqual([CLIENT_A, CLIENT_B]);

    const [id, status, message, , , resetAt, context] = marks()[0];
    expect([id, status, resetAt]).toEqual(["ff-a", 429, NOW + 60_000]);
    expect(message).toBe(`Adobe Firefly Services rate limited the image submit${named ? ` at the ${named} level` : ""}`);
    expect(context.rateLimitEvidence).toMatchObject({ state: "cooldown", source: "retry_after", resetAtMs: NOW + 60_000 });
    expect(context.quotaExhausted).toBeUndefined();
    // Cooled for exactly the provider's Retry-After, as a cooldown, not an exhaustion.
    expect(m.fallback).toEqual([expect.objectContaining({ id: "ff-a", status: 429, cooldownMs: 60_000 })]);
    expect(m.evidence).toEqual([expect.objectContaining({ connectionId: "ff-a", state: "cooldown", resetAtMs: NOW + 60_000 })]);
    expect(rowA.quotaLockout).toBeUndefined();
    expectHealthy("ff-b");
  });

  it.each(LEVELS)("video, %s: one submit, Retry-After reaches the client and only the selected account", async (_label, level, named) => {
    refusalFor = () => refusal(429, { "retry-after": "60", ...(level === undefined ? {} : { "x-access-rate-limit-level": level }) });
    adobe({ kind: "video" });
    const response = await video();
    expect(response.status).toBe(429);
    const text = await expectClean(response);
    expect(text).not.toMatch(/membership|daily/);
    if (named) expect(text).toContain(`at the ${named} level`);
    else expect(text).not.toMatch(/ level/);
    expect(Number(response.headers.get("retry-after"))).toBe(60);
    expect(posts(ADOBE_FIREFLY_VIDEO_GENERATE_URL)).toHaveLength(1);
    expect(mintedFor()).toEqual([CLIENT_A]);
    const [id, status, , , , resetAt, context] = marks()[0];
    expect([id, status, resetAt]).toEqual(["ff-a", 429, NOW + 60_000]);
    expect(context.rateLimitEvidence).toMatchObject({ state: "cooldown", source: "retry_after" });
    expect(m.fallback).toEqual([expect.objectContaining({ id: "ff-a", cooldownMs: 60_000 })]);
    expectHealthy("ff-b");
  });

  it("an HTTP-date Retry-After in the future is honored as given", async () => {
    refusalFor = () => refusal(429, { "retry-after": new Date(NOW + 120_000).toUTCString(), "x-access-rate-limit-level": "org" });
    adobe({ kind: "video" });
    const response = await video();
    expect(response.status).toBe(429);
    expect(marks()[0][5]).toBe(NOW + 120_000);
    expect(m.fallback).toEqual([expect.objectContaining({ id: "ff-a", cooldownMs: 120_000 })]);
  });

  it.each([
    ["missing", undefined],
    ["unparseable", "soon"],
    ["a past date", new Date(NOW - 60_000).toUTCString()],
    ["negative", "-30"],
    ["fractional", "1.5"],
    ["oversized (past the seven-day ceiling)", String(8 * 24 * 3600)],
    ["absurd", "999999999"],
    ["too long", "9".repeat(200)],
  ])("%s Retry-After: no reset is set or advertised, the ordinary short backoff applies", async (_label, retryAfter) => {
    for (const kind of ["image", "video"]) {
      calls = [];
      m.fallback.length = 0;
      m.evidence.length = 0;
      auth.markAccountUnavailable.mockClear();
      m.credentials.mockReset().mockResolvedValueOnce(selected(rowA)).mockResolvedValue({ allRateLimited: true, lastError: "unavailable" });
      for (const key of Object.keys(rowA)) if (key.startsWith("modelLock_") || key === "errorCode") delete rowA[key];
      refusalFor = () => refusal(429, { "x-access-rate-limit-level": "account", ...(retryAfter === undefined ? {} : { "retry-after": retryAfter }) });
      adobe({ kind });
      const response = kind === "image" ? await image() : await video();
      expect(response.status).toBe(429);
      await expectClean(response);
      const [id, status, , , , resetAt, context] = marks()[0];
      expect([id, status, resetAt]).toEqual(["ff-a", 429, null]);
      expect(context.rateLimitEvidence).toBeUndefined();
      expect(m.fallback).toHaveLength(1);
      expect(m.fallback[0].cooldownMs).toBeLessThanOrEqual(BACKOFF_CONFIG.max);
      expect(m.fallback[0].upstreamReset).toBe(false);
      // Never an exhausted state, never a reset Adobe did not state.
      expect(m.evidence).toEqual([expect.objectContaining({ connectionId: "ff-a", state: "cooldown" })]);
      expect(m.evidence[0].resetAtMs).toBeLessThanOrEqual(NOW + BACKOFF_CONFIG.max);
      const advertised = response.headers.get("retry-after");
      if (advertised !== null) expect(Number(advertised)).toBeLessThanOrEqual(BACKOFF_CONFIG.max / 1000);
      expect(posts(kind === "image" ? ADOBE_FIREFLY_GENERATE_URL : ADOBE_FIREFLY_VIDEO_GENERATE_URL)).toHaveLength(1);
      expectHealthy("ff-b");
    }
  });
});

describe("accepted jobs are never replayed after quota evidence", () => {
  it("a poll 403 quota_exhausted after acceptance is an accepted job on the sender, with no second submit", async () => {
    m.credentials.mockReset().mockResolvedValueOnce(selected(rowA)).mockResolvedValueOnce(selected(rowB));
    global.fetch = vi.fn(async (url, init = {}) => {
      const call = { url: String(url), method: init.method ?? "GET", init };
      calls.push(call);
      if (call.url === ADOBE_IMS_TOKEN_URL) return json({ access_token: TOKEN_A, token_type: "bearer", expires_in: 86_399 });
      if (call.url === ADOBE_FIREFLY_GENERATE_URL) return accepted();
      if (call.url === adobeFireflyStatusUrl(JOB)) return json({}, 403, { "x-access-error": "quota_exhausted" });
      throw new Error(`Unexpected request: ${call.method} ${call.url}`);
    });
    const response = await image();
    expect(response.status).toBe(403);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBeTruthy();
    expect(posts(ADOBE_FIREFLY_GENERATE_URL)).toHaveLength(1);
    expect(mintedFor()).toEqual([CLIENT_A]);
    expect(usage()).toEqual([expect.objectContaining({ connectionId: "ff-a", status: "accepted" })]);
    expect(marks().map((call) => call[0])).toEqual(["ff-a"]);
    expectHealthy("ff-b");
  });
});
