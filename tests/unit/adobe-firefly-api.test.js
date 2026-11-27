// Adobe Firefly Services API images, staged. Closed mocks only: every request is
// answered below, an unexpected URL fails the test, and every credential is
// synthetic. Passing here says nothing about the live service or about any
// account's Firefly Services entitlement.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const staged = vi.hoisted(() => ({ adapter: null }));

// While staged, the adapter map does not know this provider, so the core tests substitute that one lookup.
vi.mock("../../open-sse/handlers/imageProviders/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getImageAdapter: (id) => (id === "adobe-firefly-api" && staged.adapter ? staged.adapter : actual.getImageAdapter(id)),
  };
});

import provider, {
  ADOBE_FIREFLY_API_MODEL_IDS,
  ADOBE_FIREFLY_GENERATE_URL,
  ADOBE_FIREFLY_SCOPE,
  ADOBE_IMS_TOKEN_URL,
} from "../../open-sse/providers/private/adobe-firefly-api.js";
import defaultAdapter, { createAdobeFireflyApiImageAdapter } from "../../open-sse/handlers/imageProviders/adobe-firefly-api.js";
import { createAdobeTokenCache, defaultAdobeTokenCache } from "../../open-sse/services/adobeFireflyApi/auth.js";
import * as job from "../../open-sse/services/adobeFireflyApi/job.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const API = "https://firefly-api.adobe.io";
const CLIENT_A = "synthclienta0000000000000000000a";
const CLIENT_B = "synthclientb0000000000000000000b";
const SECRET_A = "p8e-SYNTHETIC-secret-account-a";
const SECRET_B = "p8e-SYNTHETIC-secret-account-b";
const TOKEN_A1 = "synthetic-ims-token-a-0001";
const TOKEN_A2 = "synthetic-ims-token-a-0002";
const TOKEN_B1 = "synthetic-ims-token-b-0001";
const PASTED = "synthetic-pasted-access-token-0001";
const JOB = "urn:ff:jobs:eso851211:86ffe2ea-d765-4bd3-b2fd-568ca8fc36ac";
const STATUS_URL = `${API}/v3/status/${JOB}`;
const CANCEL_URL = `${API}/v3/cancel/${JOB}`;
const IMAGE_1 = "https://pre-signed-firefly-prod.s3-accelerate.amazonaws.com/images/one";
const IMAGE_2 = "https://pre-signed-firefly-prod.s3-accelerate.amazonaws.com/images/two";
const SECRETS = [SECRET_A, SECRET_B, TOKEN_A1, TOKEN_A2, TOKEN_B1, PASTED];

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const ims = (token = TOKEN_A1, expiresIn = 86_399) => json({ access_token: token, token_type: "bearer", expires_in: expiresIn });
// The submit answer's own statusUrl and cancelUrl point elsewhere; they must never be used.
const accepted = (jobId = JOB) => json({
  jobId, statusUrl: `https://attacker.example/v3/status/${jobId}`, cancelUrl: `https://attacker.example/v3/cancel/${jobId}`,
}, 202);
const running = (jobId = JOB) => json({ status: "running", jobId });
const succeeded = (urls = [IMAGE_1], jobId = JOB) => json({
  status: "succeeded",
  jobId,
  result: { size: { width: 2048, height: 2048 }, outputs: urls.map((url, seed) => ({ seed, image: { url } })), contentClass: "art" },
});

const originalFetch = global.fetch;
let calls;
let virtual;
let cache;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return isFunction(step) ? step(String(url), init) : step;
  });
}

// Answers by URL, for concurrent requests whose order is not fixed.
function route(handler) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const answer = await handler(String(url), init);
    if (!answer) throw new Error(`Unexpected request: ${url}`);
    return answer;
  });
}

function clock() {
  let time = 1_700_000_000_000;
  const waits = [];
  return {
    waits,
    now: () => time,
    advance: (ms) => { time += ms; },
    wait: async (ms, signal) => {
      signal?.throwIfAborted();
      waits.push(ms);
      time += ms;
    },
  };
}

function useAdapter(polling = {}, cacheOptions = {}) {
  virtual = clock();
  cache = createAdobeTokenCache({ now: virtual.now, ...cacheOptions });
  staged.adapter = createAdobeFireflyApiImageAdapter({
    cache, now: virtual.now, polling: { wait: virtual.wait, now: virtual.now, ...polling },
  });
}

const s2s = (clientId = CLIENT_A, secret = SECRET_A, extra = {}) => ({ apiKey: secret, providerSpecificData: { clientId }, ...extra });
const pasted = (token = PASTED, extra = {}) => ({ accessToken: token, providerSpecificData: { clientId: CLIENT_A }, ...extra });

function run({ body = {}, credentials = s2s(), model = "image4_standard", ...options } = {}) {
  return handleImageGenerationCore({
    body: { prompt: "bears dancing in a forest", ...body },
    modelInfo: { provider: "adobe-firefly-api", model },
    credentials,
    log: null,
    ...options,
  });
}

function expectAccepted(result) {
  expect(result.success).toBe(false);
  expect(result.acceptedJob).toMatchObject({
    modality: "image", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "accepted" },
  });
}

function expectNoSecrets(result) {
  const text = JSON.stringify(result.error ?? "");
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

const urls = () => calls.map((call) => call.url);
const submits = () => calls.filter((call) => call.url === ADOBE_FIREFLY_GENERATE_URL);
const mints = () => calls.filter((call) => call.url === ADOBE_IMS_TOKEN_URL);
const form = (call) => Object.fromEntries(new URLSearchParams(call.init.body));
const jwt = (payload) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.c2lnbmF0dXJl`;

// Every request went only to the fixed IMS and API origins.
function expectFixedOrigins() {
  for (const url of urls()) {
    expect([new URL(ADOBE_IMS_TOKEN_URL).origin, API]).toContain(new URL(url).origin);
  }
}

beforeEach(() => {
  calls = [];
  useAdapter();
});
afterEach(() => {
  global.fetch = originalFetch;
  staged.adapter = null;
  defaultAdobeTokenCache.clear();
});

describe("adobe-firefly-api staging", () => {
  it("declares an image-only Services API identity with no chat transport", () => {
    expect(provider).toMatchObject({
      id: "adobe-firefly-api", category: "apikey", authType: "apikey", transport: null, serviceKinds: ["image"],
    });
    expect(provider.models.map((model) => model.id)).toEqual(["image3", "image4_standard", "image4_ultra"]);
    expect(ADOBE_FIREFLY_API_MODEL_IDS).toEqual(["image3", "image4_standard", "image4_ultra"]);
    for (const field of ["oauth", "authModes", "hasOAuth", "cookieImport", "webLogin", "videoConfig", "passthroughModels"]) {
      expect(provider).not.toHaveProperty(field);
    }
    expect(provider.display.notice.text).toMatch(/subscription alone does not grant API access/);
  });

  it("pins Adobe's documented origins, endpoint and scope", () => {
    expect(ADOBE_IMS_TOKEN_URL).toBe("https://ims-na1.adobelogin.com/ims/token/v3");
    expect(ADOBE_FIREFLY_GENERATE_URL).toBe("https://firefly-api.adobe.io/v3/images/generate-async");
    expect(ADOBE_FIREFLY_SCOPE).toBe("openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis");
    expect(defaultAdapter.async).toBe(true);
    expect(job.ADOBE_FIREFLY_POLL_INTERVAL_MS).toBe(2_000);
    expect(job.ADOBE_FIREFLY_POLL_TIMEOUT_MS).toBe(300_000);
    expect(job.ADOBE_FIREFLY_MAX_POLL_RETRIES).toBe(5);
    expect(job.ADOBE_FIREFLY_MAX_RETRY_DELAY_MS).toBe(30_000);
  });

  it("is not reachable through the registry, the adapter map or a chat executor, and leaves consumer IDs unregistered", async () => {
    const actual = await vi.importActual("../../open-sse/handlers/imageProviders/index.js");
    for (const id of ["adobe-firefly-api", "adobe-firefly", "firefly"]) {
      expect(actual.getImageAdapter(id)).toBeNull();
      expect(REGISTRY.some((entry) => entry.id === id)).toBe(false);
      expect(hasSpecializedExecutor(id)).toBe(false);
    }
  });
});

describe("adobe-firefly-api success", () => {
  it("mints an S2S token, submits once, polls the fixed origin and returns URLs with returned-image usage", async () => {
    const onRequestSuccess = vi.fn();
    serve(ims(), accepted(), running(), succeeded([IMAGE_1, IMAGE_2]));

    const result = await run({ body: { n: 2, size: "2048x2048", content_class: "art", negative_prompt: "rain" }, onRequestSuccess });

    expect(result.success).toBe(true);
    expect((await result.response.json()).data).toEqual([{ url: IMAGE_1 }, { url: IMAGE_2 }]);
    expect(urls()).toEqual([ADOBE_IMS_TOKEN_URL, ADOBE_FIREFLY_GENERATE_URL, STATUS_URL, STATUS_URL]);
    const [mint, submit, poll] = calls;
    expect(mint.init).toMatchObject({ method: "POST", redirect: "error" });
    expect(mint.init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(form(mint)).toEqual({ grant_type: "client_credentials", client_id: CLIENT_A, client_secret: SECRET_A, scope: ADOBE_FIREFLY_SCOPE });
    expect(submit.init.headers).toEqual({
      "Content-Type": "application/json", Accept: "application/json",
      Authorization: `Bearer ${TOKEN_A1}`, "x-api-key": CLIENT_A, "x-model-version": "image4_standard",
    });
    expect(JSON.parse(submit.init.body)).toEqual({
      prompt: "bears dancing in a forest", numVariations: 2, size: { width: 2048, height: 2048 }, contentClass: "art", negativePrompt: "rain",
    });
    expect(submit.init.body).not.toContain(TOKEN_A1);
    // The submit refuses redirects itself and carries a composed, cancellable signal.
    expect(submit.init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(submit.init.signal).toBeInstanceOf(AbortSignal);
    expect(submit.init.signal.aborted).toBe(false);
    expect(poll.init).toMatchObject({ method: "GET", redirect: "error" });
    expect(poll.init.headers).toEqual({ Authorization: `Bearer ${TOKEN_A1}`, "x-api-key": CLIENT_A, Accept: "application/json" });
    expect(virtual.waits).toEqual([2_000, 2_000]);
    expect(result.accounting).toMatchObject({
      state: "complete", modality: "image", nativeUnits: { images: 2 }, cost: null, costStatus: "unknown",
    });
    expect(result.acceptedJob).toBeUndefined();
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
    // Neither the attacker statusUrl nor a result URL was fetched.
    expectFixedOrigins();
  });

  it("uses a pasted access token with its client ID and contacts IMS never", async () => {
    serve(accepted(), succeeded());
    const result = await run({ credentials: pasted() });
    expect(result.success).toBe(true);
    expect(urls()).toEqual([ADOBE_FIREFLY_GENERATE_URL, STATUS_URL]);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${PASTED}`);
    expect(calls[0].init.headers["x-api-key"]).toBe(CLIENT_A);
  });

  it("accepts a pasted JWT issued to the same client and not yet expired", async () => {
    const token = jwt({ client_id: CLIENT_A, type: "access_token" });
    serve(accepted(), succeeded());
    const result = await run({ credentials: pasted(token, { expiresAt: new Date(virtual.now() + 60_000).toISOString() }) });
    expect(result.success).toBe(true);
  });

  it("accepts the bare-uuid job id the async guide shows in a running status", async () => {
    serve(ims(), accepted(), running("86ffe2ea-d765-4bd3-b2fd-568ca8fc36ac"), succeeded());
    expect((await run()).success).toBe(true);
  });

  it.each([
    [{}, { numVariations: 1 }],
    [{ n: 9, size: "1792x1024" }, { numVariations: 4, size: { width: 1792, height: 1024 } }],
    [{ n: "3", size: "auto" }, { numVariations: 1 }],
    [{ n: 0, size: "9999x10" }, { numVariations: 1 }],
    [{ contentClass: "photo", quality: "hd", style: "" }, { numVariations: 1, contentClass: "photo" }],
  ])("maps %j onto the submit body", async (body, expected) => {
    serve(ims(), accepted(), succeeded());
    await run({ body });
    expect(JSON.parse(submits()[0].init.body)).toEqual({ prompt: "bears dancing in a forest", ...expected });
  });

  it.each(ADOBE_FIREFLY_API_MODEL_IDS)("sends model %s as x-model-version", async (model) => {
    serve(ims(), accepted(), succeeded());
    await run({ model });
    expect(submits()[0].init.headers["x-model-version"]).toBe(model);
  });
});

describe("adobe-firefly-api token cache", () => {
  it("reuses a cached token until shortly before expiry, then mints again", async () => {
    serve(ims(TOKEN_A1, 3_600), accepted(), succeeded(), accepted(), succeeded(), ims(TOKEN_A2, 3_600), accepted(), succeeded());
    await run();
    await run();
    expect(mints()).toHaveLength(1);
    expect(submits()[1].init.headers.Authorization).toBe(`Bearer ${TOKEN_A1}`);
    // Inside the five-minute refresh margin.
    virtual.advance(3_600_000 - 5 * 60_000);
    await run();
    expect(mints()).toHaveLength(2);
    expect(submits()[2].init.headers.Authorization).toBe(`Bearer ${TOKEN_A2}`);
  });

  it("never trusts a lifetime longer than 24 hours", async () => {
    serve(ims(TOKEN_A1, 10 * 86_400), accepted(), succeeded(), ims(TOKEN_A2), accepted(), succeeded());
    await run();
    virtual.advance(86_400_000);
    await run();
    expect(mints()).toHaveLength(2);
  });

  it("keeps accounts apart: concurrent accounts mint separately and each submit carries its own token", async () => {
    const tokens = { [CLIENT_A]: TOKEN_A1, [CLIENT_B]: TOKEN_B1 };
    route((url, init) => {
      if (url === ADOBE_IMS_TOKEN_URL) return ims(tokens[form({ init }).client_id]);
      if (url === ADOBE_FIREFLY_GENERATE_URL) return accepted(`urn:ff:jobs:x:${init.headers["x-api-key"]}`);
      if (url.startsWith(`${API}/v3/status/`)) return succeeded([IMAGE_1], url.slice(`${API}/v3/status/`.length));
      return null;
    });
    const results = await Promise.all([run({ credentials: s2s(CLIENT_A, SECRET_A) }), run({ credentials: s2s(CLIENT_B, SECRET_B) })]);
    expect(results.map((result) => result.success)).toEqual([true, true]);
    expect(mints().map((call) => form(call).client_id).sort()).toEqual([CLIENT_A, CLIENT_B]);
    for (const call of calls.filter((entry) => entry.url !== ADOBE_IMS_TOKEN_URL)) {
      const client = call.init.headers["x-api-key"];
      expect(call.init.headers.Authorization).toBe(`Bearer ${tokens[client]}`);
      if (call.url !== ADOBE_FIREFLY_GENERATE_URL) expect(call.url).toContain(client);
    }
    expect(cache.size).toBe(2);
  });

  it("shares one mint between concurrent requests of one account", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    route(async (url) => {
      if (url === ADOBE_IMS_TOKEN_URL) { await gate; return ims(); }
      if (url === ADOBE_FIREFLY_GENERATE_URL) return accepted();
      if (url === STATUS_URL) return succeeded();
      return null;
    });
    const pending = [run(), run(), run()];
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    expect((await Promise.all(pending)).every((result) => result.success)).toBe(true);
    expect(mints()).toHaveLength(1);
  });

  it("mints a new token when the client secret is rotated", async () => {
    serve(ims(TOKEN_A1), accepted(), succeeded(), ims(TOKEN_A2), accepted(), succeeded());
    await run({ credentials: s2s(CLIENT_A, SECRET_A) });
    await run({ credentials: s2s(CLIENT_A, `${SECRET_A}-rotated`) });
    expect(mints()).toHaveLength(2);
    expect(form(mints()[1]).client_secret).toBe(`${SECRET_A}-rotated`);
  });

  it("prefers the client secret over a stored access token", async () => {
    serve(ims(), accepted(), succeeded());
    await run({ credentials: s2s(CLIENT_A, SECRET_A, { accessToken: PASTED }) });
    expect(submits()[0].init.headers.Authorization).toBe(`Bearer ${TOKEN_A1}`);
  });

  it("does not write a minted token into the connection credentials", async () => {
    const credentials = s2s();
    const onCredentialsRefreshed = vi.fn();
    serve(ims(), accepted(), succeeded());
    await run({ credentials, onCredentialsRefreshed });
    expect(credentials).toEqual(s2s());
    expect(onCredentialsRefreshed).not.toHaveBeenCalled();
  });
});

describe("adobe-firefly-api refusals before dispatch", () => {
  it.each([
    ["no credential", {}],
    ["a secret without a client ID", { apiKey: SECRET_A }],
    ["Adobe's consumer web-app client ID", s2s("clio-playground-web", SECRET_A)],
    ["the Express web-app client ID", s2s("projectx_webapp", SECRET_A)],
    ["a client ID without a secret or token", { providerSpecificData: { clientId: CLIENT_A } }],
    ["a secret with a line break", s2s(CLIENT_A, `${SECRET_A}\r\nX-Extra: 1`)],
    ["a browser cookie header as token", pasted(`ims_sid=${PASTED}; aux_sid=${PASTED}`)],
    ["an expired pasted token", pasted(PASTED, { expiresAt: "2023-01-01T00:00:00Z" })],
    ["a pasted JWT from the consumer web app", pasted(jwt({ client_id: "clio-playground-web" }))],
    ["a pasted JWT issued to another client", pasted(jwt({ client_id: CLIENT_B }))],
  ])("refuses %s with 401 and sends nothing", async (_name, credentials) => {
    serve();
    const result = await run({ credentials });
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(result.acceptedJob).toBeUndefined();
    expectNoSecrets(result);
    expect(calls).toHaveLength(0);
  });

  it.each(["image3_custom", "image4_custom", "nano-banana-pro", "../v3/cancel"])("refuses the model %s with 400", async (model) => {
    serve();
    expect(await run({ model })).toMatchObject({ success: false, status: 400 });
    expect(calls).toHaveLength(0);
  });

  it.each(["image", "images", "image_url", "reference_images", "mask", "style", "structure"])(
    "refuses reference input in %s before minting a token",
    async (field) => {
      serve();
      const result = await run({ body: { [field]: "https://example.com/reference.png" } });
      expect(result).toMatchObject({ success: false, status: 400 });
      expect(calls).toHaveLength(0);
    }
  );

  it.each([
    [{ prompt: "x".repeat(1025) }],
    [{ contentClass: "video" }],
    [{ negative_prompt: { text: "x" } }],
  ])("refuses the invalid body %j with 400", async (body) => {
    serve();
    expect(await run({ body })).toMatchObject({ success: false, status: 400 });
    expect(calls).toHaveLength(0);
  });
});

describe("adobe-firefly-api IMS errors", () => {
  it.each([
    [json({ error: "invalid_client", error_description: `bad secret ${SECRET_A}` }, 401), 401, "Adobe IMS refused the client credentials (invalid_client)"],
    [json({ error: "invalid_scope" }, 400), 401, "Adobe IMS refused the client credentials (invalid_scope)"],
    [json({ error: `weird ${SECRET_A}` }, 400), 401, "Adobe IMS refused the client credentials"],
    [json({}, 403), 403, "Adobe IMS refused the client credentials"],
    [json({}, 429, { "retry-after": "30" }), 429, "Adobe IMS rate limited the token request"],
    [json({}, 500), 502, "Adobe IMS token request returned 500"],
    [new Response("<html>not json</html>"), 502, "Adobe IMS returned an unusable token response"],
    [json({ access_token: TOKEN_A1, token_type: "mac", expires_in: 100 }), 502, "Adobe IMS returned an unusable token response"],
    [json({ access_token: TOKEN_A1, token_type: "bearer" }), 502, "Adobe IMS returned an unusable token response"],
  ])("maps an IMS answer to a fixed error and never submits (%#)", async (answer, status, message) => {
    const onRequestSuccess = vi.fn();
    serve(answer);
    const result = await run({ onRequestSuccess });
    expect(result).toMatchObject({ success: false, status });
    expect(result.error).toContain(message);
    expect(result.acceptedJob).toBeUndefined();
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expectNoSecrets(result);
    expect(urls()).toEqual([ADOBE_IMS_TOKEN_URL]);
  });

  it("does not repeat IMS transport or redirect error text", async () => {
    serve(() => { throw new TypeError(`redirect refused for client_secret=${SECRET_A}`); });
    const result = await run();
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.error).toContain("Adobe IMS token request failed");
    expectNoSecrets(result);
  });

  it("bounds the IMS request and reports a timeout", async () => {
    useAdapter({}, { requestTimeoutMs: 5 });
    serve((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
    const result = await run();
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.error).toContain("Adobe IMS token request timed out");
    expect(submits()).toHaveLength(0);
  });

  it("does not cache a failed mint", async () => {
    serve(json({ error: "invalid_client" }, 401), ims(), accepted(), succeeded());
    expect((await run()).status).toBe(401);
    expect((await run()).success).toBe(true);
    expect(mints()).toHaveLength(2);
  });

  it("stops at once when the client disconnects during the mint, with no submit and no accepted job", async () => {
    const controller = new AbortController();
    route(async (url) => {
      if (url === ADOBE_IMS_TOKEN_URL) {
        controller.abort();
        return ims();
      }
      return null;
    });
    const result = await run({ signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob).toBeUndefined();
    expect(submits()).toHaveLength(0);
  });
});

describe("adobe-firefly-api submit errors", () => {
  it.each([
    [403, { "x-access-error": "quota_exhausted" }],
    [403, { "x-access-error": "user_non_entitled" }],
    [429, { "retry-after": "60", "x-access-rate-limit-level": "org" }],
  ])("keeps submit status %i, sends one submit and records no accepted job", async (status, headers) => {
    const onRequestSuccess = vi.fn();
    serve(ims(), json({ error_code: "access_error", message: "synthetic refusal" }, status, headers));
    const result = await run({ onRequestSuccess });
    expect(result).toMatchObject({ success: false, status });
    expect(result.acceptedJob).toBeUndefined();
    expect(result.accounting).toBeUndefined();
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(submits()).toHaveLength(1);
    expect(calls.filter((call) => call.url.startsWith(`${API}/v3/status/`))).toHaveLength(0);
    expectNoSecrets(result);
  });

  it("drops the rejected token after a submit 401, re-mints once and resends the refused submit, persisting nothing", async () => {
    const credentials = s2s();
    const onCredentialsRefreshed = vi.fn();
    serve(ims(TOKEN_A1), json({}, 401), ims(TOKEN_A2), accepted(), succeeded());
    const result = await run({ credentials, onCredentialsRefreshed });
    expect(result.success).toBe(true);
    expect(submits().map((call) => call.init.headers.Authorization)).toEqual([`Bearer ${TOKEN_A1}`, `Bearer ${TOKEN_A2}`]);
    expect(mints()).toHaveLength(2);
    expect(credentials).toEqual(s2s());
    expect(onCredentialsRefreshed).not.toHaveBeenCalled();
    // The fresh token is cached for the next request; the rejected one is gone.
    serve(accepted(), succeeded());
    expect((await run({ credentials })).success).toBe(true);
    expect(calls.at(-2).init.headers.Authorization).toBe(`Bearer ${TOKEN_A2}`);
  });

  it("stops after a second submit 401: two submits, two mints, no accepted job, and the second token is dropped too", async () => {
    serve(ims(TOKEN_A1), json({}, 401), ims(TOKEN_A2), json({}, 401));
    const result = await run();
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(result.acceptedJob).toBeUndefined();
    expect(submits()).toHaveLength(2);
    expect(mints()).toHaveLength(2);
    expect(cache.size).toBe(0);
    expectNoSecrets(result);
  });

  it("keeps the submit 401 and sends nothing more when the re-mint fails", async () => {
    serve(ims(TOKEN_A1), json({}, 401), json({ error: "invalid_client" }, 401));
    const result = await run();
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(result.acceptedJob).toBeUndefined();
    expect(submits()).toHaveLength(1);
    expect(cache.size).toBe(0);
  });

  it("does not refresh a pasted token: the 401 stands, nothing is minted and the connection is untouched", async () => {
    const credentials = pasted();
    const refreshCredentials = vi.fn(async () => ({ accessToken: "synthetic-injected-token-0001" }));
    serve(json({}, 401));
    const result = await run({ credentials, refreshCredentials });
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(calls).toHaveLength(1);
    expect(refreshCredentials).not.toHaveBeenCalled();
    expect(credentials).toEqual(pasted());
  });

  // Defense in depth: the submit uses manual redirects, so a real fetch never answers redirected.
  it("treats a redirected submit as an unknown outcome and drops the token it carried", async () => {
    const redirected = accepted();
    Object.defineProperty(redirected, "redirected", { value: true });
    serve(ims(TOKEN_A1), redirected, ims(TOKEN_A2), accepted(), succeeded());
    const result = await run();
    expectAccepted(result);
    expect(result.error).toBe("Adobe Firefly submit was redirected");
    expect(urls()).toEqual([ADOBE_IMS_TOKEN_URL, ADOBE_FIREFLY_GENERATE_URL]);
    expect((await run()).success).toBe(true);
    expect(submits()[1].init.headers.Authorization).toBe(`Bearer ${TOKEN_A2}`);
  });

  it.each(["https://attacker.example/v3/status/x", "../../v3/cancel/x", "", 42, "a b"])(
    "never polls with the unusable job id %j",
    async (jobId) => {
      serve(ims(), json({ jobId, statusUrl: "https://attacker.example/s", cancelUrl: "https://attacker.example/c" }, 202));
      const result = await run();
      expectAccepted(result);
      expect(result.error).toBe("Adobe Firefly did not return a usable job id");
      expect(calls).toHaveLength(2);
    }
  );

  it("records an unreadable submit answer as an accepted job", async () => {
    serve(ims(), new Response("not json", { status: 202 }));
    const result = await run();
    expectAccepted(result);
    expect(calls).toHaveLength(2);
  });
});

describe("adobe-firefly-api poll errors", () => {
  it("re-mints once after a poll 401 and keeps polling the same job", async () => {
    serve(ims(TOKEN_A1), accepted(), json({}, 401), ims(TOKEN_A2), succeeded());
    const result = await run();
    expect(result.success).toBe(true);
    expect(urls()).toEqual([ADOBE_IMS_TOKEN_URL, ADOBE_FIREFLY_GENERATE_URL, STATUS_URL, ADOBE_IMS_TOKEN_URL, STATUS_URL]);
    expect(calls[4].init.headers.Authorization).toBe(`Bearer ${TOKEN_A2}`);
    expect(submits()).toHaveLength(1);
  });

  it("gives up after a second poll 401 as an accepted job", async () => {
    serve(ims(TOKEN_A1), accepted(), json({}, 401), ims(TOKEN_A2), json({}, 401));
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(401);
    expect(submits()).toHaveLength(1);
  });

  it("records a failed re-mint during polling as an accepted 401", async () => {
    serve(ims(TOKEN_A1), accepted(), json({}, 401), json({ error: "invalid_client" }, 401));
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(401);
    expectNoSecrets(result);
  });

  it("passes a pasted-token poll 401 on at once as an accepted job", async () => {
    serve(accepted(), json({ message: `bad ${PASTED}` }, 401));
    const result = await run({ credentials: pasted() });
    expectAccepted(result);
    expect(result.status).toBe(401);
    expectNoSecrets(result);
    expect(calls).toHaveLength(2);
  });

  it("passes a poll 403 on as an accepted job without resubmitting", async () => {
    serve(ims(), accepted(), json({}, 403, { "x-access-error": "quota_exhausted" }));
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(403);
    expect(submits()).toHaveLength(1);
  });

  it("backs off on 429 and 503, honoring Retry-After, then succeeds", async () => {
    serve(ims(), accepted(), json({}, 429, { "retry-after": "7" }), json({}, 503), running(), succeeded());
    const result = await run();
    expect(result.success).toBe(true);
    expect(virtual.waits).toEqual([2_000, 7_000, 4_000, 2_000]);
    expect(submits()).toHaveLength(1);
  });

  it("caps a long Retry-After and stops after five retries as an accepted 429", async () => {
    serve(ims(), accepted(), ...Array.from({ length: 6 }, () => json({}, 429, { "retry-after": "3600" })));
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(429);
    expect(virtual.waits).toEqual([2_000, 30_000, 30_000, 30_000, 30_000, 30_000]);
  });

  it.each([404, 500])("treats poll status %i as a lost observation at once", async (status) => {
    serve(ims(), accepted(), json({ error_code: "unknown_job_id" }, status));
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(502);
  });

  it("does not repeat transport or redirect error text", async () => {
    serve(ims(), accepted(), () => { throw new TypeError(`redirect refused for Bearer ${TOKEN_A1}`); });
    const result = await run();
    expectAccepted(result);
    expect(result).toMatchObject({ status: 502, error: "Adobe Firefly status check failed" });
  });

  it.each([
    ["a non-JSON body", () => new Response("<html>oops</html>")],
    ["an array body", () => json([])],
    ["an unknown status", () => json({ status: "exploded", jobId: JOB })],
    ["a missing job id", () => json({ status: "running" })],
    ["a different job", () => json({ status: "running", jobId: "urn:ff:jobs:other:1" })],
    ["success without outputs", () => json({ status: "succeeded", jobId: JOB, result: {} })],
    ["an http image URL", () => succeeded(["http://pre-signed.example/a"])],
    ["an image URL with credentials", () => succeeded(["https://user:pw@pre-signed.example/a"])],
    ["more images than requested", () => succeeded([IMAGE_1, IMAGE_2])],
  ])("records %s as an accepted job with unknown outcome", async (_name, answer) => {
    const onRequestSuccess = vi.fn();
    serve(ims(), accepted(), answer());
    const result = await run({ onRequestSuccess });
    expectAccepted(result);
    expect(result.status).toBe(502);
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(submits()).toHaveLength(1);
  });
});

describe("adobe-firefly-api reported job outcomes", () => {
  it.each([
    ["validation_error", 422], ["bad_request", 422], ["timeout_error", 504], ["rate_limited", 429],
    ["access_error", 403], ["runtime_error", 502],
  ])("maps failure code %s to %i without an accepted-job record", async (code, status) => {
    const onRequestSuccess = vi.fn();
    serve(ims(), accepted(), json({ status: "failed", jobId: JOB, error_code: code, message: `upstream ${TOKEN_A1}` }));
    const result = await run({ onRequestSuccess });
    expect(result).toMatchObject({ success: false, status, error: `Adobe Firefly image job failed: ${code}` });
    expect(result.acceptedJob).toBeUndefined();
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it.each([TOKEN_A1, "/srv/secret/path", undefined])("never repeats the unrecognized failure code %j", async (code) => {
    serve(ims(), accepted(), json({ status: "failed", jobId: JOB, error_code: code }));
    expect(await run()).toMatchObject({ success: false, status: 502, error: "Adobe Firefly image job failed: unknown reason" });
  });

  it("reports cancelled and upstream-timeout jobs", async () => {
    serve(ims(), accepted(), json({ status: "cancelled", jobId: JOB }), accepted(), json({ status: "timeout", jobId: JOB }));
    expect(await run()).toMatchObject({ success: false, status: 502, error: "Adobe Firefly image job was cancelled" });
    expect(await run()).toMatchObject({ success: false, status: 504, error: "Adobe Firefly image job timed out upstream" });
  });

  it("keeps polling while a cancellation is pending", async () => {
    serve(ims(), accepted(), json({ status: "cancel_pending", jobId: JOB }), json({ status: "cancelled", jobId: JOB }));
    expect((await run()).error).toBe("Adobe Firefly image job was cancelled");
    expect(calls).toHaveLength(4);
  });
});

describe("adobe-firefly-api timeout and cancellation", () => {
  it("stops at the deadline, cancels the job on the fixed origin and records an accepted job", async () => {
    useAdapter({ timeoutMs: 10_000 });
    serve(ims(), accepted(), ...Array.from({ length: 5 }, () => () => running()), json({}, 200));
    const result = await run();
    expectAccepted(result);
    expect(result).toMatchObject({ status: 504, error: "Adobe Firefly image job did not finish in time" });
    expect(virtual.waits).toEqual([2_000, 2_000, 2_000, 2_000, 2_000]);
    const cancel = calls.at(-1);
    expect(cancel.url).toBe(CANCEL_URL);
    expect(cancel.init).toMatchObject({ method: "PUT", redirect: "error" });
    expect(cancel.init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN_A1}`, "x-api-key": CLIENT_A });
    expectFixedOrigins();
  });

  it("bounds each status request and reports its timeout as an accepted job", async () => {
    useAdapter({ requestTimeoutMs: 5 });
    serve(ims(), accepted(), (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
    const result = await run();
    expectAccepted(result);
    expect(result).toMatchObject({ status: 504, error: "Adobe Firefly status check timed out" });
  });

  it("stops polling when the client disconnects, cancels the job and records it as accepted", async () => {
    const controller = new AbortController();
    serve(ims(), accepted(), () => { controller.abort(); return running(); }, json({}, 200));
    const result = await run({ signal: controller.signal });
    expectAccepted(result);
    expect(result.status).toBe(499);
    expect(urls()).toEqual([ADOBE_IMS_TOKEN_URL, ADOBE_FIREFLY_GENERATE_URL, STATUS_URL, CANCEL_URL]);
  });

  it("ignores a failing cancel request: the outcome stays unknown", async () => {
    const controller = new AbortController();
    serve(ims(), accepted(), () => { controller.abort(); return running(); }, () => { throw new TypeError(`cancel ${TOKEN_A1}`); });
    const result = await run({ signal: controller.signal });
    expectAccepted(result);
    expect(result.status).toBe(499);
    expectNoSecrets(result);
  });
});

describe("adobe-firefly-api default adapter", () => {
  it("uses the process-wide token cache through the exported default adapter", async () => {
    staged.adapter = defaultAdapter;
    serve(ims(), accepted(), (url) => {
      expect(url).toBe(STATUS_URL);
      return succeeded();
    });
    // The default adapter uses the real poll interval; make it instant for this one call.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const pending = run();
      await vi.advanceTimersByTimeAsync(job.ADOBE_FIREFLY_POLL_INTERVAL_MS);
      expect((await pending).success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    expect(defaultAdobeTokenCache.size).toBe(1);
  });
});
