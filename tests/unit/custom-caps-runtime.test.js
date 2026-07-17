import { describe, expect, it, vi } from "vitest";
import { reorderByCapabilities } from "../../open-sse/services/combo.js";
import { applyVisionBridgeReroute } from "../../open-sse/services/model.js";

describe("capabilitiesMap runtime consumption", () => {
  it("reorderByCapabilities promotes a custom vision model via capabilitiesMap", () => {
    const models = ["prov/text-model", "prov/custom-vision"];
    const caps = new Map([
      ["prov/custom-vision", { vision: true }],
      ["prov/text-model", { vision: false }],
    ]);
    const out = reorderByCapabilities(models, new Set(["vision"]), caps);
    expect(out[0]).toBe("prov/custom-vision");
  });

  it("applyVisionBridgeReroute skips reroute when custom caps declare vision", () => {
    const body = {
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,x" } }] }],
    };
    const settings = { visionBridgeEnabled: true, visionBridgeTarget: "claude/claude-sonnet-4-5" };
    const res = applyVisionBridgeReroute({
      body,
      modelStr: "prov/custom-vision",
      settings,
      capabilities: { vision: true },
    });
    expect(res.rerouted).toBe(false);
    expect(res.modelStr).toBe("prov/custom-vision");
  });
});

describe("clinepass thinking budget custom caps", () => {
  it("uses custom maxOutput instead of static caps", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const ex = new DefaultExecutor("clinepass");
    const body = { max_tokens: 512, reasoning_effort: "high" };
    // custom caps: reasoning enabled, low ceiling — budget must not exceed it
    const out = ex.ensureThinkingBudget(body, "custom-model", { reasoning: true, maxOutput: 1024 });
    expect(out.max_tokens).toBeLessThanOrEqual(1024);
  });

  it("no reasoning in custom caps -> body untouched", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const ex = new DefaultExecutor("clinepass");
    const body = { max_tokens: 512, reasoning_effort: "high" };
    const out = ex.ensureThinkingBudget(body, "custom-model", { reasoning: false });
    expect(out.max_tokens).toBe(512);
  });
});
