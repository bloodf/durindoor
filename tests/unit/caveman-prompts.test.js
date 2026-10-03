import { describe, it, expect } from "vitest";
import { CAVEMAN_LEVELS, CAVEMAN_PROMPTS } from "../../open-sse/rtk/cavemanPrompts.js";

const LEVEL_KEYS = [
  CAVEMAN_LEVELS.LITE,
  CAVEMAN_LEVELS.FULL,
  CAVEMAN_LEVELS.ULTRA,
  CAVEMAN_LEVELS.WENYAN_LITE,
  CAVEMAN_LEVELS.WENYAN,
  CAVEMAN_LEVELS.WENYAN_ULTRA,
];

describe("Caveman prompt coverage", () => {
  it("every level key has matching prompt and vice versa", () => {
    const levelValues = Object.values(CAVEMAN_LEVELS);
    for (const key of LEVEL_KEYS) {
      expect(levelValues).toContain(key);
    }
    for (const value of levelValues) {
      expect(LEVEL_KEYS).toContain(value);
    }
  });

  it("has a prompt string for every level", () => {
    for (const level of LEVEL_KEYS) {
      expect(typeof CAVEMAN_PROMPTS[level]).toBe("string");
      expect(CAVEMAN_PROMPTS[level].length).toBeGreaterThan(0);
    }
  });

  it("keeps upstream shared safety and clarity rules at every level", () => {
    for (const level of LEVEL_KEYS) {
      const prompt = CAVEMAN_PROMPTS[level];
      expect(prompt).toContain("Never drop not, never, no, only, or except");
      expect(prompt).toContain("Security warnings, irreversible action confirmations");
      expect(prompt).toContain("Never invent abbreviations");
      expect(prompt).toContain("mangle grammar when correct grammar costs same");
      expect(prompt).toContain("preserve user's dominant language");
      expect(prompt).toContain("keep grammar particles and postpositions");
      expect(prompt).toContain("No self-reference or style announcement");
      expect(prompt).toContain("No tool-call narration");
      expect(prompt).toContain("Tool calls: fire direct");
      expect(prompt).toContain("One idea per sentence, target 20 words");
      expect(prompt).toContain("Write normal prose in code, comments, commits, docs");
      expect(prompt).toContain("Compression changes style only, never adds words");
    }
  });

  it("keeps upstream intensity contracts distinct", () => {
    expect(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.LITE]).toContain("Keep grammar and full sentences");
    expect(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.FULL]).toContain("Drop articles (a/an/the)");
    expect(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.ULTRA]).toContain("cause and effect stay unambiguous");
    expect(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.WENYAN_LITE]).toContain("semi-classical Chinese");
    expect(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.WENYAN]).toContain("80-90% character reduction, not token reduction");
    expect(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.WENYAN_ULTRA]).toContain("extreme classical Chinese compression");
  });

});
