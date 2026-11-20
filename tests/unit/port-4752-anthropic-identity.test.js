import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { CLAUDE_SYSTEM_PROMPT } from "../../open-sse/config/appConstants.js";

const model = "claude-sonnet-4-6";

describe("official Anthropic API key identity", () => {
  it("removes the beta and leading identity while preserving instructions and input", () => {
    const executor = new DefaultExecutor("anthropic");
    const credentials = { apiKey: "key", runtimeTransport: { baseUrl: "https://api.anthropic.com/v1/messages", headers: { "anthropic-beta": "claude-code-20250219,other-beta", "X-App": "cli" } } };
    const body = { system: `${CLAUDE_SYSTEM_PROMPT}\nKeep this instruction`, messages: [] };
    const result = executor.transformRequest(model, body, false, credentials);
    expect(result.system).toBe("Keep this instruction");
    expect(body.system).toContain(CLAUDE_SYSTEM_PROMPT);
    const headers = executor.buildHeaders(credentials, false);
    expect(headers["Anthropic-Beta"]).toBe("other-beta");
    expect(headers["X-App"]).toBeUndefined();
  });

  it("combines runtime and client betas for an official compatible Claude model", () => {
    const executor = new DefaultExecutor("anthropic-compatible-test");
    const credentials = {
      apiKey: "key",
      runtimeTransport: {
        baseUrl: "https://api.anthropic.com/v1/messages",
        headers: { "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14,runtime-beta" },
      },
    };
    const headers = executor.buildHeaders(credentials, true, {
      clientHeaders: { "anthropic-beta": "timing-2026-09-09" },
    }, model);
    const betas = headers["Anthropic-Beta"].split(",");
    expect(betas).toContain("runtime-beta");
    expect(betas).toContain("timing-2026-09-09");
    expect(betas).not.toContain("claude-code-20250219");
    expect(betas.filter((beta) => beta === "interleaved-thinking-2025-05-14")).toHaveLength(1);
  });

  it("preserves billing prefix and later mentions in block systems", () => {
    const executor = new DefaultExecutor("anthropic-compatible-test");
    const credentials = { apiKey: "key" };
    const body = { system: [{ type: "text", text: "x-anthropic-billing-header: value\n" }, { type: "text", text: `${CLAUDE_SYSTEM_PROMPT}\nInstruction` }, { type: "text", text: CLAUDE_SYSTEM_PROMPT }], messages: [] };
    const result = executor.transformRequest(model, body, false, credentials);
    expect(result.system.map((block) => block.text)).toEqual(["x-anthropic-billing-header: value\n", "Instruction", CLAUDE_SYSTEM_PROMPT]);
  });

  it.each([
    { apiKey: "key", runtimeTransport: { baseUrl: "https://api.anthropic.com.evil.test/v1" } },
    { apiKey: "sk-ant-oat-token" },
    { accessToken: "oauth" },
  ])("preserves identity for third-party and OAuth requests", (credentials) => {
    const executor = new DefaultExecutor("anthropic-compatible-test");
    const body = { system: CLAUDE_SYSTEM_PROMPT, messages: [] };
    expect(executor.transformRequest(model, body, false, credentials).system).toBe(CLAUDE_SYSTEM_PROMPT);
  });
});
