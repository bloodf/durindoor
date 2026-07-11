import { describe, it, expect } from "vitest";
import { applyVisionBridgeReroute } from "../../open-sse/services/model.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// A known text-only model + a known vision-capable model, both resolved through
// the same registry/capabilities chain the helper uses, so the test tracks the
// real catalog instead of hard-coded assumptions.
const NON_VISION = "minimax/MiniMax-M2.1";
const VISION = "openai/gpt-4o";

function imageBody(model = NON_VISION) {
  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "what is in this image?" },
          { type: "image_url", image_url: { url: "https://example.com/i.png" } },
        ],
      },
    ],
  };
}

const ON = { visionBridgeEnabled: true, visionBridgeModel: VISION };

describe("applyVisionBridgeReroute (Vision Bridge #6640)", () => {
  it("reroutes image-bearing request on a non-vision model to the configured vision model", () => {
    const r = applyVisionBridgeReroute({ body: imageBody(), modelStr: NON_VISION, settings: ON });
    expect(r.rerouted).toBe(true);
    expect(r.fromModel).toBe(NON_VISION);
    expect(r.toModel).toBe(VISION);
    expect(r.modelStr).toBe(VISION);
    expect(r.body.model).toBe(VISION);
    // Target must genuinely be vision-capable.
    const p = VISION.indexOf("/");
    expect(getCapabilitiesForModel(VISION.slice(0, p), VISION.slice(p + 1)).vision).toBe(true);
  });

  it("preserves the original image message content across the reroute", () => {
    const body = imageBody();
    const expectedMessages = structuredClone(body.messages);
    const r = applyVisionBridgeReroute({ body, modelStr: NON_VISION, settings: ON });
    expect(r.rerouted).toBe(true);
    // Reroute changes the target model only — image parts must survive verbatim.
    expect(r.body.messages).toEqual(expectedMessages);
  });

  it("leaves a vision-capable model untouched (images handled natively)", () => {
    const r = applyVisionBridgeReroute({ body: imageBody(VISION), modelStr: VISION, settings: ON });
    expect(r.rerouted).toBe(false);
    expect(r.modelStr).toBe(VISION);
    expect(r.body.model).toBe(VISION);
  });

  it("passes through when the bridge is disabled", () => {
    const r = applyVisionBridgeReroute({
      body: imageBody(),
      modelStr: NON_VISION,
      settings: { visionBridgeEnabled: false, visionBridgeModel: VISION },
    });
    expect(r.rerouted).toBe(false);
    expect(r.body.model).toBe(NON_VISION);
  });

  it("passes through when no current-turn image is present", () => {
    const body = { model: NON_VISION, messages: [{ role: "user", content: "hi there" }] };
    const r = applyVisionBridgeReroute({ body, modelStr: NON_VISION, settings: ON });
    expect(r.rerouted).toBe(false);
  });

  it("ignores images in older history turns (current-turn-only semantics)", () => {
    const body = {
      model: NON_VISION,
      messages: [
        { role: "user", content: [{ type: "image_url", image_url: { url: "https://x/old.png" } }] },
        { role: "assistant", content: "described earlier" },
        { role: "user", content: "now just text, no image" },
      ],
    };
    const r = applyVisionBridgeReroute({ body, modelStr: NON_VISION, settings: ON });
    expect(r.rerouted).toBe(false);
  });

  it("passes through when no target is configured (no unsafe auto-pick)", () => {
    const r = applyVisionBridgeReroute({
      body: imageBody(),
      modelStr: NON_VISION,
      settings: { visionBridgeEnabled: true },
    });
    expect(r.rerouted).toBe(false);
    expect(r.body.model).toBe(NON_VISION);
  });

  it("passes through when the configured target is not vision-capable", () => {
    const r = applyVisionBridgeReroute({
      body: imageBody(),
      modelStr: NON_VISION,
      settings: { visionBridgeEnabled: true, visionBridgeModel: "deepseek/deepseek-chat" },
    });
    expect(r.rerouted).toBe(false);
    expect(r.body.model).toBe(NON_VISION);
  });

  it("passes through for combo / alias names (no slash) and auto/* models", () => {
    expect(applyVisionBridgeReroute({ body: imageBody("mycombo"), modelStr: "mycombo", settings: ON }).rerouted).toBe(false);
    expect(applyVisionBridgeReroute({ body: imageBody("auto/vision"), modelStr: "auto/vision", settings: ON }).rerouted).toBe(false);
  });

  it("detects image, input_image and Gemini inlineData image parts", () => {
    const cases = [
      { messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "x" } }] }] },
      { input: [{ role: "user", content: [{ type: "input_image", image_url: "https://x/a.png" }] }] },
      { contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: "x" } }] }] },
    ];
    for (const body of cases) {
      const r = applyVisionBridgeReroute({ body: { model: NON_VISION, ...body }, modelStr: NON_VISION, settings: ON });
      expect(r.rerouted).toBe(true);
    }
  });
});
