// Ideogram native image adapter, staged and unregistered (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every key is synthetic. Wire shapes follow OmniRoute
// c71f0065 (imageRegistryData.ts `ideogram`, imageGeneration.ts format
// dispatch, imageGeneration/providers/ideogram.ts, imageGeneration/fanOut.ts).
// Result URLs use a literal public IP so the local image fetch resolves them
// without DNS. Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-ideogram-image/index.js";
import {
  IDEOGRAM_IMAGE_MODELS,
  buildIdeogramImageRequest,
  createIdeogramImageAdapter,
  ideogramImageAdapter,
} from "../../open-sse/services/providerParity/native-ideogram-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import ideogramRegistry from "../../open-sse/providers/registry/ideogram.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://api.ideogram.ai";
const IMAGE_URL = `${ORIGIN}/generate`;
const KEY_A = "ideo-SYNTHETIC-key-a-0001";
const KEY_B = "ideo-SYNTHETIC-key-b-0002";
const PROMPT = "a stone gate in an emerald forest";
const RESULT_URL = "https://8.8.8.8/ideogram/ephemeral/out.png";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);
const PNG_B64 = PNG.toString("base64");
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-ideogram-image/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, code, headers = {}) =>
  json({ error: { code, message: `upstream echo ${KEY_A} ${PROMPT}` }, detail: `upstream echo ${KEY_A}` }, status, headers);
const generated = (url = RESULT_URL) => json({ created: "2026-11-27T00:00:00Z", data: [{ url, prompt: PROMPT, resolution: "1312x736", is_image_safe: true, seed: 7 }] });
const png = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });

const originalFetch = global.fetch;
let calls;
let submits;
let downloads;

// POSTs to the Ideogram endpoint and GETs of result URLs are answered from separate queues.
function serve({ submit = [], download = [] } = {}) {
  submits = [...submit];
  downloads = [...download];
  global.fetch = vi.fn(async (url, init) => {
    const target = String(url);
    const isSubmit = init?.method === "POST";
    calls.push({ kind: isSubmit ? "submit" : "download", url: target, init, body: isSubmit && init?.body ? JSON.parse(init.body) : undefined });
    const step = (isSubmit ? submits : downloads).shift();
    if (!step) throw new Error(`Unexpected request: ${target}`);
    return isFunction(step) ? step(target, init) : step;
  });
}
const submitCalls = () => calls.filter((call) => call.kind === "submit");
const downloadCalls = () => calls.filter((call) => call.kind === "download");

const image = (body = {}, { model = "V_3", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createIdeogramImageAdapter(options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
  expect(JSON.stringify(result.acceptedJob ?? {})).not.toContain(KEY_A);
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
  it("stays unregistered and leaves the existing hidden ideogram entry unchanged", () => {
    expect(getImageAdapter("ideogram")).toBeFalsy();
    expect(getImageAdapter("ideo")).toBeFalsy();
    expect(ideogramRegistry.serviceKinds).toEqual([]);
    expect(ideogramRegistry.hiddenKinds).toEqual(["image"]);
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields and keeps the existing connection mode", () => {
    expect(staged.IDEOGRAM_PROVIDER_ID).toBe("ideogram");
    expect(staged.IDEOGRAM_ALIASES).toEqual(["ideo"]);
    expect(staged.IDEOGRAM_IMAGE_URL).toBe(IMAGE_URL);
    expect(staged.IDEOGRAM_ORIGIN).toBe(ORIGIN);
    expect(staged.IDEOGRAM_AUTH_HEADER).toBe("Api-Key");
    expect(staged.IDEOGRAM_IMAGE_FORMAT).toBe("ideogram-image");
    expect(IDEOGRAM_IMAGE_MODELS.map((m) => [m.id, m.name])).toEqual([["V_3", "Ideogram V3"], ["V_2A", "Ideogram V2A"]]);
    expect(staged.IDEOGRAM_REGISTRY_SIZES).toEqual(["1024x1024", "1024x1792", "1792x1024"]);
    expect(staged.IDEOGRAM_IMAGE_SIZES).toEqual(["1792x1024"]);
    expect(staged.IDEOGRAM_ASPECT_RATIO).toBe("ASPECT_16_9");
    expect(ideogramImageAdapter.provider).toBe("ideogram");
    expect(ideogramImageAdapter.responseFormats).toEqual(["b64_json"]);
    expect(ideogramImageAdapter.defaultResponseFormat).toBe("b64_json");
    expect(isFunction(ideogramImageAdapter.generate)).toBe(true);
    // The existing provider row: same id, alias, auth mode, header and models.
    expect(ideogramRegistry.id).toBe("ideogram");
    expect(ideogramRegistry.alias).toBe("ideo");
    expect(ideogramRegistry.authType).toBe("apikey");
    expect(ideogramRegistry.imageConfig.authHeader).toBe("Api-Key");
    expect(new URL(ideogramRegistry.imageConfig.baseUrl).origin).toBe(ORIGIN);
    expect(ideogramRegistry.models.map((m) => m.id)).toEqual(IDEOGRAM_IMAGE_MODELS.map((m) => m.id));
  });

  it("describes the same ids, models and endpoints in registration.json", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.provider.canonicalId).toBe("ideogram");
    expect(REGISTRATION.provider.aliases).toEqual(["ideo"]);
    expect(REGISTRATION.provider.addServiceKinds).toEqual(["image"]);
    expect(REGISTRATION.provider.authModes).toEqual(["apikey"]);
    expect(REGISTRATION.provider.auth.header).toBe("Api-Key");
    expect(REGISTRATION.models.image.map((m) => m.id)).toEqual(IDEOGRAM_IMAGE_MODELS.map((m) => m.id));
    expect(REGISTRATION.endpoints.image.url).toBe(IMAGE_URL);
    expect(REGISTRATION.responseFormats.image).toEqual(["b64_json"]);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged).toHaveProperty(name);
  });
});

describe("image request contract", () => {
  it("sends the source body with the Api-Key header to the fixed endpoint, then downloads the result", async () => {
    serve({ submit: [generated()], download: [png()] });
    const result = await image({ size: "1792x1024", response_format: "b64_json" });
    expect(result.success).toBe(true);
    expect(submitCalls()).toHaveLength(1);
    const [submit] = submitCalls();
    expect(submit.url).toBe(IMAGE_URL);
    expect(submit.init.method).toBe("POST");
    expect(submit.init.redirect).toBe("manual");
    expect(submit.init.headers).toEqual({ "Content-Type": "application/json", "Api-Key": KEY_A });
    expect(submit.body).toEqual({ prompt: PROMPT, aspect_ratio: "ASPECT_16_9", model: "V_3" });

    expect(downloadCalls()).toHaveLength(1);
    const [download] = downloadCalls();
    expect(download.url).toBe(RESULT_URL);
    expect(download.init.redirect).toBe("manual");
    expect(download.init.headers).toBeUndefined();

    const body = await payload(result);
    expect(body.data).toEqual([{ b64_json: PNG_B64 }]);
    expect(Number.isInteger(body.created)).toBe(true);
    expect(result.accounting.nativeUnits.images).toBe(1);
    expect(result.accounting.costStatus).toBe("unknown");
    expect(result.accounting.cost).toBeNull();
  });

  it("uses the source default model and keeps V_2A verbatim", () => {
    expect(buildIdeogramImageRequest("", { prompt: "x" })).toEqual({ request: { prompt: "x", aspect_ratio: "ASPECT_16_9", model: "V_3" }, count: 1 });
    expect(buildIdeogramImageRequest("V_2A", { prompt: "x", aspect_ratio: "16:9", n: 2 }))
      .toEqual({ request: { prompt: "x", aspect_ratio: "ASPECT_16_9", model: "V_2A" }, count: 2 });
  });

  it.each([
    [{ prompt: "" }, /text prompt/],
    [{ prompt: 42 }, /text prompt/],
    [{ size: "1024x1024" }, /size must be one of: 1792x1024/],
    [{ size: "1024x1792" }, /size must be one of/],
    [{ aspect_ratio: "1:1" }, /aspect_ratio/],
    [{ n: 0 }, /n must be/],
    [{ n: 11 }, /n must be/],
    [{ n: 1.5 }, /n must be/],
    [{ response_format: "url" }, /response_format b64_json only/],
    [{ response_format: "binary" }, /response_format/],
    [{ stream: true }, /streaming/],
    [{ image_url: "https://example.com/a.png" }, /text-to-image only/],
    [{ image: "data:image/png;base64,aGk=" }, /text-to-image only/],
    [{ mask: "https://example.com/m.png" }, /text-to-image only/],
    [{ messages: [{ content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] }] }, /text-to-image only/],
    [{ quality: "hd" }, /quality/],
    [{ style: "vivid" }, /style/],
    [{ seed: 7 }, /seed/],
    [{ negative_prompt: "blur" }, /negative_prompt/],
    [{ output_format: "jpeg" }, /output_format/],
  ])("refuses %j before anything is sent", async (extra, message) => {
    const result = await image(extra);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses unknown models and a missing or unsafe key before sending", async () => {
    expect((await image({}, { model: "V_2" })).status).toBe(400);
    expect((await image({}, { model: "ideogram-4" })).status).toBe(400);
    expect((await image({}, { credentials: {} })).status).toBe(401);
    // The source reads apiKey only; an OAuth-style token is not an Ideogram key.
    expect((await image({}, { credentials: { accessToken: KEY_B } })).status).toBe(401);
    expect((await image({}, { credentials: { apiKey: "a\r\nX-Evil: 1" } })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("fans n out into independent single-image calls, like SINGLE_IMAGE_FANOUT_FORMATS", async () => {
    serve({ submit: [generated(), generated(), generated()], download: [png(), png(), png()] });
    const result = await image({ n: 3 });
    expect(result.success).toBe(true);
    expect(submitCalls()).toHaveLength(3);
    for (const call of submitCalls()) expect(call.body).toEqual({ prompt: PROMPT, aspect_ratio: "ASPECT_16_9", model: "V_3" });
    expect((await payload(result)).data).toHaveLength(3);
    expect(result.accounting.nativeUnits.images).toBe(3);
  });
});

describe("image outputs and failures", () => {
  it.each([
    ["empty data", json({ data: [] }), "completed-unusable"],
    ["no data", json({ created: "x" }), "completed-unusable"],
    ["http url", generated("http://8.8.8.8/x.png"), "completed-unusable"],
    ["private host", generated("https://127.0.0.1/x.png"), "completed-unusable"],
    ["metadata host", generated("https://169.254.169.254/latest/meta-data"), "completed-unusable"],
    ["userinfo url", generated("https://u:p@8.8.8.8/x.png"), "completed-unusable"],
    ["not a url", generated("javascript:alert(1)"), "completed-unusable"],
    ["not json", new Response("<html>oops</html>", { status: 200 }), "completed-unread"],
    ["error envelope", json({ error: { message: `echo ${KEY_A}` } }), "completed-unusable"],
  ])("treats a 2xx with %s as a possibly billed failure and never downloads", async (_name, answer, jobState) => {
    serve({ submit: [answer] });
    const result = await image();
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.acceptedJob.costSource).toBe("accepted-job");
    expect(result.acceptedJob.costStatus).toBe("unknown");
    expect(result.acceptedJob.meta.jobState).toBe(jobState);
    await assertNoLeak(result);
    expect(submitCalls()).toHaveLength(1);
    expect(downloadCalls()).toHaveLength(0);
  });

  it.each([
    ["a non-image body", () => new Response("<html>not an image</html>", { status: 200, headers: { "content-type": "image/png" } })],
    ["a refused download", () => new Response("gone", { status: 404 })],
    ["a redirect", () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } })],
  ])("refuses a result download that returns %s, without following it or resubmitting", async (_name, answer) => {
    serve({ submit: [generated()], download: [answer()] });
    const result = await image();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
    expect(await errorMessage(result)).toMatch(/downloaded safely/);
    expect(submitCalls()).toHaveLength(1);
    expect(downloadCalls()).toHaveLength(1);
  });

  it("maps refusals without quoting the upstream body", async () => {
    serve({ submit: [leaky(401, "UNAUTHORIZED")] });
    const auth = await image();
    expect(auth.status).toBe(401);
    expect(auth.acceptedJob).toBeUndefined();
    await assertNoLeak(auth);

    serve({ submit: [leaky(402, "insufficient_credits")] });
    const quota = await image();
    expect(quota.status).toBe(402);
    expect(quota.quotaExhausted).toBe(true);
    await assertNoLeak(quota);

    serve({ submit: [leaky(429, "rate_limited", { "retry-after": "30" })] });
    const limited = await image();
    expect(limited.status).toBe(429);
    expect(limited.quotaExhausted).toBeUndefined();
    expect(limited.response.headers.get("retry-after")).toBeTruthy();
    await assertNoLeak(limited);

    serve({ submit: [leaky(422, "prompt_failed_safety")] });
    const unsafe = await image();
    expect(unsafe.status).toBe(422);
    expect(await errorMessage(unsafe)).toContain("prompt_failed_safety");
    await assertNoLeak(unsafe);

    serve({ submit: [leaky(503, "overloaded")] });
    const unknown = await image();
    expect(unknown.status).toBe(502);
    expect(unknown.acceptedJob.meta.jobState).toBe("submit-unknown");
    await assertNoLeak(unknown);
    expect(downloadCalls()).toHaveLength(0);
  });

  it("refuses a redirect without following it, and flags a followed one", async () => {
    serve({ submit: [new Response(null, { status: 307, headers: { location: "https://evil.example/" } })] });
    const refused = await image();
    expect(refused.status).toBe(502);
    expect(refused.acceptedJob).toBeUndefined();

    const followed = generated();
    Object.defineProperty(followed, "url", { value: "https://evil.example/generate" });
    serve({ submit: [followed] });
    const foreign = await image();
    expect(foreign.status).toBe(502);
    expect(foreign.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(submitCalls()).toHaveLength(2);
    expect(downloadCalls()).toHaveLength(0);
  });

  it("separates unsent connect failures from uncertain sends and never resends", async () => {
    serve({ submit: [() => Promise.reject(transportError("ECONNREFUSED"))] });
    const unsent = await image();
    expect(unsent.status).toBe(502);
    expect(unsent.acceptedJob).toBeUndefined();

    serve({ submit: [() => Promise.reject(transportError("ECONNRESET"))] });
    const uncertain = await image({ n: 2 });
    expect(uncertain.acceptedJob.meta.jobState).toBe("submit-unknown");
    await assertNoLeak(uncertain);
    expect(submitCalls()).toHaveLength(2);
  });

  it("stops the fan-out at the first failure and accounts the calls that already ran", async () => {
    serve({ submit: [generated(), leaky(429, "rate_limited")], download: [png()] });
    const result = await image({ n: 3 });
    expect(result.status).toBe(429);
    expect(result.acceptedJob.meta).toMatchObject({ jobState: "partial-completed", completedCalls: 1, requestedCalls: 3 });
    expect(result.acceptedJob.costStatus).toBe("unknown");
    await assertNoLeak(result);
    expect(submitCalls()).toHaveLength(2);
  });

  it("bounds one call with a deadline and aborts the socket", async () => {
    let seen;
    serve({ submit: [(_url, init) => new Promise(() => { seen = init.signal; })] });
    const result = await image({}, { options: { callTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
    expect(submitCalls()).toHaveLength(1);
  });

  it("keeps the deadline armed while the answer body stalls", async () => {
    const stalled = new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "content-type": "application/json" } });
    serve({ submit: [stalled] });
    const result = await image({}, { options: { callTimeoutMs: 30 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
  });

  it("bounds the result download by the same call deadline", async () => {
    let seen;
    serve({ submit: [generated()], download: [(_url, init) => new Promise((_, reject) => {
      seen = init.signal;
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    })] });
    const result = await image({}, { options: { callTimeoutMs: 80 } });
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
    expect(seen.aborted).toBe(true);
  });

  it("stops a fan-out at the total deadline without starting another call", async () => {
    let clock = 0;
    serve({ submit: [generated(), generated()], download: [() => { clock += 2_000; return png(); }, png()] });
    const result = await image({ n: 3 }, { options: { totalTimeoutMs: 1_500, now: () => clock } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta).toMatchObject({ jobState: "partial-completed", completedCalls: 1, requestedCalls: 3 });
    expect(submitCalls()).toHaveLength(1);
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
    serve({ submit: [(_url, init) => { seen = init.signal; setTimeout(() => during.abort(), 5); return new Promise(() => {}); }] });
    const late = await image({}, { signal: during.signal });
    expect(late.status).toBe(499);
    expect(late.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);

    const download = new AbortController();
    serve({ submit: [generated()], download: [(_url, init) => { setTimeout(() => download.abort(), 5); return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })); }] });
    const unread = await image({}, { signal: download.signal });
    expect(unread.status).toBe(499);
    expect(unread.acceptedJob.meta.jobState).toBe("completed-unread");
  });

  it("keeps each selected connection's key on its own request", async () => {
    serve({ submit: [generated(), generated()], download: [png(), png()] });
    const [a, b] = await Promise.all([image({}, { credentials: { apiKey: KEY_A } }), image({}, { credentials: { apiKey: KEY_B } })]);
    expect(a.success && b.success).toBe(true);
    expect(submitCalls().map((c) => c.init.headers["Api-Key"]).sort()).toEqual([KEY_A, KEY_B]);
    expect(submitCalls().every((c) => c.url === IMAGE_URL)).toBe(true);
    expect(downloadCalls().every((c) => !JSON.stringify(c.init.headers ?? {}).includes("ideo-SYNTHETIC"))).toBe(true);

    serve({ submit: [leaky(401, "UNAUTHORIZED")] });
    const refusedB = await image({}, { credentials: { apiKey: KEY_B } });
    expect(refusedB.status).toBe(401);
    await assertNoLeak(refusedB);
  });
});
