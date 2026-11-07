// claude-haiku-5-5 on OpenCode Go (#1557, upstream c8644368).
// Unverified: that /messages accepts the id and /chat/completions answers ModelProtocolUnsupported
// is upstream's report only; no live OpenCode Go call was made.
import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelTargetFormat, getModelSupportedFormats } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";
import { resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const MODEL = "claude-haiku-5-5";
const MESSAGES = "https://opencode.ai/zen/go/v1/messages";

describe("opencode-go claude-haiku-5-5", () => {
  it("is registered claude-only", () => {
    expect((PROVIDER_MODELS["opencode-go"] || []).some((m) => m.id === MODEL)).toBe(true);
    expect(getModelTargetFormat("opencode-go", MODEL)).toBe(FORMATS.CLAUDE);
    expect(getModelSupportedFormats("opencode-go", MODEL)).toEqual(["claude"]);
  });

  it("resolves a 1M window, 128k output and adaptive thinking", () => {
    expect(getCapabilitiesForModel("opencode-go", MODEL)).toMatchObject({
      contextWindow: 1000000, maxOutput: 128000, thinkingFormat: "claude-adaptive",
    });
  });

  it.each(["claude", "openai", "openai-responses"])("routes a %s-format client to /messages, never /chat/completions", (sourceFormat) => {
    const { runtimeTransport, targetFormat } = resolveRequestTransport({
      provider: "opencode-go", alias: "opencode-go", model: MODEL, sourceFormat, credentials: { apiKey: "k" },
    });
    expect(targetFormat).toBe(FORMATS.CLAUDE);
    expect(runtimeTransport?.baseUrl).toBe(MESSAGES);
    expect(new OpenCodeGoExecutor().buildUrl(MODEL, true, 0, { runtimeTransport })).toBe(MESSAGES);
  });
});
