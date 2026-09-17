import { describe, it, expect } from "vitest";
import clineRegistry from "../../open-sse/providers/registry/cline.js";
import clinepassRegistry from "../../open-sse/providers/registry/clinepass.js";
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
