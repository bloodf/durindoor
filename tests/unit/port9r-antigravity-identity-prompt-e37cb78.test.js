import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { ANTIGRAVITY_DEFAULT_SYSTEM } from "../../open-sse/config/appConstants.js";

// Port of 9router master e37cb78e16: lead every generation request with the 2.33.0 identity.
const credentials = { projectId: "project-1", connectionId: "conn-1" };

function send(model, messages) {
  const envelope = openaiToAntigravityRequest(model, { messages }, true, credentials);
  return new AntigravityExecutor().transformRequest(model, envelope, true, credentials).request;
}

describe("port 9router e37cb78e16: Antigravity identity system prompt", () => {
  it("uses the official 2.33.0 identity text", () => {
    expect(ANTIGRAVITY_DEFAULT_SYSTEM.startsWith("You are Antigravity Agent, a powerful agentic AI coding assistant")).toBe(true);
  });

  it.each(["gemini-3.5-flash-low", "claude-opus-4-6-thinking"])("leads %s requests with the identity and keeps the client prompt", (model) => {
    const request = send(model, [{ role: "system", content: "USER_SYSTEM_PROMPT" }, { role: "user", content: "hello" }]);
    expect(request.systemInstruction.parts[0].text).toBe(ANTIGRAVITY_DEFAULT_SYSTEM);
    expect(JSON.stringify(request.systemInstruction)).toContain("USER_SYSTEM_PROMPT");
  });

  it("adds a user-role systemInstruction when the client sent none", () => {
    const request = send("gemini-3.5-flash-low", [{ role: "user", content: "hello" }]);
    expect(request.systemInstruction.role).toBe("user");
    expect(request.systemInstruction.parts).toEqual([{ text: ANTIGRAVITY_DEFAULT_SYSTEM }]);
  });

  it("does not duplicate an identity that is already present", () => {
    const request = send("gemini-3.5-flash-low", [{ role: "system", content: "You are Antigravity, already here." }, { role: "user", content: "hello" }]);
    const text = request.systemInstruction.parts.map((p) => p.text).join("\n");
    expect(text).not.toContain(ANTIGRAVITY_DEFAULT_SYSTEM);
    expect(text).toContain("You are Antigravity, already here.");
  });

  it("keeps the identity as systemInstruction when an oversized client prompt is folded into the user turn", () => {
    const long = "s".repeat(4001);
    const request = send("gemini-3.5-flash-low", [{ role: "system", content: long }, { role: "user", content: "hello" }]);
    expect(request.systemInstruction.parts).toEqual([{ text: ANTIGRAVITY_DEFAULT_SYSTEM }]);
    expect(JSON.stringify(request.contents[0])).toContain(long);
  });
});
