// Coverage for port(upstream): #4245 - Xiaomi MiMo desktop login, account
// clusters and v2.6 models.
//
// Scope note: only the v2.6-model / capability-metadata slice of the upstream
// commit applies here. This fork's xiaomi-mimo provider never got the base
// Desktop OAuth/account-service plumbing (no executor, no shared/mimoAccount.js,
// no /api/oauth/xiaomi-mimo/login/* routes, no auth modal) that the five-cluster
// desktop login and account-service dual-route models depend on upstream, so
// that part is skipped — see the port commit body for details. These tests lock
// in what did land: the mimo-v2.6-flash-free free-tier entry, the v2.6 pattern
// capabilities/thinking levels, and the three v2.6 cloud-API models.
import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

describe("MiMo V2.6 (port #4245)", () => {
  it("adds mimo-v2.6-flash-free to the OpenCode Zen free tier", () => {
    const entry = REGISTRY.find((e) => e.id === "opencode-zen");
    const model = entry.models.find((m) => m.id === "mimo-v2.6-flash-free");
    expect(model).toBeTruthy();
    expect(model.name).toBe("MiMo V2.6 Flash Free");
  });

  it("registers the three v2.6 cloud models on xiaomi-mimo", () => {
    const entry = REGISTRY.find((e) => e.id === "xiaomi-mimo");
    const ids = entry.models.map((m) => m.id);
    expect(ids).toContain("mimo-v2.6-pro");
    expect(ids).toContain("mimo-v2.6-flash");
    expect(ids).toContain("mimo-v2.6-pro-ultraspeed");
    // v2.5 line stays intact — additive only.
    expect(ids).toContain("mimo-v2.5-pro");
  });

  it("resolves full multimodal capabilities for v2.6 ids via the pattern rule", () => {
    const caps = getCapabilitiesForModel("xiaomi-mimo", "mimo-v2.6-pro");
    expect(caps).toMatchObject({
      vision: true,
      audioInput: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "deepseek",
      thinkingCanDisable: false,
      contextWindow: 1048576,
      maxOutput: 131072,
    });
  });

  it("keeps the v2.5 pattern (no audio/video) unaffected by the new v2.6 rule", () => {
    const caps = getCapabilitiesForModel("xiaomi-mimo", "mimo-v2.5-pro");
    expect(caps.vision).toBe(true);
    expect(caps.audioInput).toBeFalsy();
  });

  it("exposes a wider effort ladder for v2.6 in the thinking-level picker", () => {
    // thinkingCanDisable: false (always-on reasoning) strips "none" at resolve
    // time even though the pattern lists it — matches the *codex* row above.
    expect(getThinkingLevels("xiaomi-mimo", "mimo-v2.6-flash")).toEqual([
      "low", "medium", "high", "xhigh",
    ]);
  });
});
