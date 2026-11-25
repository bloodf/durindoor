// Regression for upstream decolua/9router#3223 — Antigravity rejects Zed's Claude SDK marker.
import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { ANTIGRAVITY_DEFAULT_SYSTEM } from "../../open-sse/config/appConstants.js";

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

    expect(out.request.systemInstruction.parts.map((part) => part.text)).toEqual([ANTIGRAVITY_DEFAULT_SYSTEM, "Keep this.  Continue."]);
  });

  it("leaves unrelated system instructions untouched", () => {
    const systemInstruction = { parts: [{ text: "Follow repository conventions." }] };
    const out = transform({
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      systemInstruction,
    });

    // 9router e37cb78e16: the Antigravity identity leads; client text is kept unchanged after it.
    expect(out.request.systemInstruction).toEqual({ parts: [{ text: ANTIGRAVITY_DEFAULT_SYSTEM }, ...systemInstruction.parts] });
  });

  it("gives requests without a system instruction only the Antigravity identity", () => {
    const out = transform({
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
    });

    expect(out.request.systemInstruction).toEqual({ role: "user", parts: [{ text: ANTIGRAVITY_DEFAULT_SYSTEM }] });
  });
});
