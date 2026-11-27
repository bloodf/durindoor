// Native image upscale framework and vendor adapters, staged and unregistered (#2034).
// Closed mocks only: every request is answered by an injected fetch, an
// unexpected request fails the test, and every key is synthetic. Wire shapes
// follow OmniRoute c71f0065 (config/upscaleRegistry.ts, handlers/imageUpscale.ts,
// handlers/imageUpscale/{shared,topaz,stability,syntx,adobeFirefly}.ts,
// services/syntxMedia.ts). Passing here says nothing about the live services.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { isForbiddenUpscaleReference } from "../helpers/upscale-staging-guard.js";

import {
  createImageUpscaleService,
  describeImageUpscaleModel,
  encodeSyntxUploadMultipart,
  listImageUpscaleModels,
  mapStabilityCreativity,
  resolveUpscaleModel,
  syntxChatTitle,
} from "../../open-sse/services/providerParity/native-image-upscale/index.js";

const REG_URL = new URL("../../open-sse/services/providerParity/native-image-upscale/registration.json", import.meta.url);
const REGISTRATION = JSON.parse(readFileSync(REG_URL, "utf8"));

const TOPAZ_KEY = "tpz-SYNTHETIC-upscale-key-0001";
const STAB_KEY = "sk-SYNTHETIC-stability-key-0002";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGljLXNpZw";
const NOW = 1_800_000_000_000;

function png(width = 100, height = 50) {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dims = Buffer.alloc(8);
  dims.writeUInt32BE(width, 0);
  dims.writeUInt32BE(height, 4);
  return Buffer.concat([head, dims, Buffer.alloc(24, 9)]);
}
const PNG = png();
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(44, 1)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(36, 2)]);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(30, 3)]);
const PNG_URI = `data:image/png;base64,${PNG.toString("base64")}`;
const PUBLIC_IMG = "https://93.184.216.34/source.png";

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const bytes = (buf, status = 200, type = "image/png", extra = {}) => new Response(buf, { status, headers: { "content-type": type, ...extra } });
const leaky = (status) => json({ message: `upstream echo ${TOPAZ_KEY} ${STAB_KEY} ${JWT}` }, status);
const timeoutErr = () => Object.assign(new Error("timed out"), { name: "TimeoutError" });

/** A queue-driven fetch mock that records every call and fails on surprises. */
function mockFetch() {
  const state = { calls: [], steps: [] };
  const fn = async (url, init = {}) => {
    state.calls.push({ url: String(url), init });
    const step = state.steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return typeof step === "function" ? step(String(url), init) : step;
  };
  fn.state = state;
  fn.serve = (...answers) => { state.steps = answers; };
  return fn;
}

let vendor;
let source;
let download;
const noSleep = async () => {};
const service = (extra = {}) => createImageUpscaleService({
  topaz: { fetchImpl: vendor, sourceFetchImpl: source, now: () => NOW, ...extra.topaz },
  stability: { fetchImpl: vendor, sourceFetchImpl: source, now: () => NOW, sleep: noSleep, ...extra.stability },
  syntx: { fetchImpl: vendor, downloadFetchImpl: download, now: () => NOW, sleep: noSleep, boundary: "----WebKitFormBoundaryTEST", ...extra.syntx },
});
const formOf = (call) => [...call.init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `blob:${v.type}`]);
const errorText = (result) => JSON.stringify(result);

beforeEach(() => {
  vendor = mockFetch();
  source = mockFetch();
  download = mockFetch();
});

describe("staging and registration", () => {
  it("is staged and unregistered with route, auth, catalog, usage and discovery requirements", () => {
    expect(REGISTRATION.status).toBe("staged-unregistered");
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.route.method).toBe("POST");
    expect(REGISTRATION.route.path).toBe("/v1/images/upscale");
    expect(REGISTRATION.route.discovery.path).toBe("/v1/images/upscale");
    for (const key of ["providers", "dispositions", "safety", "accounting", "integrationPoints", "bounds"]) expect(REGISTRATION[key]).toBeTruthy();
    expect(REGISTRATION.providers.map((p) => p.id)).toEqual(["topaz", "stability-ai", "syntx"]);
    expect(REGISTRATION.dispositions.map((d) => d.id)).toEqual(["adobe-firefly", "adobe-firefly-api"]);
    expect(REGISTRATION.accounting.acceptedJob).toMatch(/Never resent/);
  });

  it("is not imported by shared production code", async () => {
    const { execFileSync } = await import("node:child_process");
    let out = "";
    try {
      out = execFileSync("git", ["grep", "-l", "native-image-upscale", "--", "open-sse", "src", ":!open-sse/services/providerParity/native-image-upscale"], {
        cwd: new URL("../..", import.meta.url), encoding: "utf8",
      });
    } catch (error) {
      if (error.status !== 1) throw error; // 1 = no match
    }
    const forbidden = out.trim().split("\n").filter(Boolean).filter((path) =>
      isForbiddenUpscaleReference(path, readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")));
    expect(forbidden).toEqual([]);
  });
});

describe("catalog and model resolution", () => {
  it("lists the source catalog rows under provider id and alias", () => {
    expect(listImageUpscaleModels()).toEqual([
      { id: "stability-ai/fast", name: "Stability Fast Upscale (4x)", provider: "stability-ai", format: "stability-upscale" },
      { id: "stability-ai/conservative", name: "Stability Conservative Upscale", provider: "stability-ai", format: "stability-upscale" },
      { id: "stability-ai/creative", name: "Stability Creative Upscale", provider: "stability-ai", format: "stability-upscale" },
      { id: "topaz/topaz-enhance", name: "Topaz Labs Enhance", provider: "topaz", format: "topaz-upscale" },
      { id: "syntx/magnific/magnific", name: "Magnific Upscale", provider: "syntx", format: "syntx-upscale" },
      { id: "stx/magnific/magnific", name: "Magnific Upscale", provider: "syntx", format: "syntx-upscale" },
      { id: "syntx/topaz_ai/topaz", name: "Topaz AI Upscale", provider: "syntx", format: "syntx-upscale" },
      { id: "stx/topaz_ai/topaz", name: "Topaz AI Upscale", provider: "syntx", format: "syntx-upscale" },
      { id: "syntx/ideogram/upscale", name: "Ideogram Upscale", provider: "syntx", format: "syntx-upscale" },
      { id: "stx/ideogram/upscale", name: "Ideogram Upscale", provider: "syntx", format: "syntx-upscale" },
    ]);
    expect(listImageUpscaleModels().some((row) => row.provider.includes("firefly"))).toBe(false);
  });

  it("describes model capabilities from the source rows", () => {
    expect(describeImageUpscaleModel("stability-ai/creative")).toMatchObject({ factors: [4], supportsCreativity: true, supportsPrompt: true, promptRequired: true });
    expect(describeImageUpscaleModel("stability-ai/conservative")).toMatchObject({ supportsCreativity: false, promptRequired: true });
    expect(describeImageUpscaleModel("topaz-enhance")).toMatchObject({ id: "topaz/topaz-enhance", factors: [2, 4] });
    expect(describeImageUpscaleModel("stx/topaz_ai/topaz")).toMatchObject({ provider: "syntx", supportsPrompt: false });
    expect(describeImageUpscaleModel("firefly/topaz")).toBeNull();
    expect(describeImageUpscaleModel("nope/x")).toBeNull();
  });

  it("resolves prefixes, aliases and unambiguous bare ids", () => {
    expect(resolveUpscaleModel("stx/ideogram/upscale")).toMatchObject({ provider: "syntx", model: "ideogram/upscale" });
    expect(resolveUpscaleModel("magnific/magnific")).toMatchObject({ provider: "syntx", model: "magnific/magnific" });
    expect(resolveUpscaleModel("fast")).toMatchObject({ provider: "stability-ai", model: "fast" });
    expect(resolveUpscaleModel("adobe-firefly/topaz-bloom")).toMatchObject({ unavailable: "consumer" });
    expect(resolveUpscaleModel("topaz-standard")).toMatchObject({ unavailable: "consumer" });
    expect(resolveUpscaleModel("adobe-firefly-api/upscale")).toMatchObject({ unavailable: "services" });
  });

  it.each([
    [undefined, /missing/],
    ["topaz/unknown", /Unsupported upscale model for topaz: unknown\. Available: topaz-enhance/],
    ["stability-ai/ultra", /Available: fast, conservative, creative/],
    ["nobody/model", /Invalid upscale model/],
    ["../etc/passwd", /Invalid upscale model id/],
    ["topaz//topaz-enhance", /Invalid upscale model id/],
  ])("refuses model %s with 400 and no network", async (model, message) => {
    const result = await service().upscale({ body: { model, image: PNG_URI }, credentials: { apiKey: TOPAZ_KEY } });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(errorText(result)).toMatch(message);
    expect(vendor.state.calls).toHaveLength(0);
  });

  it("refuses a provider whose adapter a custom service omits, without network", async () => {
    const custom = createImageUpscaleService({ adapters: {} });
    const result = await custom.upscale({ body: { model: "topaz/topaz-enhance", image: PNG_URI }, credentials: { apiKey: TOPAZ_KEY } });
    expect(result.status).toBe(400);
    expect(errorText(result)).toMatch(/No upscale adapter is configured for topaz \(topaz-upscale\)/);
    expect(vendor.state.calls).toHaveLength(0);
  });

  it("refuses a non-object body", async () => {
    expect((await service().upscale({ body: "x" })).status).toBe(400);
  });
});

describe("Adobe Firefly guarded disposition", () => {
  it.each(["adobe-firefly/topaz", "firefly/topaz-bloom", "adobe-firefly/topaz-standard", "topaz-bloom", "adobe-firefly-api/topaz"])(
    "%s is unavailable (501) before any credential read or request", async (model) => {
      const credentials = { apiKey: "SYNTHETIC-cookie-a=b; c=d", accessToken: "eyJ.synthetic.ims", providerSpecificData: { cookie: "x=y" } };
      const result = await service().upscale({ body: { model, image: PUBLIC_IMG, factor: 2 }, credentials });
      expect(result.success).toBe(false);
      expect(result.status).toBe(501);
      expect(result.unavailable).toBe(true);
      expect(result.acceptedJob).toBeUndefined();
      expect(vendor.state.calls).toHaveLength(0);
      expect(source.state.calls).toHaveLength(0);
      expect(errorText(result)).not.toContain("SYNTHETIC-cookie");
    });

  it("names the consumer guard and the missing Services equivalent", async () => {
    const consumer = await service().upscale({ body: { model: "firefly/topaz", image: PNG_URI } });
    expect(errorText(consumer)).toMatch(/consumer upscale .* unavailable/);
    const services = await service().upscale({ body: { model: "adobe-firefly-api/x", image: PNG_URI } });
    expect(errorText(services)).toMatch(/Firefly Services .* no documented upscale operation/);
  });
});

describe("source image intake", () => {
  const topaz = (body) => service().upscale({ body: { model: "topaz/topaz-enhance", ...body }, credentials: { apiKey: TOPAZ_KEY } });

  it.each([
    [{}, /requires a source image/],
    [{ image: PNG_URI, image_url: `data:image/jpeg;base64,${JPEG.toString("base64")}` }, /exactly one source image \(2 distinct/],
    [{ images: [PNG_URI, PUBLIC_IMG] }, /exactly one source image/],
    [{ image: PNG_URI, provider_options: { image_url: PUBLIC_IMG } }, /exactly one source image/],
    [{ messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: PNG_URI } }] }] }, /image parts only/],
    [{ image: `data:image/gif;base64,${GIF.toString("base64")}` }, /PNG, JPEG or WebP/],
    [{ image: `data:image/jpeg;base64,${PNG.toString("base64")}` }, /is png, not the declared image\/jpeg/],
    [{ image: "data:image/png,rawbytes" }, /must be base64-encoded/],
    [{ image: "not*base64" }, /not valid base64/],
    [{ image: 42 }, /not an image reference/],
    [{ image: PNG_URI, provider_options: { quality: "hd" } }, /does not support provider_options\.quality/],
  ])("refuses %j with 400 before any network call", async (body, message) => {
    const result = await topaz(body);
    expect(result.status).toBe(400);
    expect(errorText(result)).toMatch(message);
    expect(vendor.state.calls).toHaveLength(0);
    expect(source.state.calls).toHaveLength(0);
  });

  it("accepts the same image under two aliases, object shapes and message parts", async () => {
    for (const body of [
      { image: PNG_URI, image_url: PNG_URI },
      { reference_images: [{ b64_json: PNG.toString("base64") }] },
      { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: PNG_URI } }] }] },
      { provider_options: { input_image: PNG.toString("base64") } },
    ]) {
      vendor.serve(bytes(PNG));
      expect((await topaz(body)).success).toBe(true);
    }
  });

  it.each([
    "http://127.0.0.1/a.png", "http://169.254.169.254/latest/meta-data", "https://10.0.0.5/a.png", "https://localhost/a.png",
    "https://user:pass@93.184.216.34/a.png", "ftp://93.184.216.34/a.png", "file:///etc/passwd",
  ])("refuses source URL %s without any fetch", async (url) => {
    const result = await topaz({ image: url });
    expect(result.status).toBe(400);
    expect(source.state.calls).toHaveLength(0);
    expect(vendor.state.calls).toHaveLength(0);
    expect(errorText(result)).not.toContain("pass");
  });

  it("fetches a public source with no credential, manual redirects and the guard dispatcher", async () => {
    source.serve(bytes(PNG));
    vendor.serve(bytes(PNG));
    const result = await topaz({ image_url: PUBLIC_IMG });
    expect(result.success).toBe(true);
    const [call] = source.state.calls;
    expect(call.url).toBe(PUBLIC_IMG);
    expect(call.init.redirect).toBe("manual");
    expect(call.init.dispatcher).toBeTruthy();
    expect(call.init.headers).toEqual({ Accept: "image/*" });
    expect(JSON.stringify(call.init.headers)).not.toContain(TOPAZ_KEY);
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("follows at most three re-validated redirects", async () => {
    const hop = (to) => new Response(null, { status: 302, headers: { location: to } });
    source.serve(hop("https://93.184.216.35/b.png"), bytes(PNG));
    vendor.serve(bytes(PNG));
    expect((await topaz({ image: PUBLIC_IMG })).success).toBe(true);
    expect(source.state.calls.map((c) => c.url)).toEqual([PUBLIC_IMG, "https://93.184.216.35/b.png"]);

    source.serve(hop("http://127.0.0.1/evil.png"));
    let result = await topaz({ image: PUBLIC_IMG });
    expect(result.status).toBe(400);
    expect(errorText(result)).toMatch(/refused or could not be fetched/);
    expect(errorText(result)).not.toContain("127.0.0.1");

    source.state.calls.length = 0;
    source.serve(hop("https://93.184.216.36/1"), hop("https://93.184.216.36/2"), hop("https://93.184.216.36/3"), hop("https://93.184.216.36/4"));
    result = await topaz({ image: PUBLIC_IMG });
    expect(result.status).toBe(400);
    expect(source.state.calls).toHaveLength(4);
  });

  it.each([
    [() => bytes(PNG, 404), /answered 404/],
    [() => bytes(Buffer.from("<html>"), 200, "text/html"), /did not return an image/],
    [() => bytes(GIF, 200, "image/gif"), /PNG, JPEG or WebP/],
    [() => bytes(PNG, 200, "image/png", { "content-length": String(21 * 1024 * 1024) }), /must not exceed/],
  ])("refuses a bad remote answer %#", async (answer, message) => {
    source.serve(answer());
    const result = await topaz({ image: PUBLIC_IMG });
    expect(result.status).toBe(400);
    expect(errorText(result)).toMatch(message);
    expect(vendor.state.calls).toHaveLength(0);
  });

  it("bounds the source download with a deadline", async () => {
    source.serve(() => new Promise(() => {}));
    const { fetchRemoteImage } = await import("../../open-sse/services/providerParity/native-image-upscale/media.js");
    await expect(fetchRemoteImage(PUBLIC_IMG, { fetchImpl: source, timeoutMs: 20 })).rejects.toThrow(/timed out/);
  });
});

describe("Topaz Labs upscale", () => {
  const call = (body, credentials = { apiKey: TOPAZ_KEY }, extra) =>
    service(extra).upscale({ body: { model: "topaz/topaz-enhance", image: PNG_URI, ...body }, credentials });

  it("sends the exact source request with factor-derived output size", async () => {
    vendor.serve(bytes(PNG));
    const result = await call({});
    expect(result.success).toBe(true);
    const [req] = vendor.state.calls;
    expect(req.url).toBe("https://api.topazlabs.com/image/v1/enhance");
    expect(req.init.method).toBe("POST");
    expect(req.init.redirect).toBe("manual");
    expect(req.init.headers).toEqual({ Accept: "image/png", "X-API-Key": TOPAZ_KEY });
    expect(formOf(req)).toEqual([["image", "blob:image/png"], ["output_format", "png"], ["output_width", "200"], ["output_height", "100"]]);
    expect(req.init.body.get("image").name).toBe("image");
    const payload = await result.response.json();
    expect(payload).toEqual({
      created: NOW / 1000,
      data: [{ url: `data:image/png;base64,${PNG.toString("base64")}` }],
      upscale: { provider: "topaz", model: "topaz-enhance", factor: 2, output_format: "png", mime: "image/png", width: 200, height: 100 },
    });
    expect(result.accounting).toMatchObject({ state: "complete", modality: "image", nativeUnits: { images: 1 }, costStatus: "unknown" });
  });

  it("maps every optional source field in order", async () => {
    vendor.serve(bytes(JPEG, 200, "image/jpeg"));
    const result = await call({
      upscale_factor: "4x", output_format: "jpg", topaz_model: " High Fidelity V2 ", sharpen: 0.333, denoise: "0.5", fix_compression: "0.2",
      face_enhancement: "true", creativity: 40, face_enhancement_strength: 0.8, response_format: "b64_json",
    });
    expect(result.success).toBe(true);
    const [req] = vendor.state.calls;
    expect(req.init.headers.Accept).toBe("image/jpeg");
    expect(formOf(req)).toEqual([
      ["image", "blob:image/png"], ["output_format", "jpeg"], ["output_width", "400"], ["output_height", "200"], ["model", "High Fidelity V2"],
      ["sharpen", "0.33"], ["denoise", "0.5"], ["fix_compression", "0.2"], ["face_enhancement", "true"],
      ["face_enhancement_creativity", "0.4"], ["face_enhancement_strength", "0.8"],
    ]);
    const payload = await result.response.json();
    expect(payload.data).toEqual([{ b64_json: JPEG.toString("base64") }]);
    expect(payload.upscale).toMatchObject({ factor: 4, width: 400, height: 200, output_format: "jpeg" });
  });

  it("sends an explicit size without a factor", async () => {
    vendor.serve(bytes(PNG));
    const result = await call({ size: "1024x768" });
    expect(formOf(vendor.state.calls[0]).slice(2)).toEqual([["output_width", "1024"], ["output_height", "768"]]);
    expect((await result.response.json()).upscale.factor).toBeNull();
  });

  it("uses Topaz's default scale only when no factor was asked and dimensions are unreadable", async () => {
    const webp = `data:image/webp;base64,${WEBP.toString("base64")}`;
    vendor.serve(bytes(WEBP, 200, "image/webp"));
    const ok = await call({ image: webp, output_format: "webp" });
    expect(ok.success).toBe(true);
    expect(formOf(vendor.state.calls[0])).toEqual([["image", "blob:image/webp"], ["output_format", "webp"]]);
    const refused = await call({ image: webp, factor: 4 });
    expect(refused.status).toBe(400);
    expect(errorText(refused)).toMatch(/dimensions are unreadable/);
  });

  it.each([
    [{ factor: 3 }, /supports factor 2 or 4/],
    [{ scale: "8x" }, /supports scale 2 or 4/],
    [{ factor: 2, scale: 4 }, /factor and scale disagree/],
    [{ size: "1024x1024", factor: 2 }, /either size or a factor/],
    [{ size: "20000x10" }, /sides from 1 to 16000/],
    [{ size: "big" }, /WIDTHxHEIGHT/],
    [{ image: `data:image/png;base64,${png(5000, 100).toString("base64")}`, factor: 4 }, /20000x400 exceeds the 16000-pixel edge/],
    [{ prompt: "make it sharp" }, /does not support prompt/],
    [{ creativity: 40 }, /only with face_enhancement: true/],
    [{ face_enhancement: false, face_enhancement_strength: 0.5 }, /only with face_enhancement: true/],
    [{ face_enhancement: "maybe" }, /must be a boolean/],
    [{ sharpen: 1.5 }, /sharpen must be from 0 to 1/],
    [{ fix_compression: "20%" }, /fix_compression must be from 0 to 1/],
    [{ denoise: "lots" }, /denoise must be a number/],
    [{ output_format: "tiff" }, /output_format png, jpeg, webp only/],
    [{ response_format: "binary" }, /response_format url, b64_json only/],
    [{ n: 2 }, /n = 1 only/],
    [{ stream: true }, /streaming/],
    [{ creativity_percent: 10 }, /does not support creativity_percent/],
    [{ quality: "hd" }, /does not support quality/],
  ])("refuses %j before submit", async (body, message) => {
    const result = await call(body);
    expect(result.status).toBe(400);
    expect(errorText(result)).toMatch(message);
    expect(vendor.state.calls).toHaveLength(0);
  });

  it("needs a key and falls back to accessToken (source order)", async () => {
    expect((await call({}, {})).status).toBe(401);
    expect(vendor.state.calls).toHaveLength(0);
    vendor.serve(bytes(PNG));
    await call({}, { accessToken: ` ${TOPAZ_KEY} ` });
    expect(vendor.state.calls[0].init.headers["X-API-Key"]).toBe(TOPAZ_KEY);
  });

  it("does not fetch a remote source when the key is missing", async () => {
    expect((await call({ image: PUBLIC_IMG }, {})).status).toBe(401);
    expect(source.state.calls).toHaveLength(0);
  });

  it("refuses output that is not the requested format (strict fidelity)", async () => {
    vendor.serve(bytes(JPEG, 200, "image/png"));
    const result = await call({});
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "accepted" } });
  });

  it.each([
    [() => leaky(401), 401, undefined],
    [() => leaky(402), 402, undefined],
    [() => leaky(422), 422, undefined],
    [() => leaky(503), 502, "submit-unknown"],
    [() => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }), 502, "submit-unknown"],
  ])("maps vendor answer %# without quoting it", async (answer, status, jobState) => {
    vendor.serve(answer());
    const result = await call({});
    expect(result.status).toBe(status);
    expect(result.acceptedJob?.meta?.jobState).toBe(jobState);
    expect(errorText(result)).not.toContain(TOPAZ_KEY);
    expect(errorText(result)).not.toContain("upstream echo");
    expect(vendor.state.calls).toHaveLength(1);
  });

  it("flags 402 as quota and 429 with Retry-After", async () => {
    vendor.serve(json({}, 402));
    expect((await call({})).quotaExhausted).toBe(true);
    vendor.serve(json({}, 429, { "retry-after": "7" }));
    const limited = await call({});
    expect(limited.status).toBe(429);
    expect(limited.acceptedJob).toBeUndefined();
  });

  it("marks a timeout after send as submit-unknown and never resends", async () => {
    vendor.serve(() => new Promise(() => {}));
    const result = await call({}, undefined, { topaz: { submitTimeoutMs: 15 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(vendor.state.calls).toHaveLength(1);
  });

  it("returns 499 without acceptedJob when aborted before send, with it after send", async () => {
    const early = new AbortController();
    early.abort();
    const before = await service().upscale({ body: { model: "topaz/topaz-enhance", image: PNG_URI }, credentials: { apiKey: TOPAZ_KEY }, signal: early.signal });
    expect(before.status).toBe(499);
    expect(before.acceptedJob).toBeUndefined();
    expect(vendor.state.calls).toHaveLength(0);

    const late = new AbortController();
    vendor.serve(() => { setTimeout(() => late.abort(), 5); return new Promise(() => {}); });
    const after = await service().upscale({ body: { model: "topaz/topaz-enhance", image: PNG_URI }, credentials: { apiKey: TOPAZ_KEY }, signal: late.signal });
    expect(after.status).toBe(499);
    expect(after.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("treats a transport error before connect as unsent", async () => {
    vendor.serve(() => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); });
    const result = await call({});
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("bounds the result body", async () => {
    vendor.serve(bytes(PNG, 200, "image/png", { "content-length": String(60 * 1024 * 1024) }));
    const result = await call({});
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});

describe("Stability AI upscale", () => {
  const call = (model, body, credentials = { apiKey: STAB_KEY }, extra) =>
    service(extra).upscale({ body: { model: `stability-ai/${model}`, image: PNG_URI, ...body }, credentials });
  const ok = (image = PNG, extra = {}) => json({ image: image.toString("base64"), finish_reason: "SUCCESS", seed: 42, ...extra });

  it("sends fast as image + output_format only", async () => {
    vendor.serve(ok());
    const result = await call("fast", { factor: 4 });
    expect(result.success).toBe(true);
    const [req] = vendor.state.calls;
    expect(req.url).toBe("https://api.stability.ai/v2beta/stable-image/upscale/fast");
    expect(req.init.headers).toEqual({ Accept: "application/json", Authorization: `Bearer ${STAB_KEY}` });
    expect(formOf(req)).toEqual([["image", "blob:image/png"], ["output_format", "png"]]);
    expect((await result.response.json()).upscale).toEqual({ provider: "stability-ai", model: "fast", factor: 4, output_format: "png", mime: "image/png", seed: 42 });
  });

  it("sends conservative with prompt, negative prompt, default creativity and seed", async () => {
    vendor.serve(ok(WEBP));
    const result = await call("conservative", { prompt: " a gate ", negative_prompt: "blur", seed: "7", output_format: "webp", response_format: "b64_json" });
    expect(result.success).toBe(true);
    expect(formOf(vendor.state.calls[0])).toEqual([
      ["image", "blob:image/png"], ["output_format", "webp"], ["prompt", "a gate"], ["negative_prompt", "blur"], ["creativity", "0.35"], ["seed", "7"],
    ]);
    expect((await result.response.json()).data).toEqual([{ b64_json: WEBP.toString("base64") }]);
  });

  it("maps creativity like the source and refuses out-of-range values", () => {
    const range = { min: 0.2, max: 0.5, fallback: 0.35 };
    expect(mapStabilityCreativity(undefined, range)).toBe(0.35);
    expect(mapStabilityCreativity({ value: 50, field: "creativity" }, range)).toBe(0.35);
    expect(mapStabilityCreativity({ value: "100%", field: "creativity" }, range)).toBe(0.5);
    expect(mapStabilityCreativity({ value: 0, field: "creativity" }, range)).toBe(0.2);
    expect(mapStabilityCreativity({ value: 0.42, field: "creativity" }, range)).toBe(0.42);
    expect(() => mapStabilityCreativity({ value: 0.6, field: "creativity" }, range)).toThrow(/outside 0.2-0.5/);
    expect(() => mapStabilityCreativity({ value: 150, field: "creativity" }, range)).toThrow(/0-100 percent/);
    expect(() => mapStabilityCreativity({ value: "lots", field: "creativity" }, range)).toThrow(/must be a number/);
  });

  it.each([
    ["fast", { prompt: "x" }, /does not support prompt/],
    ["fast", { creativity: 10 }, /does not support creativity/],
    ["fast", { factor: 2 }, /supports factor 4/],
    ["fast", { size: "1024x1024" }, /does not support size/],
    ["conservative", {}, /requires a prompt/],
    ["conservative", { prompt: "x", style_preset: "anime" }, /does not support style_preset/],
    ["conservative", { prompt: "x", timeout_ms: 1000 }, /does not support timeout_ms/],
    ["conservative", { prompt: "x", creativity: 0.9 }, /outside 0.2-0.5/],
    ["creative", { prompt: "x", seed: -1 }, /seed must be an integer/],
    ["creative", { prompt: "x", timeout_ms: 0 }, /timeout_ms must be a positive integer/],
    ["creative", { prompt: "x", creativity: 10, creativity_percent: 20 }, /disagree/],
    ["creative", { prompt: "x", output_format: "gif" }, /output_format/],
  ])("refuses %s %j before submit", async (model, body, message) => {
    const result = await call(model, body);
    expect(result.status).toBe(400);
    expect(errorText(result)).toMatch(message);
    expect(vendor.state.calls).toHaveLength(0);
  });

  it("runs creative as an async job and polls without resubmitting", async () => {
    vendor.serve(json({ id: "job_123" }), json({}, 202), json({}, 503), json({}, 429), ok(PNG, { seed: 9 }));
    const result = await call("creative", { prompt: "a forest gate", creativity: 100, style_preset: "photographic" });
    expect(result.success).toBe(true);
    const urls = vendor.state.calls.map((c) => `${c.init.method} ${c.url}`);
    expect(urls).toEqual([
      "POST https://api.stability.ai/v2beta/stable-image/upscale/creative",
      ...Array(4).fill("GET https://api.stability.ai/v2beta/results/job_123"),
    ]);
    expect(formOf(vendor.state.calls[0])).toEqual([
      ["image", "blob:image/png"], ["output_format", "png"], ["prompt", "a forest gate"], ["creativity", "0.35"], ["style_preset", "photographic"],
    ]);
    expect(vendor.state.calls[1].init.headers).toEqual({ Accept: "application/json", Authorization: `Bearer ${STAB_KEY}` });
    expect(result.accounting.meta.jobId).toBe("job_123");
    expect((await result.response.json()).upscale).toMatchObject({ creativity: 0.35, seed: 9 });
  });

  it("accepts the results endpoint `result` field", async () => {
    vendor.serve(json({ id: "job_9" }), json({ result: PNG.toString("base64"), finish_reason: "SUCCESS" }));
    expect((await call("creative", { prompt: "x" })).success).toBe(true);
  });

  it("keeps the job id on every failure after acceptance", async () => {
    vendor.serve(json({ id: "job_404" }), leaky(404));
    const failed = await call("creative", { prompt: "x" });
    expect(failed.status).toBe(502);
    expect(failed.acceptedJob.meta).toEqual({ jobState: "accepted", jobId: "job_404" });
    expect(errorText(failed)).not.toContain(STAB_KEY);
    expect(vendor.state.calls.filter((c) => c.init.method === "POST")).toHaveLength(1);

    let clock = NOW;
    vendor.serve(json({ id: "job_slow" }), json({}, 202), json({}, 202));
    const slow = await call("creative", { prompt: "x", timeout_ms: 5000 }, undefined, {
      stability: { now: () => clock, sleep: async (ms) => { clock += ms; } },
    });
    expect(slow.status).toBe(504);
    expect(slow.acceptedJob.meta).toEqual({ jobState: "accepted", jobId: "job_slow" });
  });

  it("refuses a poll redirect and an unusable job id", async () => {
    vendor.serve(json({ id: "job_1" }), new Response(null, { status: 307, headers: { location: "https://evil.example/" } }));
    expect((await call("creative", { prompt: "x" })).acceptedJob.meta.jobState).toBe("accepted");
    vendor.serve(json({ id: "../../admin" }));
    const bad = await call("creative", { prompt: "x" });
    expect(bad.status).toBe(502);
    expect(bad.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("reports CONTENT_FILTERED as a filtered accepted job", async () => {
    vendor.serve(json({ image: "", finish_reason: "CONTENT_FILTERED" }));
    const result = await call("conservative", { prompt: "x" });
    expect(result.status).toBe(400);
    expect(result.acceptedJob.meta.jobState).toBe("filtered");
  });

  it("refuses a result that is missing or not the requested format", async () => {
    vendor.serve(json({ finish_reason: "SUCCESS" }));
    expect((await call("fast", {})).acceptedJob.meta.jobState).toBe("accepted");
    vendor.serve(ok(JPEG));
    const wrong = await call("fast", { output_format: "png" });
    expect(wrong.status).toBe(502);
    expect(errorText(wrong)).toMatch(/returned jpeg, not the requested png/);
  });

  it("maps 5xx submits to submit-unknown and 4xx without acceptedJob", async () => {
    vendor.serve(leaky(500));
    expect((await call("fast", {})).acceptedJob.meta.jobState).toBe("submit-unknown");
    vendor.serve(leaky(400));
    const bad = await call("fast", {});
    expect(bad.status).toBe(400);
    expect(bad.acceptedJob).toBeUndefined();
    expect(errorText(bad)).not.toContain("upstream echo");
  });

  it("needs a key", async () => {
    expect((await call("fast", {}, {})).status).toBe(401);
    expect(vendor.state.calls).toHaveLength(0);
  });

  it("refuses a 2xx answer that is not JSON as accepted work", async () => {
    vendor.serve(new Response("<html>", { status: 200 }));
    const result = await call("fast", {});
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});

describe("SYNTX upscale", () => {
  const scoped = { token: JWT };
  const call = (model, body, credentials = scoped, extra) =>
    service(extra).upscale({ body: { model, image: PNG_URI, ...body }, credentials });
  const ready = (objects) => json({ messages: [
    { author_id: 7, message_object: [{ object_type: "image", object_url: "https://cdn.syntx.ai/user.png", completed: true }] },
    { author_id: -1, message_object: objects },
  ] });
  const done = (url = "https://cdn.syntx.ai/result.png") => ready([{ object_type: "text", object_text: "done", completed: true }, { object_type: "image", object_url: url, completed: true }]);
  const flow = (...tail) => [json({ files: [{ url: "https://r2.syntx.ai/up/source.png" }] }), json({ uuid: "chat-1" }), json({ ok: true }), ...tail];

  it("uploads, creates the chat, generates and polls with the exact source shapes", async () => {
    vendor.serve(...flow(json({ messages: [] }), ready([{ object_type: "image", object_url: "https://cdn.syntx.ai/r.png", completed: false }]), done()));
    const result = await call("syntx/ideogram/upscale", { factor: 4, creativity: 3, prompt: "  silver   gate  " });
    expect(result.success).toBe(true);
    const [upload, chat, generate, ...polls] = vendor.state.calls;

    expect(upload.url).toBe("https://api.syntx.ai/api/v1/chats/upload-files");
    expect(upload.init.headers).toEqual({
      authorization: `Bearer ${JWT}`, accept: "application/json, text/plain, */*", origin: "https://syntx.ai", referer: "https://syntx.ai/",
      "user-agent": expect.stringContaining("Chrome/149"), "accept-language": "en", "content-type": "multipart/form-data; boundary=----WebKitFormBoundaryTEST",
    });
    expect(Buffer.compare(upload.init.body, encodeSyntxUploadMultipart({ bytes: PNG, name: "source.png", mime: "image/png" }, "----WebKitFormBoundaryTEST").body)).toBe(0);
    expect(upload.init.body.toString("latin1")).toContain('name="files"; filename="source.png"\r\nContent-Type: image/png');
    expect(upload.init.body.toString("latin1")).toContain('name="destination"\r\n\r\nuploaded');

    expect(chat.url).toBe("https://api.syntx.ai/api/v1/chats");
    expect(JSON.parse(chat.init.body)).toEqual({ title: "silver gate", scope: "image" });
    expect(chat.init.headers["content-type"]).toBe("application/json");

    expect(generate.url).toBe("https://api.syntx.ai/api/v1/design/generate?ai_name=ideogram");
    expect(JSON.parse(generate.init.body)).toEqual({
      chat_uuid: "chat-1", prompt: "silver   gate",
      settings: { model_type: "upscale", image_url: ["https://r2.syntx.ai/up/source.png"], scale_factor: 4, creativity: 3, mode: "upscale" },
    });
    expect(polls.map((p) => p.url)).toEqual(Array(3).fill("https://api.syntx.ai/api/v1/chats/chat-1/messages?page_size=50"));
    for (const c of vendor.state.calls) expect(c.init.redirect).toBe("manual");

    const payload = await result.response.json();
    expect(payload.data).toEqual([{ url: "https://cdn.syntx.ai/result.png" }]);
    expect(payload.upscale).toEqual({ provider: "syntx", model: "ideogram/upscale", factor: 4 });
    expect(result.accounting.meta.chatUuid).toBe("chat-1");
  });

  it("defaults the prompt, omits unsent settings and passes a public https source through", async () => {
    vendor.serve(json({ uuid: "chat-2" }), json({}), done());
    const result = await call("stx/magnific/magnific", { image: "https://93.184.216.34/in.png" });
    expect(result.success).toBe(true);
    expect(vendor.state.calls).toHaveLength(3);
    expect(JSON.parse(vendor.state.calls[0].init.body)).toEqual({ title: "upscale", scope: "image" });
    expect(JSON.parse(vendor.state.calls[1].init.body)).toEqual({
      chat_uuid: "chat-2", prompt: "upscale", settings: { model_type: "magnific", image_url: ["https://93.184.216.34/in.png"] },
    });
    expect((await result.response.json()).upscale.factor).toBeNull();
    expect(source.state.calls).toHaveLength(0);
  });

  it("matches the source chat title rule", () => {
    expect(syntxChatTitle("a".repeat(80))).toBe("a".repeat(60));
    expect(syntxChatTitle("   ")).toBe("media");
  });

  it.each([
    [{ factor: "4x" }, /factor 2 or 4 \(a number\)/],
    [{ factor: 3 }, /factor 2 or 4/],
    [{ scale: 2 }, /does not support scale/],
    [{ creativity: "5" }, /creativity must be a number/],
    [{ creativity_percent: 5 }, /does not support creativity_percent/],
    [{ size: "2048x2048" }, /does not support size/],
    [{ image: "http://93.184.216.34/in.png" }, /https on a public host/],
    [{ image: "https://192.168.1.5/in.png" }, /https on a public host/],
    [{ image: PNG.toString("base64") }, /data: URI or an https image URL/],
    [{ image: `data:image/gif;base64,${GIF.toString("base64")}` }, /PNG, JPEG or WebP/],
  ])("refuses %j before any call", async (body, message) => {
    const result = await call("syntx/topaz_ai/topaz", body);
    expect(result.status).toBe(400);
    expect(errorText(result)).toMatch(message);
    expect(vendor.state.calls).toHaveLength(0);
  });

  it("takes only the scoped token, never connection fields", async () => {
    for (const credentials of [{ apiKey: JWT }, { accessToken: JWT }, { providerSpecificData: { token: JWT } }, { token: "not-a-jwt" }, null]) {
      const result = await call("syntx/magnific/magnific", {}, credentials);
      expect(result.status).toBe(401);
    }
    expect(vendor.state.calls).toHaveLength(0);
  });

  it("downloads a b64_json result through the guarded transport without the JWT", async () => {
    vendor.serve(json({ uuid: "chat-3" }), json({}), done("https://93.184.216.40/out.png"));
    download.serve(bytes(PNG));
    const result = await call("syntx/magnific/magnific", { image: "https://93.184.216.34/in.png", response_format: "b64_json" });
    expect(result.success).toBe(true);
    const [dl] = download.state.calls;
    expect(dl.url).toBe("https://93.184.216.40/out.png");
    expect(dl.init.headers).toEqual({ Accept: "image/*" });
    expect(dl.init.redirect).toBe("manual");
    expect(dl.init.dispatcher).toBeTruthy();
    const payload = await result.response.json();
    expect(payload.data).toEqual([{ b64_json: PNG.toString("base64") }]);
    expect(payload.upscale).toMatchObject({ output_format: "png" });
  });

  it("refuses a non-image or redirected-to-private download as a lost accepted result", async () => {
    vendor.serve(json({ uuid: "chat-4" }), json({}), done("https://93.184.216.40/out.png"));
    download.serve(bytes(Buffer.from("not an image at all"), 200, "application/octet-stream"));
    const notImage = await call("syntx/magnific/magnific", { image: "https://93.184.216.34/in.png", response_format: "b64_json" });
    expect(notImage.status).toBe(502);
    expect(notImage.acceptedJob.meta).toEqual({ jobState: "accepted", chatUuid: "chat-4" });

    vendor.serve(json({ uuid: "chat-5" }), json({}), done("https://93.184.216.40/out.png"));
    download.serve(new Response(null, { status: 302, headers: { location: "https://127.0.0.1/x" } }));
    const redirected = await call("syntx/magnific/magnific", { image: "https://93.184.216.34/in.png", response_format: "b64_json" });
    expect(redirected.status).toBe(502);
    expect(redirected.acceptedJob.meta.chatUuid).toBe("chat-5");
    expect(download.state.calls).toHaveLength(2);
  });

  it("falls back to URLs from the generate answer when the chat holds no media", async () => {
    vendor.serve(json({ uuid: "chat-6" }), json({ data: { result: { url: "https://cdn.syntx.ai/imm.png" }, api: "https://api.syntx.ai/api/v1/x" } }),
      ready([{ object_type: "text", object_text: "ok", completed: true }]));
    const result = await call("syntx/magnific/magnific", { image: "https://93.184.216.34/in.png" });
    expect((await result.response.json()).data).toEqual([{ url: "https://cdn.syntx.ai/imm.png" }]);
  });

  it("refuses a missing or non-https result URL as accepted work", async () => {
    vendor.serve(json({ uuid: "chat-7" }), json({}), ready([{ object_type: "text", object_text: "ok", completed: true }]));
    expect((await call("syntx/magnific/magnific", { image: "https://93.184.216.34/in.png" })).acceptedJob.meta.chatUuid).toBe("chat-7");
    vendor.serve(json({ uuid: "chat-8" }), json({}), done("http://cdn.syntx.ai/r.png"));
    const insecure = await call("syntx/magnific/magnific", { image: "https://93.184.216.34/in.png" });
    expect(insecure.status).toBe(502);
    expect(errorText(insecure)).toMatch(/not https on a public host/);
  });

  it("fails after five consecutive poll errors and never resubmits", async () => {
    vendor.serve(json({ uuid: "chat-9" }), json({}), ...Array(5).fill(0).map(() => leaky(500)));
    const result = await call("syntx/magnific/magnific", { image: "https://93.184.216.34/in.png" });
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta).toEqual({ jobState: "accepted", chatUuid: "chat-9" });
    expect(vendor.state.calls.filter((c) => c.url.includes("/design/generate"))).toHaveLength(1);
    expect(errorText(result)).not.toContain(JWT);
  });

  it("times out the poll as accepted work", async () => {
    let clock = NOW;
    vendor.serve(json({ uuid: "chat-10" }), json({}), json({ messages: [] }), json({ messages: [] }), json({ messages: [] }));
    const result = await call("syntx/magnific/magnific", { image: "https://93.184.216.34/in.png" }, scoped, {
      syntx: { now: () => clock, sleep: async (ms) => { clock += ms; }, pollTimeoutMs: 5000 },
    });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.chatUuid).toBe("chat-10");
  });

  it("maps generate failures: 5xx and timeouts are submit-unknown, 4xx is not billed", async () => {
    vendor.serve(json({ uuid: "chat-11" }), leaky(502));
    const fivexx = await call("syntx/magnific/magnific", { image: "https://93.184.216.34/in.png" });
    expect(fivexx.acceptedJob.meta).toEqual({ jobState: "submit-unknown", chatUuid: "chat-11" });

    vendor.serve(json({ uuid: "chat-12" }), () => Promise.reject(timeoutErr()));
    const timedOut = await call("syntx/magnific/magnific", { image: "https://93.184.216.34/in.png" });
    expect(timedOut.status).toBe(504);
    expect(timedOut.acceptedJob.meta).toEqual({ jobState: "submit-unknown", chatUuid: "chat-12" });

    vendor.serve(json({ uuid: "chat-13" }), leaky(422));
    const refused = await call("syntx/magnific/magnific", { image: "https://93.184.216.34/in.png" });
    expect(refused.status).toBe(422);
    expect(refused.acceptedJob).toBeUndefined();
    expect(errorText(refused)).not.toContain(JWT);
  });

  it("stops before chat or generate when the upload or chat fails (nothing billed)", async () => {
    vendor.serve(leaky(500));
    const upload = await call("syntx/magnific/magnific", {});
    expect(upload.status).toBe(502);
    expect(upload.acceptedJob).toBeUndefined();
    expect(vendor.state.calls).toHaveLength(1);

    vendor.state.calls.length = 0;
    vendor.serve(json({ files: [{ url: "http://10.0.0.1/x.png" }] }));
    expect((await call("syntx/magnific/magnific", {})).status).toBe(502);
    expect(vendor.state.calls).toHaveLength(1);

    vendor.state.calls.length = 0;
    vendor.serve(json({ uuid: "../../x" }));
    const chat = await call("syntx/magnific/magnific", { image: "https://93.184.216.34/in.png" });
    expect(chat.status).toBe(502);
    expect(chat.acceptedJob).toBeUndefined();
    expect(vendor.state.calls).toHaveLength(1);
  });

  it("accepts the nested data.files upload answer", async () => {
    vendor.serve(json({ data: { files: [{ url: "https://r2.syntx.ai/up/b.png" }] } }), json({ uuid: "chat-14" }), json({}), done());
    expect((await call("syntx/topaz_ai/topaz", {})).success).toBe(true);
    expect(JSON.parse(vendor.state.calls[2].init.body).settings).toEqual({ model_type: "topaz", image_url: ["https://r2.syntx.ai/up/b.png"] });
  });

  it("refuses a redirected SYNTX API answer", async () => {
    vendor.serve(json({ uuid: "chat-15" }), new Response(null, { status: 301, headers: { location: "https://evil.example/" } }));
    const result = await call("syntx/magnific/magnific", { image: "https://93.184.216.34/in.png" });
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("cancels the poll on abort as accepted work", async () => {
    const controller = new AbortController();
    vendor.serve(json({ uuid: "chat-16" }), json({}), () => { controller.abort(); return json({ messages: [] }); });
    const result = await service().upscale({
      body: { model: "syntx/magnific/magnific", image: "https://93.184.216.34/in.png" }, credentials: scoped, signal: controller.signal,
    });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.chatUuid).toBe("chat-16");
  });
});
