import { describe, expect, it } from "vitest";
import {
  isPaidModel,
  filterPaidModels,
  getPricingForModel,
  PROVIDER_PRICING,
} from "../../open-sse/providers/pricing.js";

// #6495 / F-4 — `hidePaidModels` classifier. Authority is the curated free
// catalog (open-sse/config/freeModelCatalog.js): provider absent from it →
// paid; present → paid unless the model is on the free roster / zero-price /
// `:free`. Explicit registry free markers (no-auth, category free, per-model
// `free`/`(Free)`/`:free`) win first. Unknown/unpriced on a non-free provider
// is PAID. Provider overrides and glob fallbacks still feed zero-price detection.

describe("isPaidModel (hidePaidModels classifier)", () => {
  it("keeps bare / providerless ids visible (no catalog entry, no slash)", () => {
    // buildModelsList dedupes providerless/custom rows under bare names; they
    // must never be classified as paid just because the catalog has no entry.
    expect(isPaidModel("foo")).toBe(false);
    expect(isPaidModel("my-custom-model")).toBe(false);
    expect(isPaidModel("")).toBe(false);
  });

  it("classifies pattern-priced model under a paid provider as paid", () => {
    // claude-sonnet-5 priced via `claude-*` glob fallback (no exact row).
    expect(isPaidModel("anthropic/claude-sonnet-5")).toBe(true);
  });

  it("honors provider-specific override keyed by alias (gh)", () => {
    // `gh` is an alias for github; the override row lives under the alias key,
    // so classifier must resolve pricing using the original alias, not the
    // canonical provider id. Assert object identity to prove the override row
    // (not canonical/pattern fallback) is what got returned.
    expect(getPricingForModel("gh", "gpt-5.3-codex")).toBe(
      PROVIDER_PRICING.gh["gpt-5.3-codex"]
    );
    expect(isPaidModel("gh/gpt-5.3-codex")).toBe(true);
  });

  it("resolves glob pattern fallback (codex-*) as paid", () => {
    expect(isPaidModel("codex/codex-mini-latest")).toBe(true);
  });

  it("treats unknown provider as paid (no curated free roster)", () => {
    // shouldHidePaid: provider absent from free catalog → hide everything.
    expect(isPaidModel("some-provider/totally-unknown-model-xyz")).toBe(true);
  });

  it("hides unlisted model under a free-catalog provider (Gemini priced-only)", () => {
    // gemini has a curated free roster; a model not on it (and not zero-price)
    // is paid even though other gemini models are free.
    expect(isPaidModel("gemini/gemini-3-ultra-unlisted")).toBe(true);
  });

  it("exempts explicit free registry entry even when family is pattern-priced (api-airforce (Free))", () => {
    // claude-3.7-sonnet matches the `claude-*` glob (paid), but api-airforce
    // lists it as "Claude 3.7 Sonnet (Free)" — per-model free marker wins.
    expect(isPaidModel("af/anthropic/claude-3.7-sonnet")).toBe(false);
    expect(isPaidModel("api-airforce/anthropic/claude-3.7-sonnet")).toBe(false);
  });

  it("exempts no-auth free provider (auggie) for priced family", () => {
    // auggie is category free / noAuth and serves claude-sonnet-4.6 (priced).
    expect(isPaidModel("aug/claude-sonnet-4.6")).toBe(false);
  });

  it("keeps a curated free model visible under a free-tier provider", () => {
    // gemini-2.5-flash is on the gemini free roster → NOT paid even though the
    // pricing table lists a positive rate for gemini-*-flash.
    expect(isPaidModel("gemini/gemini-2.5-flash")).toBe(false);
  });

  it("resolves the ghm alias to github-models for the catalog lookup", () => {
    // github-models lists openai/gpt-4.1 as free; the `ghm` alias must resolve
    // to the canonical `github-models` id so the catalog row matches. Nested
    // model id (openai/gpt-4.1) also exercises the first-slash split.
    expect(isPaidModel("github-models/openai/gpt-4.1")).toBe(false);
    expect(isPaidModel("ghm/openai/gpt-4.1")).toBe(false);
  });

  it("preserves nested model ids (split at first slash only)", () => {
    // fireworks override keys the full path; first-slash split keeps it intact.
    expect(isPaidModel("fireworks/accounts/fireworks/models/glm-5p2")).toBe(true);
  });

  it("returns false for empty / non-string input", () => {
    expect(isPaidModel("")).toBe(false);
    expect(isPaidModel(null)).toBe(false);
    expect(isPaidModel(undefined)).toBe(false);
  });
});

describe("filterPaidModels", () => {
  it("passes through unchanged when disabled", () => {
    const all = ["anthropic/claude-sonnet-5", "af/anthropic/claude-3.7-sonnet"];
    expect(filterPaidModels(all, false)).toBe(all);
  });

  it("drops paid, keeps free + catalog-listed when enabled", () => {
    const all = [
      "anthropic/claude-sonnet-5",            // paid (no free roster)
      "af/anthropic/claude-3.7-sonnet",       // free marker
      "aug/claude-sonnet-4.6",                // no-auth free provider
      "mystery/never-seen-before",            // unknown provider → paid (hidden)
    ];
    expect(filterPaidModels(all, true)).toEqual([
      "af/anthropic/claude-3.7-sonnet",
      "aug/claude-sonnet-4.6",
    ]);
  });

  it("classifies object entries by id", () => {
    const all = [
      { id: "anthropic/claude-sonnet-5" },
      { id: "af/anthropic/claude-3.7-sonnet" },
    ];
    expect(filterPaidModels(all, true).map((m) => m.id)).toEqual([
      "af/anthropic/claude-3.7-sonnet",
    ]);
  });
});
