import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { reorderByCapabilities } from "../../open-sse/services/combo.js";
import { applyVisionBridgeReroute } from "../../open-sse/services/model.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const IMAGE_BODY = () => ({
  model: "kr/auto",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Describe this image" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
      ],
    },
  ],
});

describe("Kiro auto vision capability (decolua/9router#5876 @ a7efe9ced667)", () => {
  it("marks kiro/auto and kr/auto as vision-capable", () => {
    expect(getCapabilitiesForModel("kiro", "auto").vision).toBe(true);
    expect(getCapabilitiesForModel("kr", "auto").vision).toBe(true);
  });

  it("preserves image parts for kiro/auto and kr/auto while stripping non-vision Kiro models", () => {
    for (const provider of ["kiro", "kr"]) {
      const body = IMAGE_BODY();
      stripUnsupportedModalities(body, FORMATS.OPENAI, getCapabilitiesForModel(provider, "auto"));
      expect(body.messages[0].content.some((part) => part.type === "image_url")).toBe(true);
    }

    const textOnlyBody = IMAGE_BODY();
    stripUnsupportedModalities(textOnlyBody, FORMATS.OPENAI, getCapabilitiesForModel("kr", "deepseek-3.2"));
    expect(textOnlyBody.messages[0].content.some((part) => part.type === "image_url")).toBe(false);
  });

  it("keeps kr/auto and kiro/auto first in vision-required combo ordering", () => {
    const required = new Set(["vision"]);
    expect(reorderByCapabilities(["kr/auto", "openai/gpt-4o"], required)).toEqual([
      "kr/auto",
      "openai/gpt-4o",
    ]);
    expect(reorderByCapabilities(["kiro/auto", "openai/gpt-4o"], required)).toEqual([
      "kiro/auto",
      "openai/gpt-4o",
    ]);
    expect(reorderByCapabilities(["kr/deepseek-3.2", "openai/gpt-4o"], required)).toEqual([
      "openai/gpt-4o",
      "kr/deepseek-3.2",
    ]);
  });

  it("does not reroute kr/auto or kiro/auto through Vision Bridge", () => {
    const settings = {
      visionBridgeEnabled: true,
      visionBridgeModel: "openai/gpt-4o",
    };

    for (const modelStr of ["kr/auto", "kiro/auto"]) {
      const result = applyVisionBridgeReroute({ body: IMAGE_BODY(), modelStr, settings });
      expect(result.rerouted).toBe(false);
      expect(result.modelStr).toBe(modelStr);
    }

    const rerouted = applyVisionBridgeReroute({
      body: IMAGE_BODY(),
      modelStr: "kr/deepseek-3.2",
      settings,
    });
    expect(rerouted.rerouted).toBe(true);
    expect(rerouted.toModel).toBe("openai/gpt-4o");
  });
});
