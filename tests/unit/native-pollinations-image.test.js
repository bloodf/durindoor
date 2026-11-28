// Pollinations native image adapter, staged and unregistered (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every key is synthetic. Wire shapes follow OmniRoute
// c71f0065 (imageRegistryData.ts `pollinations`, imageGeneration.ts
// handleOpenAIImageGeneration, imageGeneration/openAiImageFetch.ts). Passing
// here says nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-pollinations-image/index.js";
import {
  POLLINATIONS_IMAGE_MODELS,
  buildPollinationsImageRequest,
  createPollinationsImageAdapter,
  pollinationsAuth,
  pollinationsImageAdapter,
} from "../../open-sse/services/providerParity/native-pollinations-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import pollinationsRegistry from "../../open-sse/providers/registry/pollinations.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://gen.pollinations.ai";
const IMAGE_URL = `${ORIGIN}/v1/images/generations`;
const MODEL = "flux";
const KEY_A = "pk-SYNTHETIC-key-a-0001";
const KEY_B = "sk-SYNTHETIC-key-b-0002";
const PROMPT = "a lighthouse on a cliff at dusk";
const IMAGE_OUT = "https://media.pollinations.example/out/image.png";
const REF = "https://refs.example.com/cat.png";
const B64 = "aGVsbG8gcG9sbGluYXRpb25z";
const PUBLIC_CREDENTIAL = { id: "noauth", connectionId: "noauth", accessToken: "public", authType: "none" };
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-pollinations-image/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, code, headers = {}) =>
  json({ success: false, error: { code, message: `upstream echo ${KEY_A} ${PROMPT}` } }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });

const originalFetch = global.fetch;
let calls;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : undefined });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return isFunction(step) ? step(String(url), init) : step;
  });
}

const image = (body = {}, { model = MODEL, credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createPollinationsImageAdapter(options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
};

beforeEach(() => {
  calls = [];
  serve();
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// Staging-only negatives. Registration replaces this block with positive
// registry identity checks; every other block works staged or registered.
describe("staging state (isolated)", () => {
  it("stays unregistered and leaves the existing pollinations chat entry unchanged", () => {
    expect(getImageAdapter("pollinations")).toBeFalsy();
    expect(getImageAdapter("pol")).toBeFalsy();
    expect(pollinationsRegistry.serviceKinds ?? ["llm"]).not.toContain("image");
    expect(pollinationsRegistry.imageConfig).toBeUndefined();
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields and keeps the existing connection modes", () => {
    expect(staged.POLLINATIONS_PROVIDER_ID).toBe("pollinations");
    expect(staged.POLLINATIONS_ALIASES).toEqual(["pollinations", "pol"]);
    expect(staged.POLLINATIONS_IMAGE_URL).toBe(IMAGE_URL);
    expect(staged.POLLINATIONS_ORIGIN).toBe(ORIGIN);
    expect(staged.POLLINATIONS_IMAGE_FORMAT).toBe("openai");
    expect(POLLINATIONS_IMAGE_MODELS.map((m) => [m.id, m.name])).toEqual([
      ["klein", "FLUX.2 Klein 4B"],
      ["flux", "Flux Schnell"],
      ["zimage", "Z-Image Turbo"],
      ["qwen-image", "Qwen Image Plus"],
      ["wan-image", "Wan 2.7 Image"],
      ["gpt-image-2", "GPT Image 2"],
      ["gptimage-large", "GPT Image 1.5"],
      ["gptimage", "GPT Image 1 Mini"],
    ]);
    expect(POLLINATIONS_IMAGE_MODELS.filter((m) => m.inputModalities.includes("image")).map((m) => m.id)).toEqual(["qwen-image"]);
    expect(staged.POLLINATIONS_IMAGE_SIZES).toEqual(["1024x1024", "512x512"]);
    expect(pollinationsImageAdapter.provider).toBe("pollinations");
    expect(pollinationsImageAdapter.responseFormats).toEqual(["url", "b64_json"]);
    expect(isFunction(pollinationsImageAdapter.generate)).toBe(true);
    expect(pollinationsRegistry.id).toBe("pollinations");
    expect(pollinationsRegistry.alias).toBe("pol");
    expect(pollinationsRegistry.authType).toBe("apikey");
    expect(pollinationsRegistry.noAuth).toBe(true);
    expect(pollinationsRegistry.transport.baseUrl.startsWith(`${ORIGIN}/v1/`)).toBe(true);
  });

  it("describes the same ids, models and endpoints in registration.json", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.provider.canonicalId).toBe("pollinations");
    expect(REGISTRATION.provider.aliases).toEqual(["pollinations", "pol"]);
    expect(REGISTRATION.provider.addServiceKinds).toEqual(["image"]);
    expect(REGISTRATION.provider.authModes).toEqual(pollinationsRegistry.authModes);
    expect(REGISTRATION.provider.noAuth).toBe(true);
    expect(REGISTRATION.models.image.map((m) => [m.id, m.inputModalities])).toEqual(POLLINATIONS_IMAGE_MODELS.map((m) => [m.id, m.inputModalities]));
    expect(REGISTRATION.endpoints.image.url).toBe(IMAGE_URL);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged).toHaveProperty(name);
  });
});

describe("auth modes", () => {
  it("classifies keys, keyless placeholders and unusable keys", () => {
    expect(pollinationsAuth({ apiKey: KEY_A })).toEqual({ mode: "apikey", token: KEY_A });
    expect(pollinationsAuth({ accessToken: KEY_B })).toEqual({ mode: "apikey", token: KEY_B });
    expect(pollinationsAuth(PUBLIC_CREDENTIAL)).toEqual({ mode: "anonymous" });
    expect(pollinationsAuth({ apiKey: "sk_durindoor" })).toEqual({ mode: "anonymous" });
    expect(pollinationsAuth({})).toEqual({ mode: "anonymous" });
    expect(pollinationsAuth({ apiKey: "a\r\nX-Evil: 1" })).toEqual({ mode: "invalid" });
    expect(pollinationsAuth({ apiKey: "   " })).toEqual({ mode: "invalid" });
  });

  it("sends a keyless request without Authorization and tags the accounting scope", async () => {
    serve(json({ data: [{ url: IMAGE_OUT }] }));
    const result = await image({}, { credentials: PUBLIC_CREDENTIAL });
    expect(result.success).toBe(true);
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json" });
    expect(result.accounting.meta.authScope).toBe("anonymous");
    expect(result.accounting.costStatus).toBe("unknown");
  });

  it("refuses an unusable key before sending", async () => {
    expect((await image({}, { credentials: { apiKey: "a\r\nX-Evil: 1" } })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("uses accessToken when the connection carries no apiKey", async () => {
    serve(json({ data: [{ url: IMAGE_OUT }] }));
    const result = await image({}, { credentials: { accessToken: KEY_B } });
    expect(result.success).toBe(true);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${KEY_B}`);
    expect(result.accounting.meta.authScope).toBe("apikey");
  });
});

describe("image request contract", () => {
  it("sends the source body with Bearer auth to the fixed endpoint only", async () => {
    serve(json({ created: 123, data: [{ b64_json: B64 }], usage: { total_tokens: 3 } }));
    const result = await image({ n: 2, size: "512x512", quality: "hd", response_format: "b64_json", style: "vivid", output_format: "PNG" });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(IMAGE_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(calls[0].body).toEqual({
      model: MODEL, prompt: PROMPT, output_format: "png", n: 2, size: "512x512", quality: "hd", response_format: "b64_json", style: "vivid",
    });
    expect(await payload(result)).toEqual({ created: 123, data: [{ b64_json: B64 }] });
    expect(result.accounting.nativeUnits.images).toBe(1);
    expect(result.accounting.costStatus).toBe("unknown");
    expect(result.accounting.meta.providerUsage.value).toEqual({ total_tokens: 3 });
  });

  it("forwards optional fields only when given, like the source", () => {
    expect(buildPollinationsImageRequest("gptimage", { prompt: "x" })).toEqual({ model: "gptimage", prompt: "x" });
  });

  it("forwards one public reference image as image_url for qwen-image only", async () => {
    expect(buildPollinationsImageRequest("qwen-image", { prompt: "x", image_url: REF })).toEqual({ model: "qwen-image", prompt: "x", image_url: REF });
    expect(buildPollinationsImageRequest("qwen-image", { prompt: "x", image_urls: [REF] }).image_url).toBe(REF);
    expect(buildPollinationsImageRequest("qwen-image", {
      prompt: "x", messages: [{ content: [{ type: "image_url", image_url: { url: REF } }] }],
    }).image_url).toBe(REF);
    serve(json({ data: [{ url: IMAGE_OUT }] }));
    const result = await image({ image: REF }, { model: "qwen-image" });
    expect(result.success).toBe(true);
    expect(calls[0].body.image_url).toBe(REF);
  });

  it.each([
    [{ prompt: "" }, MODEL, /text prompt/],
    [{ size: "1792x1024" }, MODEL, /size must be one of/],
    [{ n: 0 }, MODEL, /n must be/],
    [{ n: 11 }, MODEL, /n must be/],
    [{ n: 1.5 }, MODEL, /n must be/],
    [{ response_format: "binary" }, MODEL, /response_format/],
    [{ stream: true }, MODEL, /streaming/],
    [{ image_url: REF }, MODEL, /text-to-image only/],
    [{ messages: [{ content: [{ type: "image_url", image_url: { url: REF } }] }] }, "gptimage", /text-to-image only/],
    [{ mask: "https://example.com/m.png" }, "qwen-image", /mask/],
    [{ images: [REF] }, "qwen-image", /images/],
    [{ image_urls: [REF, "https://refs.example.com/dog.png"] }, "qwen-image", /one reference image/],
    [{ image_url: "data:image/png;base64,aGk=" }, "qwen-image", /public https URL/],
    [{ image_url: "https://127.0.0.1/a.png" }, "qwen-image", /public https URL/],
    [{ image_url: "http://refs.example.com/a.png" }, "qwen-image", /public https URL/],
    [{ image_url: 42 }, "qwen-image", /image URL string/],
    [{ output_format: "tiff" }, MODEL, /output_format/],
    [{ frame_count: 4 }, MODEL, /gif/],
    [{ quality: { tier: "hd" } }, MODEL, /quality/],
  ])("refuses %j on %s before anything is sent", async (extra, model, message) => {
    const result = await image(extra, { model });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses unknown models and source aliases that belong to other providers", async () => {
    expect((await image({}, { model: "openai" })).status).toBe(400);
    expect((await image({}, { model: "kontext" })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("image outputs and failures", () => {
  it("returns url items, drops unsafe ones and refuses a format mismatch", async () => {
    serve(json({ data: [{ url: IMAGE_OUT }, { url: "http://media.pollinations.example/x.png" }, { url: "https://10.0.0.1/x.png" }, { url: "https://u:p@example.com/x.png" }, { url: "javascript:alert(1)" }] }));
    const ok = await image({ response_format: "url" });
    expect(ok.success).toBe(true);
    expect((await payload(ok)).data).toEqual([{ url: IMAGE_OUT }]);
    expect(ok.accounting.nativeUnits.images).toBe(1);
    expect(calls).toHaveLength(1);

    serve(json({ data: [{ b64_json: B64 }] }));
    const mismatch = await image({ response_format: "url" });
    expect(mismatch.status).toBe(502);
    expect(mismatch.acceptedJob.meta.jobState).toBe("completed-unusable");
  });

  it.each([
    ["empty data", json({ data: [] })],
    ["malformed base64", json({ data: [{ b64_json: "not base64!" }] })],
    ["not json", new Response("<html>oops</html>", { status: 200 })],
    ["error envelope", json({ error: { message: `echo ${KEY_A}` } })],
  ])("treats a 2xx with %s as a possibly billed failure", async (_name, answer) => {
    serve(answer);
    const result = await image();
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.acceptedJob.costSource).toBe("accepted-job");
    expect(result.acceptedJob.costStatus).toBe("unknown");
    await assertNoLeak(result);
    expect(calls).toHaveLength(1);
  });

  it("maps keyed refusals without quoting the upstream body", async () => {
    serve(leaky(401, "invalid_api_key"));
    const auth = await image();
    expect(auth.status).toBe(401);
    expect(auth.acceptedJob).toBeUndefined();
    await assertNoLeak(auth);

    serve(leaky(402, "insufficient_balance"));
    const quota = await image();
    expect(quota.status).toBe(402);
    expect(quota.quotaExhausted).toBe(true);
    await assertNoLeak(quota);

    serve(leaky(429, "rate_limited", { "retry-after": "30" }));
    const limited = await image();
    expect(limited.status).toBe(429);
    expect(limited.quotaExhausted).toBeUndefined();
    expect(limited.response.headers.get("retry-after")).toBeTruthy();

    serve(leaky(400, "bad_size"));
    const bad = await image();
    expect(bad.status).toBe(400);
    expect(await errorMessage(bad)).toContain("bad_size");
    await assertNoLeak(bad);

    serve(leaky(503, "overloaded"));
    const unknown = await image();
    expect(unknown.status).toBe(502);
    expect(unknown.acceptedJob.meta).toEqual({ jobState: "submit-unknown", authScope: "apikey" });
    await assertNoLeak(unknown);
    expect(calls).toHaveLength(5);
  });

  it("never marks the shared keyless credential as out of quota", async () => {
    serve(leaky(401, "unauthorized"));
    const unauth = await image({}, { credentials: PUBLIC_CREDENTIAL });
    expect(unauth.status).toBe(401);
    expect(await errorMessage(unauth)).toMatch(/requires an API key/);
    await assertNoLeak(unauth);

    serve(leaky(402, "insufficient_balance"));
    const paid = await image({}, { credentials: PUBLIC_CREDENTIAL });
    expect(paid.status).toBe(401);
    expect(paid.quotaExhausted).toBeUndefined();

    serve(leaky(429, "quota_exceeded"));
    const limited = await image({}, { credentials: PUBLIC_CREDENTIAL });
    expect(limited.status).toBe(429);
    expect(limited.quotaExhausted).toBeUndefined();

    serve(leaky(500, "boom"));
    const unknown = await image({}, { credentials: PUBLIC_CREDENTIAL });
    expect(unknown.acceptedJob.meta).toEqual({ jobState: "submit-unknown", authScope: "anonymous" });
    expect(calls.every((c) => c.init.headers.Authorization === undefined)).toBe(true);
  });

  it("refuses a redirect without following it, and flags a followed one", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example/" } }));
    const refused = await image();
    expect(refused.status).toBe(502);
    expect(refused.acceptedJob).toBeUndefined();

    const followed = json({ data: [{ url: IMAGE_OUT }] });
    Object.defineProperty(followed, "url", { value: "https://evil.example/v1/images/generations" });
    serve(followed);
    const foreign = await image();
    expect(foreign.status).toBe(502);
    expect(foreign.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(2);
  });

  it("separates unsent connect failures from uncertain sends and never resends", async () => {
    serve(() => Promise.reject(transportError("ECONNREFUSED")));
    const unsent = await image();
    expect(unsent.status).toBe(502);
    expect(unsent.acceptedJob).toBeUndefined();

    serve(() => Promise.reject(transportError("ECONNRESET")));
    const uncertain = await image();
    expect(uncertain.acceptedJob.meta.jobState).toBe("submit-unknown");
    await assertNoLeak(uncertain);
    expect(calls).toHaveLength(2);
  });

  it("bounds the call with a deadline and aborts the socket", async () => {
    let seen;
    serve((_url, init) => new Promise(() => { seen = init.signal; }));
    const result = await image({}, { options: { timeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("keeps the deadline armed while the answer body stalls", async () => {
    const stalled = new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "content-type": "application/json" } });
    serve(stalled);
    const result = await image({}, { options: { timeoutMs: 30 } });
    expect(result.success).toBe(false);
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
  });

  it("returns 499 on caller abort, with acceptedJob only once the request was sent", async () => {
    const before = new AbortController();
    before.abort();
    const early = await image({}, { signal: before.signal });
    expect(early.status).toBe(499);
    expect(early.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);

    const during = new AbortController();
    let seen;
    serve((_url, init) => { seen = init.signal; setTimeout(() => during.abort(), 5); return new Promise(() => {}); });
    const late = await image({}, { signal: during.signal });
    expect(late.status).toBe(499);
    expect(late.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
  });

  it("keeps each selected connection's key on its own request", async () => {
    serve(json({ data: [{ url: IMAGE_OUT }] }), json({ data: [{ url: IMAGE_OUT }] }));
    const [a, b] = await Promise.all([image({}, { credentials: { apiKey: KEY_A } }), image({}, { credentials: { apiKey: KEY_B } })]);
    expect(a.success && b.success).toBe(true);
    expect(calls.map((c) => c.init.headers.Authorization).sort()).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    expect(calls.every((c) => c.url === IMAGE_URL)).toBe(true);
  });
});
