// Regression: upstream decolua/9router commit 1fc2a81d (no PR) removed the
// redundant top-level `systemPrompt` field from the Kiro request payload.
// Kiro's system prompt is carried via conversationState (systemInstruction on
// the current user message / <instructions> prefix), so a top-level
// `systemPrompt` key is dead weight the upstream API ignores — and must never
// reappear on the wire payload.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const C2K = (body, credentials = null) =>
  translateRequest(FORMATS.CLAUDE, FORMATS.KIRO, "claude-sonnet-4.5", body, true, credentials, "kiro");
const O2K = (body, credentials = null) =>
  translateRequest(FORMATS.OPENAI, FORMATS.KIRO, "claude-sonnet-4.5", body, true, credentials, "kiro");

describe("Kiro payload — no top-level systemPrompt (upstream 1fc2a81d)", () => {
  it("claude-to-kiro: payload has no top-level systemPrompt, even with a system prompt", () => {
    const out = C2K({
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "hello" }],
    });
    expect("systemPrompt" in out).toBe(false);
    expect(out.systemPrompt).toBeUndefined();
    // The system prompt is NOT dropped: it survives via the native
    // systemInstruction on the current user message.
    expect(
      out.conversationState.currentMessage.userInputMessage.systemInstruction
    ).toContain("helpful assistant");
  });

  it("openai-to-kiro: payload has no top-level systemPrompt, even with a system message", () => {
    const out = O2K({
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "hello" },
      ],
    });
    expect("systemPrompt" in out).toBe(false);
    expect(out.systemPrompt).toBeUndefined();
    expect(out.conversationState.currentMessage.userInputMessage.content).toContain("hello");
  });

  it("both translators: serialized wire body contains no systemPrompt key", () => {
    const claude = C2K({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    });
    const openai = O2K({ messages: [{ role: "user", content: "hi" }] });
    // Non-enumerable internals (e.g. _toolNameMap) never reach the wire;
    // JSON.stringify reflects exactly what the executor sends upstream.
    expect(JSON.stringify(claude)).not.toContain('"systemPrompt"');
    expect(JSON.stringify(openai)).not.toContain('"systemPrompt"');
  });
});
