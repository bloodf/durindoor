import { describe, expect, it } from "vitest";

const { extractModel, getMappedOverride } = require("../../src/mitm/server.js");

const TIERS = ["high", "medium", "low"];
const TIERED_IDS = TIERS.map((level) => `gemini-3.7-flash-${level}`);

describe("Gemini 3.7 Flash Antigravity catalog (#3286, #3281)", () => {

  it("normalizes tiered wire names for both supported Gemini versions", () => {
    for (const version of ["3.6", "3.7"]) {
      const body = Buffer.from(JSON.stringify({ generationConfig: { thinkingConfig: { thinkingLevel: "high" } } }));
      expect(extractModel(`/v1/models/gemini-${version}-flash-tiered:generateContent`, body)).toBe(`gemini-${version}-flash-high`);
    }
  });


  it("getMappedOverride resolves exact 3.7 tier IDs even with a conflicting generic flash alias", () => {
    const aliases = {
      "gemini-3-flash-agent": { type: "mitm", provider: "ag", model: "gemini-3-flash-agent" },
      ...Object.fromEntries(TIERED_IDS.map((id) => [id, { type: "mitm", provider: "ag", model: id }])),
    };
    for (const id of TIERED_IDS) {
      expect(getMappedOverride("antigravity", id, aliases)?.model).toBe(id);
    }
  });
});
