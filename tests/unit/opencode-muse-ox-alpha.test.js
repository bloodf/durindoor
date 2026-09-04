import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { PROVIDER_MODELS, getModelSupportedFormats, getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const FREE_ID = "x-preview-f-free";
const GO_ID = "ox-alpha-free";
const OX_PAIRS = [
  ["opencode", FREE_ID],
  ["oc", FREE_ID],
  ["opencode-go", GO_ID],
  ["ocg", GO_ID],
];

describe("OpenCode Muse Responses routing", () => {
  it.each(["muse-spark-1.2", "MUSE-SPARK-1.2-CONTRIBUTOR-FREE"])(
    "routes case-insensitive Muse id %s through Responses",
    (model) => {
      expect(new OpenCodeExecutor().buildUrl(model)).toBe("https://opencode.ai/zen/v1/responses");
      const request = {
        provider: "opencode",
        alias: "oc",
        model,
        sourceFormat: FORMATS.CLAUDE,
      };
      expect(resolveRequestTransport(request).targetFormat).toBe(FORMATS.OPENAI_RESPONSES);
      expect(resolveRequestTransport({ ...request, credentials: { id: "noauth" } }).targetFormat).toBe(FORMATS.OPENAI_RESPONSES);
    },
  );

  it("keeps non-Muse and non-free-provider models on their existing routes", () => {
    expect(new OpenCodeExecutor().buildUrl("big-pickle")).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(resolveRequestTransport({
      provider: "opencode-go",
      alias: "ocg",
      model: "muse-future",
      sourceFormat: FORMATS.CLAUDE,
      credentials: { apiKey: "test" },
    }).targetFormat).not.toBe(FORMATS.OPENAI_RESPONSES);
  });

  it("routes custom OpenAI-compatible Zen Muse through Responses only", () => {
    const zenCredentials = {
      apiKey: "test",
      providerSpecificData: { baseUrl: "https://opencode.ai/zen/v1" },
    };
    const zenRequest = {
      provider: "openai-compatible-chat-zen",
      alias: "openai-compatible-chat-zen",
      model: "muse-spark-1.2",
      sourceFormat: FORMATS.OPENAI,
      credentials: zenCredentials,
    };

    const zenTransport = resolveRequestTransport(zenRequest);
    expect(zenTransport).toMatchObject({
      runtimeTransport: { format: FORMATS.OPENAI_RESPONSES, baseUrl: "https://opencode.ai/zen/v1/responses" },
      targetFormat: FORMATS.OPENAI_RESPONSES,
    });
    expect(new DefaultExecutor(zenRequest.provider).buildUrl(zenRequest.model, true, 0, {
      ...zenCredentials,
      runtimeTransport: zenTransport.runtimeTransport,
    })).toBe("https://opencode.ai/zen/v1/responses");

    const zenBody = new DefaultExecutor(zenRequest.provider).transformRequest(
      zenRequest.model,
      { max_tokens: 100, max_completion_tokens: 200, max_output_tokens: 300 },
      true,
      { ...zenCredentials, runtimeTransport: zenTransport.runtimeTransport },
    );
    expect(zenBody).toEqual({});
    const nonZenCredentials = { ...zenCredentials, providerSpecificData: { baseUrl: "https://example.test/v1" } };
    expect(resolveRequestTransport({ ...zenRequest, model: "luna" }).targetFormat).toBe(FORMATS.OPENAI);
    const nonZenProvider = "openai-compatible-chat-other";
    expect(resolveRequestTransport({
      ...zenRequest,
      provider: nonZenProvider,
      alias: nonZenProvider,
      credentials: nonZenCredentials,
    }).targetFormat).toBe(FORMATS.OPENAI);
    const nonZenBody = new DefaultExecutor(nonZenProvider).transformRequest(
      zenRequest.model,
      { max_tokens: 100, max_completion_tokens: 200, max_output_tokens: 300 },
      true,
      nonZenCredentials,
    );
    expect(nonZenBody).toMatchObject({ max_tokens: 100, max_output_tokens: 300 });
  });

  it("drops every translated token-cap spelling only for OpenCode Muse models", () => {
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "MuSe-Spark-1.2",
      { model: "MuSe-Spark-1.2", messages: [{ role: "user", content: "hi" }], max_tokens: 100 },
      true,
    );
    expect(translated.max_output_tokens).toBe(100);
    const museBody = new OpenCodeExecutor().transformRequest("MuSe-Spark-1.2", translated);
    expect(museBody.max_output_tokens).toBeUndefined();

    const goBody = { max_tokens: 100, max_completion_tokens: 200, max_output_tokens: 300 };
    stripUnsupportedParams("opencode-go", "muse-future", goBody);
    expect(goBody).toEqual({ max_tokens: 100, max_completion_tokens: 200, max_output_tokens: 300 });
    expect(new OpenCodeExecutor().transformRequest("big-pickle", { max_output_tokens: 100 })).toMatchObject({ max_output_tokens: 100 });
  });
});

describe("OpenCode Ox Alpha catalogs", () => {
  it("registers the free model as OpenAI Chat Completions", () => {
    expect(PROVIDER_MODELS.oc).toContainEqual(expect.objectContaining({ id: FREE_ID, name: "Ox Alpha Free" }));
    expect(getModelTargetFormat("oc", FREE_ID)).toBe(FORMATS.OPENAI);
    expect(getModelSupportedFormats("oc", FREE_ID)).toEqual([FORMATS.OPENAI]);
  });

  it("registers the Go model on Chat Completions per the final upstream diff", () => {
    expect(PROVIDER_MODELS["opencode-go"]).toContainEqual(expect.objectContaining({ id: GO_ID, name: "Ox Alpha Free" }));
    expect(getModelSupportedFormats("opencode-go", GO_ID)).toEqual([FORMATS.OPENAI]);
    const selected = resolveRequestTransport({
      provider: "opencode-go",
      alias: "opencode-go",
      model: GO_ID,
      sourceFormat: FORMATS.CLAUDE,
      credentials: { apiKey: "test" },
    });
    expect(selected.runtimeTransport?.baseUrl).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(selected.targetFormat).toBe(FORMATS.OPENAI);
  });
});

describe("OpenCode Ox Alpha capabilities", () => {
  it.each(OX_PAIRS)("scopes image and low/high/max reasoning to %s/%s", (provider, model) => {
    expect(getCapabilitiesForModel(provider, model)).toMatchObject({
      vision: true,
      videoInput: false,
      reasoning: true,
      thinkingFormat: "openai-low-high-max",
      thinkingCanDisable: false,
      contextWindow: 1_000_000,
      maxOutput: 131_072,
    });
    expect(getThinkingLevels(provider, model)).toEqual(["low", "high", "max"]);
  });

  it("keeps same-named models on other providers at safe defaults", () => {
    expect(getCapabilitiesForModel("openai", FREE_ID)).toMatchObject({ vision: false, reasoning: false });
    expect(getCapabilitiesForModel("nvidia", GO_ID)).toMatchObject({ vision: false, reasoning: false });
  });

  it.each(OX_PAIRS)("resolves recognized thinking suffixes for %s/%s", (provider, model) => {
    expect(getCapabilitiesForModel(provider, `${model}(max)`)).toEqual(getCapabilitiesForModel(provider, model));
  });

  it("retains OpenAI image blocks", () => {
    const body = {
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "describe" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
        ],
      }],
    };
    stripUnsupportedModalities(body, FORMATS.OPENAI, getCapabilitiesForModel("opencode", FREE_ID));
    expect(body.messages[0].content).toContainEqual(expect.objectContaining({ type: "image_url" }));
  });

  it.each([
    ["none", "low"],
    ["minimal", "low"],
    ["low", "low"],
    ["medium", "high"],
    ["high", "high"],
    ["xhigh", "max"],
    ["max", "max"],
    ["ultra", "max"],
  ])("maps %s effort to %s", (input, expected) => {
    const body = applyThinking(FORMATS.OPENAI, FREE_ID, { reasoning_effort: input }, "opencode");
    expect(body.reasoning_effort).toBe(expected);
  });

  it("omits auto effort so Ox Alpha uses its upstream default", () => {
    const body = applyThinking(FORMATS.OPENAI, GO_ID, { reasoning_effort: "auto" }, "opencode-go");
    expect(body.reasoning_effort).toBeUndefined();
  });
});
