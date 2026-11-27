// Ideogram native image request contract (#2034), independent of the staged
// adapter's behavior suite. Synthetic, docs-shaped wire fixtures only: closed
// fetch mocks, synthetic keys, no live call.
//
// Primary source, checked 2026-11-27 (public GET only):
//   Ideogram API v1 OpenAPI spec, https://developer.ideogram.ai/openapi/ideogram-api-v1.json
//   (info.version 1.0.0, servers https://api.ideogram.ai, security ApiKeyAuth = header `Api-Key`)
//   - POST /generate, operationId generate_post_generate_image ("Generate (legacy)",
//     https://developer.ideogram.ai/v1/api-reference/legacy-endpoints/generate):
//     application/json GenerateImageRequest { image_request: ImageRequest } (required),
//     ImageRequest.required = ["prompt"], aspect_ratio: AspectRatio, model: ModelEnum.
//   - POST /v1/ideogram-v3/generate, operationId generate_post_generate_image_v3
//     ("Generate with Ideogram 3.0",
//     https://developer.ideogram.ai/v1/api-reference/generate-images/generate-v3):
//     multipart/form-data, required ["prompt"], aspect_ratio: AspectRatioV3, no model field.
//   - Both answer { created, data: [ImageObject] }; ImageObject.url is nullable and
//     empty when is_image_safe is false. 422 is "Prompt failed the safety check" with
//     { error: string }. Older endpoints add a `Link: <...>; rel="successor-version"`
//     header and a JSON `notice` (https://developer.ideogram.ai/v2/ideogram-api/deprecations).
// Ideogram publishes no official SDK package (v2 docs, "SDKs and Client Libraries").
//
// The pinned OmniRoute source (c71f0065, handlers/imageGeneration/providers/ideogram.ts)
// posts { prompt, aspect_ratio, model } flat to /generate for V_3 and V_2A; these
// assertions follow the documented contract instead.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildIdeogramImageRequest,
  createIdeogramImageAdapter,
  encodeIdeogramImageRequest,
} from "../../open-sse/services/providerParity/native-ideogram-image/index.js";

// Enums and property lists copied from the spec above.
const DOC = Object.freeze({
  legacyUrl: "https://api.ideogram.ai/generate",
  v3Url: "https://api.ideogram.ai/v1/ideogram-v3/generate",
  imageRequestProperties: [
    "prompt", "aspect_ratio", "model", "magic_prompt_option", "seed", "style_type",
    "negative_prompt", "num_images", "resolution", "color_palette",
  ],
  modelEnum: ["V_1", "V_1_TURBO", "V_2", "V_2_TURBO", "V_2A", "V_2A_TURBO", "AUTO"],
  aspectRatio: [
    "ASPECT_10_16", "ASPECT_16_10", "ASPECT_9_16", "ASPECT_16_9", "ASPECT_3_2", "ASPECT_2_3",
    "ASPECT_4_3", "ASPECT_3_4", "ASPECT_1_1", "ASPECT_1_3", "ASPECT_3_1",
  ],
  v3FormProperties: [
    "prompt", "seed", "resolution", "aspect_ratio", "rendering_speed", "magic_prompt",
    "negative_prompt", "num_images", "color_palette", "style_codes", "style_type", "style_preset",
    "custom_model_uri", "style_reference_images", "character_reference_images",
    "character_reference_images_mask", "enable_copyright_detection",
  ],
  aspectRatioV3: ["1x3", "3x1", "1x2", "2x1", "9x16", "16x9", "10x16", "16x10", "2x3", "3x2", "3x4", "4x3", "4x5", "5x4", "1x1"],
});

const KEY = "ideo-SYNTHETIC-contract-key-0001";
const PROMPT = "a silver gate carved into forest stone";
// Literal public IP so the local guarded image fetch needs no DNS.
const RESULT_URL = "https://8.8.4.4/api/images/direct/SYNTHETIC-contract";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 9, 9, 9, 9]);

// Docs-shaped answers (GenerateImageResponse / ImageGenerationResponseV3).
const docsAnswer = ({ url = RESULT_URL, safe = true, extra = {}, headers = {} } = {}) => new Response(JSON.stringify({
  created: "2026-11-27T09:30:00Z",
  data: [{ prompt: PROMPT, resolution: "1312x736", is_image_safe: safe, seed: 12345, url: safe ? url : null, style_type: "GENERAL" }],
  ...extra,
}), { status: 200, headers: { "content-type": "application/json", ...headers } });
const png = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });

const originalFetch = global.fetch;
let sent;

function serve(...steps) {
  sent = [];
  global.fetch = vi.fn(async (url, init) => {
    sent.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return step;
  });
}
const posts = () => sent.filter((call) => call.init?.method === "POST");
const run = (model, extra = {}) =>
  createIdeogramImageAdapter().generate({ model, body: { prompt: PROMPT, ...extra }, credentials: { apiKey: KEY } });

beforeEach(() => serve());
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("V_2A: POST /generate (generate_post_generate_image)", () => {
  it("sends a documented GenerateImageRequest envelope and returns the downloaded image", async () => {
    serve(docsAnswer(), png());
    const result = await run("V_2A", { size: "1792x1024" });
    expect(result.success).toBe(true);

    expect(posts()).toHaveLength(1);
    const [post] = posts();
    expect(post.url).toBe(DOC.legacyUrl);
    expect(post.init.headers).toEqual({ "Content-Type": "application/json", "Api-Key": KEY });
    expect(typeof post.init.body).toBe("string");
    const wire = JSON.parse(post.init.body);

    // The envelope is the only top-level key; nothing is sent flat.
    expect(Object.keys(wire)).toEqual(["image_request"]);
    expect(wire).toEqual({ image_request: { prompt: PROMPT, aspect_ratio: "ASPECT_16_9", model: "V_2A" } });
    for (const key of Object.keys(wire.image_request)) expect(DOC.imageRequestProperties).toContain(key);
    expect(DOC.modelEnum).toContain(wire.image_request.model);
    expect(DOC.aspectRatio).toContain(wire.image_request.aspect_ratio);
    expect(post.init.body).not.toContain(KEY);

    const body = await result.response.json();
    expect(body.data).toEqual([{ b64_json: PNG.toString("base64") }]);
    expect(sent[1].url).toBe(RESULT_URL);
    expect(sent[1].init.headers).toBeUndefined();
    expect(result.accounting.nativeUnits.images).toBe(1);
  });

  it("tolerates the documented successor signals on an older endpoint", async () => {
    serve(docsAnswer({
      extra: { notice: "This endpoint has a newer replacement" },
      headers: { link: "<https://developer.ideogram.ai/v2/api-reference/images/generate/ideogram-4-5>; rel=\"successor-version\"" },
    }), png());
    const result = await run("V_2A");
    expect(result.success).toBe(true);
    expect(JSON.stringify(await result.response.json())).not.toContain("notice");
  });
});

describe("V_3: POST /v1/ideogram-v3/generate (generate_post_generate_image_v3)", () => {
  it("sends documented multipart form fields with no model and no JSON content type", async () => {
    serve(docsAnswer(), png());
    const result = await run("V_3", { aspect_ratio: "16:9" });
    expect(result.success).toBe(true);

    const [post] = posts();
    expect(post.url).toBe(DOC.v3Url);
    expect(post.init.headers).toEqual({ "Api-Key": KEY });
    expect(post.init.body).toBeInstanceOf(FormData);
    const fields = Object.fromEntries(post.init.body.entries());
    expect(fields).toEqual({ prompt: PROMPT, aspect_ratio: "16x9" });
    for (const key of Object.keys(fields)) expect(DOC.v3FormProperties).toContain(key);
    expect(DOC.aspectRatioV3).toContain(fields.aspect_ratio);
    expect(fields).not.toHaveProperty("model");
    expect(fields).not.toHaveProperty("image_request");

    // The encoded multipart body carries the form, never the key.
    const encoded = await new Request(post.url, { method: "POST", body: post.init.body }).text();
    expect(encoded).toContain('name="prompt"');
    expect(encoded).toContain('name="aspect_ratio"');
    expect(encoded).not.toContain(KEY);

    expect((await result.response.json()).data).toHaveLength(1);
  });

  it("is the default model, as in the source", async () => {
    serve(docsAnswer(), png());
    expect((await run("")).success).toBe(true);
    expect(posts()[0].url).toBe(DOC.v3Url);
  });
});

describe("documented answers that are not images", () => {
  it.each([["V_2A"], ["V_3"]])("%s: is_image_safe false with a null url is a possibly billed failure, not downloaded", async (model) => {
    serve(docsAnswer({ safe: false }));
    const result = await run(model);
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unusable");
    expect(sent).toHaveLength(1);
  });

  it.each([["V_2A"], ["V_3"]])("%s: a documented 422 safety refusal keeps its status without quoting it", async (model) => {
    serve(new Response(JSON.stringify({ error: `Prompt failed the safety check ${KEY}` }), { status: 422, headers: { "content-type": "application/json" } }));
    const result = await run(model);
    expect(result.status).toBe(422);
    expect(result.acceptedJob).toBeUndefined();
    expect(await result.response.text()).not.toContain(KEY);
    expect(sent).toHaveLength(1);
  });
});

describe("request builder and encoder", () => {
  it("never produces the source's flat body for either model", () => {
    for (const model of ["V_3", "V_2A"]) {
      const { request } = buildIdeogramImageRequest(model, { prompt: "x" });
      expect(request.fields).not.toEqual({ prompt: "x", aspect_ratio: "ASPECT_16_9", model });
      const { body } = encodeIdeogramImageRequest(request, KEY);
      if (typeof body === "string") expect(Object.keys(JSON.parse(body))).toEqual(["image_request"]);
      else expect(body.has("model")).toBe(false);
    }
  });

  it("builds a fresh body for each fanned-out call", () => {
    const { request } = buildIdeogramImageRequest("V_3", { prompt: "x" });
    expect(encodeIdeogramImageRequest(request, KEY).body).not.toBe(encodeIdeogramImageRequest(request, KEY).body);
  });

  it("refuses a model with no documented operation here before any send", async () => {
    for (const model of ["V_2", "V_3_TURBO", "AUTO"]) {
      expect(() => buildIdeogramImageRequest(model, { prompt: "x" })).toThrow(/Unsupported Ideogram image model/);
      expect((await run(model)).status).toBe(400);
    }
    expect(sent).toHaveLength(0);
  });
});
