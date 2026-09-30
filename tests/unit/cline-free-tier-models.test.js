import { describe, it, expect } from "vitest";
import clineRegistry from "../../open-sse/providers/registry/cline.js";
import clinepassRegistry from "../../open-sse/providers/registry/clinepass.js";
import { getPricingForModel, isPaidModel } from "../../open-sse/providers/pricing.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const modelIds = () => clineRegistry.models.map((m) => m.id);

describe("cline free tier", () => {
  it("offers the free-tier models on the cline catalog", () => {
    expect(modelIds()).toEqual(expect.arrayContaining([
      "cline-free/muse-spark-1.3-contributor",
      "deepseek/deepseek-v4-flash",
      "z-ai/glm-5.3-flash",
      "cline-free/solar-pro4",
      "cline-free/longcat-2.0",
      "poolside/laguna-s-2.1:free",
    ]));
  });

  it("accepts an API key as well as OAuth, like its clinepass sibling", () => {
    expect(clineRegistry.authModes).toEqual(["oauth", "apikey"]);
    expect(clineRegistry.hasOAuth).toBe(true);
    expect(clinepassRegistry.authModes).toContain("apikey");
  });
  // `solar-pro4` contains the substring "o4", so without a dedicated pattern it
  // falls through to the OpenAI o-series catch-all `*o4*` and is advertised as
  // vision-capable with a 100K output ceiling. A client then sends an image the
  // model cannot read. The fork already hit this exact trap with `solar-pro3`
  // against `*o3*` (see the upstage override in capabilities.js), which is why the
  // new patterns must stay ABOVE the o-series block.
  it("does not let solar-pro4 inherit OpenAI o-series vision from the *o4* pattern", () => {
    const caps = getCapabilitiesForModel("cline", "cline-free/solar-pro4");
    expect(caps.vision).toBe(false);
    expect(caps.contextWindow).toBe(200000);
    expect(caps.maxOutput).toBe(32000);
  });

  it("gives longcat the conservative free-tier envelope", () => {
    const caps = getCapabilitiesForModel("cline", "cline-free/longcat-2.0");
    expect(caps.reasoning).toBe(true);
    expect(caps.contextWindow).toBe(200000);
    expect(caps.maxOutput).toBe(32000);
  });

  // The pre-existing solar-pro3 override must keep winning over the new glob.
  it("keeps the exact solar-pro3 override ahead of the new pattern", () => {
    const caps = getCapabilitiesForModel("upstage", "solar-pro3");
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(false);
  });
});

describe("cline-free pricing and classification", () => {
  // Without the namespace rule the vendor-prefix strip resolves
  // cline-free/deepseek-v4.1-flash to the paid deepseek-v4.1-flash row.
  it("prices cline-free/* at zero even when the base name has a paid rate", () => {
    for (const id of ["cline-free/deepseek-v4.1-flash", "cline-free/gemini-3.8-flash", "cline-free/muse-spark-1.3-contributor"]) {
      expect(getPricingForModel("cline", id)).toMatchObject({ input: 0, output: 0, cached: 0, reasoning: 0, cache_creation: 0 });
    }
  });

  it("charges zero for Cline catalog models explicitly marked Free, not their paid twins", () => {
    for (const id of ["deepseek/deepseek-v4-flash", "z-ai/glm-5.3-flash", "poolside/laguna-s-2.1:free"]) {
      expect(getPricingForModel("cline", id)).toMatchObject({ input: 0, output: 0 });
      expect(isPaidModel(`cline/${id}`)).toBe(false);
    }
    expect(getPricingForModel("deepseek", "deepseek-v4-flash").input).toBeGreaterThan(0);
    expect(getPricingForModel("cline", "anthropic/claude-opus-5").input).toBeGreaterThan(0);
  });

  it("classifies cline-free/* as free and other cline models as paid", () => {
    expect(isPaidModel("cline/cline-free/deepseek-v4.1-flash")).toBe(false);
    expect(isPaidModel("cline/cline-free/gemini-3.8-flash")).toBe(false);
    expect(isPaidModel("cline/anthropic/claude-opus-5")).toBe(true);
  });
});
