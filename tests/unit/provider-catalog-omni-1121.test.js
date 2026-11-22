import { describe, expect, it } from "vitest";
import codex from "../../open-sse/providers/registry/codex.js";
import gemini from "../../open-sse/providers/registry/gemini.js";
import openai from "../../open-sse/providers/registry/openai.js";
import qoder from "../../open-sse/providers/registry/qoder.js";
import codebuddyCn from "../../open-sse/providers/registry/codebuddy-cn.js";

const model = (provider, id) => provider.models.find((entry) => entry.id === id);

describe("OmniRoute 4265bb2 provider catalog parity", () => {
  it("adds the seven GPT-6.1 Terra Codex variants with long reasoning timeouts", () => {
    for (const [id, name] of [
      ["gpt-6.1-terra", "GPT 6.1 Terra"],
      ["gpt-6.1-terra-ultra", "GPT 6.1 Terra (Ultra)"],
      ["gpt-6.1-terra-max", "GPT 6.1 Terra (Max)"],
      ["gpt-6.1-terra-xhigh", "GPT 6.1 Terra (xHigh)"],
      ["gpt-6.1-terra-high", "GPT 6.1 Terra (High)"],
      ["gpt-6.1-terra-medium", "GPT 6.1 Terra (Medium)"],
      ["gpt-6.1-terra-low", "GPT 6.1 Terra (Low)"],
    ]) {
      expect(model(codex, id)?.name).toBe(name);
    }
    expect(model(codex, "gpt-6.1-terra-xhigh").timeoutMs).toBe(1_200_000);
    expect(model(codex, "gpt-6.1-terra-high").timeoutMs).toBe(1_200_000);
  });

  it("declares Gemini Carbon tool calling and vision", () => {
    expect(model(gemini, "gemini-4-carbon")).toMatchObject({ toolCalling: true, supportsVision: true });
  });

  it("supports all GPT-6.1 Terra OpenAI reasoning efforts", () => {
    expect(model(openai, "gpt-6.1-terra")).toMatchObject({
      targetFormat: "openai-responses",
      supportedThinkingEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    });
  });

  it("keeps Qoder Sonus and Cantus static fallback capabilities", () => {
    expect(model(qoder, "smodel")).toMatchObject({
      name: "Sonus", supportsVision: true, supportsReasoning: true, maxInputTokens: 180_000,
    });
    expect(model(qoder, "cmodel")).toMatchObject({
      name: "Cantus", supportsVision: true, supportsReasoning: true, maxInputTokens: 180_000,
    });
  });

  it("uses China Standard Time for CodeBuddy CN naive reset timestamps", () => {
    expect(codebuddyCn.naiveResetTimezone).toBe("+08:00");
  });
});
