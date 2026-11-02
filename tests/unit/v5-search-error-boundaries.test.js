import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transport: vi.fn(), select: vi.fn(), noAuth: vi.fn(), refresh: vi.fn(),
  unavailable: vi.fn(), clear: vi.fn(), record: vi.fn(),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.transport }));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({}), getCombos: async () => [],
  getComboForModel: async () => null, getApiKeyByKey: async () => null,
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({
    apiKey: "fixture-caller", auth: { ok: true, apiKeyId: "fixture-key", billingEpoch: "fixture-epoch" },
  }),
  getProviderCredentialsWithQuotaPreflight: mocks.select,
  getNoAuthProviderCredentials: mocks.noAuth,
  markAccountUnavailable: mocks.unavailable, clearAccountError: mocks.clear,
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.refresh,
  updateProviderCredentials: () => { throw new Error("Unexpected credential persistence"); },
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: async () => null, recordApiKeyUsageForResponse: mocks.record,
}));
vi.mock("../../src/sse/utils/logger.js", () => ({
  request: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), maskKey: () => "masked",
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getAutoComboCatalog: () => { throw new Error("Unexpected automatic combo"); },
}));
vi.mock("open-sse/services/combo.js", () => ({
  getComboModelsFromData: () => null,
  handleComboChat: () => { throw new Error("Unexpected combo dispatch"); },
}));
vi.mock("open-sse/services/comboRoutingPolicy.js", () => ({
  getComboRoutingPolicy: () => { throw new Error("Unexpected combo policy"); },
}));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: (id) => !id,
  resolveMediaRoute: () => { throw new Error("Unexpected default route"); },
  defaultRouteComboOptions: () => { throw new Error("Unexpected default route options"); },
}));

import { handleSearchCore } from "../../open-sse/handlers/search/index.js";
import { handleSearch } from "../../src/sse/handlers/search.js";
import { getRequestId } from "../../src/sse/utils/requestCorrelation.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";

const API_KEY = "amberlamp42";
const ACCESS_TOKEN = "violetlamp73";
const REFRESHED = "silverlamp86";
const SAFE = "quota exhausted ordinarylamp99";
const QUERY = "durindoor";
const perplexity = AI_PROVIDERS.perplexity;
const dedicatedUrl = "https://api.perplexity.ai/search";
const chatUrl = "https://api.perplexity.ai/chat/completions";
const credentials = { connectionId: "e12-account", apiKey: API_KEY, accessToken: ACCESS_TOKEN };
const echo = (token, reason = "quota exhausted") => `${reason} ${token} ${token} ordinarylamp99`;
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const failure = (status, message) => json(status, { error: { message }, usage: { cost_usd: 99 } });
let queue;
let captured;
let escapes;
let selections;

function refuse(message) {
  escapes.push(message);
  throw new Error(message);
}
function plan(...steps) { queue.push(...steps); }
function step(url, status, message, rejection = false, authorization = `Bearer ${API_KEY}`) {
  return { url, method: "POST", authorization, outcome: rejection ? new Error(message) : failure(status, message) };
}
function core(mode, creds = credentials, onRequestSuccess = vi.fn()) {
  return handleSearchCore({
    body: { query: QUERY },
    provider: mode === "dedicated" ? { ...perplexity, searchViaChat: undefined } : perplexity,
    providerConfig: mode === "chat" ? undefined : perplexity.searchConfig,
    credentials: creds, onRequestSuccess,
  });
}
function request(provider = "perplexity") {
  return new Request("http://fixture.invalid/v1/search", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, query: QUERY }),
  });
}
async function publicError(response, status, code = status, type) {
  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  const bytes = await response.text();
  const body = JSON.parse(bytes);
  expect(body.error.code).toBe(code);
  if (type) expect(body.error.type).toBe(type);
  else expect(body.error).not.toHaveProperty("type");
  expect(body.error.message).toEqual(expect.any(String));
  return { bytes, message: body.error.message, body };
}
function absent(publicResult, token, internalError) {
  // Soft assertions retain all public-byte and internal-error evidence on the first red run.
  expect.soft(publicResult.bytes).not.toContain(token);
  expect.soft(publicResult.message).not.toContain(token);
  if (internalError !== undefined) expect.soft(internalError).not.toContain(token);
}
function noSuccess() {
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-10-09T00:00:00.000Z"));
  queue = []; captured = []; escapes = []; selections = [];
  vi.stubGlobal("fetch", vi.fn(() => refuse("Unexpected native fetch")));
  mocks.transport.mockImplementation(async (url, init) => {
    const expected = queue.shift();
    const actual = { url: String(url), method: init?.method, authorization: new Headers(init?.headers).get("authorization") };
    captured.push(actual);
    if (!expected || actual.url !== expected.url || actual.method !== expected.method || actual.authorization !== expected.authorization) {
      return refuse(`Unexpected transport: ${JSON.stringify(actual)}`);
    }
    if (!(init.signal instanceof AbortSignal)) return refuse("Missing bounded abort signal");
    if (actual.method === "POST") {
      const body = JSON.parse(init.body);
      if (actual.url === dedicatedUrl && body.query !== QUERY) return refuse("Unexpected dedicated query");
      if (actual.url === chatUrl && (body.model !== "sonar" || body.messages?.[0]?.content !== QUERY)) return refuse("Unexpected chat request");
    }
    if (expected.outcome instanceof Error) throw expected.outcome;
    return expected.outcome;
  });
  mocks.select.mockImplementation(async (_provider, excluded) => {
    selections.push([...excluded]);
    if (selections.length > 2) return refuse("Unbounded account selection");
    return selections.length === 1 ? { ...credentials } : null;
  });
  mocks.noAuth.mockResolvedValue({ connectionId: "e12-no-auth", apiKey: API_KEY });
  mocks.refresh.mockImplementation(async (_provider, value) => ({ ...value, apiKey: REFRESHED }));
  mocks.unavailable.mockResolvedValue({ shouldFallback: false });
  mocks.record.mockImplementation(async (_key, response) => response);
});
afterEach(() => {
  try {
    expect(escapes).toEqual([]);
    expect(queue).toEqual([]);
    expect(mocks.transport).toHaveBeenCalledTimes(captured.length);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

describe("E-12 selected search credential boundaries", () => {
  const branches = [
    ["D1 dedicated HTTP", "dedicated", 503, false, API_KEY],
    ["C1 chat HTTP", "chat", 401, false, ACCESS_TOKEN],
    ["D2 dedicated rejection", "dedicated", 502, true, API_KEY],
    ["C2 chat rejection", "chat", 502, true, ACCESS_TOKEN],
  ];
  for (const [name, mode, status, rejection, token] of branches) {
    for (const probe of ["selected", "safe", "diagnostic"]) {
      it(`${name}: ${probe} public Response and internal error`, async () => {
        const message = probe === "selected" ? echo(token) : probe === "safe" ? SAFE : `${SAFE} /home/fixture/e12.js:7 Bearer fixturebearer88\n    at search (/home/fixture/e12.js:7:1)`;
        plan(step(mode === "chat" ? chatUrl : dedicatedUrl, status, message, rejection, `Bearer ${token}`));
        const success = vi.fn();
        const result = await core(mode, mode === "chat" ? { accessToken: ACCESS_TOKEN } : credentials, success);
        expect(result.success).toBe(false);
        expect(result.status).toBe(status);
        expect(result).not.toHaveProperty("accounting");
        expect(success).not.toHaveBeenCalled();
        expect(captured).toHaveLength(1);
        expect(captured[0].authorization).toBe(`Bearer ${token}`);
        const wire = await publicError(result.response, status);
        expect(result.response.headers.get("access-control-allow-origin")).toBe("*");
        expect(wire.message).toBe(result.error);
        expect(wire.message).toContain("quota exhausted");
        expect(wire.message).toContain("ordinarylamp99");
        absent(wire, token, result.error);
        if (probe === "diagnostic") {
          expect(wire.bytes).not.toContain("/home/fixture");
          expect(wire.bytes).not.toContain("fixturebearer88");
        }
      });
    }
  }

  it("F1 preserves the first dedicated failure when chat also fails", async () => {
    plan(step(dedicatedUrl, 503, echo(API_KEY, "dedicated denied")), step(chatUrl, 401, echo(API_KEY, "chat denied")));
    const success = vi.fn();
    const result = await core("dual", credentials, success);
    expect(result.success).toBe(false);
    expect(result.status).toBe(503);
    expect(result).not.toHaveProperty("accounting");
    expect(success).not.toHaveBeenCalled();
    expect(captured.map((call) => call.authorization)).toEqual([`Bearer ${API_KEY}`, `Bearer ${API_KEY}`]);
    const wire = await publicError(result.response, 503);
    expect(wire.message).toBe(result.error);
    expect(wire.message).toContain("dedicated denied");
    expect(wire.message).not.toContain("chat denied");
    absent(wire, API_KEY, result.error);
  });

  it("F2 does not retry a dedicated 401 through chat", async () => {
    plan(step(dedicatedUrl, 401, echo(API_KEY)));
    const success = vi.fn();
    const result = await core("dual", credentials, success);
    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty("accounting");
    expect(success).not.toHaveBeenCalled();
    expect(captured).toHaveLength(1);
    const wire = await publicError(result.response, 401);
    expect(wire.message).toContain("quota exhausted");
    absent(wire, API_KEY, result.error);
  });

  it("F3 records only the winning chat receipt through the real wrapper", async () => {
    const usage = { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, cost_usd: 0.07 };
    plan(step(dedicatedUrl, 503, echo(REFRESHED), false, `Bearer ${REFRESHED}`), {
      url: chatUrl, method: "POST", authorization: `Bearer ${REFRESHED}`,
      outcome: json(200, { choices: [{ message: { content: "safe answer" } }], citations: ["https://example.com/e12"], usage }),
    });
    const req = request();
    const response = await handleSearch(req);
    expect(response.status).toBe(200);
    expect(captured.map((call) => call.authorization)).toEqual([`Bearer ${REFRESHED}`, `Bearer ${REFRESHED}`]);
    expect(mocks.clear).toHaveBeenCalledExactlyOnceWith("e12-account", credentials, "websearch:perplexity", { provider: "perplexity", webSearch: true });
    expect(mocks.unavailable).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledTimes(1);
    const [key, recordedResponse, accounting] = mocks.record.mock.calls[0];
    expect(key).toBe("fixture-caller");
    expect(recordedResponse.status).toBe(200);
    expect(accounting).toMatchObject({
      connectionId: "e12-account", provider: "perplexity", model: "sonar", modality: "webSearch",
      usageEventId: `${getRequestId(req)}:/v1/search`, billingEpoch: "fixture-epoch",
      cost: 0.07, costStatus: "known", costSource: "provider",
      tokens: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      meta: { providerUsage: { path: "usage", value: usage } },
    });
    const bytes = await response.text();
    const body = JSON.parse(bytes);
    expect(body.answer).toMatchObject({ text: "safe answer", model: "sonar" });
    expect(body.results[0].url).toBe("https://example.com/e12");
    expect(body.usage).toMatchObject({ queries_used: 1, llm_tokens: 5 });
    expect(body).not.toHaveProperty("accounting");
    expect(bytes).not.toContain("providerUsage");
    // Structured oracle: the documented public usage.search_cost_usd is allowed; the provider
    // receipt field cost_usd must not appear as a key anywhere in the public body.
    const keys = (value) => value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, nested]) => [key, ...keys(nested)]) : [];
    expect(keys(body)).not.toContain("cost_usd");
    expect(bytes).not.toContain(REFRESHED);
    expect(bytes).not.toContain("99");
  });

  it("W1 returns the numeric direct error and protects the refreshed selected token", async () => {
    plan(step(dedicatedUrl, 401, echo(REFRESHED), false, `Bearer ${REFRESHED}`));
    const req = request();
    const response = await handleSearch(req);
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith("perplexity", credentials);
    expect(captured[0].authorization).toBe(`Bearer ${REFRESHED}`);
    expect(captured).toHaveLength(1);
    noSuccess();
    const wire = await publicError(response, 401);
    expect(wire.body.error.request_id).toBe(getRequestId(req));
    expect(wire.message).toContain("quota exhausted");
    absent(wire, REFRESHED);
  });

  it("W2 protects stored credential context without claiming SearXNG sends Authorization", async () => {
    const base = AI_PROVIDERS.searxng.searchConfig.baseUrl;
    plan({
      url: `${base.endsWith("/search") ? base : `${base}/search`}?q=${QUERY}&format=json&categories=general`,
      method: "GET", authorization: null, outcome: failure(503, echo(API_KEY)),
    });
    const response = await handleSearch(request("searxng"));
    expect(captured).toHaveLength(1);
    expect(captured[0].authorization).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.unavailable).not.toHaveBeenCalled();
    noSuccess();
    const wire = await publicError(response, 503);
    expect(wire.message).toContain("quota exhausted");
    absent(wire, API_KEY);
  });

  it("W3 reconstructs canonical account exhaustion rather than a numeric core envelope", async () => {
    mocks.unavailable.mockResolvedValue({ shouldFallback: true });
    plan(step(dedicatedUrl, 401, echo(REFRESHED), false, `Bearer ${REFRESHED}`));
    const response = await handleSearch(request());
    expect(selections).toEqual([[], ["e12-account"]]);
    expect(captured).toHaveLength(1);
    noSuccess();
    const wire = await publicError(response, 401, "invalid_api_key", "authentication_error");
    expect(wire.message).toContain("quota exhausted");
    absent(wire, REFRESHED);
  });

  it("W4 preserves first-error precedence and canonical cooldown with bounded account selection", async () => {
    const retryAfter = "2026-10-09T00:00:30.000Z";
    mocks.unavailable.mockResolvedValue({ shouldFallback: true });
    mocks.select.mockImplementation(async (_provider, excluded) => {
      selections.push([...excluded]);
      if (selections.length > 2) return refuse("Unbounded cooldown selection");
      return selections.length === 1 ? { ...credentials } : {
        allRateLimited: true, lastErrorCode: 429, retryAfter, retryAfterHuman: "30s",
      };
    });
    plan(step(dedicatedUrl, 429, echo(REFRESHED, "dedicated denied"), false, `Bearer ${REFRESHED}`),
      step(chatUrl, 429, echo(REFRESHED, "chat denied"), false, `Bearer ${REFRESHED}`));
    const response = await handleSearch(request());
    expect(selections).toEqual([[], ["e12-account"]]);
    expect(captured.map((call) => call.authorization)).toEqual([`Bearer ${REFRESHED}`, `Bearer ${REFRESHED}`]);
    noSuccess();
    expect(response.headers.get("retry-after")).toBe("30");
    const wire = await publicError(response, 429, "rate_limit_exceeded", "rate_limit_error");
    expect(wire.body.error.retry_after).toBe(retryAfter);
    expect(wire.message).toContain("dedicated denied");
    expect(wire.message).not.toContain("chat denied");
    absent(wire, REFRESHED);
  });
});
