// Unit tests for unified thinking normalization (thinkingUnified.js).
// Covers extract, suffix parse, and per-provider apply per MATRIX (.docs/thinking/plan.md).
import { beforeEach, describe, it, expect, vi } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import "./registerAll.js";
import {
  parseSuffix,
  extractThinking,
  applyThinking,
  stripThinkingSuffix,
} from "../../open-sse/translator/concerns/thinkingUnified.js";
import { extractReasoningText } from "../../open-sse/translator/concerns/reasoning.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  }));
});

const apply = (targetFormat, model, body, provider) => {
  const b = JSON.parse(JSON.stringify(body));
  applyThinking(targetFormat, model, b, provider);
  return b;
};

describe("parseSuffix", () => {
  it("parses level suffix", () => {
    expect(parseSuffix("gpt-5(high)")).toEqual({ cleanModel: "gpt-5", override: { mode: "level", level: "high" } });
  });
  it("parses numeric budget suffix", () => {
    expect(parseSuffix("model(8192)")).toEqual({ cleanModel: "model", override: { mode: "budget", budget: 8192 } });
    expect(parseSuffix("model(0)")).toEqual({ cleanModel: "model", override: { mode: "none" } });
  });
  it("parses auto / none", () => {
    expect(parseSuffix("m(auto)").override).toEqual({ mode: "auto" });
    expect(parseSuffix("m(none)").override).toEqual({ mode: "none" });
  });
  it("maps the UI's binary thinking choice to automatic thinking", () => {
    expect(parseSuffix("glm-5(thinking)")).toEqual({
      cleanModel: "glm-5",
      override: { mode: "auto" },
    });
  });
  it("keeps unknown parentheses as an opaque model ID", () => {
    expect(parseSuffix("gpt-5.5(custom)")).toEqual({
      cleanModel: "gpt-5.5(custom)",
      override: null,
    });
  });
  it("no suffix → passthrough", () => {
    expect(parseSuffix("claude-opus-4.7")).toEqual({ cleanModel: "claude-opus-4.7", override: null });
  });
});

describe("extractThinking", () => {
  it("claude enabled+budget", () => {
    expect(extractThinking({ thinking: { type: "enabled", budget_tokens: 4096 } })).toEqual({ mode: "budget", budget: 4096 });
  });
  it("claude disabled", () => {
    expect(extractThinking({ thinking: { type: "disabled" } })).toEqual({ mode: "none" });
  });
  it("openai reasoning_effort", () => {
    expect(extractThinking({ reasoning_effort: "high" })).toEqual({ mode: "level", level: "high" });
  });
  it("responses reasoning.effort none", () => {
    expect(extractThinking({ reasoning: { effort: "none" } })).toEqual({ mode: "none" });
  });
  it("gemini thinkingBudget 0 → none", () => {
    expect(extractThinking({ thinkingConfig: { thinkingBudget: 0 } })).toEqual({ mode: "none" });
  });
  it("qwen enable_thinking false", () => {
    expect(extractThinking({ enable_thinking: false })).toEqual({ mode: "none" });
  });
  it("no intent → null", () => {
    expect(extractThinking({ messages: [] })).toBeNull();
  });
});

describe("applyThinking per provider format", () => {
  it("claude 4.6+ → adaptive output_config (no budget_tokens) + summarized display", () => {
    const out = apply("claude", "claude-opus-4.7", { reasoning_effort: "high" }, "claude");
    expect(out.output_config).toEqual({ effort: "high" });
    // Opus 4.7/4.8 default thinking.display to "omitted"; we explicitly request
    // summarized so reasoning summary flows back to clients.
    expect(out.thinking).toEqual({ type: "adaptive", display: "summarized" });
  });
  it("claude adaptive none → disabled WITHOUT display (Anthropic rejects display on disabled)", () => {
    const out = apply("claude", "claude-opus-4.8", { reasoning_effort: "none" }, "claude");
    expect(out.thinking).toEqual({ type: "disabled" });
    expect(out.output_config).toBeUndefined();
  });
  it("claude opus-4.8 adaptive → summarized display", () => {
    const out = apply("claude", "claude-opus-4.8", { reasoning_effort: "high" }, "claude");
    expect(out.output_config).toEqual({ effort: "high" });
    expect(out.thinking).toEqual({ type: "adaptive", display: "summarized" });
  });
  it("claude adaptive maps auto/minimal/xhigh into its accepted effort enum", () => {
    for (const [requested, expected] of [
      ["auto", "high"],
      ["minimal", "low"],
      ["xhigh", "high"],
    ]) {
      const out = apply("claude", "claude-opus-4.8", { reasoning_effort: requested }, "claude");
      expect(out.output_config.effort, requested).toBe(expected);
    }
  });
  it("claude haiku → enabled+budget", () => {
    const out = apply("claude", "claude-haiku-4.5", { reasoning_effort: "high" }, "claude");
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 24576 });
  });
  it("gemini-3 → thinkingLevel", () => {
    const out = apply("gemini", "gemini-3-pro", { reasoning_effort: "medium" }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingLevel).toBe("medium");
  });
  it("gemini-3 clamps unsupported max/xhigh thinking levels to high", () => {
    const outMax = apply("gemini", "gemini-3-pro", { reasoning_effort: "max" }, "gemini");
    const outXhigh = apply("gemini", "gemini-3-pro", { reasoning_effort: "xhigh" }, "gemini");
    expect(outMax.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
    expect(outXhigh.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  });
  it("gemini-3 maps auto thinking level to high instead of sending unsupported auto", () => {
    const out = apply("gemini", "gemini-3-pro", { reasoning_effort: "auto" }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  });
  it("gemini-3 high thinking raises too-small maxOutputTokens", () => {
    const out = apply("gemini-cli", "gemini-3.1-pro-preview", {
      request: { generationConfig: { maxOutputTokens: 128 } },
      reasoning_effort: "high",
    }, "gemini-cli");
    expect(out.request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "high", includeThoughts: true });
    expect(out.request.generationConfig.maxOutputTokens).toBe(65535);
  });
  it("gemini-2.5 → thinkingBudget", () => {
    const out = apply("gemini", "gemini-2.5-flash", { reasoning_effort: "high" }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingBudget).toBe(24576);
    expect(out.generationConfig.thinkingConfig.thinkingLevel).toBeUndefined();
  });
  it("gemini-2.5 budget thinking keeps enough room for answer tokens", () => {
    const out = apply("gemini-cli", "gemini-2.5-pro", {
      request: { generationConfig: { maxOutputTokens: 1024 } },
      reasoning_effort: "high",
    }, "gemini-cli");
    expect(out.request.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 24576, includeThoughts: true });
    expect(out.request.generationConfig.maxOutputTokens).toBe(32768);
  });
  it("GLM off → enable_thinking:false (not thinking.disabled)", () => {
    const out = apply("openai", "glm-4.6", { reasoning_effort: "none" }, "glm");
    expect(out.enable_thinking).toBe(false);
    expect(out.thinking).toBeUndefined();
  });
  it("Z.ai GLM preserves high reasoning_effort when thinking is enabled", () => {
    const out = apply("openai", "glm-5.2", { reasoning_effort: "high" }, "glm");
    expect(out.thinking).toEqual({ type: "enabled" });
    expect(out.reasoning_effort).toBe("high");
  });
  it("Z.ai GLM China preserves reasoning_effort when thinking is enabled", () => {
    const out = apply("openai", "glm-5.2", { reasoning_effort: "max" }, "glm-cn");
    expect(out.thinking).toEqual({ type: "enabled" });
    expect(out.reasoning_effort).toBe("max");
  });
  it("Z.ai GLM maps max/xhigh reasoning_effort to max", () => {
    const outMax = apply("openai", "glm-5.2", { reasoning_effort: "max" }, "glm");
    const outXhigh = apply("openai", "glm-5.2", { reasoning_effort: "xhigh" }, "glm");
    expect(outMax.thinking).toEqual({ type: "enabled" });
    expect(outMax.reasoning_effort).toBe("max");
    expect(outXhigh.thinking).toEqual({ type: "enabled" });
    expect(outXhigh.reasoning_effort).toBe("max");
  });
  it("Z.ai GLM maps lower reasoning_effort levels to high", () => {
    const outLow = apply("openai", "glm-5.2", { reasoning_effort: "low" }, "glm");
    const outMedium = apply("openai", "glm-5.2", { reasoning_effort: "medium" }, "glm");
    expect(outLow.thinking).toEqual({ type: "enabled" });
    expect(outLow.reasoning_effort).toBe("high");
    expect(outMedium.thinking).toEqual({ type: "enabled" });
    expect(outMedium.reasoning_effort).toBe("high");
  });
  it("Qwen on → enable_thinking + thinking_budget", () => {
    const out = apply("openai", "qwen3-max", { reasoning_effort: "medium" }, "qwen");
    expect(out.enable_thinking).toBe(true);
    expect(out.thinking_budget).toBe(8192);
  });
  it("QwQ cannot disable → clamp minimal", () => {
    const out = apply("openai", "qwq-32b", { reasoning_effort: "none" }, "qwen");
    expect(out.enable_thinking).toBe(true);
  });
  it("DeepSeek → enabled + reasoning_effort high (low→high)", () => {
    const out = apply("openai", "deepseek-v4-pro", { reasoning_effort: "low" }, "deepseek");
    expect(out.thinking).toEqual({ type: "enabled" });
    expect(out.reasoning_effort).toBe("high");
  });
  it("Kimi on → reasoning_effort", () => {
    const out = apply("openai", "kimi-k2.6", { reasoning_effort: "high" }, "kimi");
    expect(out.reasoning_effort).toBe("high");
  });
  it("Kimi auto → supported reasoning_effort", () => {
    const out = apply("openai", "kimi-k2.7", { reasoning_effort: "auto" }, "kimchi");
    expect(out.reasoning_effort).toBe("high");
  });
  it("Kimi unsupported OpenAI levels → supported reasoning_effort", () => {
    const minimal = apply("openai", "kimi-k2.7", { reasoning_effort: "minimal" }, "kimchi");
    const xhigh = apply("openai", "kimi-k2.7", { reasoning_effort: "xhigh" }, "kimchi");
    expect(minimal.reasoning_effort).toBe("low");
    expect(xhigh.reasoning_effort).toBe("max");
  });
  it("MiniMax M3 → adaptive", () => {
    const out = apply("claude", "MiniMax-M3", { reasoning_effort: "high" }, "minimax");
    expect(out.thinking).toEqual({ type: "adaptive" });
  });
  it("non-reasoning model → strips thinking", () => {
    const out = apply("openai", "gpt-4o", { reasoning_effort: "high" }, "openai");
    expect(out.reasoning_effort).toBeUndefined();
  });
  it("aggregator (siliconflow) GLM model → forced openai reasoning_effort", () => {
    const out = apply("openai", "zai-org/GLM-5", { reasoning_effort: "high" }, "siliconflow");
    expect(out.reasoning_effort).toBe("high");
    expect(out.enable_thinking).toBeUndefined();
  });
  it("DIT.ai marketplace router: claude-sonnet-4-6 → forced openai reasoning_effort, not Anthropic thinking", () => {
    expect(PROVIDERS.dit.thinkingFormat).toBe("openai");
    const out = apply("openai", "claude-sonnet-4-6", { reasoning_effort: "high" }, "dit");
    expect(out.reasoning_effort).toBe("high");
    expect(out.thinking).toBeUndefined();
    expect(out.output_config).toBeUndefined();
  });
  it("FreeAIAPIKey marketplace router: anthropic/claude model → forced openai reasoning_effort", () => {
    expect(PROVIDERS.freeaiapikey.thinkingFormat).toBe("openai");
    const out = apply("openai", "anthropic/claude-sonnet-4.6", { reasoning_effort: "high" }, "freeaiapikey");
    expect(out.reasoning_effort).toBe("high");
    expect(out.thinking).toBeUndefined();
  });
  it("Featherless QwQ → forced openai reasoning_effort, not Qwen enable_thinking", () => {
    expect(PROVIDERS["featherless-ai"].thinkingFormat).toBe("openai");
    const out = apply("openai", "featherless-ai/Qwerky-QwQ-32B", { reasoning_effort: "high" }, "featherless-ai");
    expect(out.reasoning_effort).toBe("high");
    expect(out.enable_thinking).toBeUndefined();
  });
  it("suffix overrides body", () => {
    const out = apply("openai", "gpt-5(low)", { reasoning_effort: "high" }, "openai");
    expect(out.reasoning_effort).toBe("low");
  });
  it("openai keeps xhigh for reasoning models", () => {
    const out = apply("openai", "gpt-5.3-codex", { reasoning_effort: "xhigh" }, "codex");
    expect(out.reasoning_effort).toBe("xhigh");
  });
});

describe("Responses reasoning effort wire shape", () => {
  it("nests effort only in the body dispatched to a Responses transport", async () => {
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "gpt-5.6-sol",
      {
        messages: [{ role: "user", content: "hello" }],
        reasoning_effort: "high",
      },
      true,
      null,
      "openai",
    );
    expect(translated.reasoning_effort).toBe("high");

    await new DefaultExecutor("openai").execute({
      model: "gpt-5.6-sol",
      body: translated,
      stream: true,
      credentials: {
        apiKey: "sk-test",
        runtimeTransport: {
          format: FORMATS.OPENAI_RESPONSES,
          baseUrl: "https://api.openai.com/v1/responses",
        },
      },
    });

    const dispatched = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(dispatched.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(dispatched.reasoning_effort).toBeUndefined();
  });

  it("preserves an explicit Responses reasoning summary while nesting effort", async () => {
    await new DefaultExecutor("openai").execute({
      model: "gpt-5.6-sol",
      body: {
        input: [{ role: "user", content: "hello" }],
        reasoning: { summary: "detailed" },
        reasoning_effort: "high",
      },
      stream: true,
      credentials: {
        apiKey: "sk-test",
        runtimeTransport: {
          format: FORMATS.OPENAI_RESPONSES,
          baseUrl: "https://api.openai.com/v1/responses",
        },
      },
    });

    const dispatched = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(dispatched.reasoning).toEqual({ effort: "high", summary: "detailed" });
    expect(dispatched.reasoning_effort).toBeUndefined();
  });

  it("keeps Chat Completions reasoning effort flat on dispatch", async () => {
    await new DefaultExecutor("openai").execute({
      model: "gpt-5.4",
      body: {
        messages: [{ role: "user", content: "hello" }],
        reasoning_effort: "high",
      },
      stream: true,
      credentials: {
        apiKey: "sk-test",
        runtimeTransport: {
          format: FORMATS.OPENAI,
          baseUrl: "https://api.openai.com/v1/chat/completions",
        },
      },
    });

    const dispatched = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(dispatched.reasoning_effort).toBe("high");
    expect(dispatched.reasoning).toBeUndefined();
  });
});

describe("stripThinkingSuffix", () => {
  it("removes known level suffix from model name", () => {
    expect(stripThinkingSuffix("gpt-5(high)")).toBe("gpt-5");
    expect(stripThinkingSuffix("claude-opus-4.7(medium)")).toBe("claude-opus-4.7");
  });
  it("removes numeric budget suffix", () => {
    expect(stripThinkingSuffix("model(8192)")).toBe("model");
  });
  it("leaves model names without suffix unchanged", () => {
    expect(stripThinkingSuffix("gpt-4o")).toBe("gpt-4o");
    expect(stripThinkingSuffix("provider:model")).toBe("provider:model");
  });
  it("preserves unknown parenthesized suffixes", () => {
    expect(stripThinkingSuffix("foo(bar)")).toBe("foo(bar)");
    expect(stripThinkingSuffix("custom(id-1)")).toBe("custom(id-1)");
  });
});

describe("extractReasoningText (response shapes)", () => {
  it("reasoning_content (GLM/Qwen/DeepSeek)", () => {
    expect(extractReasoningText({ reasoning_content: "abc" })).toBe("abc");
  });
  it("reasoning fallback", () => {
    expect(extractReasoningText({ reasoning: "xyz" })).toBe("xyz");
  });
  it("reasoning_details[] (MiniMax split)", () => {
    expect(extractReasoningText({ reasoning_details: [{ text: "a" }, { content: "b" }, "c"] })).toBe("abc");
  });
  it("no reasoning → empty", () => {
    expect(extractReasoningText({ content: "hello" })).toBe("");
  });
});
