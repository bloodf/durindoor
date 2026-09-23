import { describe, it, expect } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import codexRegistry from "../../open-sse/providers/registry/codex.js";

// GPT-6 Sol and Luna: port(upstream) decolua/9router#4266. Sol accepts the
// extra `ultra` alias (wire-mapped to `max`); Luna tops out at `max` — same
// split as their GPT-5.6 namesakes. Codex-only (ChatGPT backend), no direct
// OpenAI API registry row yet per upstream.
describe("GPT-6 Sol and Luna registry", () => {
  it("are registered Codex models", () => {
    const ids = codexRegistry.models.map((m) => m.id);
    expect(ids).toContain("gpt-6-sol");
    expect(ids).toContain("gpt-6-luna");
  });

  it("carry vision + reasoning + non-disableable Codex capabilities", () => {
    for (const provider of ["codex", "cx"]) {
      for (const model of ["gpt-6-sol", "gpt-6-luna"]) {
        const caps = getCapabilitiesForModel(provider, model);
        expect(caps).toMatchObject({
          vision: true,
          reasoning: true,
          thinkingFormat: "openai",
          thinkingCanDisable: false,
          contextWindow: 1050000,
          maxOutput: 128000,
        });
      }
    }
  });
});

describe("GPT-6 Sol and Luna reasoning effort levels", () => {
  it("Sol accepts low..max plus the ultra alias", () => {
    for (const provider of ["codex", "cx"]) {
      expect(getThinkingLevels(provider, "gpt-6-sol")).toEqual([
        "low", "medium", "high", "xhigh", "max", "ultra",
      ]);
    }
  });

  it("Luna accepts low..max but not ultra", () => {
    for (const provider of ["codex", "cx"]) {
      const levels = getThinkingLevels(provider, "gpt-6-luna");
      expect(levels).toEqual(["low", "medium", "high", "xhigh", "max"]);
      expect(levels).not.toContain("ultra");
    }
  });
});

describe("GPT-6 Sol and Luna unsupported effort wire clamping", () => {
  it.each(["gpt-6-sol", "gpt-6-luna"])(
    "clamps none/minimal to low for %s through applyThinking",
    (model) => {
      for (const effort of ["none", "minimal"]) {
        const body = { reasoning_effort: effort };
        applyThinking("openai", model, body, "codex");
        expect(body.reasoning_effort).toBe("low");
      }
    }
  );

  it.each(["gpt-6-sol", "gpt-6-luna"])(
    "clamps a Codex client none/minimal request to low through the executor",
    (model) => {
      for (const effort of ["none", "minimal"]) {
        const body = new CodexExecutor().transformRequest(model, {
          model, input: "hi", reasoning_effort: effort,
        }, true, {});
        expect(body.reasoning.effort).toBe("low");
      }
    }
  );

  it("Sol's ultra resolves to max on the wire; Luna's ultra falls back to max", () => {
    const sol = new CodexExecutor().transformRequest("gpt-6-sol", {
      model: "gpt-6-sol", input: "hi", reasoning_effort: "ultra",
    }, true, {});
    const luna = new CodexExecutor().transformRequest("gpt-6-luna", {
      model: "gpt-6-luna", input: "hi", reasoning_effort: "ultra",
    }, true, {});
    expect(sol.reasoning.effort).toBe("max");
    expect(luna.reasoning.effort).toBe("max");
  });

  it("preserves an explicit max effort for both models", () => {
    for (const model of ["gpt-6-sol", "gpt-6-luna"]) {
      const body = new CodexExecutor().transformRequest(model, {
        model, input: "hi", reasoning_effort: "max",
      }, true, {});
      expect(body.reasoning.effort).toBe("max");
    }
  });
});

describe("GPT-6 Sol and Luna Codex default effort", () => {
  it.each(["gpt-6-sol", "gpt-6-luna"])("defaults to low without explicit effort (%s)", (model) => {
    const body = new CodexExecutor().transformRequest(model, {
      model, input: "hi",
    }, true, {});
    expect(body.reasoning.effort).toBe("low");
  });
});

describe("GPT-6 Sol and Luna pricing", () => {
  it("Sol prices at the published per-million rates", () => {
    expect(getPricingForModel("codex", "gpt-6-sol")).toMatchObject({
      input: 2, output: 10, cached: 0.2, reasoning: 10, cache_creation: 2.5,
    });
  });

  it("Luna prices at the published per-million rates", () => {
    expect(getPricingForModel("codex", "gpt-6-luna")).toMatchObject({
      input: 0.1, output: 0.5, cached: 0.01, reasoning: 0.5, cache_creation: 0.125,
    });
  });
});
