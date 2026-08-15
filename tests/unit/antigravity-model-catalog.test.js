import { describe, expect, it } from "vitest";
import antigravity from "../../open-sse/providers/registry/antigravity.js";
import gemini from "../../open-sse/providers/registry/gemini.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";
import { ANTIGRAVITY_QUOTA_MODELS } from "../../open-sse/services/usage/google.js";

const { extractModel, getMappedOverride } = require("../../src/mitm/server.js");
const { MODEL_SYNONYMS } = require("../../src/mitm/config.js");
const { __test__ } = require("../../cli/src/cli/menus/providers.js");

const TIERS = ["high", "medium", "low"];
const TIERED_UPSTREAM = Object.fromEntries(TIERS.map((level) => [level, `gemini-3.7-flash-tiered(${level})`]));
const TIERED_IDS = TIERS.map((level) => `gemini-3.7-flash-${level}`);

describe("Gemini 3.7 Flash Antigravity catalog (#3286, #3281)", () => {
  it("exposes the exact Antigravity tier rows in registry order", () => {
    const tierRows = antigravity.models.filter((m) => TIERED_IDS.includes(m.id));
    expect(tierRows).toEqual([
      { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)", upstreamModelId: TIERED_UPSTREAM.high },
      { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)", upstreamModelId: TIERED_UPSTREAM.medium },
      { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)", upstreamModelId: TIERED_UPSTREAM.low },
    ]);
  });

  it("exposes the exact Gemini base row preceding 3.1 Pro", () => {
    const idx = gemini.models.findIndex((m) => m.id === "gemini-3.7-flash");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(gemini.models[idx]).toEqual({ id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" });
    expect(gemini.models[idx + 1]?.id).toBe("gemini-3.1-pro-preview");
  });

  it("normalizes tiered wire names for both supported Gemini versions", () => {
    for (const version of ["3.6", "3.7"]) {
      const body = Buffer.from(JSON.stringify({ generationConfig: { thinkingConfig: { thinkingLevel: "high" } } }));
      expect(extractModel(`/v1/models/gemini-${version}-flash-tiered:generateContent`, body)).toBe(`gemini-${version}-flash-high`);
    }
  });

  it("publishes exactly three tiers in every configured consumer", () => {
    expect(Object.keys(MODEL_SYNONYMS.antigravity).filter((id) => id.startsWith("gemini-3.7-flash-"))).toEqual(TIERED_IDS);
    expect(MITM_TOOLS.antigravity.modelAliases.filter((id) => id.startsWith("gemini-3.7-flash-"))).toEqual(TIERED_IDS);
    expect(__test__.PROVIDER_MODELS.ag.filter(({ id }) => id.startsWith("gemini-3.7-flash-"))).toEqual(TIERED_IDS.map((id) => ({ id })));
    expect(MITM_TOOLS.antigravity.defaultModels.filter(({ id }) => id.startsWith("gemini-3.7-flash-"))).toEqual([
      { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)", alias: "gemini-3.7-flash-high" },
      { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)", alias: "gemini-3.7-flash-medium" },
      { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)", alias: "gemini-3.7-flash-low" },
    ]);
    expect(ANTIGRAVITY_QUOTA_MODELS.filter((id) => id.startsWith("gemini-3.7-flash-"))).toEqual(TIERED_IDS);
  });

  it("getMappedOverride resolves exact 3.7 tier IDs even with a conflicting generic flash alias", () => {
    const aliases = {
      "gemini-3-flash-agent": { type: "mitm", provider: "ag", model: "gemini-3-flash-agent" },
      ...Object.fromEntries(TIERED_IDS.map((id) => [id, { type: "mitm", provider: "ag", model: id }])),
    };
    for (const id of TIERED_IDS) {
      expect(getMappedOverride("antigravity", id, aliases)?.model).toBe(id);
    }
    for (const id of TIERED_IDS) {
      expect(getMappedOverride("antigravity", id, aliases)?.model).not.toBe("gemini-3-flash-agent");
    }
  });
});
