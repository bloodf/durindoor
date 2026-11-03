import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

// Every provider that lists a dotted Claude 5.5 id in its registry, with the exact listed id,
// so a future provider cannot slip through without a capability row.
const LISTED = Object.entries(PROVIDER_MODELS).flatMap(([provider, models]) =>
  models.filter((m) => /claude-(?:opus|sonnet)-5\.5(?:$|-)/.test(m.id)).map((m) => [provider, m.id]));
const KIRO = ["kiro", "kr"].flatMap((p) => ["claude-opus-5.5", "claude-sonnet-5.5"].map((m) => [p, m]));

describe("dotted Claude 5.5 ids share the dashed thinking rules (#1367)", () => {
  it("the registry lists dotted ids on at least github, ghe and nanogpt", () => {
    const providers = new Set(LISTED.map(([p]) => p));
    for (const p of ["gh", "ghe", "nanogpt"]) expect(providers.has(p)).toBe(true);
  });

  describe.each([...LISTED, ...KIRO])("%s %s", (provider, id) => {
    const dashed = id.replace(/^.*?(claude-(?:opus|sonnet))-5\.5.*$/, "$1-5-5");

    it("resolves like the dashed id", () => {
      const d = getCapabilitiesForModel(provider, id);
      const s = getCapabilitiesForModel("anthropic", dashed);
      expect(d.thinkingFormat).toBe(s.thinkingFormat);
      expect(d.thinkingCanDisable).toBe(false);
      expect(d.thinkingModes).toEqual(s.thinkingModes);
      // Kiro-family providers never advertise max/ultra, whatever the model.
      const dashedLevels = getThinkingLevels("anthropic", dashed).filter((l) => !(provider.startsWith("k") && l === "max"));
      expect(getThinkingLevels(provider, id)).toEqual(dashedLevels);
      expect(getThinkingLevels(provider, id)).not.toContain("none");
    });

    it('never sends thinking.type "disabled" at translator output', () => {
      const body = applyThinking("claude", id, { model: id, reasoning_effort: "none", messages: [] }, provider);
      expect(body.thinking?.type).not.toBe("disabled");
    });
  });

  it("Kiro variant suffixes follow the same rules", () => {
    expect(getCapabilitiesForModel("kiro", "claude-opus-5.5-thinking-agentic").thinkingCanDisable).toBe(false);
  });

  it("is scoped: other gateways keep their own handling", () => {
    expect(getCapabilitiesForModel("openrouter", "anthropic/claude-sonnet-5.5").thinkingCanDisable).not.toBe(false);
  });

  it("dotted Opus 5.5 drops top_p/top_k like the dashed id", () => {
    for (const model of ["claude-opus-5-5", "claude-opus-5.5"]) {
      const body = { model, top_p: 0.9, top_k: 5, messages: [] };
      stripUnsupportedParams("github", model, body);
      expect(body).not.toHaveProperty("top_p");
      expect(body).not.toHaveProperty("top_k");
    }
  });
});

describe("OpenAI-compatible nodes keep effort max for GPT-5.6 / GPT-6 (#1367)", () => {
  const compat = "openai-compatible-abc";
  const effort = (model) =>
    applyThinking("openai", model, { model, reasoning_effort: "max", messages: [] }, compat).reasoning_effort;

  // Already met on main through the model rows; pinned so a regression is caught.
  it.each(["gpt-5.6", "openai/gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-sol", "gpt-6-luna", "gpt-6-astra", "GPT-6-LUNA"])(
    "%s keeps max",
    (model) => expect(effort(model)).toBe("max"),
  );

  it.each(["gpt-5.6-pro", "gpt-5.6-mini", "gpt-5.5"])(
    "%s follows the built-in openai row (no max, nothing lost)",
    (model) => {
      expect(getThinkingLevels(compat, model).includes("max")).toBe(getThinkingLevels("openai", model).includes("max"));
      expect(effort(model)).toBe(applyThinking("openai", model, { model, reasoning_effort: "max", messages: [] }, "openai").reasoning_effort);
    },
  );
});
