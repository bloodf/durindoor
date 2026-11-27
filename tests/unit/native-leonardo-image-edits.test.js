// Leonardo.Ai native reference-image edits, staged and unregistered (#2034).
// Closed mocks only: every Leonardo request is answered by the global fetch
// mock below, every storage request by an injected storageFetch, every DNS
// answer by an injected lookup; an unexpected request fails the test and every
// key, URL and signature is synthetic. Wire shapes follow OmniRoute c71f0065
// (imageGeneration/providers/leonardo.ts uploadLeonardoInitImage and
// handleLeonardoImageGeneration initImage). Passing here says nothing about
// the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-leonardo-image-edits/index.js";
import {
  LEONARDO_EDIT_INIT_STRENGTH,
  LEONARDO_INIT_IMAGE_URL,
  checkLeonardoStorageUrl,
  createLeonardoImageEditAdapter,
  createLeonardoStorageConnector,
  leonardoImageEditAdapter,
  parseLeonardoEditRequest,
  parseLeonardoUploadTicket,
} from "../../open-sse/services/providerParity/native-leonardo-image-edits/index.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const API = "https://cloud.leonardo.ai/api/rest/v1";
const INIT = `${API}/init-image`;
const SUBMIT = `${API}/generations`;
const status = (id) => `${API}/generations/${id}`;
const PHOENIX = "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3";
const SDXL = "16e7060a-803e-4df3-97ee-edcfa5dc9cc8";
const KEY_A = "leo-SYNTHETIC-key-a-0001";
const KEY_B = "leo-SYNTHETIC-key-b-0002";
const PROMPT = "make the boat red";
const IMG = "https://cdn.leonardo.ai/users/u/generations/g/edit.png";
const STORAGE = "https://synthetic-bucket.s3-accelerate.amazonaws.com/";
const STORAGE_IP = "52.216.1.2";
const SIGNATURE = "SYNTHETIC-SIGNATURE-c0ffee";
const FIELDS = { "Content-Type": "image/png", key: "u/init-1.png", policy: "U1lOVEhFVElD", "x-amz-signature": SIGNATURE };
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-leonardo-image-edits/registration.json", import.meta.url), "utf8"));

const bytes = (...head) => new Uint8Array([...head, ...new Array(32).fill(7)]);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
const dataUri = (data, mime) => `data:${mime};base64,${Buffer.from(data).toString("base64")}`;

const json = (value, code = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status: code, headers: { "content-type": "application/json", ...headers } });
const leaky = (code, vendor) => json({ error: `upstream echo ${KEY_A} ${SIGNATURE} ${STORAGE}`, code: vendor }, code);
const ticket = ({ id = "init-1", url = STORAGE, fields = JSON.stringify(FIELDS) } = {}) => json({ uploadInitImage: { id, url, fields, key: "u/init-1.png" } });
const imageJob = (id = "gen-1") => json({ sdGenerationJob: { generationId: id, apiCreditCost: 8 } });
const generation = (fields) => json({ generations_by_pk: fields });
const done = (id = "gen-1", url = IMG) => generation({ id, status: "COMPLETE", generated_images: [{ url }] });
const pending = (id = "gen-1") => generation({ id, status: "PENDING", generated_images: [] });
const noContent = () => new Response(null, { status: 204 });

const originalFetch = global.fetch;
let calls;
let storageCalls;
let lookups;
let clock;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : undefined });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected Leonardo request: ${url}`);
    return isFunction(step) ? step(String(url), init) : step;
  });
}

function storage(...steps) {
  return vi.fn(async (url, init) => {
    storageCalls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected storage request: ${url}`);
    return isFunction(step) ? step(String(url), init) : step;
  });
}

const publicLookup = (address = STORAGE_IP) => vi.fn(async (host, options) => {
  lookups.push({ host, options });
  return [{ address, family: address.includes(":") ? 6 : 4 }];
});

// A request that never answers; it rejects only when its signal aborts.
const stalled = (_url, init) => new Promise((_, rejectWait) => {
  init.signal.addEventListener("abort", () => rejectWait(init.signal.reason), { once: true });
});

const testOptions = (extra = {}) => ({
  pollIntervalMs: 5_000,
  timeoutMs: 300_000,
  wait: async (ms, signal) => {
    signal?.throwIfAborted();
    clock += ms;
  },
  now: () => clock,
  storageFetch: storage(noContent()),
  lookup: publicLookup(),
  ...extra,
});

function form({ image = new Blob([PNG], { type: "image/png" }), fields = {}, extra = [] } = {}) {
  const data = new FormData();
  data.append("model", "phoenix");
  data.append("prompt", PROMPT);
  if (image) data.append("image", image, "boat.png");
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  for (const [key, value, name] of extra) data.append(key, value, name);
  return data;
}

const edit = ({ formData = form(), jsonBody = null, model = "phoenix", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createLeonardoImageEditAdapter(options ?? testOptions()).edit({ model, formData: jsonBody ? null : formData, jsonBody, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  for (const secret of [KEY_A, KEY_B, SIGNATURE, "synthetic-bucket", "U1lOVEhFVElD", "upstream echo"]) expect(text).not.toContain(secret);
};
const storageForm = (call) =>
  new Response(call.init.body, { headers: { "content-type": call.init.headers["Content-Type"] } }).formData();

beforeEach(() => {
  calls = [];
  storageCalls = [];
  lookups = [];
  clock = 1_000_000;
  serve();
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Staging-only negative. Registration replaces this block with a positive
// dispatch check; every other block works staged or registered.
describe("staging state (isolated)", () => {
  it("is not imported by the public edit entry points", () => {
    for (const file of ["../../src/sse/handlers/imageEdit.js", "../../open-sse/handlers/imageEditCore.js"]) {
      expect(readFileSync(new URL(file, import.meta.url), "utf8")).not.toContain("native-leonardo-image-edits");
    }
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the source init-image constants and the adapter contract", () => {
    expect(LEONARDO_INIT_IMAGE_URL).toBe(INIT);
    expect(LEONARDO_EDIT_INIT_STRENGTH).toBe(0.3);
    expect(isFunction(leonardoImageEditAdapter.edit)).toBe(true);
    expect(leonardoImageEditAdapter.provider).toBe("leonardo");
    expect(leonardoImageEditAdapter.responseFormats).toEqual(["url"]);
    expect(leonardoImageEditAdapter.maxReferenceImages).toBe(1);
    expect(leonardoImageEditAdapter.supportsMask).toBe(false);
    expect(leonardoImageEditAdapter.models.map((m) => m.id)).toEqual(["phoenix", "sdxl"]);
  });

  it("registration.json matches the exports and the source pin", () => {
    expect(REGISTRATION.issue).toBe("#2034");
    expect(REGISTRATION.registrationBatch).toBe("batch03");
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(REGISTRATION.endpoints.initImage.url).toBe(INIT);
    expect(REGISTRATION.endpoints.generation.url).toBe(SUBMIT);
    expect(REGISTRATION.edit.initStrength).toBe(LEONARDO_EDIT_INIT_STRENGTH);
    expect(REGISTRATION.endpoints.storageUpload.leonardoKey).toBe(false);
  });
});

describe("edit flow contract", () => {
  it("requests a ticket, uploads the pre-encoded form without the key, then generates with the init image", async () => {
    serve(ticket(), imageJob(), done());
    const options = testOptions();
    const result = await edit({ formData: form({ fields: { size: "576x1024" } }), options });
    expect(result.success).toBe(true);
    expect(await payload(result)).toEqual({ created: expect.any(Number), data: [{ url: IMG }] });
    expect(result.initImageId).toBe("init-1");
    expect(result.generationId).toBe("gen-1");
    expect(result.acceptedJob).toBeUndefined();

    expect(calls.map((c) => c.url)).toEqual([INIT, SUBMIT, status("gen-1")]);
    const [init, submit, poll] = calls;
    expect(init.init.method).toBe("POST");
    expect(init.init.redirect).toBe("manual");
    expect(init.init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(init.body).toEqual({ extension: "png" });
    expect(submit.init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(submit.body).toEqual({
      modelId: PHOENIX, prompt: PROMPT, width: 576, height: 1024, num_images: 1, init_image_id: "init-1", init_strength: 0.3,
    });
    expect(poll.init.headers).toEqual({ Authorization: `Bearer ${KEY_A}` });

    expect(storageCalls).toHaveLength(1);
    const [upload] = storageCalls;
    expect(upload.url).toBe(STORAGE);
    expect(upload.init.method).toBe("POST");
    expect(upload.init.redirect).toBe("manual");
    expect(Object.keys(upload.init.headers)).toEqual(["Content-Type"]);
    expect(upload.init.headers["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(JSON.stringify(upload.init.headers)).not.toContain(KEY_A);
    expect(upload.init.body).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(upload.init.body).toString("latin1")).not.toContain(KEY_A);
    expect(upload.init.dispatcher).toBeDefined();
    expect(upload.init.signal).toBeInstanceOf(AbortSignal);
    expect(options.lookup).toHaveBeenCalledTimes(1);
    expect(lookups[0]).toEqual({ host: "synthetic-bucket.s3-accelerate.amazonaws.com", options: { all: true, verbatim: true } });
  });

  it("encodes the source form: every ticket field in order, then file named init with the sniffed type", async () => {
    serve(ticket(), imageJob(), done());
    await edit();
    const parsed = await storageForm(storageCalls[0]);
    expect([...parsed.keys()]).toEqual([...Object.keys(FIELDS), "file"]);
    for (const [name, value] of Object.entries(FIELDS)) expect(parsed.get(name)).toBe(value);
    const file = parsed.get("file");
    expect(file.name).toBe("init");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
  });

  it.each([
    ["JPEG", JPEG, "image/jpeg", "jpg"],
    ["WebP", WEBP, "image/webp", "webp"],
  ])("accepts a %s data: URI JSON reference", async (_name, data, mime, extension) => {
    serve(ticket(), imageJob(), done());
    const result = await edit({ jsonBody: { model: "sdxl", prompt: PROMPT, image: dataUri(data, mime) }, model: "sdxl" });
    expect(result.success).toBe(true);
    expect(calls[0].body).toEqual({ extension });
    expect(calls[1].body.modelId).toBe(SDXL);
    const file = (await storageForm(storageCalls[0])).get("file");
    expect(file.type).toBe(mime);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(data);
  });

  it("accepts images: [one] and { url: data: } and an octet-stream upload sniffed as PNG", async () => {
    serve(ticket(), imageJob(), done());
    expect((await edit({ jsonBody: { prompt: PROMPT, images: [{ type: "image_url", url: dataUri(PNG, "image/png") }] } })).success).toBe(true);
    serve(ticket(), imageJob(), done());
    expect((await edit({ formData: form({ image: new Blob([PNG], { type: "application/octet-stream" }) }) })).success).toBe(true);
  });

  it("counts usage once, on success only", async () => {
    serve(ticket(), imageJob(), pending(), done());
    const result = await edit();
    expect(result.accounting.nativeUnits.images).toBe(1);
    expect(result.accounting.costStatus).toBe("unknown");
    serve(ticket(), imageJob(), generation({ id: "gen-1", status: "FAILED" }));
    const failed = await edit();
    expect(failed.success).toBe(false);
    expect(failed.accounting).toBeUndefined();
  });
});

describe("refused before any upload", () => {
  const masked = () => form({ extra: [["mask", new Blob([PNG], { type: "image/png" }), "mask.png"]] });
  it.each([
    ["a mask", { formData: masked() }, /masks/],
    ["a JSON mask", { jsonBody: { prompt: PROMPT, image: dataUri(PNG, "image/png"), mask: dataUri(PNG, "image/png") } }, /masks/],
    ["two references", { formData: form({ extra: [["image", new Blob([PNG], { type: "image/png" }), "b.png"]] }) }, /exactly one/],
    ["two JSON references", { jsonBody: { prompt: PROMPT, images: [dataUri(PNG, "image/png"), dataUri(PNG, "image/png")] } }, /exactly one/],
    ["no reference", { formData: form({ image: null }) }, /exactly one/],
    ["a GIF", { formData: form({ image: new Blob([GIF], { type: "image/gif" }) }) }, /PNG, JPEG or WebP/],
    ["a truncated JPEG", { formData: form({ image: new Blob([bytes(0xff, 0xd8, 0x00)], { type: "image/jpeg" }) }) }, /PNG, JPEG or WebP/],
    ["a mislabelled type", { formData: form({ image: new Blob([PNG], { type: "image/jpeg" }) }) }, /does not match/],
    ["an empty file", { formData: form({ image: new Blob([], { type: "image/png" }) }) }, /empty or truncated/],
    ["a remote URL", { jsonBody: { prompt: PROMPT, image: "http://169.254.169.254/latest/meta-data" } }, /remote reference/],
    ["a file_id", { jsonBody: { prompt: PROMPT, image: { file_id: "file-1" } } }, /file_id/],
    ["n > 1", { formData: form({ fields: { n: "2" } }) }, /n=1/],
    ["b64_json", { formData: form({ fields: { response_format: "b64_json" } }) }, /url only/],
    ["streaming", { formData: form({ fields: { stream: "true" } }) }, /streaming/],
    ["width", { jsonBody: { prompt: PROMPT, image: dataUri(PNG, "image/png"), width: 512 } }, /do not support width/],
    ["an unknown field", { formData: form({ fields: { quality: "hd" } }) }, /do not support quality/],
    ["a bad size", { formData: form({ fields: { size: "1001x1000" } }) }, /multiple of 8/],
    ["an unknown model", { model: "dall-e-2" }, /Unsupported Leonardo image model/],
    ["no prompt", { jsonBody: { image: dataUri(PNG, "image/png") } }, /text prompt/],
  ])("%s", async (_name, input, message) => {
    const options = testOptions();
    const result = await edit({ ...input, options });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.phase).toBe("request");
    expect(await errorMessage(result)).toMatch(message);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(options.storageFetch).not.toHaveBeenCalled();
    expect(options.lookup).not.toHaveBeenCalled();
  });

  it("refuses an oversized reference with 413", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PNG.slice(0, 8));
    const result = await edit({ formData: form({ image: new Blob([big], { type: "image/png" }) }) });
    expect(result.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it("needs the selected key and refuses a connection proxy before any call", async () => {
    expect((await edit({ credentials: {} })).status).toBe(401);
    const proxied = await edit({ credentials: { apiKey: KEY_A, providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example:8080" } } });
    expect(proxied.status).toBe(400);
    expect(await errorMessage(proxied)).toMatch(/connection proxy/);
    expect(calls).toHaveLength(0);
  });

  it("parses requests without touching the network", async () => {
    const { generation: body, reference } = await parseLeonardoEditRequest({ model: "", jsonBody: { prompt: PROMPT, image: dataUri(WEBP, "image/webp") } });
    expect(body).toEqual({ modelId: PHOENIX, prompt: PROMPT, width: 1024, height: 1024, num_images: 1 });
    expect(reference.extension).toBe("webp");
  });
});

describe("init-image phase", () => {
  it.each([
    ["no ticket", json({})],
    ["an unsafe id", ticket({ id: "../init" })],
    ["object fields", json({ uploadInitImage: { id: "init-1", url: STORAGE, fields: FIELDS } })],
    ["unparseable fields", ticket({ fields: `{"x-amz-signature":"${SIGNATURE}"` })],
    ["a field named file", ticket({ fields: JSON.stringify({ ...FIELDS, file: "x" }) })],
    ["a CRLF field value", ticket({ fields: JSON.stringify({ ...FIELDS, policy: "a\r\nX-Injected: 1" }) })],
    ["a nested field value", ticket({ fields: JSON.stringify({ ...FIELDS, policy: { a: 1 } }) })],
    ["too many fields", ticket({ fields: JSON.stringify(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`f${i}`, "v"]))) })],
    ["no fields", ticket({ fields: "{}" })],
    ["a non-object answer", json([1, 2])],
  ])("refuses a malformed ticket: %s", async (_name, answer) => {
    serve(answer);
    const options = testOptions();
    const result = await edit({ options });
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.phase).toBe("init-image");
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(options.storageFetch).not.toHaveBeenCalled();
    await assertNoLeak(result);
  });

  it.each([
    ["http", "http://synthetic-bucket.s3.amazonaws.com/"],
    ["userinfo", "https://user:pass@synthetic-bucket.s3.amazonaws.com/"],
    ["loopback", "https://127.0.0.1/"],
    ["IPv6 loopback", "https://[::1]/"],
    ["IPv4-mapped loopback", "https://[::ffff:7f00:1]/"],
    ["metadata", "https://169.254.169.254/latest/"],
    ["private", "https://10.0.0.8/"],
    ["localhost", "https://localhost./"],
    ["internal suffix", "https://metadata.google.internal/"],
    ["explicit port", "https://synthetic-bucket.s3.amazonaws.com:8443/"],
    ["file scheme", "file:///etc/passwd"],
    ["not a URL", "not a url"],
    ["a non-string", 42],
  ])("refuses a malicious storage URL: %s", async (_name, url) => {
    serve(ticket({ url }));
    const options = testOptions();
    const result = await edit({ options });
    expect(result.status).toBe(502);
    expect(result.phase).toBe("init-image");
    expect(await errorMessage(result)).toMatch(/storage URL was refused/);
    expect(options.storageFetch).not.toHaveBeenCalled();
    expect(options.lookup).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it.each([
    [401, 401, /refused the API key/],
    [402, 402, /refused init-image for this account/],
    [429, 429, /rate limited/],
    [400, 400, /refused the init-image request with 400/],
    [500, 502, /init-image request failed with 500/],
    [503, 502, /init-image request failed with 503/],
  ])("maps init-image %i without an accepted job", async (code, expected, message) => {
    serve(leaky(code, "SOME_CODE"));
    const result = await edit();
    expect(result.status).toBe(expected);
    expect(result.phase).toBe("init-image");
    expect(await errorMessage(result)).toMatch(message);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(storageCalls).toHaveLength(0);
    await assertNoLeak(result);
  });

  it("refuses an init-image redirect and an unreadable answer", async () => {
    serve(new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    const redirected = await edit();
    expect(redirected.status).toBe(502);
    expect(await errorMessage(redirected)).toMatch(/redirect refused/);
    serve(new Response("not json", { status: 200 }));
    const unreadable = await edit();
    expect(unreadable.status).toBe(502);
    expect(unreadable.acceptedJob).toBeUndefined();
    expect(storageCalls).toHaveLength(0);
  });

  it("times out and aborts the init-image request", async () => {
    serve(stalled);
    const timedOut = await edit({ options: testOptions({ initTimeoutMs: 20 }) });
    expect(timedOut.status).toBe(504);
    expect(timedOut.phase).toBe("init-image");
    expect(timedOut.acceptedJob).toBeUndefined();

    serve(stalled);
    const controller = new AbortController();
    const pendingEdit = edit({ signal: controller.signal });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    controller.abort();
    const aborted = await pendingEdit;
    expect(aborted.status).toBe(499);
    expect(aborted.acceptedJob).toBeUndefined();
    expect(storageCalls).toHaveLength(0);
  });

  it("returns 499 without any call when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await edit({ signal: controller.signal });
    expect(result.status).toBe(499);
    expect(calls).toHaveLength(0);
  });
});

describe("storage phase", () => {
  it.each([
    ["private", [{ address: "10.0.0.5", family: 4 }]],
    ["loopback", [{ address: "127.0.0.1", family: 4 }]],
    ["metadata", [{ address: "169.254.169.254", family: 4 }]],
    ["IPv6 unique-local", [{ address: "fd00::1", family: 6 }]],
    ["IPv4-mapped private", [{ address: "::ffff:192.168.1.1", family: 6 }]],
    ["mixed public and private", [{ address: STORAGE_IP, family: 4 }, { address: "10.0.0.5", family: 4 }]],
    ["a non-address", [{ address: "evil.example", family: 4 }]],
  ])("refuses a storage host resolving to %s", async (_name, records) => {
    serve(ticket());
    const options = testOptions({ lookup: vi.fn(async () => records) });
    const result = await edit({ options });
    expect(result.status).toBe(502);
    expect(result.phase).toBe("storage");
    expect(await errorMessage(result)).toMatch(/storage URL was refused/);
    expect(options.storageFetch).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("fails closed when the storage host does not resolve", async () => {
    serve(ticket());
    const options = testOptions({ lookup: vi.fn(async () => { throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${STORAGE}`), { code: "ENOTFOUND" }); }) });
    const result = await edit({ options });
    expect(result.status).toBe(502);
    expect(await errorMessage(result)).toMatch(/could not be resolved/);
    expect(options.storageFetch).not.toHaveBeenCalled();
    await assertNoLeak(result);
  });

  it("resolves once: a rebinding answer on a second lookup is never consulted", async () => {
    serve(ticket(), imageJob(), done());
    let answers = 0;
    const lookup = vi.fn(async () => (answers++ === 0 ? [{ address: STORAGE_IP, family: 4 }] : [{ address: "127.0.0.1", family: 4 }]));
    const result = await edit({ options: testOptions({ lookup }) });
    expect(result.success).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it.each([301, 302, 303, 307, 308])("refuses a storage %i redirect without following it", async (code) => {
    serve(ticket());
    const options = testOptions({ storageFetch: storage(new Response(null, { status: code, headers: { location: "http://127.0.0.1/" } })) });
    const result = await edit({ options });
    expect(result.status).toBe(502);
    expect(result.phase).toBe("storage");
    expect(await errorMessage(result)).toMatch(/redirect refused/);
    expect(storageCalls).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(result.acceptedJob).toBeUndefined();
  });

  it.each([403, 412, 500])("maps a storage %i without quoting it or generating", async (code) => {
    serve(ticket());
    const options = testOptions({ storageFetch: storage(leaky(code, "AccessDenied")) });
    const result = await edit({ options });
    expect(result.status).toBe(502);
    expect(await errorMessage(result)).toBe(`Leonardo init-image upload failed with ${code}`);
    expect(calls).toHaveLength(1);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("maps a storage transport failure without the URL", async () => {
    serve(ticket());
    const options = testOptions({ storageFetch: storage(() => { throw new TypeError(`fetch failed ${STORAGE} ${SIGNATURE}`); }) });
    const result = await edit({ options });
    expect(result.status).toBe(502);
    expect(await errorMessage(result)).toMatch(/failed to connect/);
    await assertNoLeak(result);
  });

  it("times out the DNS lookup and the upload", async () => {
    serve(ticket());
    const dns = await edit({ options: testOptions({ dnsTimeoutMs: 20, lookup: vi.fn(() => new Promise(() => {})) }) });
    expect(dns.status).toBe(504);
    expect(dns.phase).toBe("storage");
    expect(calls).toHaveLength(1);

    serve(ticket());
    const options = testOptions({ storageTimeoutMs: 20, storageFetch: storage(stalled) });
    const upload = await edit({ options });
    expect(upload.status).toBe(504);
    expect(upload.phase).toBe("storage");
    expect(await errorMessage(upload)).toMatch(/upload timed out/);
    expect(storageCalls[0].init.signal.aborted).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([INIT, INIT]);
    expect(upload.acceptedJob).toBeUndefined();
  });

  it("aborts during DNS and during the upload", async () => {
    serve(ticket());
    const dnsController = new AbortController();
    const dnsEdit = edit({ signal: dnsController.signal, options: testOptions({ lookup: vi.fn(() => new Promise(() => {})) }) });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    dnsController.abort();
    expect((await dnsEdit).status).toBe(499);

    serve(ticket());
    const controller = new AbortController();
    const pendingEdit = edit({ signal: controller.signal, options: testOptions({ storageFetch: storage(stalled) }) });
    await vi.waitFor(() => expect(storageCalls).toHaveLength(1));
    controller.abort();
    const aborted = await pendingEdit;
    expect(aborted.status).toBe(499);
    expect(aborted.phase).toBe("storage");
    expect(aborted.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(2);
  });
});

describe("storage socket guard", () => {
  const pinned = [{ address: STORAGE_IP, family: 4 }];
  const fakeSocket = (remoteAddress) => ({ remoteAddress, destroy: vi.fn() });
  const connectWith = (connector, options) => new Promise((resolve) => connector(options, (error, socket) => resolve({ error, socket })));

  it("accepts a socket connected to a pinned public address", async () => {
    const socket = fakeSocket(STORAGE_IP);
    const base = vi.fn((_options, callback) => callback(null, socket));
    const { error, socket: connected } = await connectWith(createLeonardoStorageConnector(pinned, base), { hostname: "synthetic-bucket.s3.amazonaws.com" });
    expect(error).toBeFalsy();
    expect(connected).toBe(socket);
    const mapped = await connectWith(createLeonardoStorageConnector(pinned, (_o, cb) => cb(null, fakeSocket(`::ffff:${STORAGE_IP}`))), { hostname: "synthetic-bucket.s3.amazonaws.com" });
    expect(mapped.error).toBeFalsy();
  });

  it.each(["10.1.2.3", "127.0.0.1", "52.216.9.9", "", undefined])("destroys a socket whose peer is %s", async (peer) => {
    const socket = fakeSocket(peer);
    const { error } = await connectWith(createLeonardoStorageConnector(pinned, (_o, cb) => cb(null, socket)), { hostname: "synthetic-bucket.s3.amazonaws.com" });
    expect(error?.unsafe).toBe(true);
    expect(socket.destroy).toHaveBeenCalled();
  });

  it("refuses blocked or unpinned literal hosts before connecting", async () => {
    const base = vi.fn();
    for (const hostname of ["127.0.0.1", "[::1]", "169.254.169.254", "52.216.9.9", "localhost"]) {
      const { error } = await connectWith(createLeonardoStorageConnector(pinned, base), { hostname });
      expect(error?.unsafe, hostname).toBe(true);
    }
    expect(base).not.toHaveBeenCalled();
  });

  it("refuses through the real undici transport when the connected peer is private (no network)", async () => {
    serve(ticket());
    const socket = fakeSocket("10.9.8.7");
    const baseConnect = vi.fn((_options, callback) => queueMicrotask(() => callback(null, socket)));
    const options = testOptions({ baseConnect });
    delete options.storageFetch;
    const result = await edit({ options });
    expect(baseConnect).toHaveBeenCalledTimes(1);
    expect(baseConnect.mock.calls[0][0].hostname).toBe("synthetic-bucket.s3-accelerate.amazonaws.com");
    expect(socket.destroy).toHaveBeenCalled();
    expect(result.status).toBe(502);
    expect(result.phase).toBe("storage");
    expect(await errorMessage(result)).toMatch(/storage URL was refused/);
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("checks storage URLs and tickets as pure functions", () => {
    expect(checkLeonardoStorageUrl(`${STORAGE}#frag`).href).toBe(STORAGE);
    expect(() => checkLeonardoStorageUrl("https://0.0.0.0/")).toThrow(/refused/);
    expect(parseLeonardoUploadTicket({ uploadInitImage: { id: "init-1", url: STORAGE, fields: '{"key":"k","n":3}' } }).fields)
      .toEqual([["key", "k"], ["n", "3"]]);
  });
});

describe("generation phase", () => {
  it("never resends an uncertain generation submit and keeps the accepted job", async () => {
    serve(ticket(), stalled);
    const result = await edit({ options: testOptions({ submitTimeoutMs: 20 }) });
    expect(result.status).toBe(504);
    expect(result.phase).toBe("generation");
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "submit-unknown" }, modality: "image" });
    expect(calls.map((c) => c.url)).toEqual([INIT, SUBMIT]);
    expect(storageCalls).toHaveLength(1);
  });

  it("keeps the accepted job on a 5xx submit, a missing generation id and an abort while polling", async () => {
    serve(ticket(), leaky(500, "INTERNAL"));
    const failed = await edit();
    expect(failed.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls.filter((c) => c.url === SUBMIT)).toHaveLength(1);
    await assertNoLeak(failed);

    serve(ticket(), json({ sdGenerationJob: {} }));
    const noId = await edit();
    expect(noId.status).toBe(502);
    expect(noId.acceptedJob?.meta.jobState).toBe("accepted");

    const controller = new AbortController();
    serve(ticket(), imageJob(), () => {
      controller.abort();
      return pending();
    });
    const aborted = await edit({ signal: controller.signal });
    expect(aborted.status).toBe(499);
    expect(aborted.phase).toBe("generation");
    expect(aborted.acceptedJob?.meta.jobState).toBe("accepted");
  });

  it("maps a FAILED generation without an accepted job and a refused submit as its status", async () => {
    serve(ticket(), imageJob(), generation({ id: "gen-1", status: "FAILED" }));
    const failed = await edit();
    expect(failed.status).toBe(502);
    expect(failed.acceptedJob).toBeUndefined();
    serve(ticket(), leaky(402, "INSUFFICIENT_CREDITS"));
    const quota = await edit();
    expect(quota.status).toBe(402);
    expect(quota.quotaExhausted).toBe(true);
    expect(quota.acceptedJob).toBeUndefined();
  });

  it("bounds the whole edit by one job deadline", async () => {
    serve(ticket(), imageJob(), ...Array.from({ length: 70 }, () => pending()));
    const result = await edit({ options: testOptions({ timeoutMs: 20_000 }) });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls.filter((c) => c.url === status("gen-1")).length).toBeLessThanOrEqual(4);
  });

  it("refuses a result URL that is not public https", async () => {
    serve(ticket(), imageJob(), done("gen-1", "http://127.0.0.1/x.png"));
    const result = await edit();
    expect(result.success).toBe(false);
    expect(result.acceptedJob).toBeDefined();
  });
});

describe("account isolation", () => {
  it("runs two accounts concurrently with their own keys, tickets and storage connections", async () => {
    const byKey = new Map([
      [KEY_A, { init: "init-a", gen: "gen-a", url: "https://bucket-a.s3.amazonaws.com/" }],
      [KEY_B, { init: "init-b", gen: "gen-b", url: "https://bucket-b.s3.amazonaws.com/" }],
    ]);
    global.fetch = vi.fn(async (url, init) => {
      const key = init.headers.Authorization.replace("Bearer ", "");
      const account = byKey.get(key);
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url: String(url), key, body });
      if (url === INIT) return ticket({ id: account.init, url: account.url });
      if (url === SUBMIT) return imageJob(account.gen);
      return done(account.gen, `${IMG}?${account.gen}`);
    });
    const storageFetch = vi.fn(async (url, init) => {
      storageCalls.push({ url: String(url), init });
      return noContent();
    });
    const options = testOptions({ storageFetch });
    const adapter = createLeonardoImageEditAdapter(options);
    const [a, b] = await Promise.all([
      adapter.edit({ model: "phoenix", formData: form(), credentials: { apiKey: KEY_A } }),
      adapter.edit({ model: "phoenix", formData: form(), credentials: { apiKey: KEY_B } }),
    ]);
    expect((await payload(a)).data[0].url).toBe(`${IMG}?gen-a`);
    expect((await payload(b)).data[0].url).toBe(`${IMG}?gen-b`);
    for (const call of calls.filter((c) => c.url === SUBMIT)) {
      expect(call.body.init_image_id).toBe(byKey.get(call.key).init);
    }
    expect(storageCalls.map((c) => c.url).sort()).toEqual(["https://bucket-a.s3.amazonaws.com/", "https://bucket-b.s3.amazonaws.com/"]);
    expect(storageCalls[0].init.dispatcher).not.toBe(storageCalls[1].init.dispatcher);
    for (const call of storageCalls) {
      const raw = Buffer.from(call.init.body).toString("latin1") + JSON.stringify(call.init.headers);
      expect(raw).not.toContain(KEY_A);
      expect(raw).not.toContain(KEY_B);
    }
  });
});
