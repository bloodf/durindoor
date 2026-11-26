import { describe, it, expect } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";

describe("OmniRoute #20222: Responses-only fields stay off Chat requests", () => {
  it("does not send context_management or prompt to Chat", () => {
    const result = openaiResponsesToOpenAIRequest("m", { input: "hi", context_management: [{ type: "compaction" }], prompt: { id: "pmpt_1" } }, true);
    expect(result.messages).toHaveLength(1);
    expect(result).not.toHaveProperty("context_management");
    expect(result).not.toHaveProperty("prompt");
  });
});
