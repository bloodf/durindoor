// ParalonCloud's live GPU catalog is not in the seed. Unknown chat ids stay
// valid, and a Responses client must hit /v1/responses rather than chat completions.
import { describe, expect, it } from "vitest";
import { getModelSupportedFormats, PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";
import { isValidModel } from "../../src/shared/constants/models.js";
import { APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";

const CHAT = "https://paraloncloud.com/v1/chat/completions";
const RESPONSES = "https://paraloncloud.com/v1/responses";

function route(model, sourceFormat) {
  return resolveRequestTransport({
    provider: "paraloncloud",
    alias: "paraloncloud",
    model,
    sourceFormat,
    credentials: { apiKey: "k" },
  });
}

describe("ParalonCloud passthrough and Responses transport (#20794)", () => {
  it("accepts a live catalog id and keeps seed context lengths", () => {
    expect(APIKEY_PROVIDERS.paraloncloud.passthroughModels).toBe(true);
    expect(isValidModel("paraloncloud", "live-gpu-only")).toBe(true);
    expect(PROVIDER_MODELS.paraloncloud.find((model) => model.id === "qwen3.8-27b").contextLength).toBe(131072);
    expect(PROVIDER_MODELS.paraloncloud.find((model) => model.id === "qwen3-3b").contextLength).toBe(32768);
  });

  it("routes chat and Responses clients onto their own base URLs", () => {
    expect(getModelSupportedFormats("paraloncloud", "live-gpu-only")).toEqual(["openai", "openai-responses"]);
    expect(getModelSupportedFormats("paralon", "qwen3-3b")).toEqual(["openai", "openai-responses"]);
    expect(getModelSupportedFormats("paraloncloud", "multilingual-e5-small")).toBeNull();
    expect(route("qwen3-3b", "openai").runtimeTransport.baseUrl).toBe(CHAT);
    expect(route("live-gpu-only", "openai").runtimeTransport.baseUrl).toBe(CHAT);
    expect(route("qwen3-3b", "openai-responses").runtimeTransport.baseUrl).toBe(RESPONSES);
    expect(route("live-gpu-only", "openai-responses").runtimeTransport.baseUrl).toBe(RESPONSES);
  });
});
