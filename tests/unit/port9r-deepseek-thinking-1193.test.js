import { expect, it } from "vitest";
import { injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";

it("does not inject synthetic reasoning when DeepSeek thinking is disabled", () => {
  const messages = [{ role: "assistant", content: "answer" }];
  expect(injectReasoningContent({ provider: "deepseek", model: "deepseek-v4-pro-none", body: { messages } }).messages).toEqual(messages);
  expect(injectReasoningContent({ provider: "deepseek", model: "deepseek-v4-pro", body: { messages } }).messages[0].reasoning_content).toBe(" ");
});
