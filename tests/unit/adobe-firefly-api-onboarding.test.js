// Adobe Firefly Services API onboarding (#2034): the two credential modes
// through the real connection create, validate and update routes, then the
// stored shapes through the real /v1/images/generations and
// /v1/video/generations routes with two accounts.
//
// Modes: a client secret (IMS mints in-memory tokens) or a supplied S2S access
// token with an optional expiry (used as given, IMS never called). The client
// ID is required in both. Only account storage, the usage ledger rows, caller
// admission and logging are substituted. Closed network: every request is
// answered below, an unexpected URL fails the test, and every credential is
// synthetic. Passing here says nothing about the live service or about any
// organization's entitlement.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  credentials: vi.fn(),
  markUnavailable: vi.fn(),
  save: vi.fn(),
  created: vi.fn(),
  connection: vi.fn(),
  updated: vi.fn(),
}));

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

const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");
const { handleVideoGeneration } = await import("../../src/sse/handlers/video.js");
const { POST: createConnection } = await import("@/app/api/providers/route.js");
const { POST: validateConnection } = await import("@/app/api/providers/validate/route.js");
const { PUT: updateConnection } = await import("@/app/api/providers/[id]/route.js");

// The adapters read the real clock, so the fake one starts at the real time.
const NOW = Math.floor(Date.now() / 1000) * 1000;
const CLIENT_A = "synthclienta0000000000000000000a";
const CLIENT_B = "synthclientb0000000000000000000b";
const SECRET_A = "p8e-SYNTHETIC-onboarding-secret-a";
const SECRET_B = "p8e-SYNTHETIC-onboarding-secret-b";
const TOKEN_A = "synthetic-onboarding-supplied-token-a";
const TOKEN_A2 = "synthetic-onboarding-supplied-token-a2";
const MINTED_B = "synthetic-onboarding-minted-token-b";
const SECRETS = [SECRET_A, SECRET_B, TOKEN_A, TOKEN_A2, MINTED_B];
const JOB = "urn:ff:jobs:eso851211:86ffe2ea-d765-4bd3-b2fd-568ca8fc36ac";
const IMAGE_URL = "https://pre-signed-firefly-prod.s3-accelerate.amazonaws.com/images/onboarding";
const VIDEO_URL = "https://pre-signed-firefly-prod.s3-accelerate.amazonaws.com/videos/onboarding.mp4";
const IN_ONE_HOUR = new Date(NOW + 3_600_000).toISOString();

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const ims = (token) => json({ access_token: token, token_type: "bearer", expires_in: 86_399 });
const accepted = () => json({ jobId: JOB, statusUrl: "https://collector.invalid/status", cancelUrl: "https://collector.invalid/cancel" }, 202);
const imageDone = () => json({ status: "succeeded", jobId: JOB, result: { outputs: [{ seed: 1, image: { url: IMAGE_URL } }] } });
const videoDone = () => json({ status: "succeeded", jobId: JOB, result: { outputs: [{ seed: 1, video: { url: VIDEO_URL } }] } });
// An unsigned JWT-shaped token whose payload names a client ID.
const jwtFor = (clientId) => [
  Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url"),
  Buffer.from(JSON.stringify({ client_id: clientId, type: "access_token" })).toString("base64url"),
  "synthetic-signature-0000",
].join(".");

const secretConnection = (connectionId, clientId = CLIENT_B, apiKey = SECRET_B) => ({
  connectionId, provider: "adobe-firefly-api", authType: "apikey", apiKey, providerSpecificData: { clientId },
});
const tokenConnection = (connectionId, extra = {}) => ({
  connectionId, provider: "adobe-firefly-api", authType: "apikey", apiKey: "", accessToken: TOKEN_A,
  expiresAt: IN_ONE_HOUR, providerSpecificData: { clientId: CLIENT_A }, ...extra,
});

const originalFetch = global.fetch;
let calls;

function network(handler) {
  global.fetch = vi.fn(async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? "GET", init };
    calls.push(call);
    const answer = await handler(call);
    if (!answer) throw new Error(`Unexpected request: ${call.method} ${call.url}`);
    return answer;
  });
}

function sequence(...steps) {
  network((call) => {
    const step = steps.shift();
    return typeof step === "function" ? step(call) : step;
  });
}

const header = (call, name) => {
  const headers = call.init?.headers ?? {};
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
};
const posts = (url) => calls.filter((call) => call.method === "POST" && call.url === url);
const mints = () => posts(ADOBE_IMS_TOKEN_URL);
const usage = () => m.save.mock.calls.map(([event]) => event);

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

const post = (url, body, init = {}) => new Request(`http://localhost${url}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...init,
});
const put = (body) => updateConnection(
  new Request("http://localhost/api/providers/ff-1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: "ff-1" }) },
);
const create = (body) => createConnection(post("/api/providers", { provider: "adobe-firefly-api", name: "ff", ...body }));
const validate = async (body) => (await validateConnection(post("/api/providers/validate", { provider: "adobe-firefly-api", ...body }))).json();
const image = (body = {}) => settle(handleImageGeneration(post("/v1/images/generations", { prompt: "a fox in the snow", model: "adobe-firefly-api/image3", ...body })));
const video = (body = {}) => settle(handleVideoGeneration(post("/v1/video/generations", { prompt: "waves at dusk", model: "adobe-firefly-api/video1_standard", ...body })));

async function expectNoSecrets(response) {
  const text = await response.clone().text();
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

beforeEach(() => {
  calls = [];
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) vi.stubEnv(key, undefined);
  m.save.mockResolvedValue(true);
  m.markUnavailable.mockReset().mockImplementation(async (_id, status) => ({
    shouldFallback: [401, 403, 429].includes(Number(status)) || Number(status) >= 500,
  }));
  m.credentials.mockReset().mockResolvedValue({ allRateLimited: true, lastError: "exhausted" });
  m.created.mockReset().mockImplementation(async (data) => ({ id: "conn-new", ...data }));
  m.updated.mockReset().mockImplementation(async (id, patch) => ({ ...m.connection.mock.results.at(-1)?.value, ...patch, id }));
  defaultAdobeTokenCache.clear();
  // Any request a test does not expect fails it.
  network(() => null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  global.fetch = originalFetch;
});

describe("create: two explicit modes, client ID in both", () => {
  it("client-secret mode stores the secret only, clears the token fields and calls nothing", async () => {
    const response = await create({ credentialMode: "client_secret", apiKey: SECRET_A, providerSpecificData: { clientId: CLIENT_A } });
    expect(response.status).toBeLessThan(300);
    const stored = m.created.mock.calls[0][0];
    expect(stored).toMatchObject({ provider: "adobe-firefly-api", apiKey: SECRET_A, providerSpecificData: { clientId: CLIENT_A } });
    expect(stored).not.toHaveProperty("accessToken");
    expect(stored).not.toHaveProperty("expiresAt");
    expect(calls).toEqual([]);
    await expectNoSecrets(response);
  });

  it("access-token mode stores the supplied token and its validated expiry, never a secret, and never calls IMS", async () => {
    const response = await create({
      credentialMode: "access_token", accessToken: TOKEN_A, expiresAt: String(Math.floor((NOW + 7_200_000) / 1000)),
      providerSpecificData: { clientId: CLIENT_A },
    });
    expect(response.status).toBeLessThan(300);
    const stored = m.created.mock.calls[0][0];
    expect(stored).toMatchObject({ accessToken: TOKEN_A, apiKey: "", expiresAt: new Date(NOW + 7_200_000).toISOString(), providerSpecificData: { clientId: CLIENT_A } });
    expect(calls).toEqual([]);
    await expectNoSecrets(response);
  });

  it("infers the token mode from a supplied token and stores no expiry when none is given", async () => {
    const response = await create({ accessToken: TOKEN_A, providerSpecificData: { clientId: CLIENT_A } });
    expect(response.status).toBeLessThan(300);
    const stored = m.created.mock.calls[0][0];
    expect(stored).toMatchObject({ accessToken: TOKEN_A, apiKey: "" });
    expect(stored).not.toHaveProperty("expiresAt");
  });

  it.each([
    ["a secret and a token together", { apiKey: SECRET_A, accessToken: TOKEN_A }],
    ["the token mode with a secret", { credentialMode: "access_token", apiKey: SECRET_A }],
    ["the secret mode with a token", { credentialMode: "client_secret", accessToken: TOKEN_A }],
    ["an expiry in secret mode", { credentialMode: "client_secret", apiKey: SECRET_A, expiresAt: IN_ONE_HOUR }],
    ["an unknown mode", { credentialMode: "cookie", apiKey: SECRET_A }],
    ["no client ID", { accessToken: TOKEN_A, clientId: null }],
    ["a malformed expiry", { accessToken: TOKEN_A, expiresAt: "next tuesday" }],
    ["a signed-number expiry", { accessToken: TOKEN_A, expiresAt: "-3000" }],
    ["a zero expiry", { accessToken: TOKEN_A, expiresAt: 0 }],
    ["an expiry past the largest date", { accessToken: TOKEN_A, expiresAt: 1e20 }],
    ["a past expiry", { accessToken: TOKEN_A, expiresAt: new Date(NOW - 1000).toISOString() }],
    ["a consumer web-app client ID", { accessToken: TOKEN_A, clientId: "clio-playground-web" }],
    ["a consumer web-app token", { accessToken: jwtFor("projectx_webapp") }],
    ["a token issued to another client", { accessToken: jwtFor(CLIENT_B) }],
    ["a cookie header pasted as a token", { accessToken: "session=abc; Path=/; HttpOnly" }],
  ])("refuses %s with 400 before storage or any request", async (_label, { clientId = CLIENT_A, ...fields }) => {
    const response = await create({ ...fields, providerSpecificData: clientId === null ? {} : { clientId } });
    expect(response.status).toBe(400);
    expect(m.created).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    await expectNoSecrets(response);
  });

  it("accepts a JWT-shaped token issued to the same client ID", async () => {
    const token = jwtFor(CLIENT_A);
    const response = await create({ accessToken: token, providerSpecificData: { clientId: CLIENT_A } });
    expect(response.status).toBeLessThan(300);
    expect(m.created.mock.calls[0][0]).toMatchObject({ accessToken: token });
    expect(await response.clone().text()).not.toContain(token);
  });
});

describe("validate: secret mode mints once, token mode never calls IMS", () => {
  it("checks a supplied token locally and reports the check as skipped, with no request", async () => {
    const result = await validate({ credentialMode: "access_token", accessToken: TOKEN_A, expiresAt: IN_ONE_HOUR, providerSpecificData: { clientId: CLIENT_A } });
    expect(result).toMatchObject({ valid: true, skipped: true, error: null });
    expect(calls).toEqual([]);
  });

  it.each([
    ["a past expiry", { expiresAt: new Date(NOW - 60_000).toISOString() }, /expired/],
    ["a malformed expiry", { expiresAt: "soon" }, /not a valid date/],
    ["a consumer web-app token", { accessToken: jwtFor("clio-playground-web") }, /not issued to this client ID/],
  ])("refuses a supplied token with %s, without any request", async (_label, fields, message) => {
    const result = await validate({ accessToken: TOKEN_A, providerSpecificData: { clientId: CLIENT_A }, ...fields });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(message);
    expect(JSON.stringify(result)).not.toContain(TOKEN_A);
    expect(calls).toEqual([]);
  });

  it("mints exactly one IMS token for a client secret and keeps it nowhere", async () => {
    sequence(ims(MINTED_B));
    const result = await validate({ credentialMode: "client_secret", apiKey: SECRET_B, providerSpecificData: { clientId: CLIENT_B } });
    expect(result).toEqual({ valid: true, error: null });
    expect(calls.map((call) => [call.method, call.url])).toEqual([["POST", ADOBE_IMS_TOKEN_URL]]);
    expect(new URLSearchParams(String(calls[0].init.body)).get("client_id")).toBe(CLIENT_B);
    expect(defaultAdobeTokenCache.size).toBe(0);
    expect(JSON.stringify(result)).not.toContain(MINTED_B);
  });

  it("refuses a secret and a token together without minting", async () => {
    const result = await validate({ apiKey: SECRET_A, accessToken: TOKEN_A, providerSpecificData: { clientId: CLIENT_A } });
    expect(result.valid).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("update: replacing the credential clears the other mode", () => {
  const storedSecret = { id: "ff-1", provider: "adobe-firefly-api", authType: "apikey", apiKey: SECRET_A, providerSpecificData: { clientId: CLIENT_A } };
  const storedToken = { id: "ff-1", provider: "adobe-firefly-api", authType: "apikey", apiKey: "", accessToken: TOKEN_A, expiresAt: IN_ONE_HOUR, providerSpecificData: { clientId: CLIENT_A } };

  it("a supplied token replaces a stored secret, clearing the secret", async () => {
    m.connection.mockResolvedValue(storedSecret);
    const response = await put({ credentialMode: "access_token", accessToken: TOKEN_A2, expiresAt: IN_ONE_HOUR });
    expect(response.status).toBe(200);
    expect(m.updated.mock.calls[0][1]).toMatchObject({ apiKey: "", accessToken: TOKEN_A2, expiresAt: IN_ONE_HOUR });
    expect(calls).toEqual([]);
    await expectNoSecrets(response);
  });

  it("a new secret replaces a stored token, clearing the token and its expiry", async () => {
    m.connection.mockResolvedValue(storedToken);
    const response = await put({ apiKey: SECRET_B });
    expect(response.status).toBe(200);
    expect(m.updated.mock.calls[0][1]).toMatchObject({ apiKey: SECRET_B, accessToken: null, expiresAt: null });
    expect(calls).toEqual([]);
    await expectNoSecrets(response);
  });

  it("re-checks the stored token when only its expiry changes", async () => {
    m.connection.mockResolvedValue(storedToken);
    const later = new Date(NOW + 20 * 3_600_000).toISOString();
    expect((await put({ expiresAt: later })).status).toBe(200);
    expect(m.updated.mock.calls[0][1]).toMatchObject({ accessToken: TOKEN_A, expiresAt: later });
  });

  it.each([
    ["a malformed expiry", storedToken, { expiresAt: "tomorrow-ish" }],
    ["a past expiry", storedToken, { expiresAt: new Date(NOW - 1).toISOString() }],
    ["a mode switch without its credential", storedSecret, { credentialMode: "access_token" }],
    ["a consumer client ID", storedSecret, { providerSpecificData: { clientId: "projectx_webapp" } }],
    ["a secret and a token together", storedSecret, { apiKey: SECRET_B, accessToken: TOKEN_A2 }],
  ])("refuses %s with 400 and writes nothing", async (_label, stored, body) => {
    m.connection.mockResolvedValue(stored);
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(m.updated).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    await expectNoSecrets(response);
  });

  it("leaves the credential alone for an unrelated edit", async () => {
    m.connection.mockResolvedValue(storedToken);
    expect((await put({ name: "renamed" })).status).toBe(200);
    const patch = m.updated.mock.calls[0][1];
    expect(patch).toMatchObject({ name: "renamed" });
    for (const field of ["apiKey", "accessToken", "expiresAt"]) expect(patch).not.toHaveProperty(field);
  });
});

describe("routes: both stored modes, two accounts kept apart", () => {
  it("image: a supplied token is sent as given with its own client ID, and IMS is never called", async () => {
    m.credentials.mockResolvedValueOnce(tokenConnection("ff-a"));
    sequence(accepted(), imageDone());
    const response = await image();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ url: IMAGE_URL }]);
    expect(mints()).toEqual([]);
    const [submit] = posts(ADOBE_FIREFLY_GENERATE_URL);
    expect(header(submit, "Authorization")).toBe(`Bearer ${TOKEN_A}`);
    expect(header(submit, "x-api-key")).toBe(CLIENT_A);
    expect(usage()[0]).toMatchObject({ connectionId: "ff-a" });
  });

  it("video: a supplied token is sent as given and IMS is never called", async () => {
    m.credentials.mockResolvedValueOnce(tokenConnection("ff-a"));
    sequence(accepted(), videoDone());
    const response = await video();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ url: VIDEO_URL }]);
    expect(mints()).toEqual([]);
    expect(calls.map((call) => call.url)).toEqual([ADOBE_FIREFLY_VIDEO_GENERATE_URL, adobeFireflyStatusUrl(JOB)]);
    expect(header(calls[0], "Authorization")).toBe(`Bearer ${TOKEN_A}`);
  });

  it.each([
    ["an expired", new Date(NOW - 1000).toISOString(), /expired/],
    ["a malformed", "not-a-date", /not a valid date/],
    ["an out-of-range", 1e20, /not a valid date/],
  ])("image and video refuse %s stored expiry with 401 before anything is sent", async (_label, expiresAt, message) => {
    m.credentials.mockResolvedValueOnce(tokenConnection("ff-a", { expiresAt })).mockResolvedValue({ allRateLimited: true, lastError: "expired" });
    const imageResponse = await image();
    expect(imageResponse.status).toBe(401);
    m.credentials.mockReset().mockResolvedValueOnce(tokenConnection("ff-a", { expiresAt }));
    const videoResponse = await video();
    expect(videoResponse.status).toBe(401);
    expect((await videoResponse.json()).error.message).toMatch(message);
    expect(calls).toEqual([]);
  });

  it("a refused supplied token is not refreshed: no IMS call, no resend, and the next account uses its own secret", async () => {
    m.credentials.mockResolvedValueOnce(tokenConnection("ff-a")).mockResolvedValueOnce(secretConnection("ff-b"));
    sequence(json({ message: `bad ${TOKEN_A}` }, 401), ims(MINTED_B), accepted(), imageDone());
    const response = await image();
    expect(response.status).toBe(200);
    expect(posts(ADOBE_FIREFLY_GENERATE_URL).map((call) => [header(call, "x-api-key"), header(call, "Authorization")])).toEqual([
      [CLIENT_A, `Bearer ${TOKEN_A}`], [CLIENT_B, `Bearer ${MINTED_B}`],
    ]);
    expect(mints()).toHaveLength(1);
    expect(new URLSearchParams(String(mints()[0].init.body)).get("client_id")).toBe(CLIENT_B);
    expect(m.markUnavailable.mock.calls.map((call) => call.slice(0, 2))).toEqual([["ff-a", 401]]);
    expect(usage()).toEqual([expect.objectContaining({ connectionId: "ff-b" })]);
  });

  it("keeps a token account and a secret account apart under concurrency", async () => {
    m.credentials.mockResolvedValueOnce(tokenConnection("ff-a")).mockResolvedValueOnce(secretConnection("ff-b"));
    network((call) => {
      if (call.url === ADOBE_IMS_TOKEN_URL) return ims(MINTED_B);
      if (call.url === ADOBE_FIREFLY_GENERATE_URL) return accepted();
      if (call.url === adobeFireflyStatusUrl(JOB)) return imageDone();
      return null;
    });
    const [a, b] = await Promise.all([image(), image()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const pairs = posts(ADOBE_FIREFLY_GENERATE_URL).map((call) => [header(call, "x-api-key"), header(call, "Authorization")]).sort();
    expect(pairs).toEqual([[CLIENT_A, `Bearer ${TOKEN_A}`], [CLIENT_B, `Bearer ${MINTED_B}`]]);
    expect(mints().map((call) => new URLSearchParams(String(call.init.body)).get("client_id"))).toEqual([CLIENT_B]);
    expect(usage().map((event) => event.connectionId).sort()).toEqual(["ff-a", "ff-b"]);
  });

  it("isolates tokens by credential: distinct secrets mint apart, an identical credential shares one token", async () => {
    // Three connections: two store the very same client ID and secret, which is
    // one Adobe technical account; the third is a different credential.
    m.credentials
      .mockResolvedValueOnce(secretConnection("ff-b1"))
      .mockResolvedValueOnce(secretConnection("ff-b2"))
      .mockResolvedValueOnce(secretConnection("ff-c", CLIENT_A, SECRET_A));
    network((call) => {
      if (call.url === ADOBE_IMS_TOKEN_URL) {
        const id = new URLSearchParams(String(call.init.body)).get("client_id");
        return ims(id === CLIENT_B ? MINTED_B : "synthetic-onboarding-minted-token-c");
      }
      if (call.url === ADOBE_FIREFLY_GENERATE_URL) return accepted();
      if (call.url === adobeFireflyStatusUrl(JOB)) return imageDone();
      return null;
    });
    for (let index = 0; index < 3; index += 1) expect((await image()).status).toBe(200);
    expect(mints().map((call) => new URLSearchParams(String(call.init.body)).get("client_id"))).toEqual([CLIENT_B, CLIENT_A]);
    expect(posts(ADOBE_FIREFLY_GENERATE_URL).map((call) => header(call, "Authorization"))).toEqual([
      `Bearer ${MINTED_B}`, `Bearer ${MINTED_B}`, "Bearer synthetic-onboarding-minted-token-c",
    ]);
  });
});
