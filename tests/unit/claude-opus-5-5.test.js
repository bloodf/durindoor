import { describe, expect, it } from "vitest";

import "../translator/registerAll.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import {
  CLAUDE_CLI_VERSION,
  CLAUDE_CLI_SPOOF_HEADERS,
  resolveClaudeCliVersion,
  mergeForwardableClientBetas,
} from "../../open-sse/providers/shared.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { buildClaudeModelsHeaders, PROVIDER_MODELS_CONFIG } from "../../src/app/api/providers/[id]/models/modelsConfig.js";
import { applyCloaking } from "../../open-sse/utils/claudeCloaking.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import claude from "../../open-sse/providers/registry/claude.js";
import anthropic from "../../open-sse/providers/registry/anthropic.js";

describe("Claude Opus 5.5", () => {
  it("is listed on the claude OAuth and anthropic API key providers", () => {
    expect(claude.models.map((m) => m.id)).toContain("claude-opus-5-5");
    expect(anthropic.models.map((m) => m.id)).toContain("claude-opus-5-5");
  });

  it("spoofs Claude Code 2.1.282, at or above 2.1.280 (the first CLI Anthropic accepts for Opus 5.5)", () => {
    expect(CLAUDE_CLI_VERSION).toBe("2.1.282");
    expect(CLAUDE_CLI_SPOOF_HEADERS["User-Agent"]).toBe("claude-cli/2.1.282 (external, sdk-cli)");
    const body = applyCloaking({ messages: [] }, "sk-ant-oat-test", "session-id");
    expect(body.system[0].text).toMatch(/^x-anthropic-billing-header: cc_version=2\.1\.282\./);
  });

  it("resolves its own price instead of the generic Opus row", () => {
    expect(getPricingForModel("claude", "claude-opus-5-5")).toMatchObject({
      input: 4,
      output: 20,
      cached: 0.2,
      cache_creation: 5,
    });
  });

  it("has 1M context, 128K output and thinking that cannot be disabled", () => {
    for (const [provider, model] of [["claude", "claude-opus-5-5"], ["kiro", "kiro-claude-opus-5-5"]]) {
      expect(getCapabilitiesForModel(provider, model)).toMatchObject({
        thinkingFormat: "claude-adaptive",
        thinkingCanDisable: false,
        contextWindow: 1000000,
        maxOutput: 128000,
      });
    }
    // Opus 5 keeps its own row and can still turn thinking off.
    expect(getCapabilitiesForModel("claude", "claude-opus-5").thinkingCanDisable).not.toBe(false);
  });

  it("downgrades a forced tool choice, which an always-thinking model rejects", () => {
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "claude-opus-5-5",
      {
        max_tokens: 64,
        messages: [{ role: "user", content: "Record this." }],
        tools: [{ type: "function", function: { name: "record_summary", parameters: { type: "object", properties: {} } } }],
        tool_choice: { type: "function", function: { name: "record_summary" } },
      },
      false,
      null,
      "claude",
    );
    expect(translated.tool_choice).toEqual({ type: "auto" });
  });

  it("lets CLAUDE_CODE_CLIENT_VERSION override the pin, ignoring unsafe values", () => {
    expect(resolveClaudeCliVersion({})).toBe("2.1.282");
    expect(resolveClaudeCliVersion({ CLAUDE_CODE_CLIENT_VERSION: " 2.1.300 " })).toBe("2.1.300");
    expect(resolveClaudeCliVersion({ CLAUDE_CODE_CLIENT_VERSION: "2.1.300\r\nX-Evil: 1" })).toBe("2.1.282");
    expect(resolveClaudeCliVersion({ CLAUDE_CODE_CLIENT_VERSION: "" })).toBe("2.1.282");
  });

  it("drops top_p and top_k, which Opus 5.5 rejects, but keeps them for Opus 5", () => {
    const body = { temperature: 1, top_p: 0.9, top_k: 5, max_tokens: 10 };
    stripUnsupportedParams("claude", "claude-opus-5-5", body);
    expect(body).toEqual({ max_tokens: 10 });
    const opus5 = { top_p: 0.9, top_k: 5 };
    stripUnsupportedParams("claude", "claude-opus-5", opus5);
    expect(opus5).toEqual({ top_p: 0.9, top_k: 5 });
  });

  it("offers low..max with xhigh and sends xhigh on the wire", () => {
    expect(getThinkingLevels("claude", "claude-opus-5-5")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "claude-opus-5-5",
      { max_tokens: 64, messages: [{ role: "user", content: "hi" }], reasoning_effort: "xhigh" },
      false,
      null,
      "claude",
    );
    expect(translated.output_config).toEqual({ effort: "xhigh" });
    expect(translated.thinking.type).toBe("adaptive");
  });

  it("never sends disabled thinking or a budget", () => {
    for (const thinking of [{ type: "disabled" }, { type: "enabled", budget_tokens: 8000 }]) {
      const translated = translateRequest(
        FORMATS.CLAUDE,
        FORMATS.CLAUDE,
        "claude-opus-5-5",
        { max_tokens: 64, messages: [{ role: "user", content: "hi" }], thinking },
        false,
        null,
        "claude",
      );
      expect(translated.thinking.type).toBe("adaptive");
      expect(translated.thinking.budget_tokens).toBeUndefined();
    }
  });
});

describe("client beta forwarding", () => {
  it("merges only allowlisted client betas", () => {
    const headers = mergeForwardableClientBetas(
      { "Anthropic-Beta": "claude-code-20250219" },
      { "anthropic-beta": "dangerous-tool-use-2026-09-03, made-up-2099-01-01,thinking-display-updates-2026-08-18" },
    );
    expect(headers["Anthropic-Beta"]).toBe(
      "claude-code-20250219,dangerous-tool-use-2026-09-03,thinking-display-updates-2026-08-18",
    );
    expect(mergeForwardableClientBetas({ a: "1" }, null)).toEqual({ a: "1" });
  });

  it("forwards them on the claude provider for this request", () => {
    const executor = new DefaultExecutor("claude");
    const clientHeaders = { "anthropic-beta": "thinking-binding-controls-2026-08-01" };
    const headers = executor.buildHeaders({ accessToken: "sk-ant-oat-x" }, true, { clientHeaders }, "claude-opus-5-5");
    const beta = headers["Anthropic-Beta"] || headers["anthropic-beta"];
    expect(beta.split(",")).toContain("thinking-binding-controls-2026-08-01");
  });
});

describe("Claude model discovery headers", () => {
  it("sends an OAuth token as a Bearer with the OAuth beta and CLI User-Agent", () => {
    expect(PROVIDER_MODELS_CONFIG.claude.url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    const headers = buildClaudeModelsHeaders("sk-ant-oat01-abc");
    expect(headers).toMatchObject({
      Authorization: "Bearer sk-ant-oat01-abc",
      "Anthropic-Beta": "oauth-2025-04-20",
      "Anthropic-Version": "2023-06-01",
      "User-Agent": "claude-cli/2.1.282 (external, sdk-cli)",
    });
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("keeps x-api-key for a real API key", () => {
    const headers = buildClaudeModelsHeaders("sk-ant-api03-abc");
    expect(headers["x-api-key"]).toBe("sk-ant-api03-abc");
    expect(headers.Authorization).toBeUndefined();
  });
});
