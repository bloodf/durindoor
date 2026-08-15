import { describe, expect, it } from "vitest";
import antigravity from "../../open-sse/providers/registry/antigravity.js";
import gemini from "../../open-sse/providers/registry/gemini.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

const { extractModel } = require("../../src/mitm/server.js");
const { MODEL_SYNONYMS } = require("../../src/mitm/config.js");
const { __test__ } = require("../../cli/src/cli/menus/providers.js");

const TIERED = [
  ["high", "gemini-3.7-flash-tiered(high)"],
  ["medium", "gemini-3.7-flash-tiered(medium)"],
  ["low", "gemini-3.7-flash-tiered(low)"],
];

describe("Gemini 3.7 Flash Antigravity catalog (#3286, #3281)", () => {
  it("registers all Antigravity tiers and Gemini base model", () => {
    for (const [level, upstreamModelId] of TIERED) {
      expect(antigravity.models).toContainEqual({
        id: `gemini-3.7-flash-${level}`,
        name: `Gemini 3.7 Flash (${level[0].toUpperCase()}${level.slice(1)})`,
        upstreamModelId,
      });
    }
    expect(gemini.models).toContainEqual({ id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" });
  });

  it("normalizes tiered wire names for both supported Gemini versions", () => {
    for (const version of ["3.6", "3.7"]) {
      const body = Buffer.from(JSON.stringify({ generationConfig: { thinkingConfig: { thinkingLevel: "high" } } }));
      expect(extractModel(`/v1/models/gemini-${version}-flash-tiered:generateContent`, body)).toBe(`gemini-${version}-flash-high`);
    }
  });

  it("publishes tier aliases in CLI and MITM configuration", () => {
    for (const [level] of TIERED) {
      const id = `gemini-3.7-flash-${level}`;
      expect(MODEL_SYNONYMS.antigravity[id]).toBe(id);
      expect(MITM_TOOLS.antigravity.modelAliases).toContain(id);
      expect(__test__.PROVIDER_MODELS.ag).toContainEqual({ id });
    }
  });
});

