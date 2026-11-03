// Antigravity catalog refresh and Gemini 4 Argon request rules (#1398, #1369).
// Ports upstream 9router 29fc880e + f172c3c4 (Argon tiers), a07ed95b (Claude 5.5
// tiers), 24034f69 (3.1 Pro High alias) and eb373017 (Gemini 4 request rules),
// applied at the Antigravity executor boundary.
import "../translator/registerAll.js";
import { describe, expect, it } from "vitest";
import antigravity from "../../open-sse/providers/registry/antigravity.js";
import { getModelUpstreamId, getModelUpstreamThinkingIntent } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel, isGemini4Model } from "../../open-sse/providers/capabilities.js";
import { ANTIGRAVITY_QUOTA_MODELS } from "../../open-sse/services/usage/google.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

const NEW_IDS = [
  "gemini-4-argon-high", "gemini-4-argon-medium", "gemini-4-argon-low", "gemini-3.1-pro-high",
  "claude-sonnet-5-5-high", "claude-sonnet-5-5-medium", "claude-sonnet-5-5-low", "claude-sonnet-5-5",
  "claude-opus-5-5-high", "claude-opus-5-5-medium", "claude-opus-5-5-low", "claude-opus-5-5",
];

function transform(model, request) {
  return new AntigravityExecutor().transformRequest(model, { request }, true, { projectId: "p", connectionId: "c" });
}

describe("Antigravity catalog refresh", () => {
  it("registers Argon, Claude 5.5 and 3.1 Pro High rows with quota tracking", () => {
    const ids = antigravity.models.map((m) => m.id);
    for (const id of NEW_IDS) {
      expect(ids).toContain(id);
      expect(ANTIGRAVITY_QUOTA_MODELS).toContain(id);
    }
  });

  it.each(["ag", "agy"])("%s resolves new rows to clean wire ids with presets", (alias) => {
    expect(getModelUpstreamId(alias, "gemini-4-argon-low")).toBe("gemini-4-argon-low");
    expect(getModelUpstreamThinkingIntent(alias, "gemini-4-argon-low")).toEqual({ mode: "level", level: "low" });
    expect(getModelUpstreamId(alias, "claude-sonnet-5-5")).toBe("claude-sonnet-5-5-high");
    expect(getModelUpstreamId(alias, "claude-opus-5-5", "low")).toBe("claude-opus-5-5-low");
    expect(getModelUpstreamId(alias, "gemini-3.1-pro-high")).toBe("gemini-pro-agent");
    expect(getModelUpstreamThinkingIntent(alias, "gemini-3.1-pro-low")).toEqual({ mode: "level", level: "low" });
  });
});

describe("Gemini 4 rules", () => {
  it("detects Gemini 4 ids only", () => {
    for (const id of ["gemini-4-argon-high", "models/gemini-4", "gemini-4.1-pro"]) expect(isGemini4Model(id)).toBe(true);
    for (const id of ["gemini-3.8-flash-high", "gemini-40", "", null]) expect(isGemini4Model(id)).toBe(false);
  });

  it("clamps Argon thinking to LOW instead of minimal", () => {
    const body = { request: { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: {} } };
    applyThinking("antigravity", "gemini-4-argon-low", body, "antigravity", { mode: "level", level: "minimal" },
      getCapabilitiesForModel("antigravity", "gemini-4-argon-low"));
    expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe("low");
  });

  const request = () => ({
    contents: [
      { role: "user", parts: [{ text: "go" }] },
      { role: "model", parts: [{ functionCall: { id: "c1", name: "read", args: {} }, thoughtSignature: "sig" }] },
      { role: "user", parts: [{ functionResponse: { id: "c1", name: "read", response: { ok: true } } }, { text: "next" }] },
    ],
    generationConfig: { temperature: 0.2, topP: 0.9, topK: 40, maxOutputTokens: 1000 },
  });

  it("drops sampling params and puts functionResponse last for Gemini 4", () => {
    const out = transform("gemini-4-argon-high", request());
    expect(out.request.generationConfig).toEqual({ maxOutputTokens: 1000 });
    const lastUser = out.request.contents.at(-1);
    expect(lastUser.parts.map((p) => Object.keys(p).find((k) => k !== "thoughtSignature"))).toEqual(["text", "functionResponse"]);
  });

  it("leaves Gemini 3.x requests unchanged", () => {
    const out = transform("gemini-3.8-flash-high", request());
    expect(out.request.generationConfig).toMatchObject({ temperature: 0.2, topP: 0.9, topK: 40, maxOutputTokens: 1000 });
    expect(Object.keys(out.request.contents.at(-1).parts[0])).toContain("functionResponse");
  });
});

describe("Gemini 3.6-3.8 Flash tiers floor minimal to low (#1552, upstream 9router#5355; 400 unverified live)", () => {
  const run = (model, intent) => {
    const body = { request: { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: {} } };
    applyThinking("antigravity", model, body, "antigravity", intent, getCapabilitiesForModel("antigravity", model));
    return body.request.generationConfig.thinkingConfig.thinkingLevel;
  };
  it.each(["gemini-3.8-flash", "gemini-3.8-flash-high", "gemini-3.7", "gemini-3.7-flash-low", "gemini-3.6", "gemini-3.6-flash-medium"])(
    "%s emits low for minimal and none", (id) => {
      expect(run(id, { mode: "level", level: "minimal" })).toBe("low");
      expect(run(id, { mode: "level", level: "none" })).toBe("low");
    });
  it("keeps minimal for Gemini 3 models with a MINIMAL tier", () => {
    expect(run("gemini-3-flash", { mode: "level", level: "minimal" })).toBe("minimal");
  });
});
