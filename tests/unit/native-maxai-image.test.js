// MaxAI native image adapter, staged and unregistered (#2034).
// Closed mocks only: every request is answered by an injected fetch, an
// unexpected request fails the test, and every token and key is synthetic.
// Wire shapes follow OmniRoute c71f0065 (handlers/imageGeneration/providers/
// maxaiImage.ts, executors/maxai/{signing,credentials,protocol}.ts,
// config/imageRegistryData.ts). Passing here says nothing about the live service.
import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-maxai-image/index.js";
import {
  MAXAI_IMAGE_MODELS,
  buildMaxaiImageRequest,
  createMaxaiImageAdapter,
  discoverMaxaiConstants,
  extractMaxaiImageUrls,
  maxaiImageAdapter,
  resolveMaxaiImageCredential,
  resolveMaxaiImageModel,
} from "../../open-sse/services/providerParity/native-maxai-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import maxaiRegistry from "../../open-sse/providers/registry/maxai.js";
import { isFunction, isString } from "../../src/shared/utils/typeChecks.js";

const URL_IMAGE = "https://api.maxai.me/gpt/get_image_generate_response";
const WEBAPP = "https://www.maxai.co";
const TOKEN_A = "mx-SYNTHETIC-token-a-0001";
const TOKEN_B = "mx-SYNTHETIC-token-b-0002";
const CONN_A = { providerSpecificData: { maxaiAccessToken: TOKEN_A, maxaiDeviceId: "device-a", maxaiUserId: "user-a" } };
const CONN_B = { apiKey: `access_token=${TOKEN_B}; device_id=device-b; user_id=user-b` };
const CONSTANTS = Object.freeze({
  hmacKey: "a".repeat(40),
  aesKey: "b".repeat(48),
  appVersion: "webpage_9.8.7",
  ctxKey: "c".repeat(40),
});
const NOW = 1_800_000_000_000;
const SALT = Buffer.from("0011223344556677", "hex");
const PROMPT = "a silver gate in a green forest";
const PNG_A = "https://cdn.maxai.me/img/a.png";
const WEBP_B = "https://cdn.maxai.me/img/b.webp";
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-maxai-image/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const ok = (data) => json({ status: "OK", data });
const leaky = (status) => json({ detail: `upstream echo ${TOKEN_A} ${TOKEN_B} ${PROMPT}` }, status);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${TOKEN_A}`), { code }) });

let calls;
let steps;
const fetchImpl = vi.fn(async (url, init) => {
  calls.push({ url: String(url), init, body: isString(init?.body) ? init.body : undefined });
  const step = steps.shift();
  if (!step) throw new Error(`Unexpected request: ${url}`);
  return isFunction(step) ? step(String(url), init) : step;
});
const serve = (...answers) => { steps = answers; };

const adapter = (options = {}) => createMaxaiImageAdapter({
  fetchImpl, constants: CONSTANTS, now: () => NOW, random: () => "123456", salt: SALT, ...options,
});
const generate = (body = {}, { model = "gpt-image-1", credentials = CONN_A, signal, options } = {}) =>
  adapter(options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const assertNoLeak = async (result) => {
  const text = `${await result.response.clone().text()} ${result.error ?? ""}`;
  expect(text).not.toContain(TOKEN_A);
  expect(text).not.toContain(TOKEN_B);
  expect(text).not.toContain("upstream echo");
};
const posts = () => calls.filter((c) => c.init.method === "POST");

function decryptAuthorization(blob, aesKey) {
  const raw = Buffer.from(blob, "base64");
  expect(raw.subarray(0, 8).toString("ascii")).toBe("Salted__");
  const salt = raw.subarray(8, 16);
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  while (derived.length < 48) {
    block = createHash("md5").update(Buffer.concat([block, Buffer.from(aesKey), salt])).digest();
    derived = Buffer.concat([derived, block]);
  }
  const decipher = createDecipheriv("aes-256-cbc", derived.subarray(0, 32), derived.subarray(32, 48));
  return { salt, payload: Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]).toString("utf8") };
}
const expectedProof = (path, t, userId) => {
  const sha1 = createHmac("sha1", `${t}:${CONSTANTS.hmacKey}`).update(`${CONSTANTS.appVersion}:${t}:${path}:${userId}`).digest("hex");
  return createHash("sm3").update(`${t}:${sha1}:${CONSTANTS.hmacKey}`).digest("hex");
};

beforeEach(() => {
  calls = [];
  steps = [];
  fetchImpl.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// Staging-only negatives. Registration replaces this block with positive
// registry identity checks; every other block works staged or registered.
describe("staging state (isolated)", () => {
  it("stays unregistered and leaves the existing maxai chat entry unchanged", () => {
    expect(getImageAdapter("maxai")).toBeNull();
    expect(getImageAdapter("mx")).toBeNull();
    expect(maxaiRegistry.serviceKinds).toEqual(["llm"]);
    expect(maxaiRegistry.authType).toBe("cookie");
    expect(maxaiRegistry.transport.baseUrl).toBe("https://api.maxai.me/gpt/cwc/chat");
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.MAXAI_PROVIDER_ID).toBe("maxai");
    expect(staged.MAXAI_PROVIDER_ALIASES).toEqual(["mx"]);
    expect(staged.MAXAI_IMAGE_URL).toBe(URL_IMAGE);
    expect(staged.MAXAI_IMAGE_PATH).toBe("/gpt/get_image_generate_response");
    expect(staged.MAXAI_IMAGE_FORMAT).toBe("maxai-image");
    expect(MAXAI_IMAGE_MODELS.map((m) => m.id)).toEqual(["gpt-image-1", "dall-e-3", "flux-1-schnell", "flux-1-dev", "flux-1-pro", "sd3-medium"]);
    expect(staged.MAXAI_IMAGE_SIZES).toEqual(["1024x1024", "1024x1536", "1536x1024", "1024x1792", "1792x1024"]);
    expect(maxaiImageAdapter.provider).toBe("maxai");
    expect(maxaiImageAdapter.responseFormats).toEqual(["url"]);
    expect(isFunction(maxaiImageAdapter.generate)).toBe(true);
  });

  it("registration.json matches the module", () => {
    expect(REGISTRATION.issue).toBe("#2034");
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.provider.canonicalId).toBe("maxai");
    expect(REGISTRATION.provider.aliases).toEqual(["mx"]);
    expect(REGISTRATION.provider.serviceKinds).toEqual(["image"]);
    expect(REGISTRATION.models.map((m) => m.id)).toEqual(MAXAI_IMAGE_MODELS.map((m) => m.id));
    expect(REGISTRATION.endpoints.generate.url).toBe(URL_IMAGE);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
  });
});

describe("request contract", () => {
  it("builds the source body in field order with defaults", () => {
    const body = buildMaxaiImageRequest("gpt-image-1", { prompt: `  ${PROMPT} ` });
    expect(JSON.stringify(body)).toBe(JSON.stringify({ prompt: PROMPT, style: "vivid", size: "1024x1024", n: 1, model_name: "gpt-image-1" }));
    expect(buildMaxaiImageRequest("dall-e-3", { prompt: PROMPT, size: "1792x1024", n: 2, style: "natural" }))
      .toEqual({ prompt: PROMPT, style: "natural", size: "1792x1024", n: 2, model_name: "dall-e-3" });
    expect(buildMaxaiImageRequest("flux-1-dev", { prompt: PROMPT, size: "768x1344" }).size).toBe("768x1344");
  });

  it("resolves prefixes and the source model aliases", () => {
    expect(resolveMaxaiImageModel("maxai/flux-1-pro")).toBe("flux-1-pro");
    expect(resolveMaxaiImageModel("mx/dall-e-3")).toBe("dall-e-3");
    expect(resolveMaxaiImageModel("stable-diffusion-v3")).toBe("sd3-medium");
    expect(resolveMaxaiImageModel("stable-diffusion-3-medium")).toBe("sd3-medium");
    expect(resolveMaxaiImageModel("flux-1-schneil")).toBe("flux-1-schnell");
    expect(resolveMaxaiImageModel("gpt-4o")).toBeNull();
  });

  it.each([
    ["an unknown model", { }, "gpt-4o"],
    ["a size the source would snap", { size: "512x512" }, "gpt-image-1"],
    ["a dall-e-3 size outside its bucket", { size: "1024x1536" }, "dall-e-3"],
    ["a malformed size", { size: "huge" }, "flux-1-dev"],
    ["n above 4", { n: 5 }, "gpt-image-1"],
    ["a fractional n", { n: 1.5 }, "gpt-image-1"],
    ["a mask", { mask: "data:image/png;base64,AAAA" }, "gpt-image-1"],
    ["an input image", { image: "https://example.com/x.png" }, "gpt-image-1"],
    ["quality", { quality: "hd" }, "dall-e-3"],
    ["streaming", { stream: true }, "gpt-image-1"],
    ["b64_json output", { response_format: "b64_json" }, "gpt-image-1"],
    ["an empty prompt", { prompt: "  " }, "gpt-image-1"],
    ["an unsafe style", { style: "vivid\r\nX-Evil: 1" }, "gpt-image-1"],
  ])("refuses %s before signing or sending", async (_name, body, model) => {
    const result = await generate(body, { model });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe("wire contract", () => {
  it("sends the exact source URL, headers, signature and body", async () => {
    serve(ok([{ webp_url: WEBP_B, png_url: PNG_A }]));
    const result = await generate({ size: "1536x1024", n: 1 });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(URL_IMAGE);
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("manual");
    expect(call.body).toBe(JSON.stringify({ prompt: PROMPT, style: "vivid", size: "1536x1024", n: 1, model_name: "gpt-image-1" }));
    const { "X-Authorization": blob, ...rest } = call.init.headers;
    expect(rest).toEqual({
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0",
      Accept: "*/*",
      "Accept-Language": "en-CA,en;q=0.9",
      Origin: "https://www.maxai.co",
      Referer: "https://www.maxai.co/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
      "Content-Type": "application/json",
      "X-Browser-Name": "Firefox",
      "X-Browser-Version": "150.0",
      "X-Browser-Major": "150",
      "X-App-Version": "webpage_9.8.7",
      "X-App-Env": "MaxAI-Browser-Extension",
      Authorization: `Bearer ${TOKEN_A}`,
    });
    const { salt, payload: signed } = decryptAuthorization(blob, CONSTANTS.aesKey);
    expect(salt.equals(SALT)).toBe(true);
    expect(signed).toBe(JSON.stringify({
      "X-Client-Domain": "maxai.co",
      "X-Client-Path": "https://www.maxai.co/app/",
      "X-Random": "123456",
      t: NOW,
      p: expectedProof("/gpt/get_image_generate_response", NOW, "user-a"),
      d: "device-a",
      [CONSTANTS.ctxKey]: { a: "" },
    }));
  });

  it("uses each selected connection's own triple (two credentials)", async () => {
    serve(ok([{ png_url: PNG_A }]), ok([{ png_url: PNG_A }]));
    const shared = adapter();
    await shared.generate({ model: "gpt-image-1", body: { prompt: PROMPT }, credentials: CONN_A });
    await shared.generate({ model: "gpt-image-1", body: { prompt: PROMPT }, credentials: CONN_B });
    expect(calls.map((c) => c.init.headers.Authorization)).toEqual([`Bearer ${TOKEN_A}`, `Bearer ${TOKEN_B}`]);
    const [a, b] = calls.map((c) => JSON.parse(decryptAuthorization(c.init.headers["X-Authorization"], CONSTANTS.aesKey).payload));
    expect([a.d, b.d]).toEqual(["device-a", "device-b"]);
    expect(a.p).toBe(expectedProof("/gpt/get_image_generate_response", NOW, "user-a"));
    expect(b.p).toBe(expectedProof("/gpt/get_image_generate_response", NOW, "user-b"));
  });

  it("keeps the local cookie-connection precedence", () => {
    const jwt = `x.${Buffer.from(JSON.stringify({ subject: { user_id: "jwt-user" } })).toString("base64url")}.y`;
    expect(resolveMaxaiImageCredential({ accessToken: jwt, providerSpecificData: { deviceId: "\"dev\"" } }))
      .toEqual({ token: jwt, deviceId: "dev", userId: "jwt-user" });
    expect(resolveMaxaiImageCredential({ apiKey: "access_token=t; device_id=d; user_id=u", providerSpecificData: { maxaiAccessToken: "psd" } }))
      .toEqual({ token: "psd", deviceId: "d", userId: "u" });
    expect(resolveMaxaiImageCredential({ apiKey: "access_token=t" })).toBeNull();
    expect(resolveMaxaiImageCredential({ providerSpecificData: { accessToken: "t\r\nX: y", deviceId: "d", userId: "u" } })).toBeNull();
  });

  it("refuses a connection without the full triple before any request", async () => {
    const result = await generate({}, { credentials: { apiKey: `access_token=${TOKEN_A}` } });
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
    await assertNoLeak(result);
  });
});

describe("success normalization", () => {
  it("prefers png_url, then webp_url, then url; reports returned images with unknown cost", async () => {
    serve(ok([{ png_url: PNG_A, webp_url: "https://cdn.maxai.me/a.webp" }, { webp_url: WEBP_B }, { url: "https://cdn.maxai.me/c.jpg" }, { png_url: PNG_A }]));
    const result = await generate({ n: 3 });
    expect(result.success).toBe(true);
    const body = await payload(result);
    expect(body.created).toBe(Math.floor(NOW / 1000));
    expect(body.data).toEqual([{ url: PNG_A }, { url: WEBP_B }, { url: "https://cdn.maxai.me/c.jpg" }]);
    expect(result.accounting.nativeUnits.images).toBe(3);
    expect(result.accounting.cost).toBeNull();
    expect(result.accounting.costStatus).toBe("unknown");
    expect(result.accounting.modality).toBe("image");
  });

  it("drops unsafe result URLs and never fetches them", async () => {
    const { urls, unsafe } = extractMaxaiImageUrls({ data: [
      { png_url: "http://cdn.maxai.me/a.png" }, { png_url: "https://127.0.0.1/a.png" },
      { png_url: "https://user:pw@cdn.maxai.me/a.png" }, { png_url: "javascript:alert(1)" }, { png_url: PNG_A },
    ] });
    expect(urls).toEqual([PNG_A]);
    expect(unsafe).toBe(4);
    serve(ok([{ png_url: "https://169.254.169.254/latest" }]));
    const result = await generate();
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.acceptedJob.costSource).toBe("accepted-job");
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["status other than OK", () => json({ status: "ERROR", data: [{ png_url: PNG_A }], message: `upstream echo ${TOKEN_A}` })],
    ["no images", () => ok([])],
    ["non-JSON", () => new Response(`upstream echo ${TOKEN_A}`, { status: 200 })],
  ])("treats a 2xx with %s as an unknown, possibly billed outcome", async (_name, answer) => {
    serve(answer());
    const result = await generate();
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });
});

describe("refused answers and quota", () => {
  it.each([
    [401, 401], [403, 403], [418, 401], [400, 400], [404, 404],
  ])("maps %i to %i without acceptedJob or upstream text", async (status, expected) => {
    serve(leaky(status));
    const result = await generate();
    expect(result.status).toBe(expected);
    expect(result.acceptedJob).toBeUndefined();
    expect(result.quotaExhausted).toBeUndefined();
    await assertNoLeak(result);
  });

  it("marks 402 as quota exhausted for this connection only", async () => {
    serve(leaky(402));
    const result = await generate();
    expect(result.status).toBe(402);
    expect(result.quotaExhausted).toBe(true);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("keeps a bounded Retry-After on 429", async () => {
    serve(json({ detail: "slow down" }, 429, { "retry-after": "30" }));
    const result = await generate();
    expect(result.status).toBe(429);
    expect(result.response.headers.get("Retry-After")).toBe("30");
    expect(result.acceptedJob).toBeUndefined();
  });

  it("treats 5xx as an unknown outcome and never resends", async () => {
    serve(leaky(500), ok([{ png_url: PNG_A }]));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(posts()).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("refuses a redirect without following it or sending the token again", async () => {
    serve(new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    const result = await generate();
    expect(result.status).toBe(401);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("treats an answer from another origin as possibly billed", async () => {
    const foreign = ok([{ png_url: PNG_A }]);
    Object.defineProperty(foreign, "url", { value: "https://other.example/x" });
    serve(foreign);
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });
});

describe("transport, cancellation and deadlines", () => {
  it("a pre-connect failure was not sent and has no acceptedJob", async () => {
    serve(() => { throw transportError("ECONNREFUSED"); });
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("a mid-flight disconnect is uncertain, carries acceptedJob and is not replayed", async () => {
    serve(() => { throw transportError("ECONNRESET"); }, ok([{ png_url: PNG_A }]));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("the submit deadline aborts the socket and reports an uncertain outcome", async () => {
    let seen;
    serve((_url, init) => { seen = init.signal; return new Promise(() => {}); });
    const result = await generate({}, { options: { submitTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("the total deadline bounds the submit after slow discovery", async () => {
    let clock = NOW;
    const result = await createMaxaiImageAdapter({
      fetchImpl, now: () => clock, timeoutMs: 1000,
      discover: async () => { clock += 5000; return CONSTANTS; },
    }).generate({ model: "gpt-image-1", body: { prompt: PROMPT }, credentials: CONN_A });
    expect(result.status).toBe(504);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("a caller abort mid-flight aborts the request and keeps acceptedJob", async () => {
    const controller = new AbortController();
    let seen;
    serve((_url, init) => { seen = init.signal; setTimeout(() => controller.abort(), 5); return new Promise(() => {}); });
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("an abort before send sends nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe("signing-constants discovery", () => {
  const HTML = `<script src="/_next/static/chunks/pages/_app-abc123.js"></script>
    <script src="/_next/static/chunks/111-deadbe.js"></script><script src="/_next/static/chunks/222-feedfa.js"></script>
    <script src="https://evil.example/_next/static/chunks/333-aaaaaa.js"></script>`;
  const APP = `x={Mn:function(){return Qa},Rl:function(){return Qb}};var Qa="${CONSTANTS.hmacKey}",Qb="${CONSTANTS.aesKey}";v="${CONSTANTS.appVersion}"`;
  const OTHER = "console.log(1)";
  const SIGNER = `(0,r.nj)("abc123");var m={"${CONSTANTS.ctxKey}":{a:""}}`;
  const text = (body) => new Response(body, { status: 200 });
  const bundle = () => [text(HTML), text(APP), text(OTHER), text(SIGNER)];

  it("reads the public bundle on the fixed origin without credentials, then memoizes", async () => {
    serve(...bundle(), ok([{ png_url: PNG_A }]), ok([{ png_url: PNG_A }]));
    const shared = createMaxaiImageAdapter({ fetchImpl, now: () => NOW, random: () => "123456", salt: SALT });
    expect((await shared.generate({ model: "flux-1-dev", body: { prompt: PROMPT }, credentials: CONN_A })).success).toBe(true);
    expect((await shared.generate({ model: "flux-1-dev", body: { prompt: PROMPT }, credentials: CONN_B })).success).toBe(true);
    const gets = calls.filter((c) => c.init.method === "GET");
    expect(gets.map((c) => c.url)).toEqual([
      `${WEBAPP}/app/`, `${WEBAPP}/_next/static/chunks/pages/_app-abc123.js`,
      `${WEBAPP}/_next/static/chunks/111-deadbe.js`, `${WEBAPP}/_next/static/chunks/222-feedfa.js`,
    ]);
    for (const get of gets) {
      expect(get.init.redirect).toBe("manual");
      expect(JSON.stringify(get.init.headers)).not.toMatch(/Authorization|Cookie|SYNTHETIC/i);
    }
    expect(posts()).toHaveLength(2);
    const signed = JSON.parse(decryptAuthorization(posts()[0].init.headers["X-Authorization"], CONSTANTS.aesKey).payload);
    expect(signed[CONSTANTS.ctxKey]).toEqual({ a: "" });
  });

  it("uses a connection's saved constants without discovery", async () => {
    serve(ok([{ png_url: PNG_A }]));
    const credentials = { providerSpecificData: { ...CONN_A.providerSpecificData, maxaiSigningConstants: CONSTANTS } };
    const result = await createMaxaiImageAdapter({ fetchImpl, now: () => NOW }).generate({ model: "gpt-image-1", body: { prompt: PROMPT }, credentials });
    expect(result.success).toBe(true);
    expect(calls.map((c) => c.init.method)).toEqual(["POST"]);
  });

  it("a redirected or malformed bundle signs nothing and sends no POST", async () => {
    serve(new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    const result = await createMaxaiImageAdapter({ fetchImpl }).generate({ model: "gpt-image-1", body: { prompt: PROMPT }, credentials: CONN_A });
    expect(result.status).toBe(401);
    expect(posts()).toHaveLength(0);
    serve(text(HTML), text("no getters here"));
    expect(await discoverMaxaiConstants({ fetchImpl })).toBeNull();
  });

  it("discovery follows the caller's abort and per-request deadline", async () => {
    const controller = new AbortController();
    serve((_url, init) => { setTimeout(() => controller.abort(), 5); return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))); });
    const result = await createMaxaiImageAdapter({ fetchImpl }).generate({ model: "gpt-image-1", body: { prompt: PROMPT }, credentials: CONN_A, signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(posts()).toHaveLength(0);

    let seen;
    serve((_url, init) => { seen = init.signal; return new Promise(() => {}); });
    expect(await discoverMaxaiConstants({ fetchImpl, requestTimeoutMs: 20 })).toBeNull();
    expect(seen.aborted).toBe(true);
  });
});
