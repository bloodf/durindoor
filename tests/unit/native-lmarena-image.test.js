// Arena (lmarena) image, staged and unregistered. The pinned source routes
// lmarena image models through its generic OpenAI image forwarder, which sends
// no session cookie and no Arena envelope, so there is no native contract to
// port and the staged adapter fails fast. global.fetch is replaced with a spy
// that fails the test if it is ever called. Every credential is synthetic.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import defaultAdapter, {
  createLmarenaImageAdapter,
  LMARENA_IMAGE_NOT_IMPLEMENTED_STATUS,
  LMARENA_IMAGE_RESPONSE_FORMATS,
  LMARENA_IMAGE_UNKNOWN_MODEL_MESSAGE,
  LMARENA_IMAGE_UNKNOWN_MODEL_STATUS,
} from "../../open-sse/services/providerParity/native-lmarena-image/adapter.js";
import {
  LMARENA_AUTH_COOKIE,
  LMARENA_IMAGE_AUTH_HEADER,
  LMARENA_IMAGE_AUTH_TYPE,
  LMARENA_IMAGE_BASE_URL,
  LMARENA_IMAGE_FORMAT,
  LMARENA_IMAGE_MODEL_IDS,
  LMARENA_IMAGE_MODELS,
  LMARENA_IMAGE_PROVIDER_ALIASES,
  LMARENA_IMAGE_PROVIDER_ID,
  LMARENA_IMAGE_PROVIDER_METADATA,
  LMARENA_IMAGE_SUPPORTED_SIZES,
  LMARENA_IMAGE_UNSUPPORTED_REASON,
  resolveLmarenaImageModel,
} from "../../open-sse/services/providerParity/native-lmarena-image/config.js";
import {
  buildLmarenaSourceImageWire,
  LMARENA_SOURCE_WIRE_DEFECTS,
  reconstructLmarenaImageCookie,
  resolveLmarenaImageCookie,
} from "../../open-sse/services/providerParity/native-lmarena-image/contract.js";
import * as bundle from "../../open-sse/services/providerParity/native-lmarena-image/index.js";

const BUNDLE = new URL("../../open-sse/services/providerParity/native-lmarena-image/", import.meta.url);
const registration = JSON.parse(readFileSync(new URL("registration.json", BUNDLE), "utf8"));

const COOKIE_A = "arena-auth-prod-v1=SYNTHETIC-arena-session-a-0001";
const COOKIE_B_CHUNK0 = "SYNTHETIC-chunk-b-0-";
const COOKIE_B_CHUNK1 = "SYNTHETIC-chunk-b-1";
const CRED_A = { id: "conn-a", cookie: COOKIE_A };
const CRED_B = {
  id: "conn-b",
  providerSpecificData: { [`${LMARENA_AUTH_COOKIE}.0`]: COOKIE_B_CHUNK0, [`${LMARENA_AUTH_COOKIE}.1`]: COOKIE_B_CHUNK1 },
};
const BODY = { model: "lmarena/gpt-image-1", prompt: "a stone gate in an emerald forest", size: "1024x1024", n: 1 };

// The 27 category "Image" rows of the pinned directModels.ts, in source order:
// [catalogId, arenaId, displayName, vision].
const SOURCE_IMAGE_ROWS = [
  ["cosmos3-super", "019f4270-5d10-723c-8a7e-dfd5dd2214e5", "cosmos3-super", false],
  ["cosmos3-super-agentic", "019f4270-9eea-79c3-b18f-71303ee41ff8", "cosmos3-super-agentic", false],
  ["flux-2-dev", "019b478d-74ae-7d19-9a8f-6cfde89ab4ca", "flux-2-dev", true],
  ["flux-2-pro", "019b7541-5e4b-7ff7-a34b-b0255b6ca9aa", "flux-2-pro", true],
  ["gemini-2.5-flash-image-preview (nano-banana)", "0199ef2a-583f-7088-b704-b75fd169401d", "gemini-2.5-flash-image-preview (nano-banana)", true],
  ["instant-ramen", "019ed3b3-c4f8-7e67-b72d-385d740096d0", "gemini-3.1-flash-lite-image (nano-banana-2-lite)", true],
  ["gpt-image-1", "6e855f13-55d7-4127-8656-9168a9f4dcc0", "gpt-image-1", true],
  ["blue-crab", "019e4271-4717-7dd9-a0e2-90783fbabd25", "grok-imagine-image-quality (20260519)", true],
  ["hidream-o1-image", "019e1cd7-5cc5-75d2-8b3e-275616dec624", "hidream-o1-image", false],
  ["sungod", "019bec2d-e92c-745d-ae46-c7166590237a", "hunyuan-image-3.0-instruct", true],
  ["ideogram-v3-quality", "73378be5-cdba-49e7-b3d0-027949871aa6", "ideogram-v3-quality", false],
  ["krea-2-large", "019e8ebd-6cfb-7492-949c-a2c4a00301aa", "krea-2-large", false],
  ["krea-2-turbo", "019f049d-7de4-7fae-8237-1c2103b9e730", "krea-2-turbo", false],
  ["lucid-origin", "5a3b3520-c87d-481f-953c-1364687b6e8f", "lucid-origin", false],
  ["kakarot-v2", "019e80aa-37bf-7e89-8a28-41e4ab72ed9f", "mai-image-2.5 (image-edit)", true],
  ["baryonyx", "019e530d-2a50-75e3-95d1-a5ef41d4c24c", "mai-image-2.5 (text-to-image)", false],
  ["iron-bloom", "019ef780-25ef-7878-8b91-307f8f879d42", "muse-image", true],
  ["photon", "e7c9fa2d-6f5d-40eb-8305-0980b11c7cab", "photon", false],
  ["qwen-image-2.0", "019d287c-4906-7f9c-8b78-8a2a86cf00a5", "qwen-image-2.0", true],
  ["qwen-image-2.0-pro", "019d287b-b718-7daa-ad65-502596d0813d", "qwen-image-2.0-pro", true],
  ["recraft-v4", "019c6e76-a7c0-7b05-8dce-bbe3d52c8f4e", "recraft-v4", false],
  ["avalon", "019e7091-f73f-7338-b5e2-4ab5fba37dc2", "reve-2.0 (image-edit)", true],
  ["babylon", "019e86c6-a3dc-73ac-9adc-8c5f304dc2fb", "reve-2.0 (text-to-image)", false],
  ["seedream-5.0-pro", "019f42b5-8c52-7793-9be8-de35eecf7ea9", "seedream-5.0-pro", true],
  ["uni-1.1-max", "019ed208-69ca-7f3f-85ee-182d5f0ea08b", "uni-1.1-max", true],
  ["wan2.7-image-pro", "019db3f0-b024-7478-bd4d-55ea1ec1d421", "wan2.7-image-pro", true],
  ["zen-bear-v3", "019f38c2-002d-7f0f-a391-db6df024b734", "zen-bear-v3", false],
];

const originalFetch = global.fetch;
let fetchSpy;
beforeEach(() => {
  fetchSpy = vi.fn(async () => {
    throw new Error("unexpected network call");
  });
  global.fetch = fetchSpy;
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function errorBody(result) {
  return JSON.parse(await result.response.clone().text());
}

// Isolated staging block: the only assertions that depend on the bundle being
// unregistered. Registration may replace these with positive identity checks;
// every other block holds staged and registered alike.
describe("staging state (pre-registration only)", () => {
  it("is not registered: no image dispatch, image service kind or production import", async () => {
    const { getImageAdapter } = await import("../../open-sse/handlers/imageProviders/index.js");
    const { PROVIDER_MEDIA } = await import("../../open-sse/providers/index.js");
    const { default: lmarenaRegistry } = await import("../../open-sse/providers/registry/lmarena.js");
    expect(getImageAdapter("lmarena")).toBeNull();
    expect(getImageAdapter("lma")).toBeNull();
    expect(lmarenaRegistry.serviceKinds).toEqual(["llm"]);
    expect(PROVIDER_MEDIA.lmarena?.imageConfig).toBeUndefined();
    const dispatch = readFileSync(new URL("../../open-sse/handlers/imageProviders/index.js", import.meta.url), "utf8");
    expect(dispatch).not.toContain("native-lmarena-image");
  });
});

describe("source-pinned metadata", () => {
  it("matches the pinned imageRegistryData.ts lmarena entry exactly", () => {
    expect(registration.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(registration.source.registryEntry).toEqual({
      id: "lmarena",
      alias: "lma",
      baseUrl: "https://arena.ai/nextjs-api/stream/create-evaluation",
      authType: "apikey",
      authHeader: "cookie",
      format: "openai",
      models: "LMARENA_DIRECT_IMAGE_MODELS",
      supportedSizes: ["1024x1024", "1024x1792", "1792x1024"],
    });
    expect(LMARENA_IMAGE_PROVIDER_ID).toBe("lmarena");
    expect(LMARENA_IMAGE_PROVIDER_ALIASES).toEqual(["lma"]);
    expect(LMARENA_IMAGE_BASE_URL).toBe("https://arena.ai/nextjs-api/stream/create-evaluation");
    expect(LMARENA_IMAGE_AUTH_TYPE).toBe("apikey");
    expect(LMARENA_IMAGE_AUTH_HEADER).toBe("cookie");
    expect(LMARENA_IMAGE_FORMAT).toBe("openai");
    expect(LMARENA_IMAGE_SUPPORTED_SIZES).toEqual(["1024x1024", "1024x1792", "1792x1024"]);
  });

  it("carries the 27 source Image rows in source order with ids, arena ids, names and modalities", () => {
    expect(LMARENA_IMAGE_MODELS).toHaveLength(27);
    expect(LMARENA_IMAGE_MODELS.map((m) => [m.id, m.arenaId, m.name, m.vision])).toEqual(SOURCE_IMAGE_ROWS);
    for (const model of LMARENA_IMAGE_MODELS) {
      expect(model.publicName).toBe(model.id);
      expect(model.inputModalities).toEqual(model.vision ? ["text", "image"] : ["text"]);
      expect(Object.isFrozen(model)).toBe(true);
    }
    expect(LMARENA_IMAGE_MODEL_IDS).toEqual(SOURCE_IMAGE_ROWS.map((r) => r[0]));
    expect(registration.models.map((m) => m.id)).toEqual([...LMARENA_IMAGE_MODEL_IDS]);
    expect(registration.models.map((m) => m.arenaId)).toEqual(SOURCE_IMAGE_ROWS.map((r) => r[1]));
  });

  it("records the unsupported state and evidence instead of claiming support", () => {
    expect(LMARENA_IMAGE_PROVIDER_METADATA.supported).toBe(false);
    expect(LMARENA_IMAGE_PROVIDER_METADATA.unsupported).toBe(true);
    expect(LMARENA_IMAGE_PROVIDER_METADATA.supportedResponseFormats).toEqual([]);
    expect(LMARENA_IMAGE_PROVIDER_METADATA.serviceKinds).toEqual(["image"]);
    expect(LMARENA_IMAGE_PROVIDER_METADATA.localConnectionAuthType).toBe("cookie");
    expect(LMARENA_IMAGE_PROVIDER_METADATA.dynamicDiscovery).toMatch(/static/);
    expect(registration.provider.supported).toBe(false);
    expect(registration.provider.auth.sentTo).toEqual([]);
    expect(registration.publicContract.accepted).toEqual([]);
    expect(registration.source.nonNativeEvidence.length).toBeGreaterThanOrEqual(5);
    expect(LMARENA_SOURCE_WIRE_DEFECTS.join("\n")).toMatch(/cookie/);
    expect(registration.status).toMatch(/staged-unregistered/);
  });

  it("exports the documented surface from index.js", () => {
    for (const name of Object.keys(registration.exports)) expect(bundle[name], name).toBeDefined();
    expect(bundle.lmarenaImageAdapter).toBe(defaultAdapter);
  });
});

describe("model resolution (source resolveLmarenaArenaId over Image rows)", () => {
  it("strips lmarena/, lma/ and arena/ prefixes and matches id, public or display name", () => {
    expect(resolveLmarenaImageModel("gpt-image-1").arenaId).toBe("6e855f13-55d7-4127-8656-9168a9f4dcc0");
    expect(resolveLmarenaImageModel("lmarena/flux-2-pro").id).toBe("flux-2-pro");
    expect(resolveLmarenaImageModel("lma/flux-2-dev").id).toBe("flux-2-dev");
    expect(resolveLmarenaImageModel("arena/photon").id).toBe("photon");
    expect(resolveLmarenaImageModel("muse-image").id).toBe("iron-bloom");
    expect(resolveLmarenaImageModel("GEMINI-3.1-FLASH-LITE-IMAGE (NANO-BANANA-2-LITE)").id).toBe("instant-ramen");
    expect(resolveLmarenaImageModel("gemini-2.5-flash-image-preview (nano-banana)").id).toBe("gemini-2.5-flash-image-preview (nano-banana)");
    expect(resolveLmarenaImageModel("019F4270-5D10-723C-8A7E-DFD5DD2214E5").id).toBe("cosmos3-super");
  });

  it("does not resolve chat, search, unknown or malformed ids", () => {
    for (const id of [
      "claude-sonnet-5",
      "gpt-5.2-search",
      "a14546b5-d78d-4cf6-bb61-ab5b8510a9d6",
      "00000000-0000-0000-0000-000000000000",
      "dall-e-3",
      "lmarena/",
      "",
      "   ",
      null,
      undefined,
      42,
      { id: "gpt-image-1" },
    ]) {
      expect(resolveLmarenaImageModel(id), String(id)).toBeNull();
    }
  });
});

describe("fail-fast adapter (no billable submission)", () => {
  it("answers 501 with the pinned reason for every recognised model, without network or credentials", async () => {
    for (const id of LMARENA_IMAGE_MODEL_IDS) {
      const result = await defaultAdapter.generate({ model: id, body: { ...BODY, model: `lmarena/${id}` }, credentials: CRED_A });
      expect(result.success).toBe(false);
      expect(result.status).toBe(LMARENA_IMAGE_NOT_IMPLEMENTED_STATUS);
    }
    const result = await defaultAdapter.generate({ model: "gpt-image-1", body: BODY, credentials: CRED_A });
    expect(result.status).toBe(501);
    expect((await errorBody(result)).error.message).toBe(LMARENA_IMAGE_UNSUPPORTED_REASON);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown model with 400 before anything else", async () => {
    const result = await defaultAdapter.generate({ model: "dall-e-3", body: { ...BODY, model: "lmarena/dall-e-3" }, credentials: CRED_A });
    expect(result.status).toBe(LMARENA_IMAGE_UNKNOWN_MODEL_STATUS);
    expect((await errorBody(result)).error.message).toBe(LMARENA_IMAGE_UNKNOWN_MODEL_MESSAGE);
    const viaBody = await defaultAdapter.generate({ body: { model: "lma/claude-sonnet-5" } });
    expect(viaBody.status).toBe(400);
    const empty = await defaultAdapter.generate();
    expect(empty.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("gives two credentials identical answers and never echoes either session cookie", async () => {
    const a = await defaultAdapter.generate({ model: "gpt-image-1", body: BODY, credentials: CRED_A });
    const b = await defaultAdapter.generate({ model: "gpt-image-1", body: BODY, credentials: CRED_B });
    const textA = await a.response.clone().text();
    const textB = await b.response.clone().text();
    expect(textA).toBe(textB);
    for (const secret of ["SYNTHETIC-arena-session-a-0001", COOKIE_B_CHUNK0, COOKIE_B_CHUNK1, LMARENA_AUTH_COOKIE]) {
      expect(textA).not.toContain(secret);
    }
    expect(a.acceptedJob).toBeUndefined();
    expect(a.accounting).toBeUndefined();
    expect(a.quotaExhausted).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not read credential getters, body media or the signal", async () => {
    const credentials = {};
    const cookieGetter = vi.fn(() => COOKIE_A);
    Object.defineProperty(credentials, "cookie", { get: cookieGetter });
    const mediaGetter = vi.fn(() => "data:image/png;base64,AAAA");
    const body = { ...BODY };
    Object.defineProperty(body, "image", { get: mediaGetter, enumerable: true });
    const controller = new AbortController();
    controller.abort(new Error("caller cancelled"));
    const result = await defaultAdapter.generate({ model: "flux-2-pro", body, credentials, signal: controller.signal });
    expect(result.status).toBe(501);
    expect(cookieGetter).not.toHaveBeenCalled();
    expect(mediaGetter).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses unsupported inputs (edits, masks, streams, b64) the same way, before submission", async () => {
    for (const extra of [
      { image: "https://example.invalid/in.png" },
      { mask: "data:image/png;base64,AAAA" },
      { stream: true },
      { response_format: "b64_json" },
      { size: "4096x4096" },
      { n: 8 },
    ]) {
      const result = await defaultAdapter.generate({ model: "gpt-image-1", body: { ...BODY, ...extra }, credentials: CRED_B });
      expect(result.status, JSON.stringify(extra)).toBe(501);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("declares only what the image core needs to reach the diagnostic", () => {
    expect(defaultAdapter.unsupported).toBe(true);
    expect(defaultAdapter.responseFormats).toBe(LMARENA_IMAGE_RESPONSE_FORMATS);
    expect([...LMARENA_IMAGE_RESPONSE_FORMATS]).toEqual(["url", "b64_json"]);
    expect(defaultAdapter.defaultResponseFormat).toBe("url");
    expect(defaultAdapter.useExecutor).toBeUndefined();
    expect(defaultAdapter.buildUrl).toBeUndefined();
  });

  it("uses an injected reason and falls back to the pinned reason when empty", async () => {
    const custom = createLmarenaImageAdapter({ unsupportedReason: "synthetic reason" });
    expect((await errorBody(await custom.generate({ model: "photon" }))).error.message).toBe("synthetic reason");
    const fallback = createLmarenaImageAdapter({ unsupportedReason: "" });
    expect((await errorBody(await fallback.generate({ model: "photon" }))).error.message).toBe(LMARENA_IMAGE_UNSUPPORTED_REASON);
  });
});

describe("image core integration (synthetic registry, no network)", () => {
  it("passes the 501 through imageGenerationCore without recording success", async () => {
    vi.resetModules();
    vi.doMock("../../open-sse/handlers/imageProviders/index.js", () => ({
      getImageAdapter: (provider) => (provider === "lmarena" ? defaultAdapter : null),
      isImageProvider: (provider) => provider === "lmarena",
      IMAGE_ADAPTERS: {},
    }));
    try {
      const { handleImageGenerationCore } = await import("../../open-sse/handlers/imageGenerationCore.js");
      const onRequestSuccess = vi.fn();
      const result = await handleImageGenerationCore({
        modelInfo: { provider: "lmarena", model: "gpt-image-1" },
        body: { ...BODY },
        credentials: CRED_A,
        onRequestSuccess,
      });
      expect(result.success).toBe(false);
      expect(result.status).toBe(501);
      expect(onRequestSuccess).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../../open-sse/handlers/imageProviders/index.js");
      vi.resetModules();
    }
  });
});

describe("dormant source wire (evidence only, never sent)", () => {
  it("reproduces the pinned generic OpenAI request: no Cookie, OpenAI body, catalog id as model", () => {
    const wire = buildLmarenaSourceImageWire("gpt-image-1", {
      prompt: "p",
      n: 2,
      size: "1024x1792",
      quality: "hd",
      response_format: "url",
      style: "vivid",
      image: "ignored",
      user: "ignored",
    });
    expect(wire).toEqual({
      method: "POST",
      url: "https://arena.ai/nextjs-api/stream/create-evaluation",
      headers: { "Content-Type": "application/json" },
      body: { model: "gpt-image-1", prompt: "p", n: 2, size: "1024x1792", quality: "hd", response_format: "url", style: "vivid" },
    });
    expect(Object.keys(wire.headers).map((h) => h.toLowerCase())).not.toContain("cookie");
    expect(wire.body).not.toHaveProperty("modelAId");
    expect(wire.body).not.toHaveProperty("modality");
    expect(buildLmarenaSourceImageWire("photon", { prompt: "q" }).body).toEqual({ model: "photon", prompt: "q" });
  });

  it("resolves two cookie connections with the source precedence and chunk reconstruction", () => {
    expect(resolveLmarenaImageCookie(CRED_A)).toBe(COOKIE_A);
    expect(resolveLmarenaImageCookie(CRED_B)).toBe(`${LMARENA_AUTH_COOKIE}=${COOKIE_B_CHUNK0}${COOKIE_B_CHUNK1}`);
    expect(resolveLmarenaImageCookie({ apiKey: "arena-auth-prod-v1.1=B; arena-auth-prod-v1.0=A; cf_clearance=x" }))
      .toBe("arena-auth-prod-v1=AB; cf_clearance=x");
    expect(resolveLmarenaImageCookie({ cookie: "x", apiKey: "y" })).toBe("x");
    expect(resolveLmarenaImageCookie({ [`${LMARENA_AUTH_COOKIE}.0`]: " top " })).toBe(`${LMARENA_AUTH_COOKIE}=top`);
    expect(resolveLmarenaImageCookie({ providerSpecificData: { cookie: "psd-cookie" } })).toBe("psd-cookie");
    expect(resolveLmarenaImageCookie({ cookie: "   ", providerSpecificData: {} })).toBe("");
    expect(resolveLmarenaImageCookie(null)).toBe("");
  });

  it("keeps a whole cookie and stops at the first missing chunk", () => {
    expect(reconstructLmarenaImageCookie("arena-auth-prod-v1=whole; other=1")).toBe("arena-auth-prod-v1=whole; other=1");
    expect(reconstructLmarenaImageCookie("arena-auth-prod-v1.0=A; arena-auth-prod-v1.2=C")).toBe("arena-auth-prod-v1=A");
    expect(reconstructLmarenaImageCookie("arena-auth-prod-v1.1=B")).toBe("arena-auth-prod-v1.1=B");
    expect(reconstructLmarenaImageCookie("")).toBe("");
  });
});
