// DashScope native image adapters for alibaba, qwen-cloud,
// qwen-cloud-token-plan and bailian-coding-plan, staged and unregistered
// (#2034). Closed mocks only: every request is answered by an injected fetch,
// an unexpected request fails the test, and every key is synthetic. Wire
// shapes follow OmniRoute c71f0065 (config/imageRegistryData.ts,
// handlers/imageGeneration/providers/alibabaImage.ts and
// shared/constants/alibabaProviderRegions.ts). Passing here says nothing about
// the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-dashscope-image/index.js";
import {
  DASHSCOPE_IMAGE_IDENTITIES,
  DASHSCOPE_IMAGE_PROVIDER_IDS,
  alibabaImageAdapter,
  bailianCodingPlanImageAdapter,
  buildDashscopeImageRequest,
  createDashscopeImageAdapter,
  dashscopeImageAccounting,
  isDashscopeImageRegionSupported,
  normalizeDashscopeImageItems,
  qwenCloudImageAdapter,
  qwenCloudTokenPlanImageAdapter,
  resolveDashscopeImageCredential,
  resolveDashscopeImageModel,
} from "../../open-sse/services/providerParity/native-dashscope-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import alibabaRegistry from "../../open-sse/providers/registry/alibaba.js";
import qwenCloudRegistry from "../../open-sse/providers/registry/qwen-cloud.js";
import qwenCloudTokenPlanRegistry from "../../open-sse/providers/registry/qwen-cloud-token-plan.js";
import bailianRegistry from "../../open-sse/providers/registry/bailian-coding-plan.js";
import { isFunction, isString } from "../../src/shared/utils/typeChecks.js";

const PATH = "/api/v1/services/aigc/multimodal-generation/generation";
const EXPECTED = {
  alibaba: {
    alias: "ali",
    format: "alibaba-image",
    url: `https://dashscope-intl.aliyuncs.com${PATH}`,
    models: ["qwen-image-3.0-pro", "qwen-image-2.0-pro-2026-06-22", "qwen-image-2.0", "z-image-turbo", "wan2.6-t2i"],
    textOnly: ["z-image-turbo", "wan2.6-t2i"],
    sizes: ["1024x1024", "1280x1280", "2048x2048"],
  },
  "qwen-cloud": {
    alias: "qwc",
    format: "qwen-cloud-image",
    url: `https://dashscope-intl.aliyuncs.com${PATH}`,
    models: ["wan2.7-image-pro", "wan2.7-image", "qwen-image-3.0-pro", "qwen-image-2.0-pro-2026-06-22", "qwen-image-2.0-2026-03-03", "z-image-turbo"],
    textOnly: ["z-image-turbo"],
    sizes: ["1024x1024", "2048x2048"],
  },
  "qwen-cloud-token-plan": {
    alias: "qct",
    format: "qwen-token-plan-image",
    url: `https://token-plan.ap-southeast-1.maas.aliyuncs.com${PATH}`,
    models: ["wan2.7-image", "wan2.7-image-pro"],
    textOnly: [],
    sizes: ["1024x1024", "2048x2048"],
  },
  "bailian-coding-plan": {
    alias: "bcp",
    format: "bailian-coding-plan-image",
    url: `https://coding-intl.dashscope.aliyuncs.com${PATH}`,
    models: ["wan2.7-image", "wan2.7-image-pro", "qwen-image-2.0", "qwen-image-2.0-pro"],
    textOnly: [],
    sizes: ["1024x1024", "2048x2048"],
  },
};
const IDS = Object.keys(EXPECTED);
const KEY_A = "sk-SYNTHETIC-dashscope-a-0001";
const KEY_B = "sk-SYNTHETIC-dashscope-b-0002";
const PROMPT = "a silver gate in a green forest";
const NOW = 1_800_000_000_000;
const OUT_A = "https://dashscope-result-intl.oss-accelerate.aliyuncs.com/img/a.png";
const OUT_B = "https://dashscope-result-intl.oss-accelerate.aliyuncs.com/img/b.png";
const IN_A = "https://cdn.example.com/ref-a.png";
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-dashscope-image/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}, url) => {
  const response = new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
  if (url) Object.defineProperty(response, "url", { value: url });
  return response;
};
const success = (urls = [OUT_A], usage = { image_count: urls.length, width: 1024, height: 1024 }) => json({
  request_id: "4b9e2c1a-0000-4000-8000-000000000001",
  output: { choices: [{ finish_reason: "stop", message: { role: "assistant", content: urls.map((image) => ({ image })) } }] },
  usage,
});
const leaky = (status, code, headers = {}) => json({ code, message: `upstream echo ${KEY_A} ${KEY_B} ${PROMPT}`, request_id: "r" }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });

let calls;
let steps;
const fetchImpl = vi.fn(async (url, init) => {
  calls.push({ url: String(url), init, body: isString(init?.body) ? JSON.parse(init.body) : undefined });
  const step = steps.shift();
  if (!step) throw new Error(`Unexpected request: ${url}`);
  return isFunction(step) ? step(String(url), init) : step;
});
const serve = (...answers) => { steps = answers; };

const adapter = (id = "alibaba", options = {}) => createDashscopeImageAdapter(id, { fetchImpl, now: () => NOW, ...options });
const generate = (id = "alibaba", body = {}, { model = EXPECTED[id].models[0], credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  adapter(id, options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const assertNoLeak = async (result) => {
  const text = `${result.response ? await result.response.clone().text() : ""} ${result.error ?? ""} ${JSON.stringify(result)}`;
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
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
  it("stays unregistered and leaves the four existing provider entries unchanged", () => {
    for (const id of IDS) expect(getImageAdapter(id), id).toBeNull();
    expect(alibabaRegistry.serviceKinds).toEqual(["llm", "video"]);
    expect(qwenCloudRegistry.serviceKinds).toEqual(["llm"]);
    expect(qwenCloudTokenPlanRegistry.serviceKinds ?? []).not.toContain("image");
    expect(bailianRegistry.serviceKinds ?? []).not.toContain("image");
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("identities and metadata", () => {
  it("exports the pinned source registry fields for each identity", () => {
    expect(DASHSCOPE_IMAGE_PROVIDER_IDS).toEqual(IDS);
    expect(staged.DASHSCOPE_IMAGE_PATH).toBe(PATH);
    for (const id of IDS) {
      const identity = DASHSCOPE_IMAGE_IDENTITIES[id];
      const want = EXPECTED[id];
      expect(identity.id).toBe(id);
      expect(identity.alias).toBe(want.alias);
      expect(identity.format).toBe(want.format);
      expect(identity.url).toBe(want.url);
      expect(identity.models.map((m) => m.id)).toEqual(want.models);
      expect(identity.models.filter((m) => !m.inputModalities.includes("image")).map((m) => m.id)).toEqual(want.textOnly);
      expect(identity.supportedSizes).toEqual(want.sizes);
    }
  });

  it("aliases and hosts match the existing local provider identities", () => {
    expect(alibabaRegistry.alias).toBe("ali");
    expect(qwenCloudRegistry.alias).toBe("qwc");
    expect(qwenCloudTokenPlanRegistry.alias).toBe("qct");
    expect(bailianRegistry.alias).toBe("bcp");
    expect(new URL(alibabaRegistry.transport.baseUrl).origin).toBe(new URL(EXPECTED.alibaba.url).origin);
    expect(new URL(qwenCloudRegistry.transport.baseUrl).origin).toBe(new URL(EXPECTED["qwen-cloud"].url).origin);
    expect(new URL(qwenCloudTokenPlanRegistry.transport.baseUrl).origin).toBe(new URL(EXPECTED["qwen-cloud-token-plan"].url).origin);
    expect(new URL(bailianRegistry.transport.baseUrl).origin).toBe(new URL(EXPECTED["bailian-coding-plan"].url).origin);
  });

  it("default instances are one per identity", () => {
    const defaults = [alibabaImageAdapter, qwenCloudImageAdapter, qwenCloudTokenPlanImageAdapter, bailianCodingPlanImageAdapter];
    expect(defaults.map((a) => a.provider)).toEqual(IDS);
    for (const a of defaults) {
      expect(a.aliases).toEqual([EXPECTED[a.provider].alias]);
      expect(a.url).toBe(EXPECTED[a.provider].url);
      expect(a.responseFormats).toEqual(["url"]);
      expect(isFunction(a.generate)).toBe(true);
    }
    expect(() => createDashscopeImageAdapter("alibaba-cn")).toThrow(/Unknown DashScope image identity/);
  });

  it("registration.json matches the module", () => {
    expect(REGISTRATION.issue).toBe("#2034");
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.providers.map((p) => p.canonicalId)).toEqual(IDS);
    for (const entry of REGISTRATION.providers) {
      const want = EXPECTED[entry.canonicalId];
      expect(entry.aliases).toEqual([want.alias]);
      expect(entry.format).toBe(want.format);
      expect(entry.url).toBe(want.url);
      expect(entry.models).toEqual(want.models);
      expect(entry.textOnlyModels).toEqual(want.textOnly);
      expect(entry.supportedSizes).toEqual(want.sizes);
    }
    expect(REGISTRATION.auth.connectionBaseUrlHonored).toBe(false);
    expect(Object.keys(REGISTRATION.endpoints)).toEqual(["generate"]);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
  });
});

describe("model and credential resolution", () => {
  it("accepts a bare id, the identity id prefix and its alias prefix only", () => {
    expect(resolveDashscopeImageModel("alibaba", "wan2.6-t2i")?.id).toBe("wan2.6-t2i");
    expect(resolveDashscopeImageModel("alibaba", "alibaba/wan2.6-t2i")?.id).toBe("wan2.6-t2i");
    expect(resolveDashscopeImageModel("alibaba", "ali/wan2.6-t2i")?.id).toBe("wan2.6-t2i");
    expect(resolveDashscopeImageModel("alibaba", "qwc/z-image-turbo")).toBeNull();
    expect(resolveDashscopeImageModel("qwen-cloud", "ali/z-image-turbo")).toBeNull();
    expect(resolveDashscopeImageModel("bailian-coding-plan", "qwen-image-3.0-pro")).toBeNull();
    expect(resolveDashscopeImageModel("qwen-cloud-token-plan", "qct/qwen-image-2.0")).toBeNull();
    expect(resolveDashscopeImageModel("alibaba", "alibaba/../x")).toBeNull();
    expect(resolveDashscopeImageModel("nope", "wan2.7-image")).toBeNull();
  });

  it("does not substitute a model across identities", () => {
    // Same-named ids are each identity's own; no identity serves another's list.
    expect(resolveDashscopeImageModel("bailian-coding-plan", "qwen-image-2.0-pro")?.id).toBe("qwen-image-2.0-pro");
    expect(resolveDashscopeImageModel("alibaba", "qwen-image-2.0-pro")).toBeNull();
    expect(resolveDashscopeImageModel("qwen-cloud", "qwen-image-2.0")).toBeNull();
  });

  it("uses apiKey, then accessToken", () => {
    expect(resolveDashscopeImageCredential({ apiKey: ` ${KEY_A} `, accessToken: KEY_B })).toBe(KEY_A);
    expect(resolveDashscopeImageCredential({ apiKey: "", accessToken: KEY_B })).toBe(KEY_B);
    expect(resolveDashscopeImageCredential({})).toBeNull();
    expect(resolveDashscopeImageCredential(null)).toBeNull();
  });

  it("supports only the global-sg region", () => {
    expect(isDashscopeImageRegionSupported({})).toBe(true);
    expect(isDashscopeImageRegionSupported({ providerSpecificData: { region: "global-sg" } })).toBe(true);
    expect(isDashscopeImageRegionSupported({ providerSpecificData: { region: " Singapore " } })).toBe(true);
    expect(isDashscopeImageRegionSupported({ providerSpecificData: { region: "china-beijing" } })).toBe(false);
    expect(isDashscopeImageRegionSupported({ providerSpecificData: { region: "mars" } })).toBe(false);
    expect(isDashscopeImageRegionSupported({ providerSpecificData: { region: 3 } })).toBe(false);
  });
});

describe("request contract", () => {
  it("sends the source minimum body when nothing else is set", () => {
    expect(buildDashscopeImageRequest("alibaba", "wan2.6-t2i", { prompt: ` ${PROMPT} ` })).toEqual({
      model: "wan2.6-t2i",
      input: { messages: [{ role: "user", content: [{ text: PROMPT }] }] },
    });
  });

  it("matches the source body for the source test request, in source parameter order", () => {
    const body = buildDashscopeImageRequest("alibaba", "alibaba/qwen-image-3.0-pro", {
      prompt: "A cinematic horse portrait", seed: 42, watermark: false, prompt_extend: true, negative_prompt: "blurry", n: 1, size: "2048x2048", user: "u-1",
    });
    expect(JSON.stringify(body)).toBe(JSON.stringify({
      model: "qwen-image-3.0-pro",
      input: { messages: [{ role: "user", content: [{ text: "A cinematic horse portrait" }] }] },
      parameters: { size: "2048*2048", n: 1, negative_prompt: "blurry", prompt_extend: true, watermark: false, seed: 42 },
    }));
  });

  it("puts input images before the text and forwards the remaining source parameters", () => {
    const body = buildDashscopeImageRequest("qwen-cloud-token-plan", "qct/wan2.7-image-pro", {
      prompt: PROMPT, image: IN_A, image_urls: [{ url: "https://cdn.example.com/ref-b.png" }, IN_A], imageUrls: [{ image_url: "https://cdn.example.com/ref-c.png" }],
      size: "1024*1024", n: 2, enable_sequential: true, thinking_mode: false, color_palette: [{ hex: "#00A86B", ratio: "60%" }],
    });
    expect(body.input.messages[0].content).toEqual([
      { image: IN_A }, { image: "https://cdn.example.com/ref-c.png" }, { image: "https://cdn.example.com/ref-b.png" }, { text: PROMPT },
    ]);
    expect(JSON.stringify(body.parameters)).toBe(JSON.stringify({
      size: "1024*1024", n: 2, enable_sequential: true, thinking_mode: false, color_palette: [{ hex: "#00A86B", ratio: "60%" }],
    }));
  });

  it.each([
    [{ parameters: { size: "1024*1024" } }, /raw parameters/],
    [{ prompt: "  " }, /Prompt is required/],
    [{ prompt: "x".repeat(8193) }, /must not exceed/],
    [{ size: "2K" }, /WIDTHxHEIGHT/],
    [{ size: "10x10" }, /WIDTHxHEIGHT/],
    [{ n: 0 }, /n from 1/],
    [{ n: 1.5 }, /n from 1/],
    [{ n: 11 }, /n from 1/],
    [{ seed: -1 }, /seed/],
    [{ watermark: "no" }, /watermark must be true or false/],
    [{ thinking_mode: 1 }, /thinking_mode must be true or false/],
    [{ color_palette: "red" }, /color_palette/],
    [{ color_palette: [{ hex: { nested: true } }] }, /color_palette/],
    [{ response_format: "b64_json" }, /URLs only/],
    [{ stream: true }, /streaming/],
    [{ quality: "hd" }, /does not support quality/],
    [{ messages: [] }, /does not support messages/],
    [{ image: "http://cdn.example.com/a.png" }, /https URLs on a public host/],
    [{ image: "https://127.0.0.1/a.png" }, /https URLs on a public host/],
    [{ image: "data:image/png;base64,AAAA" }, /https URLs on a public host/],
    [{ image: { path: IN_A } }, /https URLs on a public host/],
    [{ image_urls: Array.from({ length: 10 }, (_, i) => `https://cdn.example.com/${i}.png`) }, /at most 9/],
  ])("refuses %j before sending", (extra, message) => {
    expect(() => buildDashscopeImageRequest("qwen-cloud", "wan2.7-image", { prompt: PROMPT, ...extra })).toThrow(message);
  });

  it("refuses input images for text-only models", () => {
    expect(() => buildDashscopeImageRequest("alibaba", "z-image-turbo", { prompt: PROMPT, image: IN_A })).toThrow(/does not take input images/);
  });

  it("refuses models outside the identity's allowlist with the source message", () => {
    expect(() => buildDashscopeImageRequest("bailian-coding-plan", "bailian-coding-plan/qwen-image-3.0-pro", { prompt: PROMPT }))
      .toThrow(/Unsupported bailian-coding-plan image model/);
    expect(() => buildDashscopeImageRequest("alibaba", "qwc/z-image-turbo", { prompt: PROMPT })).toThrow(/Unsupported alibaba image model/);
  });
});

describe("exact wire per identity", () => {
  it.each(IDS)("%s sends every model to its own endpoint with its own Bearer key", async (id) => {
    const models = EXPECTED[id].models;
    serve(...models.map(() => success()));
    for (const model of models) {
      const result = await generate(id, { size: "1024x1024" }, { model: `${EXPECTED[id].alias}/${model}` });
      expect(result.success, model).toBe(true);
    }
    expect(calls.map((c) => c.url)).toEqual(models.map(() => EXPECTED[id].url));
    for (const [index, call] of calls.entries()) {
      expect(call.init.method).toBe("POST");
      expect(call.init.redirect).toBe("manual");
      expect(call.init.headers).toEqual({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" });
      expect(call.body).toEqual({
        model: models[index],
        input: { messages: [{ role: "user", content: [{ text: PROMPT }] }] },
        parameters: { size: "1024*1024" },
      });
    }
  });

  it("refuses before any send: bad body, missing key, unsupported region, pre-aborted signal", async () => {
    const before = new AbortController();
    before.abort();
    const results = [
      await generate("alibaba", { quality: "hd" }),
      await generate("alibaba", {}, { model: "qwc/z-image-turbo" }),
      await generate("alibaba", {}, { credentials: {} }),
      await generate("qwen-cloud", {}, { credentials: { apiKey: KEY_A, providerSpecificData: { region: "china-beijing" } } }),
      await generate("alibaba", {}, { signal: before.signal }),
    ];
    expect(results.map((r) => r.status)).toEqual([400, 400, 401, 400, 499]);
    for (const result of results) {
      expect(result.success).toBe(false);
      expect(result.acceptedJob).toBeUndefined();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignores a connection base URL: the key goes only to the fixed origin", async () => {
    serve(success());
    const result = await generate("bailian-coding-plan", {}, {
      credentials: { apiKey: KEY_A, providerSpecificData: { baseUrl: "https://evil.example.com/api/v1", region: "global-sg" } },
    });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe(EXPECTED["bailian-coding-plan"].url);
  });
});

describe("credential isolation", () => {
  it("two connections of one identity each use only their own key", async () => {
    serve(success(), success());
    await generate("qwen-cloud", {}, { credentials: { apiKey: KEY_A } });
    await generate("qwen-cloud", {}, { credentials: { accessToken: KEY_B } });
    expect(calls.map((c) => c.init.headers.Authorization)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
  });

  it("identities sharing a host or a model id never swap keys, hosts or models", async () => {
    serve(success(), success(), success(), success());
    await generate("alibaba", {}, { model: "z-image-turbo", credentials: { apiKey: KEY_A } });
    await generate("qwen-cloud", {}, { model: "z-image-turbo", credentials: { apiKey: KEY_B } });
    await generate("qwen-cloud-token-plan", {}, { model: "wan2.7-image", credentials: { apiKey: KEY_A } });
    await generate("bailian-coding-plan", {}, { model: "wan2.7-image", credentials: { apiKey: KEY_B } });
    expect(calls.map((c) => [c.url, c.init.headers.Authorization, c.body.model])).toEqual([
      [EXPECTED.alibaba.url, `Bearer ${KEY_A}`, "z-image-turbo"],
      [EXPECTED["qwen-cloud"].url, `Bearer ${KEY_B}`, "z-image-turbo"],
      [EXPECTED["qwen-cloud-token-plan"].url, `Bearer ${KEY_A}`, "wan2.7-image"],
      [EXPECTED["bailian-coding-plan"].url, `Bearer ${KEY_B}`, "wan2.7-image"],
    ]);
    expect(new Set(calls.slice(2).map((c) => new URL(c.url).origin)).size).toBe(2);
  });
});

describe("success, artifacts and usage", () => {
  it("returns the source URL list, deduped, with one accounting record", async () => {
    serve(success([OUT_A, OUT_B, OUT_A], { input_tokens: 12, output_tokens: 3, image_count: 2, width: 1024, height: 1024, junk: "x" }));
    const result = await generate("qwen-cloud-token-plan", { n: 2 }, { model: "wan2.7-image-pro" });
    expect(result.success).toBe(true);
    expect(await payload(result)).toEqual({ created: Math.floor(NOW / 1000), data: [{ url: OUT_A }, { url: OUT_B }] });
    expect(result.accounting.nativeUnits).toEqual({ images: 2 });
    expect(result.accounting.meta.nativeUnitsSource).toBe("returned-images");
    expect(result.accounting.tokens).toEqual({ input_tokens: 12, output_tokens: 3 });
    expect(result.accounting.meta.providerUsage).toEqual({
      path: "usage", value: { input_tokens: 12, output_tokens: 3, image_count: 2, width: 1024, height: 1024 },
    });
    expect(result.accounting.meta.providerImageCount).toBe(2);
    expect(result.accounting.meta.providerRequestId).toBe("4b9e2c1a-0000-4000-8000-000000000001");
    expect(result.accounting.cost).toBeNull();
    expect(result.accounting.costStatus).toBe("unknown");
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("counts returned images, never requested n, and keeps width/height out of tokens", () => {
    const accounting = dashscopeImageAccounting("alibaba", { usage: { image_count: 4, width: 2048, height: 2048 } }, { data: [{ url: OUT_A }] });
    expect(accounting.nativeUnits.images).toBe(1);
    expect(accounting.tokens).toEqual({});
    expect(accounting.meta.providerImageCount).toBe(4);
  });

  it("drops unsafe result URLs and fails accepted when nothing safe is left", async () => {
    expect(normalizeDashscopeImageItems({ output: { choices: [{ message: { content: [
      { image: "http://cdn.example.com/a.png" }, { image: "https://10.0.0.1/a.png" }, { image: `https://${KEY_A}@cdn.example.com/a.png` }, { text: "hi" }, { image: OUT_A },
    ] } }] } })).toEqual({ items: [{ url: OUT_A }], unsafe: 3 });
    serve(success(["http://cdn.example.com/a.png"]));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/no safe images/);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(result.acceptedJob.costSource).toBe("accepted-job");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a 2xx without images or with an unreadable body is accepted, not replayed", async () => {
    serve(json({ output: { choices: [] } }), new Response("not json", { status: 200 }));
    const empty = await generate();
    const unreadable = await generate();
    expect([empty.status, unreadable.status]).toEqual([502, 502]);
    expect(empty.error).toMatch(/returned no images/);
    expect([empty.acceptedJob.meta.jobState, unreadable.acceptedJob.meta.jobState]).toEqual(["accepted", "accepted"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses an oversized answer as accepted", async () => {
    serve(new Response("x".repeat(1024 * 1024 + 10), { status: 200 }));
    const result = await generate();
    expect(result.success).toBe(false);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});

describe("refusals, quota and errors", () => {
  it("passes 401/403 auth refusals without acceptedJob or leaks", async () => {
    serve(leaky(401, "InvalidApiKey"), leaky(403, "AccessDenied"));
    for (const status of [401, 403]) {
      const result = await generate();
      expect(result.status).toBe(status);
      expect(result.error).toMatch(/rejected the API key/);
      expect(result.acceptedJob).toBeUndefined();
      expect(result.quotaExhausted).toBeUndefined();
      await assertNoLeak(result);
    }
  });

  it("marks unpaid accounts as quota exhausted on this connection only", async () => {
    serve(leaky(400, "Arrearage"), leaky(403, "AccessDenied.Unpurchased"), leaky(402, "Whatever"));
    for (let i = 0; i < 3; i += 1) {
      const result = await generate("bailian-coding-plan");
      expect(result.status).toBe(402);
      expect(result.quotaExhausted).toBe(true);
      expect(result.acceptedJob).toBeUndefined();
      await assertNoLeak(result);
    }
  });

  it("maps 429 to a rate limit with Retry-After evidence", async () => {
    serve(leaky(429, "Throttling.RateQuota", { "retry-after": "7" }));
    const result = await generate("qwen-cloud");
    expect(result.status).toBe(429);
    expect(result.error).toMatch(/rate limited.*Throttling\.RateQuota/);
    expect(result.quotaExhausted).toBeUndefined();
    await assertNoLeak(result);
  });

  it("passes other 4xx with only a safe vendor code", async () => {
    serve(leaky(400, "DataInspectionFailed"), leaky(404, "ModelNotFound"), leaky(400, "bad code with spaces"));
    const a = await generate();
    const b = await generate();
    const c = await generate();
    expect([a.status, b.status, c.status]).toEqual([400, 404, 400]);
    expect(a.error).toMatch(/\(DataInspectionFailed\)/);
    expect(c.error).not.toMatch(/bad code/);
    for (const result of [a, b, c]) await assertNoLeak(result);
  });

  it("a 5xx is an unknown outcome and is never retried", async () => {
    serve(leaky(503, "InternalError"));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await assertNoLeak(result);
  });

  it("refuses redirects without following them and off-origin answers as unknown", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example.com/" } }), json({}, 200, {}, "https://evil.example.com/x"));
    const redirect = await generate();
    const foreign = await generate();
    expect(redirect.status).toBe(502);
    expect(redirect.error).toMatch(/redirect refused/);
    expect(redirect.acceptedJob).toBeUndefined();
    expect(foreign.status).toBe(502);
    expect(foreign.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("abort, deadline and uncertain submits", () => {
  it("a proven pre-connect failure is a plain 502 without acceptedJob", async () => {
    serve(() => { throw transportError("ECONNREFUSED"); });
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("a mid-send disconnect is unknown and never replayed", async () => {
    serve(() => { throw transportError("ECONNRESET"); });
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a submit deadline ends the wait even when the transport ignores the signal", async () => {
    serve(() => new Promise(() => {}));
    const result = await generate("alibaba", {}, { options: { submitTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.error).toMatch(/timed out; whether it ran is unknown/);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a caller abort after send is unknown; the fetch signal is aborted", async () => {
    const controller = new AbortController();
    let seen;
    serve((_, init) => {
      seen = init.signal;
      setTimeout(() => controller.abort(), 5);
      return new Promise(() => {});
    });
    const result = await generate("qwen-cloud", {}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a caller abort during the body read is accepted, not replayed", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); setTimeout(() => controller.abort(), 5); } });
    serve(new Response(stream, { status: 200 }));
    const result = await generate("qwen-cloud-token-plan", {}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("the total deadline also bounds the body read", async () => {
    let clock = NOW;
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); } });
    serve(() => { clock += 1000; return new Response(stream, { status: 200 }); });
    const result = await createDashscopeImageAdapter("alibaba", { fetchImpl, now: () => clock, timeoutMs: 1030 })
      .generate({ model: "wan2.6-t2i", body: { prompt: PROMPT }, credentials: { apiKey: KEY_A } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});
