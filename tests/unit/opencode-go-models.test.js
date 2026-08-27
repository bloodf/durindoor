import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelSupportedFormats, getModelTargetFormat, getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";

const API_KEY = { apiKey: "test-key" };
const OPENAI_URL = "https://opencode.ai/zen/go/v1/chat/completions";
const CLAUDE_URL = "https://opencode.ai/zen/go/v1/messages";
const RESPONSES_URL = "https://opencode.ai/zen/go/v1/responses";

const CHAT_ONLY = ["glm-5.1", "kimi-k2.7-code", "kimi-k2.6", "mimo-v2.5", "mimo-v2.5-pro"];
const MODEL_WITHOUT_FORMATS = "glm-5.2";
const CLAUDE_CAPABLE = ["minimax-m3", "minimax-m2.7", "minimax-m2.5", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus"];
const RESPONSES_CAPABLE = ["deepseek-v4-pro", "deepseek-v4-flash"];
const VISION_CAPABLE = "deepseek-v4-flash-vision-exp";

describe("OpenCode Go model catalog", () => {
  it("matches documented model IDs", () => {
    const ids = (PROVIDER_MODELS["opencode-go"] || []).map((model) => model.id);

    expect(ids).toEqual([
      MODEL_WITHOUT_FORMATS,
      ...CHAT_ONLY.slice(0, 3),
      ...RESPONSES_CAPABLE,
      VISION_CAPABLE,
      ...CHAT_ONLY.slice(3),
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

  it("declares OpenAI-only support for DeepSeek, Kimi, and MiMo models", () => {
    for (const model of [...RESPONSES_CAPABLE, ...CHAT_ONLY]) {
      expect(getModelSupportedFormats("opencode-go", model)).toEqual(["openai"]);
    }
  });

  it("declares every OpenCode Go transport for DeepSeek V4 Flash Vision", () => {
    expect(getModelSupportedFormats("opencode-go", VISION_CAPABLE))
      .toEqual(["openai", "claude", "openai-responses"]);
  });

  it("uses default OpenAI transport for known models without endpoint metadata", () => {
    expect(getModelSupportedFormats("opencode-go", MODEL_WITHOUT_FORMATS)).toBeNull();
  });

  it("resolves recognized thinking suffixes without rewriting opaque model IDs", () => {
    expect(getModelSupportedFormats("opencode-go", "deepseek-v4-flash(max)")).toEqual(["openai"]);
    expect(getModelSupportedFormats("opencode-go", "minimax-m3(max)")).toEqual(["openai", "claude"]);
    expect(getModelSupportedFormats("opencode-go", "minimax-m3(custom)")).toBeNull();
  });

  it("strips at most one recognized thinking suffix per lookup", () => {
    expect(getModelUpstreamId("opencode-go", "minimax-m3(max)(max)")).toBe("minimax-m3(max)");
  });
});

describe("CommandCode DeepSeek V4 Flash Vision aliases", () => {
  it("maps the short selectable ID to CommandCode's vendor-prefixed upstream ID", () => {
    expect(getModelUpstreamId("commandcode", "deepseek-v4-flash-vision-exp"))
      .toBe("deepseek/deepseek-v4-flash-vision-exp");
    expect(getModelUpstreamId("commandcode", "deepseek/deepseek-v4-flash-vision-exp"))
      .toBe("deepseek/deepseek-v4-flash-vision-exp");
  });
});

describe("OpenCode Go multi-endpoint transports", () => {
  it("declares OpenAI, Claude, and Responses transports", () => {
    expect(PROVIDERS["opencode-go"].transports.map((transport) => transport.format))
      .toEqual(["openai", "claude", "openai-responses"]);
  });

  it("resolves endpoints matching client format", () => {
    expect(resolveTransport("opencode-go", "openai")?.baseUrl).toBe(OPENAI_URL);
    expect(resolveTransport("opencode-go", "claude")?.baseUrl).toBe(CLAUDE_URL);
    expect(resolveTransport("opencode-go", "openai-responses")?.baseUrl).toBe(RESPONSES_URL);
  });

  it("uses Anthropic API-key authentication for Claude", () => {
    const transport = resolveTransport("opencode-go", "claude");
    expect(transport?.auth).toMatchObject({ header: "x-api-key", anthropicVersion: true });
  });
});

describe("OpenCode Go per-model transport selection", () => {
  it("uses Claude messages endpoint for Claude-source MiniMax and Qwen requests", () => {
    for (const model of CLAUDE_CAPABLE) {
      const { runtimeTransport, targetFormat } = resolveRequestTransport({
        provider: "opencode-go",
        alias: "opencode-go",
        model,
        sourceFormat: "claude",
        credentials: API_KEY,
      });
      expect(runtimeTransport?.format).toBe("claude");
      expect(runtimeTransport?.baseUrl).toBe(CLAUDE_URL);
      expect(targetFormat).toBe("claude");
    }
  });

  it("routes a suffixed Claude-capable model to the Claude endpoint", () => {
    const { runtimeTransport, targetFormat } = resolveRequestTransport({
      provider: "opencode-go",
      alias: "opencode-go",
      model: "minimax-m3(max)",
      sourceFormat: "claude",
      credentials: API_KEY,
    });
    expect(runtimeTransport?.format).toBe("claude");
    expect(runtimeTransport?.baseUrl).toBe(CLAUDE_URL);
    expect(targetFormat).toBe("claude");
  });

  it("keeps a suffixed DeepSeek model on the OpenAI endpoint", () => {
    for (const sourceFormat of ["claude", "openai-responses"]) {
      const { runtimeTransport, targetFormat } = resolveRequestTransport({
        provider: "opencode-go",
        alias: "opencode-go",
        model: "deepseek-v4-flash(max)",
        sourceFormat,
        credentials: API_KEY,
      });
      expect(runtimeTransport?.format).toBe("openai");
      expect(runtimeTransport?.baseUrl).toBe(OPENAI_URL);
      expect(targetFormat).toBe("openai");
    }
  });

  it("falls back to OpenAI transport for chat-only models under Claude source", () => {
    for (const model of [MODEL_WITHOUT_FORMATS, ...CHAT_ONLY]) {
      const { runtimeTransport, targetFormat } = resolveRequestTransport({
        provider: "opencode-go",
        alias: "opencode-go",
        model,
        sourceFormat: "claude",
        credentials: API_KEY,
      });
      expect(runtimeTransport?.format).toBe("openai");
      expect(runtimeTransport?.baseUrl).toBe(OPENAI_URL);
      expect(targetFormat).toBe("openai");
    }
  });

  it("translates Responses-source DeepSeek requests to the default OpenAI endpoint", () => {
    for (const model of RESPONSES_CAPABLE) {
      const { runtimeTransport, targetFormat } = resolveRequestTransport({
        provider: "opencode-go",
        alias: "opencode-go",
        model,
        sourceFormat: "openai-responses",
        credentials: API_KEY,
      });
      expect(runtimeTransport?.format).toBe("openai");
      expect(runtimeTransport?.baseUrl).toBe(OPENAI_URL);
      expect(targetFormat).toBe("openai");
    }
  });

  it("uses required Claude transport for MiniMax and Qwen under Responses source", () => {
    for (const model of CLAUDE_CAPABLE) {
      const { runtimeTransport, targetFormat } = resolveRequestTransport({
        provider: "opencode-go",
        alias: "opencode-go",
        model,
        sourceFormat: "openai-responses",
        credentials: API_KEY,
      });
      expect(runtimeTransport?.format).toBe("claude");
      expect(runtimeTransport?.baseUrl).toBe(CLAUDE_URL);
      expect(targetFormat).toBe("claude");
    }
  });

  it("falls back to OpenAI transport for unknown model under Claude source", () => {
    const { runtimeTransport, targetFormat } = resolveRequestTransport({
      provider: "opencode-go",
      alias: "opencode-go",
      model: "mystery-future-model",
      sourceFormat: "claude",
      credentials: API_KEY,
    });
    expect(runtimeTransport?.format).toBe("openai");
    expect(runtimeTransport?.baseUrl).toBe(OPENAI_URL);
    expect(targetFormat).toBe("openai");
  });

  it("uses default endpoint and format without credentials", () => {
    const { runtimeTransport, targetFormat } = resolveRequestTransport({
      provider: "opencode-go",
      alias: "opencode-go",
      model: "minimax-m3",
      sourceFormat: "claude",
    });
    expect(runtimeTransport).toBeNull();
    expect(targetFormat).toBe("openai");
  });

  it("keeps shared executor URL and authentication behavior for each transport", () => {
    const executor = new DefaultExecutor("opencode-go");
    const openaiCredentials = { ...API_KEY, runtimeTransport: resolveTransport("opencode-go", "openai") };
    const claudeCredentials = { ...API_KEY, runtimeTransport: resolveTransport("opencode-go", "claude") };

    expect(executor.buildUrl("minimax-m3", true, 0, openaiCredentials)).toBe(OPENAI_URL);
    expect(executor.buildHeaders(openaiCredentials, true)).toMatchObject({ Authorization: "Bearer test-key" });
    expect(executor.buildUrl("minimax-m3", true, 0, claudeCredentials)).toBe(CLAUDE_URL);
    expect(executor.buildHeaders(claudeCredentials, true)).toMatchObject({
      "x-api-key": "test-key",
      "anthropic-version": expect.any(String),
    });
  });
});

describe("OpenCode Go target format preservation", () => {
  it("preserves targetFormat: claude for MiniMax and Qwen models", () => {
    for (const model of CLAUDE_CAPABLE) {
      expect(getModelTargetFormat("opencode-go", model)).toBe("claude");
    }
  });

  it("does not declare Responses for DeepSeek models in this port", () => {
    for (const model of RESPONSES_CAPABLE) {
      expect(getModelSupportedFormats("opencode-go", model)).toEqual(["openai"]);
    }
  });
});
