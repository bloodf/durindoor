import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelSupportedFormats } from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { resolveTransport } from "../../open-sse/services/provider.js";

const CHAT_ONLY = ["glm-5.2", "glm-5.1", "kimi-k2.7-code", "kimi-k2.6", "mimo-v2.5", "mimo-v2.5-pro"];
const CLAUDE_CAPABLE = ["minimax-m3", "minimax-m2.7", "minimax-m2.5", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus"];
const RESPONSES_CAPABLE = ["deepseek-v4-pro", "deepseek-v4-flash"];

function pickTransport(provider, sourceFormat, alias, model) {
  const supported = getModelSupportedFormats(alias, model);
  const transport = resolveTransport(provider, sourceFormat);
  return supported?.includes(sourceFormat) ? transport : null;
}

describe("OpenCode Go model catalog", () => {
  it("matches documented model IDs", () => {
    const ids = (PROVIDER_MODELS["opencode-go"] || []).map((model) => model.id);

    expect(ids).toEqual([
      ...CHAT_ONLY.slice(0, 4),
      ...RESPONSES_CAPABLE,
      ...CHAT_ONLY.slice(4),
      ...CLAUDE_CAPABLE,
    ]);
  });
});

describe("OpenCode Go per-model supportedFormats", () => {
  it("declares OpenAI and Claude support for MiniMax and Qwen models", () => {
    for (const model of CLAUDE_CAPABLE) {
      expect(getModelSupportedFormats("opencode-go", model)).toEqual(["openai", "claude"]);
    }
  });

  it("declares OpenAI, Claude, and Responses support for DeepSeek models", () => {
    for (const model of RESPONSES_CAPABLE) {
      expect(getModelSupportedFormats("opencode-go", model)).toEqual(["openai", "claude", "openai-responses"]);
    }
  });

  it("declares OpenAI-only support for GLM, Kimi, and MiMo models", () => {
    for (const model of CHAT_ONLY) {
      expect(getModelSupportedFormats("opencode-go", model)).toEqual(["openai"]);
    }
  });
});

describe("OpenCode Go multi-endpoint transports", () => {
  it("declares OpenAI, Claude, and Responses transports", () => {
    expect(PROVIDERS["opencode-go"].transports.map((transport) => transport.format))
      .toEqual(["openai", "claude", "openai-responses"]);
  });

  it("resolves endpoints matching client format", () => {
    expect(resolveTransport("opencode-go", "openai")?.baseUrl).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(resolveTransport("opencode-go", "claude")?.baseUrl).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(resolveTransport("opencode-go", "openai-responses")?.baseUrl).toBe("https://opencode.ai/zen/go/v1/responses");
  });

  it("uses Anthropic API-key authentication for Claude", () => {
    const transport = resolveTransport("opencode-go", "claude");
    expect(transport?.auth).toMatchObject({ header: "x-api-key", anthropicVersion: true });
  });
});

describe("OpenCode Go per-model transport guard", () => {
  it("routes MiniMax and Qwen Claude requests to messages", () => {
    for (const model of CLAUDE_CAPABLE) {
      expect(pickTransport("opencode-go", "claude", "opencode-go", model)?.baseUrl)
        .toBe("https://opencode.ai/zen/go/v1/messages");
    }
  });

  it("does not route chat-only models to messages", () => {
    for (const model of CHAT_ONLY) {
      expect(pickTransport("opencode-go", "claude", "opencode-go", model)).toBeNull();
    }
  });

  it("routes DeepSeek Responses requests to responses", () => {
    for (const model of RESPONSES_CAPABLE) {
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", model)?.baseUrl)
        .toBe("https://opencode.ai/zen/go/v1/responses");
    }
  });

  it("does not route MiniMax and Qwen Responses requests to responses", () => {
    for (const model of CLAUDE_CAPABLE) {
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", model)).toBeNull();
    }
  });
});
