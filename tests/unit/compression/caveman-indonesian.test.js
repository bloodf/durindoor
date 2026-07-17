import { describe, expect, it } from "vitest";
import { applyRulesToText } from "../../../open-sse/services/compression/caveman.js";
import { cavemanCompress } from "../../../open-sse/services/compression/caveman.js";
import { getRulesForContext, CAVEMAN_RULES } from "../../../open-sse/services/compression/cavemanRules.js";
import {
  getAvailableLanguagePacks,
  loadAllRulesForLanguage,
} from "../../../open-sse/services/compression/ruleLoader.js";
import { detectCompressionLanguage } from "../../../open-sse/services/compression/languageDetector.js";

/**
 * Indonesian caveman language pack — ported from omniroute c9b5b1a892
 * (feat(compression): add Indonesian caveman rules and language pack #3975).
 *
 * Rule JSONs live under `open-sse/services/compression/rules/id/*.json` and are
 * compiled by `ruleLoader.js`. `cavemanRules.js` already prefers file-backed
 * packs for non-English languages; these tests pin that behaviour for `id` and
 * guard the English inline rules from regression.
 */
describe("Indonesian caveman language pack", () => {
  it("getAvailableLanguagePacks lists the id pack with all five categories", () => {
    const packs = getAvailableLanguagePacks();
    const id = packs.find((p) => p.language === "id");
    expect(id).toBeDefined();
    expect(id.categories).toEqual(["context", "dedup", "filler", "structural", "ultra"]);
    expect(id.ruleCount).toBeGreaterThan(0);
  });

  it("loads id rules via getRulesForContext instead of English fallbacks", () => {
    const idRules = getRulesForContext("user", "lite", "id");
    expect(idRules.length).toBeGreaterThan(0);
    const names = new Set(idRules.map((r) => r.name));
    expect(names.has("id_pleasantries")).toBe(true);
    expect(names.has("id_polite_framing")).toBe(true);
  });

  it("detectCompressionLanguage identifies Indonesian text", () => {
    expect(detectCompressionLanguage("bisa tolong jelaskan tentang database ini")).toBe("id");
  });

  it("applies Indonesian rules without touching technical terms", () => {
    const idRules = getRulesForContext("user", "ultra", "id");
    const { text } = applyRulesToText(
      "Tolong berikan penjelasan detail tentang basis data dan autentikasi di src/auth.ts",
      idRules
    );
    expect(text).toContain("src/auth.ts");
    expect(text).not.toContain("Tolong");
    expect(text).not.toContain("berikan penjelasan detail tentang");
    expect(text).toMatch(/\bDB\b/);
    expect(text).toMatch(/\bauth\b/);
  });

  it("cavemanCompress compresses Indonesian user messages", () => {
    const body = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content:
            "Bisa tolong jelaskan tentang database ini, terima kasih",
        },
      ],
    };
    const result = cavemanCompress(body, {
      enabled: true,
      intensity: "full",
      autoDetectLanguage: true,
      minMessageLength: 0,
    });
    expect(result.compressed).toBe(true);
    expect(result.stats.savingsPercent).toBeGreaterThan(0);
    const out = result.body.messages[0].content;
    expect(out).not.toContain("Bisa tolong");
    expect(out).not.toContain("terima kasih");
  });

  it("English inline rules remain untouched by the id pack", () => {
    const enRules = getRulesForContext("user", "full", "en");
    expect(enRules.length).toBeGreaterThan(0);
    const names = new Set(enRules.map((r) => r.name));
    expect(names.has("id_pleasantries")).toBe(false);
    expect(names.has("id_polite_framing")).toBe(false);
    expect(names.has("redundant_phrasing")).toBe(true);
    expect(names.has("pleasantries")).toBe(true);
  });
});
