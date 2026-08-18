import { describe, expect, it } from "vitest";

// Port of decolua/9router#3238 "fix(kiro): comment out systemPrompt field
// causing REQUEST_BODY_INVALID". Upstream disabled `payload.systemPrompt =
// systemPrompt` in claude-to-kiro.js / openai-to-kiro.js because the Kiro
// gateway rejects a top-level `systemPrompt` field.
//
// DUPLICATE: DurinDoor's translators never write a top-level `systemPrompt`
// field to begin with -- system content is carried via
// userInputMessage.systemInstruction plus an <instructions> block prepended
// to the user content (claude-to-kiro.js), or folded into the merged user
// turn (openai-to-kiro.js, system role -> user role). Additionally
// open-sse/executors/kiro.js already strips any top-level `systemPrompt`
// that reaches the Kiro IDE gateway (see decolua/9router#3238 reference
// there), covering the case even more defensively than upstream's fix.
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";

describe("port-3238: kiro translators never emit top-level systemPrompt", () => {
  it("claudeToKiroRequest omits payload.systemPrompt while carrying system content via systemInstruction", () => {
    const payload = claudeToKiroRequest(
      "claude-sonnet-4.5",
      {
        system: "Follow the system instructions",
        messages: [{ role: "user", content: "Hello" }],
      },
      false,
      {},
    );

    expect(payload).not.toHaveProperty("systemPrompt");
    expect(payload.conversationState.currentMessage.userInputMessage.systemInstruction).toBe(
      "Follow the system instructions",
    );
    expect(payload.conversationState.currentMessage.userInputMessage.content).toContain(
      "Follow the system instructions",
    );
  });

  it("openaiToKiroRequest omits payload.systemPrompt while carrying system content in the merged user turn", () => {
    const payload = openaiToKiroRequest(
      "claude-sonnet-4.5",
      {
        messages: [
          { role: "system", content: "Follow the system instructions" },
          { role: "user", content: "Hello" },
        ],
      },
      false,
      {},
    );

    expect(payload).not.toHaveProperty("systemPrompt");
    expect(payload.conversationState.currentMessage.userInputMessage.content).toContain(
      "Follow the system instructions",
    );
  });
});
