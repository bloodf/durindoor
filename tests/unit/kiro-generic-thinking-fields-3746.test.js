import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { KIRO_UNSUPPORTED_THINKING_FIELDS } from "../../open-sse/config/kiroConstants.js";

const CREDS = { providerSpecificData: {} };
const MODEL = "claude-sonnet-4.5";

const CLIENT_BODIES = {
  "openai-responses": { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }], reasoning: { effort: "medium" } },
  gemini: { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { thinkingConfig: { thinkingBudget: 4096 } } },
  openai: { messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" },
  claude: { messages: [{ role: "user", content: "hi" }], thinking: { type: "enabled", budget_tokens: 4096 } },
};

describe("upstream 9router #3746: Kiro rejects generic thinking fields", () => {
  it.each(Object.entries(CLIENT_BODIES))("sends none of them for a %s client", (format, body) => {
    for (const model of [MODEL, "claude-opus-4.8", "glm-5"]) {
      const payload = translateRequest(format, "kiro", model, structuredClone(body), false, CREDS, "kiro");
      const before = structuredClone(payload);

      const sent = new KiroExecutor().transformRequest(model, payload, false, CREDS);

      for (const field of KIRO_UNSUPPORTED_THINKING_FIELDS) expect(sent).not.toHaveProperty(field);
      // conversationId is regenerated per request for generated sessions.
      expect(sent.conversationState.currentMessage).toEqual(before.conversationState.currentMessage);
      expect(sent.inferenceConfig).toEqual(before.inferenceConfig);
      expect(payload).toEqual(before);
    }
  });

  it("keeps the nested effort fields Kiro accepts", () => {
    const nested = { thinking: { type: "adaptive" }, output_config: { effort: "high" } };
    const sent = new KiroExecutor().transformRequest(
      MODEL, { conversationState: {}, thinking: { type: "enabled" }, additionalModelRequestFields: nested }, false, CREDS
    );

    expect(sent).toEqual({ conversationState: {}, additionalModelRequestFields: nested });
  });
});
