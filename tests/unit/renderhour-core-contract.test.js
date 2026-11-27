// RenderHour submit contract through the real image core and the real image
// route. Closed network: every request is answered below, an unexpected URL
// fails the test, and every key is synthetic. Only the staged adapter lookup,
// account storage and the usage ledger are substituted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  adapter: null,
  credentials: vi.fn(),
  markUnavailable: vi.fn(),
  recordUsage: vi.fn(),
  recordUsageForResponse: vi.fn(),
  clearAccountError: vi.fn(),
}));

// While staged, the adapter map does not know this provider, so only that one lookup is substituted.
vi.mock("../../open-sse/handlers/imageProviders/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getImageAdapter: (id) => (id === "renderhour" && m.adapter ? m.adapter : actual.getImageAdapter(id)) };
});
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: m.credentials,
  getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: m.markUnavailable,
  clearAccountError: m.clearAccountError,
  resolveClientApiKey: vi.fn(async () => ({ apiKey: "client-key", auth: { ok: true, apiKeyId: "key-1", billingEpoch: null } })),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})),
  getApiKeyByKey: vi.fn(async () => null),
  getComboForModel: vi.fn(async () => null),
  getCustomModels: vi.fn(async () => []),
  getSyncedModelCatalog: vi.fn(async () => null),
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
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  refreshWithRetry: vi.fn(async () => null),
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: vi.fn(async () => null),
  recordApiKeyUsage: m.recordUsage,
  recordApiKeyUsageForResponse: m.recordUsageForResponse,
}));
vi.mock("../../src/sse/utils/requestCorrelation.js", () => ({
  captureRequestBillingEpoch: vi.fn(async () => {}),
  getRequestId: vi.fn(() => "req-1"),
  withRequestCorrelation: (fn) => fn,
}));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: () => false,
  resolveMediaRoute: vi.fn(),
  defaultRouteComboOptions: () => ({}),
}));
vi.mock("../../open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn(async () => null) }));

import { RENDERHOUR_GENERATIONS_URL } from "../../open-sse/providers/private/renderhour.js";
import { createRenderHourImageAdapter } from "../../open-sse/handlers/imageProviders/renderhour.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { ACCEPTED_JOB_HEADER } from "../../open-sse/services/combo.js";

const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");

const NOW = 1_800_000_000_000;
const KEY_A = "rh_synthetic_contract_a";
const KEY_B = "rh_synthetic_contract_b";
const EVIL = "https://collector.invalid/steal";
const FILE = "https://renderhour.com/files/c1";

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const queued = (id = "job-1") => ({ id, status: "queued", outputs: [] });
const done = (url = FILE, id = "job-1") => ({ id, status: "succeeded", outputs: [{ content_type: "image/png", url }] });
const failed = (reason, id = "job-1") => ({ id, status: "failed", failure_reason: reason, outputs: [] });

const originalFetch = global.fetch;
let calls;

// Answers requests in order; a step is a Response or a function of the request.
function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return typeof step === "function" ? step(String(url), init) : step;
  });
}

const submits = () => calls.filter((call) => call.init?.method === "POST");
const authOf = (call) => call.init?.headers?.Authorization ?? call.init?.headers?.authorization;
const transportError = (code, text) => Object.assign(new TypeError(text), { cause: Object.assign(new Error(text), { code }) });

function useAdapter(options = {}) {
  let time = NOW;
  m.adapter = createRenderHourImageAdapter({ now: () => time, wait: async (ms) => { time += ms; }, ...options });
}

function core({ key = KEY_A, ...options } = {}) {
  return handleImageGenerationCore({
    body: { prompt: "a fox in the snow" },
    modelInfo: { provider: "renderhour", model: "z-image" },
    credentials: { apiKey: key },
    log: null,
    ...options,
  });
}

function route() {
  return handleImageGeneration(new Request("http://localhost/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "renderhour/z-image", prompt: "a fox in the snow" }),
  }));
}

function twoAccounts() {
  m.credentials
    .mockResolvedValueOnce({ connectionId: "conn-a", apiKey: KEY_A })
    .mockResolvedValueOnce({ connectionId: "conn-b", apiKey: KEY_B })
    .mockResolvedValue({ allRateLimited: true, lastError: "exhausted", retryAfter: null });
}

function expectUncertainSubmit(result, status) {
  expect(result).toMatchObject({ success: false, status });
  expect(result.acceptedJob).toMatchObject({
    modality: "image", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" },
  });
}

beforeEach(() => {
  calls = [];
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  m.credentials.mockReset();
  m.markUnavailable.mockReset().mockResolvedValue({ shouldFallback: true });
  m.recordUsage.mockReset().mockResolvedValue(undefined);
  m.recordUsageForResponse.mockReset().mockImplementation(async (_key, response) => response);
  m.clearAccountError.mockReset().mockResolvedValue(undefined);
  useAdapter();
});
afterEach(() => {
  global.fetch = originalFetch;
  m.adapter = null;
  vi.restoreAllMocks();
});

describe("renderhour submit redirects", () => {
  it.each([301, 302, 303, 307, 308])("refuses a %i submit redirect without following it", async (status) => {
    serve(new Response(null, { status, headers: { location: EVIL } }));
    const result = await core();
    expect(result).toMatchObject({ success: false, status: 502, error: "renderhour image submit redirect refused" });
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: RENDERHOUR_GENERATIONS_URL, init: { method: "POST", redirect: "manual" } });
    expect(calls.some((call) => call.url.startsWith(EVIL))).toBe(false);
  });

  it("refuses an opaque redirect answer", async () => {
    const opaque = new Response(null, { status: 200 });
    Object.defineProperty(opaque, "type", { value: "opaqueredirect" });
    serve(opaque);
    expect(await core()).toMatchObject({ status: 502, error: "renderhour image submit redirect refused" });
    expect(calls).toHaveLength(1);
  });

  it("on the route, never forwards a key to the redirect target and gives each account its own key", async () => {
    twoAccounts();
    serve(new Response(null, { status: 307, headers: { location: EVIL } }), json(queued()), json(done()));
    const response = await route();
    expect(response.status).toBe(200);
    expect(calls.map((call) => call.url)).toEqual([RENDERHOUR_GENERATIONS_URL, RENDERHOUR_GENERATIONS_URL, `${RENDERHOUR_GENERATIONS_URL}/job-1`]);
    expect(calls.map(authOf)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`, `Bearer ${KEY_B}`]);
    expect(submits().every((call) => call.init.redirect === "manual")).toBe(true);
    expect(m.markUnavailable).toHaveBeenCalledTimes(1);
    expect(m.markUnavailable.mock.calls[0].slice(0, 2)).toEqual(["conn-a", 502]);
  });
});

describe("renderhour submit errors redact the selected key", () => {
  it.each([401, 403])("keeps status %i and never returns an echoed key", async (status) => {
    serve(json({ error: { message: `invalid key ${KEY_A} (Bearer ${KEY_A})`, code: KEY_A } }, status));
    const result = await core();
    expect(result).toMatchObject({ success: false, status });
    expect(result.acceptedJob).toBeUndefined();
    expect(result.error).not.toContain(KEY_A);
    const text = await result.response.text();
    expect(text).not.toContain(KEY_A);
    expect(text).not.toContain("synthetic_contract");
    expect(submits()).toHaveLength(1);
  });

  it("does not return a key echoed in a transport error", async () => {
    serve(() => { throw transportError("ECONNREFUSED", `connect refused for Bearer ${KEY_A}`); });
    const result = await core();
    expect(result.status).toBe(502);
    expect(result.error).not.toContain(KEY_A);
    expect(await result.response.text()).not.toContain(KEY_A);
  });
});

describe("renderhour submit Retry-After", () => {
  it("passes a delta-seconds Retry-After exactly to the result and the client", async () => {
    serve(json({ error: { message: `slow down ${KEY_A}` } }, 429, { "retry-after": "7" }));
    const result = await core();
    expect(result).toMatchObject({ success: false, status: 429, resetsAtMs: NOW + 7_000 });
    expect(result.rateLimitEvidence).toMatchObject({ source: "retry_after", resetAtMs: NOW + 7_000 });
    expect(result.acceptedJob).toBeUndefined();
    expect(result.response.headers.get("retry-after")).toBe("7");
    expect(await result.response.text()).not.toContain(KEY_A);
  });

  it("passes an HTTP-date Retry-After exactly", async () => {
    serve(json({}, 429, { "retry-after": new Date(NOW + 90_000).toUTCString() }));
    const result = await core();
    expect(result.resetsAtMs).toBe(NOW + 90_000);
    expect(result.response.headers.get("retry-after")).toBe("90");
  });

  it("claims no reset when RenderHour gives none", async () => {
    serve(json({}, 429));
    const result = await core();
    expect(result.resetsAtMs).toBeUndefined();
    expect(result.rateLimitEvidence).toBeUndefined();
    expect(result.response.headers.get("retry-after")).toBeNull();
  });

  it("on the route, hands the exact reset and its provenance to account cooldown", async () => {
    twoAccounts();
    serve(json({}, 429, { "retry-after": "7" }), json(queued()), json(done()));
    const response = await route();
    expect(response.status).toBe(200);
    expect(m.markUnavailable).toHaveBeenCalledTimes(1);
    const [connectionId, status, , provider, model, resetAt, context] = m.markUnavailable.mock.calls[0];
    expect({ connectionId, status, provider, model, resetAt }).toEqual({
      connectionId: "conn-a", status: 429, provider: "renderhour", model: "z-image", resetAt: NOW + 7_000,
    });
    expect(context).toMatchObject({ usedCredential: KEY_A, rateLimitEvidence: { source: "retry_after", resetAtMs: NOW + 7_000 } });
    expect(submits().map(authOf)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
  });
});

describe("renderhour uncertain submit outcome", () => {
  it("bounds a stalled submit and reports it as possibly accepted", async () => {
    useAdapter({ submitTimeoutMs: 20 });
    let late;
    serve(() => new Promise((resolve) => { late = resolve; }));
    const result = await core();
    expectUncertainSubmit(result, 504);
    expect(result.error).toBe("renderhour image submit timed out; whether it was accepted is unknown");
    // The deadline aborts the transport, not only the wait.
    expect(calls[0].init.signal.aborted).toBe(true);
    expect(calls[0].init.signal.reason).toMatchObject({ name: "TimeoutError" });
    // A late answer is discarded, not polled.
    const cancel = vi.fn(async () => {});
    late({ body: { cancel } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it.each(["ECONNRESET", "UND_ERR_SOCKET", undefined])("reports an interrupted submit (%s) as possibly accepted", async (code) => {
    serve(() => { throw transportError(code, `socket hang up Bearer ${KEY_A}`); });
    const result = await core();
    expectUncertainSubmit(result, 502);
    expect(result.error).not.toContain(KEY_A);
    expect(calls).toHaveLength(1);
  });

  it.each(["ENOTFOUND", "ECONNREFUSED"])("treats %s as certainly unsent", async (code) => {
    serve(() => { throw transportError(code, "no connection"); });
    const result = await core();
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("keeps a client abort during submit a 499 without fallback, with the job possibly accepted", async () => {
    const controller = new AbortController();
    serve((_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      controller.abort();
    }));
    const result = await core({ signal: controller.signal });
    expectUncertainSubmit(result, 499);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.signal.aborted).toBe(true);
  });

  it.each([
    ["timeout", () => new Promise(() => {}), 504],
    ["network interruption", () => { throw transportError("ECONNRESET", "socket hang up"); }, 502],
  ])("on the route, a %s sends zero duplicate submits and records the job on the first account", async (_name, step, status) => {
    useAdapter({ submitTimeoutMs: 20 });
    twoAccounts();
    serve(step);
    const response = await route();
    expect(response.status).toBe(status);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(submits()).toHaveLength(1);
    expect(authOf(submits()[0])).toBe(`Bearer ${KEY_A}`);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(m.markUnavailable).toHaveBeenCalledTimes(1);
    expect(m.markUnavailable.mock.calls[0][0]).toBe("conn-a");
    expect(m.recordUsage).toHaveBeenCalledTimes(1);
    expect(m.recordUsage.mock.calls[0][1]).toMatchObject({
      status: "accepted", provider: "renderhour", model: "z-image", connectionId: "conn-a", apiKeyId: "key-1",
      costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" },
    });
    expect(m.recordUsageForResponse).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(KEY_A);
  });
});

describe("renderhour job results", () => {
  it.each([
    ["moderation", 422],
    ["invalid_input", 422],
    ["timeout", 504],
    ["expired", 504],
    ["something new", 502],
  ])("fails a job reported %s with %i, deterministically", async (reason, status) => {
    for (let round = 0; round < 2; round += 1) {
      calls = [];
      serve(json(queued()), json(failed(reason)));
      const result = await core();
      expect(result).toMatchObject({ success: false, status });
      expect(result.acceptedJob).toBeUndefined();
      expect(result.error).toBe(`RenderHour image job failed: ${status === 502 ? "unknown reason" : reason}`);
      expect(submits()).toHaveLength(1);
    }
  });

  it("returns the validated URLs on success and never the key", async () => {
    const onRequestSuccess = vi.fn();
    serve(json(queued()), json(done()));
    const result = await core({ onRequestSuccess });
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.data).toEqual([{ url: FILE }]);
    expect(JSON.stringify(body)).not.toContain(KEY_A);
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
    expect(result.accounting).toMatchObject({ modality: "image" });
    expect(calls.map(authOf)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_A}`]);
  });

  it.each([
    ["raw", `${FILE}?k=${KEY_A}`],
    ["encoded", `${FILE}?k=${encodeURIComponent(KEY_A)}`],
    ["path", `https://renderhour.com/${KEY_A}/c1`],
  ])("refuses a result URL that carries the key (%s)", async (_name, url) => {
    serve(json(queued()), json(done(url)));
    const result = await core();
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ meta: { jobState: "accepted" } });
    expect(result.error).not.toContain(KEY_A);
    expect(await result.response.text()).not.toContain(KEY_A);
  });

  it("on the route, records a success on the account that ran it", async () => {
    twoAccounts();
    serve(json(queued()), json(done()));
    const response = await route();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ url: FILE }]);
    expect(m.recordUsageForResponse).toHaveBeenCalledTimes(1);
    expect(m.recordUsageForResponse.mock.calls[0][2]).toMatchObject({ provider: "renderhour", model: "z-image", connectionId: "conn-a", apiKeyId: "key-1" });
    expect(m.clearAccountError).toHaveBeenCalledTimes(1);
    expect(m.clearAccountError.mock.calls[0][0]).toBe("conn-a");
    expect(m.markUnavailable).not.toHaveBeenCalled();
    expect(m.credentials).toHaveBeenCalledTimes(1);
  });

  it("on the route, fails a moderated job without resubmitting on the first account", async () => {
    m.markUnavailable.mockResolvedValue({ shouldFallback: false });
    twoAccounts();
    serve(json(queued()), json(failed("moderation")));
    const response = await route();
    expect(response.status).toBe(422);
    expect(submits()).toHaveLength(1);
    expect(m.recordUsage).not.toHaveBeenCalled();
  });
});
