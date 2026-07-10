import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  stripInternalKeys,
  validateOutboundPayload,
} from "../../open-sse/translator/validate.js";

function validKiroBody() {
  return {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: "session-144",
      currentMessage: {
        userInputMessage: {
          content: "hello",
          modelId: "claude-sonnet-4.5",
          origin: "AI_EDITOR",
        },
      },
      history: [],
    },
    inferenceConfig: { maxTokens: 32000 },
  };
}

describe("Kiro outbound validation", () => {
  it("accepts the native conversationState envelope without OpenAI fields", () => {
    const body = validKiroBody();
    expect(body.model).toBeUndefined();
    expect(body.messages).toBeUndefined();
    expect(validateOutboundPayload(FORMATS.KIRO, body)).toEqual({ ok: true, errors: [] });
  });

  it.each([
    ["conversation ID", (body) => { delete body.conversationState.conversationId; }],
    ["current model ID", (body) => { delete body.conversationState.currentMessage.userInputMessage.modelId; }],
    ["current content", (body) => { delete body.conversationState.currentMessage.userInputMessage.content; }],
    ["history", (body) => { delete body.conversationState.history; }],
  ])("rejects a malformed native envelope missing %s", (_label, mutate) => {
    const body = validKiroBody();
    mutate(body);
    expect(validateOutboundPayload(FORMATS.KIRO, body).ok).toBe(false);
  });

  it("detects and removes non-enumerable internal metadata", () => {
    const body = validKiroBody();
    Object.defineProperty(body, "_kiroUpstreamModel", {
      value: "claude-sonnet-4.5",
      configurable: true,
      enumerable: false,
    });

    expect(validateOutboundPayload(FORMATS.KIRO, body).ok).toBe(false);
    stripInternalKeys(body);
    expect(Reflect.ownKeys(body)).not.toContain("_kiroUpstreamModel");
    expect(validateOutboundPayload(FORMATS.KIRO, body).ok).toBe(true);
  });
});
