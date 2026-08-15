import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import {
  KIRO_GPT_5_6_FAMILY,
  buildKiroGpt56Variants,
} from "../../open-sse/providers/models/kiroVariants.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

// Guards Kiro model ids that still need mappable defaultModels slots. Without
// a slot, getMappedModel (src/mitm/server.js) returns null and the request is
// passed through to AWS instead of being routed to the user's chosen provider.
describe("Kiro MITM model slots", () => {
  const kiro = MITM_TOOLS.kiro;

  it("exposes the kiro mitm tool", () => {
    expect(kiro).toBeTruthy();
    expect(kiro.configType).toBe("mitm");
    expect(Array.isArray(kiro.defaultModels)).toBe(true);
  });

  it("offers a mappable slot for Claude Sonnet 5", () => {
    const sonnet5 = kiro.defaultModels.find((m) => m.id === "claude-sonnet-5");
    expect(sonnet5).toBeTruthy();
    expect(sonnet5.alias).toBe("claude-sonnet-5");
  });

  it("offers a mappable slot for the agent default model id 'auto'", () => {
    const auto = kiro.defaultModels.find((m) => m.id === "auto");
    expect(auto).toBeTruthy();
    expect(auto.alias).toBe("auto");
  });

  it("offers a mappable slot for the background sub-task model id 'simple-task'", () => {
    const simpleTask = kiro.defaultModels.find((m) => m.id === "simple-task");
    expect(simpleTask).toBeTruthy();
    expect(simpleTask.alias).toBe("simple-task");
  });


  // decolua/9router#2596 — static MITM picker slots for the GPT-5.6 family.
  // These mirror KIRO_GPT_5_6_FAMILY in providers/models/kiroVariants.js
  // (cliTools.js must not import the server config graph); the catalog test
  // below pins the exact same ids/rates from the descriptor.
  it("offers mappable slots for the GPT-5.6 family base ids", () => {
    const byId = new Map(kiro.defaultModels.map((m) => [m.id, m]));
    expect(byId.get("gpt-5.6-sol")).toMatchObject({ alias: "gpt-5.6-sol", contextLength: 1050000, rateMultiplier: 2.4 });
    expect(byId.get("gpt-5.6-terra")).toMatchObject({ alias: "gpt-5.6-terra", contextLength: 1050000, rateMultiplier: 1.2 });
    expect(byId.get("gpt-5.6-luna")).toMatchObject({ alias: "gpt-5.6-luna", contextLength: 1050000, rateMultiplier: 0.6 });
  });
});

describe("Kiro static provider models", () => {
  it("includes Claude Sonnet 5 and its synthetic Kiro variants", () => {
    const ids = (PROVIDER_MODELS.kr || []).map((model) => model.id);
    expect(ids).toEqual(expect.arrayContaining([
      "claude-sonnet-5",
      "claude-sonnet-5-thinking",
      "claude-sonnet-5-agentic",
      "claude-sonnet-5-thinking-agentic",
    ]));
  });
});

// Guards the Kiro GPT-5.6 Sol/Terra/Luna family ported from decolua/9router#2596:
// every descriptor in KIRO_GPT_5_6_FAMILY expands to the 4 synthetic variants
// (base/-thinking/-agentic/-thinking-agentic), each carrying the family's 1.05M
// context, per-tier rate multiplier, and an upstreamModelId pointing back at
// the bare upstream id. Expectations iterate the exported descriptor — no
// duplicate hardcoded list of ids in the test.
//
// PROVIDER_MODELS here is imported from `providers/index.js` (the canonical
// registry build), NOT the config/providerModels.js barrel — so a regression
// that re-adds the rows by mutating the map after the registry build (instead
// of in registry/kiro.js) fails this suite.
describe("Kiro GPT-5.6 family (decolua/9router#2596)", () => {
  const models = new Map((PROVIDER_MODELS.kr || []).map((m) => [m.id, m]));
  const expected = KIRO_GPT_5_6_FAMILY.flatMap(buildKiroGpt56Variants);

  it("expands the descriptor into exactly 4 variants per base id", () => {
    expect(expected).toHaveLength(KIRO_GPT_5_6_FAMILY.length * 4);
  });

  it("generates exactly the 12 upstream GPT-5.6 variant ids", () => {
    // Exact contract from decolua/9router#2596 — pinned literally so a
    // generator regression (wrong suffix shape) cannot pass self-referentially.
    expect(expected.map((m) => m.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-sol-thinking",
      "gpt-5.6-sol-agentic",
      "gpt-5.6-sol-thinking-agentic",
      "gpt-5.6-terra",
      "gpt-5.6-terra-thinking",
      "gpt-5.6-terra-agentic",
      "gpt-5.6-terra-thinking-agentic",
      "gpt-5.6-luna",
      "gpt-5.6-luna-thinking",
      "gpt-5.6-luna-agentic",
      "gpt-5.6-luna-thinking-agentic",
    ]);
  });

  it("exposes every generated GPT-5.6 variant id in PROVIDER_MODELS.kr", () => {
    for (const variant of expected) {
      expect(models.has(variant.id), variant.id).toBe(true);
    }
  });

  it("each variant resolves the bare upstream id, family context, and tier rate", () => {
    for (const variant of expected) {
      const model = models.get(variant.id);
      expect(model, variant.id).toMatchObject({
        contextLength: variant.contextLength,
        rateMultiplier: variant.rateMultiplier,
        upstreamModelId: variant.upstreamModelId,
      });
      expect(model.description).toContain("1.05M context window");
    }
  });

  it("covers the Sol/Terra/Luna tiers at 2.4/1.2/0.6 rate multipliers", () => {
    const byId = new Map(KIRO_GPT_5_6_FAMILY.map((m) => [m.id, m.rateMultiplier]));
    expect(byId.get("gpt-5.6-sol")).toBe(2.4);
    expect(byId.get("gpt-5.6-terra")).toBe(1.2);
    expect(byId.get("gpt-5.6-luna")).toBe(0.6);
  });
});
