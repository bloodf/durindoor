// Adobe Firefly Services submit policy through the real image core and the real
// image route: manual redirects, the bounded and cancellable submit, unknown
// outcomes recorded on the selected account, submit 401 token handling,
// Retry-After and redaction. Closed network: every request is answered below,
// an unexpected URL fails the test, and every credential is synthetic. Only the
// staged adapter lookup, account storage and the usage ledger are substituted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  adapter: null,
  credentials: vi.fn(),
  markUnavailable: vi.fn(),
  recordUsage: vi.fn(),
  recordUsageForResponse: vi.fn(),
  clearAccountError: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

// While staged, the adapter map does not know this provider, so only that one lookup is substituted.
vi.mock("../../open-sse/handlers/imageProviders/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getImageAdapter: (id) => (id === "adobe-firefly-api" && m.adapter ? m.adapter : actual.getImageAdapter(id)) };
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
  updateProviderCredentials: m.updateProviderCredentials,
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

import { ADOBE_FIREFLY_GENERATE_URL, ADOBE_IMS_TOKEN_URL } from "../../open-sse/providers/private/adobe-firefly-api.js";
import defaultAdapter, { createAdobeFireflyApiImageAdapter } from "../../open-sse/handlers/imageProviders/adobe-firefly-api.js";
import { createAdobeTokenCache } from "../../open-sse/services/adobeFireflyApi/auth.js";
import { ADOBE_FIREFLY_REQUEST_TIMEOUT_MS } from "../../open-sse/services/adobeFireflyApi/job.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { ACCEPTED_JOB_HEADER } from "../../open-sse/services/combo.js";

const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");

const API = "https://firefly-api.adobe.io";
const ATTACKER = "https://attacker.example/collect";
const CLIENT_A = "synthclienta0000000000000000000a";
const CLIENT_B = "synthclientb0000000000000000000b";
const SECRET_A = "p8e-SYNTHETIC-submit-secret-a";
const SECRET_B = "p8e-SYNTHETIC-submit-secret-b";
const TOKEN_A1 = "synthetic-submit-token-a-0001";
const TOKEN_A2 = "synthetic-submit-token-a-0002";
const TOKEN_B1 = "synthetic-submit-token-b-0001";
const PASTED = "synthetic-submit-pasted-token-0001";
const SECRETS = [SECRET_A, SECRET_B, TOKEN_A1, TOKEN_A2, TOKEN_B1, PASTED];
const JOB = "urn:ff:jobs:eso851211:86ffe2ea-d765-4bd3-b2fd-568ca8fc36ac";
const STATUS_URL = `${API}/v3/status/${JOB}`;
const IMAGE = "https://pre-signed-firefly-prod.s3-accelerate.amazonaws.com/images/one";

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const ims = (token = TOKEN_A1) => json({ access_token: token, token_type: "bearer", expires_in: 86_399 });
const accepted = () => json({ jobId: JOB }, 202);
const succeeded = () => json({ status: "succeeded", jobId: JOB, result: { outputs: [{ seed: 1, image: { url: IMAGE } }] } });
const transportError = (code, text) => Object.assign(new TypeError(text), { cause: Object.assign(new Error(text), { code }) });

const originalFetch = global.fetch;
let calls;
let cache;

// A closed fetch. Like undici, it follows a redirect itself unless the request
// says `redirect: "manual"`, so a followed redirect shows up as a call to the target.
function serve(...steps) {
  global.fetch = vi.fn(async function closedFetch(url, init) {
    calls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    const answer = typeof step === "function" ? await step(String(url), init) : step;
    const location = answer?.headers?.get?.("location");
    if (location && answer.status >= 300 && answer.status < 400 && init?.redirect !== "manual") {
      return closedFetch(location, init);
    }
    return answer;
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
    late.answer = () => resolve(new Response(new ReadableStream({ cancel: late.cancel }), { status: 202 }));
  });
  return late;
}

const submits = () => calls.filter((call) => call.url === ADOBE_FIREFLY_GENERATE_URL);
const mints = () => calls.filter((call) => call.url === ADOBE_IMS_TOKEN_URL);
const authOf = (call) => call.init?.headers?.Authorization;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function useAdapter({ submitTimeoutMs = 60_000 } = {}) {
  let time = 1_700_000_000_000;
  const now = () => time;
  cache = createAdobeTokenCache({ now });
  m.adapter = createAdobeFireflyApiImageAdapter({
    cache, now, submitTimeoutMs, polling: { now, wait: async (ms) => { time += ms; } },
  });
}

const s2s = (clientId = CLIENT_A, secret = SECRET_A) => ({ apiKey: secret, providerSpecificData: { clientId } });
const pasted = () => ({ accessToken: PASTED, providerSpecificData: { clientId: CLIENT_A } });

function core({ credentials = s2s(), ...options } = {}) {
  return handleImageGenerationCore({
    body: { prompt: "a stone gate in a silver forest" },
    modelInfo: { provider: "adobe-firefly-api", model: "image4_standard" },
    credentials,
    log: null,
    ...options,
  });
}

function route(signal) {
  return handleImageGeneration(new Request("http://localhost/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "adobe-firefly-api/image4_standard", prompt: "a stone gate in a silver forest" }),
    signal,
  }));
}

function twoAccounts() {
  const a = { connectionId: "conn-a", ...s2s(CLIENT_A, SECRET_A) };
  const b = { connectionId: "conn-b", ...s2s(CLIENT_B, SECRET_B) };
  m.credentials
    .mockResolvedValueOnce(a)
    .mockResolvedValueOnce(b)
    .mockResolvedValue({ allRateLimited: true, lastError: "exhausted", retryAfter: null });
  return { a, b };
}

const submitUnknown = { modality: "image", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } };

function expectRecordedOnFirstAccount() {
  expect(m.recordUsage).toHaveBeenCalledTimes(1);
  expect(m.recordUsage.mock.calls[0][1]).toMatchObject({
    status: "accepted", provider: "adobe-firefly-api", model: "image4_standard", connectionId: "conn-a", apiKeyId: "key-1",
    costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" },
  });
  expect(m.recordUsageForResponse).not.toHaveBeenCalled();
}

function expectNoSecrets(text) {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

beforeEach(() => {
  calls = [];
  m.credentials.mockReset();
  m.markUnavailable.mockReset().mockResolvedValue({ shouldFallback: true });
  m.recordUsage.mockReset().mockResolvedValue(undefined);
  m.recordUsageForResponse.mockReset().mockImplementation(async (_key, response) => response);
  m.clearAccountError.mockReset().mockResolvedValue(undefined);
  m.updateProviderCredentials.mockReset().mockResolvedValue(undefined);
  useAdapter();
});
afterEach(() => {
  global.fetch = originalFetch;
  m.adapter = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("adobe-firefly-api submit policy", () => {
  it("declares manual redirects, a bounded submit, unknown-outcome accounting and Retry-After resets", () => {
    expect(defaultAdapter).toMatchObject({
      async: true,
      submitRedirect: "manual",
      submitTimeoutMs: ADOBE_FIREFLY_REQUEST_TIMEOUT_MS,
      submitOutcomeUnknown: true,
      retryAfterResets: true,
    });
    expect(defaultAdapter.onSubmitAuthRejected).toBeTypeOf("function");
  });
});

describe("adobe-firefly-api submit redirects", () => {
  it.each([301, 302, 303, 307, 308])("refuses a %i to another host without forwarding anything", async (status) => {
    serve(ims(), new Response(null, { status, headers: { location: `${ATTACKER}?t=${TOKEN_A1}` } }));
    const result = await core();
    expect(result).toMatchObject({ success: false, status: 502, error: "adobe-firefly-api image submit redirect refused" });
    expect(result.acceptedJob).toBeUndefined();
    expect(submits()).toHaveLength(1);
    expect(submits()[0].init.redirect).toBe("manual");
    // Nothing reached the redirect target: not the token, not the body.
    expect(calls.map((call) => call.url)).toEqual([ADOBE_IMS_TOKEN_URL, ADOBE_FIREFLY_GENERATE_URL]);
    expectNoSecrets(JSON.stringify(result.error));
  });

  it("refuses an opaque redirect answer and cancels its body", async () => {
    const cancel = vi.fn();
    const answer = new Response(new ReadableStream({ cancel }), { status: 200 });
    Object.defineProperty(answer, "type", { value: "opaqueredirect" });
    serve(ims(), answer);
    const result = await core();
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
    await flush();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it("refuses a redirect on the resend after a submit 401 too", async () => {
    serve(ims(TOKEN_A1), json({}, 401), ims(TOKEN_A2), new Response(null, { status: 302, headers: { location: ATTACKER } }));
    const result = await core();
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
    expect(submits().map((call) => call.init.redirect)).toEqual(["manual", "manual"]);
    expect(calls.some((call) => call.url.startsWith(ATTACKER))).toBe(false);
  });

  it("on the route, a refused redirect is not an accepted job and falls back to the next account", async () => {
    twoAccounts();
    serve(
      ims(TOKEN_A1), new Response(null, { status: 302, headers: { location: ATTACKER } }),
      ims(TOKEN_B1), accepted(), succeeded(),
    );
    const response = await route();
    expect(response.status).toBe(200);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBeNull();
    expect(submits().map(authOf)).toEqual([`Bearer ${TOKEN_A1}`, `Bearer ${TOKEN_B1}`]);
    expect(calls.some((call) => call.url.startsWith(ATTACKER))).toBe(false);
    expect(m.recordUsage).not.toHaveBeenCalled();
  });
});

describe("adobe-firefly-api submit deadline", () => {
  it("aborts the outbound fetch at the deadline, records an unknown outcome and leaves no timer behind", async () => {
    useAdapter({ submitTimeoutMs: 20 });
    serve(ims());
    // The token is minted with real timers first, then the deadline runs on fake ones.
    await cache.get({ mode: "client_credentials", clientId: CLIENT_A, clientSecret: SECRET_A });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    serve(pendingUntilAborted);
    const pending = core();
    await vi.advanceTimersByTimeAsync(20);
    const result = await pending;
    expect(result).toMatchObject({ success: false, status: 504, acceptedJob: submitUnknown });
    expect(result.error).toBe("adobe-firefly-api image submit timed out; whether it was accepted is unknown");
    const { signal } = calls.at(-1).init;
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toMatchObject({ name: "TimeoutError" });
    expect(vi.getTimerCount()).toBe(0);
    expect(calls.filter((call) => call.url.startsWith(`${API}/v3/status/`))).toHaveLength(0);
  });

  it("clears the deadline once the submit answers", async () => {
    serve(ims(), accepted(), succeeded());
    const result = await core();
    expect(result.success).toBe(true);
    expect(submits()[0].init.signal.aborted).toBe(false);
  });

  it("cancels the body of an answer that arrives after the deadline and never polls it", async () => {
    useAdapter({ submitTimeoutMs: 20 });
    const late = ignoringTransport();
    serve(ims(), late.step);
    const result = await core();
    expect(result).toMatchObject({ status: 504, acceptedJob: submitUnknown });
    late.answer();
    await flush();
    expect(late.cancel).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it("treats a reset connection after dispatch as an unknown outcome without repeating its text", async () => {
    serve(ims(), () => { throw transportError("ECONNRESET", `socket hang up Bearer ${TOKEN_A1}`); });
    const result = await core();
    expect(result).toMatchObject({ status: 502, acceptedJob: submitUnknown });
    expectNoSecrets(result.error);
  });

  it("on the route, records the timed-out job once on the selected account and sends no second submit", async () => {
    useAdapter({ submitTimeoutMs: 20 });
    twoAccounts();
    serve(ims(TOKEN_A1), pendingUntilAborted);
    const response = await route();
    expect(response.status).toBe(504);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(submits()).toHaveLength(1);
    expect(authOf(submits()[0])).toBe(`Bearer ${TOKEN_A1}`);
    expect(submits()[0].init.signal.aborted).toBe(true);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expectRecordedOnFirstAccount();
  });

  it("on the route, a refused connection is proven unsent and falls back to the next account", async () => {
    twoAccounts();
    serve(ims(TOKEN_A1), () => { throw transportError("ECONNREFUSED", "connect refused"); }, ims(TOKEN_B1), accepted(), succeeded());
    const response = await route();
    expect(response.status).toBe(200);
    expect(submits().map(authOf)).toEqual([`Bearer ${TOKEN_A1}`, `Bearer ${TOKEN_B1}`]);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBeNull();
    expect(m.recordUsage).not.toHaveBeenCalled();
    expect(m.recordUsageForResponse.mock.calls[0][2]).toMatchObject({ connectionId: "conn-b" });
  });
});

describe("adobe-firefly-api caller abort around the submit", () => {
  it("before anything is sent: no request, no job, 499", async () => {
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
    serve(ims(), (url, init) => {
      setTimeout(() => controller.abort(reason), 0);
      return pendingUntilAborted(url, init);
    });
    const result = await core({ signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499, acceptedJob: submitUnknown });
    const { signal } = submits()[0].init;
    expect(signal).not.toBe(controller.signal);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
  });

  it("ends the wait even when the transport ignores the abort, and cancels its late body", async () => {
    const controller = new AbortController();
    const late = ignoringTransport();
    serve(ims(), (url, init) => {
      setTimeout(() => controller.abort(), 0);
      return late.step(url, init);
    });
    const result = await core({ signal: controller.signal });
    expect(result).toMatchObject({ status: 499, acceptedJob: submitUnknown });
    late.answer();
    await flush();
    expect(late.cancel).toHaveBeenCalledTimes(1);
  });

  it("during the re-mint after a submit 401: no resend, no job, 499", async () => {
    const controller = new AbortController();
    serve(ims(TOKEN_A1), json({}, 401), () => {
      controller.abort();
      return new Promise(() => {});
    });
    const result = await core({ signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob).toBeUndefined();
    expect(submits()).toHaveLength(1);
  });

  it("on the route, an abort after send records the job on the selected account, without cooldown or fallback", async () => {
    const controller = new AbortController();
    twoAccounts();
    serve(ims(TOKEN_A1), (url, init) => {
      setTimeout(() => controller.abort(), 0);
      return pendingUntilAborted(url, init);
    });
    const response = await route(controller.signal);
    expect(response.status).toBe(499);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(submits()).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(m.markUnavailable).not.toHaveBeenCalled();
    expectRecordedOnFirstAccount();
  });
});

describe("adobe-firefly-api submit 401", () => {
  it("evicts the rejected token, mints once and resends only the refused submit", async () => {
    const credentials = s2s();
    const onCredentialsRefreshed = vi.fn();
    serve(ims(TOKEN_A1), json({}, 401), ims(TOKEN_A2), accepted(), succeeded());
    const result = await core({ credentials, onCredentialsRefreshed });
    expect(result.success).toBe(true);
    expect(submits().map(authOf)).toEqual([`Bearer ${TOKEN_A1}`, `Bearer ${TOKEN_A2}`]);
    expect(submits().map((call) => call.init.redirect)).toEqual(["manual", "manual"]);
    expect(mints()).toHaveLength(2);
    expect(credentials).toEqual(s2s());
    expect(onCredentialsRefreshed).not.toHaveBeenCalled();
  });

  it("prefers its own token handling over an injected refresher, so nothing is merged into the connection", async () => {
    const credentials = s2s();
    const refreshCredentials = vi.fn(async () => ({ accessToken: "synthetic-injected-token-0001" }));
    serve(ims(TOKEN_A1), json({}, 401), ims(TOKEN_A2), accepted(), succeeded());
    const result = await core({ credentials, refreshCredentials });
    expect(result.success).toBe(true);
    expect(refreshCredentials).not.toHaveBeenCalled();
    expect(credentials).toEqual(s2s());
  });

  it("is terminal after one fresh token: a second 401 stands, the second token is dropped and nothing is accepted", async () => {
    serve(ims(TOKEN_A1), json({ message: `bad token ${TOKEN_A1}` }, 401), ims(TOKEN_A2), json({ message: `bad token ${TOKEN_A2}` }, 401));
    const result = await core();
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(result.acceptedJob).toBeUndefined();
    expect(submits()).toHaveLength(2);
    expect(cache.size).toBe(0);
    expectNoSecrets(result.error);
    expectNoSecrets(await result.response.text());
  });

  it("does not resend when a pasted token is refused", async () => {
    const credentials = pasted();
    serve(json({ message: `bad token ${PASTED}` }, 401));
    const result = await core({ credentials });
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(calls).toHaveLength(1);
    expect(credentials).toEqual(pasted());
    expectNoSecrets(result.error);
  });

  it("does not re-mint on a submit 403: the entitlement refusal stands and the token is kept", async () => {
    serve(ims(TOKEN_A1), json({ error_code: "access_error" }, 403, { "x-access-error": "user_non_entitled" }));
    const result = await core();
    expect(result).toMatchObject({ success: false, status: 403 });
    expect(mints()).toHaveLength(1);
    expect(submits()).toHaveLength(1);
    expect(cache.size).toBe(1);
  });

  it("treats a transport failure on the resend as an unknown outcome, never a third submit", async () => {
    serve(ims(TOKEN_A1), json({}, 401), ims(TOKEN_A2), () => { throw transportError("ECONNRESET", "reset"); });
    const result = await core();
    expect(result).toMatchObject({ status: 502, acceptedJob: submitUnknown });
    expect(submits()).toHaveLength(2);
  });

  it("on the route, retries once on the selected account and persists no token", async () => {
    const { a } = twoAccounts();
    serve(ims(TOKEN_A1), json({}, 401), ims(TOKEN_A2), accepted(), succeeded());
    const response = await route();
    expect(response.status).toBe(200);
    expect(submits().map(authOf)).toEqual([`Bearer ${TOKEN_A1}`, `Bearer ${TOKEN_A2}`]);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(m.updateProviderCredentials).not.toHaveBeenCalled();
    expect(a).toEqual({ connectionId: "conn-a", ...s2s(CLIENT_A, SECRET_A) });
    expect(m.recordUsageForResponse.mock.calls[0][2]).toMatchObject({ connectionId: "conn-a" });
  });

  it("on the route, a terminal 401 is unaccepted: account A cools down and account B sends its own submit", async () => {
    twoAccounts();
    serve(ims(TOKEN_A1), json({}, 401), ims(TOKEN_A2), json({}, 401), ims(TOKEN_B1), accepted(), succeeded());
    const response = await route();
    expect(response.status).toBe(200);
    expect(submits().map(authOf)).toEqual([`Bearer ${TOKEN_A1}`, `Bearer ${TOKEN_A2}`, `Bearer ${TOKEN_B1}`]);
    expect(m.markUnavailable.mock.calls[0].slice(0, 2)).toEqual(["conn-a", 401]);
    expect(m.recordUsage).not.toHaveBeenCalled();
    expect(m.updateProviderCredentials).not.toHaveBeenCalled();
  });
});

describe("adobe-firefly-api submit 429", () => {
  it("passes the provider's Retry-After to the account cooldown and records no job", async () => {
    const before = Date.now();
    serve(ims(), json({ message: `slow down ${TOKEN_A1} ${SECRET_A}` }, 429, { "retry-after": "60" }));
    const result = await core();
    expect(result).toMatchObject({ success: false, status: 429 });
    expect(result.acceptedJob).toBeUndefined();
    expect(result.rateLimitEvidence).toMatchObject({ source: "retry_after" });
    expect(result.resetsAtMs).toBeGreaterThanOrEqual(before + 59_000);
    expect(result.resetsAtMs).toBeLessThanOrEqual(Date.now() + 61_000);
    expect(result.response.headers.get("retry-after")).toBeTruthy();
    expect(submits()).toHaveLength(1);
    expectNoSecrets(result.error);
    expectNoSecrets(await result.response.text());
  });

  it("does not poll the job's status for a refused submit", async () => {
    serve(ims(), json({}, 429));
    await core();
    expect(calls.map((call) => call.url)).not.toContain(STATUS_URL);
  });
});
