import { describe, expect, it } from "vitest";
import { aggregateComboCapabilities } from "../../open-sse/providers/capabilities.js";
import { applyVisionBridgeReroute } from "../../open-sse/services/model.js";

describe("combo advertising with custom capabilities", () => {
  it("advertises vision when a custom member declares it", () => {
    const customCaps = new Map([["myprov/custom-model", { vision: true }]]);
    const caps = aggregateComboCapabilities(
      ["myprov/custom-model", "openai/gpt-4o-mini"],
      null,
      null,
      0,
      customCaps,
    );
    expect(caps.vision).toBe(true);
  });

  it("keys custom caps by provider so same id on another provider stays static", () => {
    const customCaps = new Map([["provA/shared-id", { vision: true }]]);
    const capsB = aggregateComboCapabilities(["provB/shared-id"], null, null, 0, customCaps);
    // provB/shared-id has no custom row; unknown static model -> vision falsy
    expect(capsB.vision).toBeFalsy();
  });
});

describe("vision bridge custom target", () => {
  const body = {
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,x" } }] }],
  };

  it("accepts a custom vision target via targetCapabilities", () => {
    const settings = { visionBridgeEnabled: true, visionBridgeModel: "myprov/custom-vision" };
    const res = applyVisionBridgeReroute({
      body,
      modelStr: "openai/gpt-4o-mini-text",
      settings,
      capabilities: { vision: false },
      targetCapabilities: { vision: true },
    });
    expect(res.rerouted).toBe(true);
    expect(res.modelStr).toBe("myprov/custom-vision");
  });

  it("rejects a non-vision target even with source custom caps", () => {
    const settings = { visionBridgeEnabled: true, visionBridgeModel: "myprov/text-model" };
    const res = applyVisionBridgeReroute({
      body,
      modelStr: "openai/gpt-4o-mini-text",
      settings,
      capabilities: { vision: false },
      targetCapabilities: { vision: false },
    });
    expect(res.rerouted).toBe(false);
  });
});
