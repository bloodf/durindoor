// RenderHour submit cancellation and deadline through the real image core and
// the real image route. Closed network: every request is answered below, an
// unexpected URL fails the test, and every key is synthetic. Only the staged
// adapter lookup, account storage and the usage ledger are substituted.
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
const KEY_A = "rh_synthetic_cancel_a";
const KEY_B = "rh_synthetic_cancel_b";
const FILE = "https://renderhour.com/files/x1";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const queued = () => ({ id: "job-1", status: "queued", outputs: [] });
const done = () => ({ id: "job-1", status: "succeeded", outputs: [{ content_type: "image/png", url: FILE }] });
const transportError = (code, text) => Object.assign(new TypeError(text), { cause: Object.assign(new Error(text), { code }) });

const originalFetch = global.fetch;
let calls;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return typeof step === "function" ? step(String(url), init) : step;
  });
}

// A transport that stays pending until its own signal aborts, as undici does.
const pendingUntilAborted = (_url, init) => new Promise((_, reject) => {
  init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
});

// A transport that ignores its signal; `answer` resolves it late with a body whose cancel is observed.
function ignoringTransport() {
  const late = { cancel: vi.fn(), answer: null };
  late.step = () => new Promise((resolve) => {
    late.answer = () => resolve(new Response(new ReadableStream({ cancel: late.cancel }), { status: 200 }));
  });
  return late;
}

const submits = () => calls.filter((call) => call.init?.method === "POST");
const authOf = (call) => call.init?.headers?.Authorization;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

function route(signal) {
  return handleImageGeneration(new Request("http://localhost/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "renderhour/z-image", prompt: "a fox in the snow" }),
    signal,
  }));
}

function twoAccounts() {
  m.credentials
    .mockResolvedValueOnce({ connectionId: "conn-a", apiKey: KEY_A })
    .mockResolvedValueOnce({ connectionId: "conn-b", apiKey: KEY_B })
    .mockResolvedValue({ allRateLimited: true, lastError: "exhausted", retryAfter: null });
}

const submitUnknown = { modality: "image", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } };

function expectRecordedOnFirstAccount() {
  expect(m.recordUsage).toHaveBeenCalledTimes(1);
  expect(m.recordUsage.mock.calls[0][1]).toMatchObject({
    status: "accepted", provider: "renderhour", model: "z-image", connectionId: "conn-a", apiKeyId: "key-1",
    costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" },
  });
  expect(m.recordUsageForResponse).not.toHaveBeenCalled();
}

beforeEach(() => {
  calls = [];
  m.credentials.mockReset();
  m.markUnavailable.mockReset().mockResolvedValue({ shouldFallback: true });
  m.recordUsage.mockReset().mockResolvedValue(undefined);
  m.recordUsageForResponse.mockReset().mockImplementation(async (_key, response) => response);
  m.clearAccountError.mockReset().mockResolvedValue(undefined);
  useAdapter({ submitTimeoutMs: 20 });
});
afterEach(() => {
  global.fetch = originalFetch;
  m.adapter = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("renderhour submit deadline", () => {
  it("aborts the outbound fetch at the deadline and leaves no timer behind", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    serve(pendingUntilAborted);
    const pending = core();
    await vi.advanceTimersByTimeAsync(20);
    const result = await pending;
    expect(result).toMatchObject({ success: false, status: 504, acceptedJob: submitUnknown });
    const { signal } = calls[0].init;
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toMatchObject({ name: "TimeoutError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline once the submit answers, so a success leaves no timer or abort behind", async () => {
    useAdapter({ submitTimeoutMs: 60_000 });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    serve(json(queued()), json(done()));
    const result = await core();
    expect(result.success).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(calls[0].init.signal.aborted).toBe(false);
  });

  it("cancels the body of an answer that arrives after the deadline", async () => {
    const late = ignoringTransport();
    serve(late.step);
    const result = await core();
    expect(result).toMatchObject({ status: 504, acceptedJob: submitUnknown });
    late.answer();
    await flush();
    expect(late.cancel).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it("on the route, records the timed-out job once on the sending account and sends no second submit", async () => {
    twoAccounts();
    serve(pendingUntilAborted);
    const response = await route();
    expect(response.status).toBe(504);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(submits()).toHaveLength(1);
    expect(calls[0].init.signal.aborted).toBe(true);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expectRecordedOnFirstAccount();
  });
});

describe("renderhour caller abort around the submit", () => {
  it("before the submit: no request, no job, 499", async () => {
    const controller = new AbortController();
    controller.abort();
    serve();
    const result = await core({ signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("after the submit is sent: the transport aborts with the caller's reason and the job stays possibly accepted", async () => {
    const controller = new AbortController();
    const reason = new Error("client left");
    serve((url, init) => {
      setTimeout(() => controller.abort(reason), 0);
      return pendingUntilAborted(url, init);
    });
    useAdapter({ submitTimeoutMs: 60_000 });
    const result = await core({ signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499, acceptedJob: submitUnknown });
    expect(calls[0].init.signal).not.toBe(controller.signal);
    expect(calls[0].init.signal.aborted).toBe(true);
    expect(calls[0].init.signal.reason).toBe(reason);
  });

  it("ends the wait even when the transport ignores the abort, and cancels its late body", async () => {
    useAdapter({ submitTimeoutMs: 60_000 });
    const controller = new AbortController();
    const late = ignoringTransport();
    serve((url, init) => {
      setTimeout(() => controller.abort(), 0);
      return late.step(url, init);
    });
    const result = await core({ signal: controller.signal });
    expect(result).toMatchObject({ status: 499, acceptedJob: submitUnknown });
    late.answer();
    await flush();
    expect(late.cancel).toHaveBeenCalledTimes(1);
  });

  it("on the route, an abort after send records the job on the sending account, without cooldown or fallback", async () => {
    useAdapter({ submitTimeoutMs: 60_000 });
    const controller = new AbortController();
    twoAccounts();
    serve((url, init) => {
      setTimeout(() => controller.abort(), 0);
      return pendingUntilAborted(url, init);
    });
    const response = await route(controller.signal);
    expect(response.status).toBe(499);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(submits()).toHaveLength(1);
    expect(authOf(submits()[0])).toBe(`Bearer ${KEY_A}`);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(m.markUnavailable).not.toHaveBeenCalled();
    expectRecordedOnFirstAccount();
  });

  it("on the route, an abort before dispatch sends nothing and records no job", async () => {
    const controller = new AbortController();
    m.credentials.mockImplementationOnce(async () => {
      controller.abort();
      return { connectionId: "conn-a", apiKey: KEY_A };
    });
    serve();
    const response = await route(controller.signal);
    expect(response.status).toBe(499);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBeNull();
    expect(calls).toHaveLength(0);
    expect(m.recordUsage).not.toHaveBeenCalled();
    expect(m.recordUsageForResponse).not.toHaveBeenCalled();
    expect(m.markUnavailable).not.toHaveBeenCalled();
  });
});

describe("renderhour pre-connect failures stay retryable", () => {
  it("falls back to the next account after a refused connection and records only the real job", async () => {
    useAdapter({ submitTimeoutMs: 60_000 });
    twoAccounts();
    serve(() => { throw transportError("ECONNREFUSED", "connect refused"); }, json(queued()), json(done()));
    const response = await route();
    expect(response.status).toBe(200);
    expect(submits().map(authOf)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBeNull();
    expect(m.markUnavailable).toHaveBeenCalledTimes(1);
    expect(m.markUnavailable.mock.calls[0].slice(0, 2)).toEqual(["conn-a", 502]);
    expect(m.recordUsage).not.toHaveBeenCalled();
    expect(m.recordUsageForResponse).toHaveBeenCalledTimes(1);
    expect(m.recordUsageForResponse.mock.calls[0][2]).toMatchObject({ connectionId: "conn-b" });
  });
});
