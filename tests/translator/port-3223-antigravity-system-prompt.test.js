// Regression for upstream decolua/9router#3223 — Antigravity rejects Zed's Claude SDK marker.
import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const MARKER = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
const transform = (request) => new AntigravityExecutor().transformRequest("gemini-2.5-pro", { request }, true, {
  projectId: "project-1",
  connectionId: "conn-1",
});

describe("port #3223: Antigravity system instruction sanitization", () => {
  it("removes Zed's Claude SDK marker from system instruction parts", () => {
    const out = transform({
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      systemInstruction: { parts: [{ text: `Keep this. ${MARKER} Continue.` }] },
    });

    expect(out.request.systemInstruction.parts[0].text).toBe("Keep this.  Continue.");
  });

  it("leaves unrelated system instructions untouched", () => {
    const systemInstruction = { parts: [{ text: "Follow repository conventions." }] };
    const out = transform({
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      systemInstruction,
    });

    expect(out.request.systemInstruction).toEqual(systemInstruction);
  });

  it("keeps requests without a system instruction unaffected", () => {
    const out = transform({
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
    });

    expect(out.request).not.toHaveProperty("systemInstruction");
  });
});
