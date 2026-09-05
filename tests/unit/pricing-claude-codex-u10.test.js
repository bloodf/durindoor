import { describe, it, expect } from "vitest";
import {
  getPricingForModel,
  MODEL_PRICING,
  PROVIDER_PRICING,
  PATTERN_PRICING,
} from "../../open-sse/providers/pricing.js";

// Port of upstream 9router d2599ebf1 — fix(pricing): Claude/Codex model rates + new models.
// Pin: decolua/9router @ d2599ebf176051c55a524373bf56cc779884b7e9
//
// Assert via the public resolution path (getPricingForModel) so precedence bugs
// (provider override vs canonical vs PATTERN_PRICING) surface, not just the
// constant table. Exact rate objects match the upstream commit.

const claude = (input, output, cached, reasoning, cache_creation) => ({
  input, output, cached, reasoning, cache_creation,
});

describe("U-10 Claude/Codex pricing (upstream d2599ebf1)", () => {
  describe("new model entries resolve to canonical rates", () => {
    it("claude-fable-5", () => {
      expect(getPricingForModel(null, "claude-fable-5")).toBe(MODEL_PRICING["claude-fable-5"]);
      expect(getPricingForModel(null, "claude-fable-5")).toEqual(
        claude(10.00, 50.00, 1.00, 50.00, 12.50),
      );
    });

    it("gpt-5.6 keeps its exact fork rate instead of the generic GPT-5 fallback", () => {
      expect(getPricingForModel(null, "gpt-5.6")).toBe(MODEL_PRICING["gpt-5.6"]);
      expect(getPricingForModel(null, "gpt-5.6")).toEqual(
        claude(2.50, 15.00, 0.25, 15.00, 2.50),
      );
    });


    it("gpt-5.6-luna", () => {
      expect(getPricingForModel(null, "gpt-5.6-luna")).toEqual(
        claude(1.00, 1.25, 0.10, 1.25, 1.00),
      );
    });

    it("gpt-5.6-terra", () => {
      expect(getPricingForModel(null, "gpt-5.6-terra")).toEqual(
        claude(2.50, 3.125, 0.25, 3.125, 2.50),
      );
    });

    it("gpt-5.6-sol", () => {
      expect(getPricingForModel(null, "gpt-5.6-sol")).toEqual(
        claude(5.00, 6.25, 0.50, 6.25, 5.00),
      );
    });
  });

  describe("revised canonical GPT-5 / Codex rates", () => {
    const revised = {
      "gpt-5":          claude(1.25, 10.00, 0.125, 10.00, 1.25),
      "gpt-5-mini":     claude(0.25, 2.00, 0.025, 2.00, 0.25),
      "gpt-5-codex":    claude(1.25, 10.00, 0.625, 10.00, 1.25),
      "gpt-5.1":        claude(1.25, 10.00, 0.125, 10.00, 1.25),
      "gpt-5.1-codex":  claude(1.25, 10.00, 0.625, 10.00, 1.25),
      "gpt-5.2":        claude(1.75, 14.00, 0.175, 14.00, 1.75),
      "gpt-5.2-codex":  claude(1.75, 14.00, 0.175, 14.00, 1.75),
      "gpt-5.3-codex":  claude(1.75, 14.00, 0.175, 14.00, 1.75),
    };

    for (const [model, rate] of Object.entries(revised)) {
      it(`${model} → revised rate`, () => {
        expect(getPricingForModel(null, model)).toEqual(rate);
      });
    }
  });

  describe("pattern fallback rates", () => {
    it("gpt-5.6-* pattern retains the historical fork rate", () => {
      const pattern = PATTERN_PRICING.find((entry) => entry.pattern === "gpt-5.6-*");
      expect(getPricingForModel(null, "gpt-5.6-unknown")).toBe(pattern.pricing);
      expect(pattern.pricing).toEqual(
        claude(2.50, 15.00, 0.25, 15.00, 2.50),
      );
    });

    it("*-codex-low pattern repriced", () => {
      expect(getPricingForModel(null, "gpt-5.9-codex-low")).toEqual(
        claude(1.75, 14.00, 0.175, 14.00, 1.75),
      );
    });

    it("*-codex-none pattern repriced (now equals -low)", () => {
      expect(getPricingForModel(null, "gpt-5.9-codex-none")).toEqual(
        claude(1.75, 14.00, 0.175, 14.00, 1.75),
      );
    });

    it("codex-* catch-all pattern repriced", () => {
      expect(getPricingForModel(null, "codex-future")).toEqual(
        claude(1.75, 14.00, 0.175, 14.00, 1.75),
      );
    });

    it("gpt-5.3-* / gpt-5.2-* patterns align to 1.75/14.00", () => {
      expect(getPricingForModel(null, "gpt-5.3-anything")).toEqual(
        claude(1.75, 14.00, 0.175, 14.00, 1.75),
      );
      expect(getPricingForModel(null, "gpt-5.2-anything")).toEqual(
        claude(1.75, 14.00, 0.175, 14.00, 1.75),
      );
    });

    it("gpt-5.1-* pattern aligns to 1.25/10.00", () => {
      expect(getPricingForModel(null, "gpt-5.1-anything")).toEqual(
        claude(1.25, 10.00, 0.125, 10.00, 1.25),
      );
    });

    // The three rows below have NO exact/family case that reaches them: every
    // changed canonical id is also matched by a more specific dotted pattern.
    // Probe each with an unknown id that uniquely lands on that single row, and
    // assert IDENTITY against the matched PATTERN_PRICING row (toBe) so a
    // deleted row falling through to an equal-value sibling would fail.
    const row = (pattern) => PATTERN_PRICING.find((p) => p.pattern === pattern);

    it("*-codex catch-all suffix row repriced (unknown id, no codex-* prefix)", () => {
      // "zz-future-codex": ends -codex, but does NOT start with "codex-" (so
      // codex-* is skipped) and carries no -low/-none/-spark suffix — unique hit
      // on the `*-codex` row.
      const r = getPricingForModel(null, "zz-future-codex");
      expect(r).toBe(row("*-codex").pricing);
      expect(r).toEqual(claude(1.75, 14.00, 0.175, 14.00, 1.75));
    });

    it("gpt-5-* dashed-family row repriced (unknown id, not a dotted 5.x)", () => {
      // "gpt-5-zzz": matches gpt-5-* but NOT gpt-5.1/5.2/5.3/5.6-* (those need
      // a dot) — lands uniquely on the dashed-family row.
      const r = getPricingForModel(null, "gpt-5-zzz");
      expect(r).toBe(row("gpt-5-*").pricing);
      expect(r).toEqual(claude(1.25, 10.00, 0.125, 10.00, 1.25));
    });

    it("gpt-5* bare row repriced (unknown id, no dash or dot after gpt-5)", () => {
      // "gpt-5zzz": matches gpt-5* but NOT gpt-5-* (needs a dash) nor the
      // dotted 5.x rows — unique hit on the bare catch-all row.
      const r = getPricingForModel(null, "gpt-5zzz");
      expect(r).toBe(row("gpt-5*").pricing);
      expect(r).toEqual(claude(1.25, 10.00, 0.125, 10.00, 1.25));
    });
  });

  describe("provider override precedence (gh gpt-5.3-codex)", () => {
    it("gh override returns the exact override object (proves precedence over canonical)", () => {
      // Identity, not equality: gh override and canonical gpt-5.3-codex now share
      // numeric rates, so only toBe on the override object proves step 1 of the
      // fallback chain (PROVIDER_PRICING) won over step 2 (MODEL_PRICING).
      expect(getPricingForModel("gh", "gpt-5.3-codex")).toBe(
        PROVIDER_PRICING.gh["gpt-5.3-codex"],
      );
    });

    it("gh override rate matches canonical gpt-5.3-codex rate", () => {
      expect(getPricingForModel("gh", "gpt-5.3-codex")).toEqual(
        claude(1.75, 14.00, 0.175, 14.00, 1.75),
      );
    });
  });

  describe("constant table still exported for direct consumers", () => {
    it("MODEL_PRICING exposes the new claude-fable-5 row", () => {
      expect(MODEL_PRICING["claude-fable-5"]).toEqual(
        claude(10.00, 50.00, 1.00, 50.00, 12.50),
      );
    });

    it("claude-fable-5-1 keeps its exact 0.25 cached rate (proves exact row beats claude-fable-* pattern)", () => {
      expect(getPricingForModel(null, "claude-fable-5-1")).toBe(MODEL_PRICING["claude-fable-5-1"]);
      expect(getPricingForModel(null, "claude-fable-5-1")).toEqual(
        claude(10.00, 50.00, 0.25, 50.00, 12.50),
      );
    });

    it("claude-fable-future resolves the claude-fable-* pattern with Fable rates", () => {
      expect(getPricingForModel(null, "claude-fable-future")).toEqual(
        claude(10.00, 50.00, 1.00, 50.00, 12.50),
      );
    });

  });
});
