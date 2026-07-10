import { describe, it, expect } from "vitest";
import {
  getPricingForModel,
  MODEL_PRICING,
  PROVIDER_PRICING,
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
      expect(getPricingForModel(null, "claude-fable-5")).toEqual(
        claude(10.00, 50.00, 1.00, 50.00, 12.50),
      );
    });

    it("gpt-5.6", () => {
      expect(getPricingForModel(null, "gpt-5.6")).toEqual(
        claude(2.50, 15.00, 0.25, 15.00, 2.50),
      );
    });

    it("gpt-5.6-luna", () => {
      expect(getPricingForModel(null, "gpt-5.6-luna")).toEqual(
        claude(1.00, 6.00, 0.10, 6.00, 1.00),
      );
    });

    it("gpt-5.6-terra", () => {
      expect(getPricingForModel(null, "gpt-5.6-terra")).toEqual(
        claude(2.50, 15.00, 0.25, 15.00, 2.50),
      );
    });

    it("gpt-5.6-sol", () => {
      expect(getPricingForModel(null, "gpt-5.6-sol")).toEqual(
        claude(5.00, 30.00, 0.50, 30.00, 5.00),
      );
    });
  });

  describe("revised canonical GPT-5 / Codex rates", () => {
    const revised = {
      "gpt-5":          claude(1.25, 10.00, 0.625, 10.00, 1.25),
      "gpt-5-mini":     claude(0.25, 2.00, 0.125, 2.00, 0.25),
      "gpt-5-codex":    claude(1.25, 10.00, 0.625, 10.00, 1.25),
      "gpt-5.1":        claude(1.25, 10.00, 0.625, 10.00, 1.25),
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
    it("gpt-5.6-* pattern matches new family variants", () => {
      expect(getPricingForModel(null, "gpt-5.6-unknown")).toEqual(
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
        claude(1.25, 10.00, 0.625, 10.00, 1.25),
      );
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
  });
});
