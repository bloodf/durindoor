import { expect, it } from "vitest";
import { openAIToBedrockConverse } from "../../open-sse/executors/bedrock.js";

it("pairs normalized tool IDs and reserves colliding valid IDs", () => {
  const invalid = "call.1";
  const first = openAIToBedrockConverse("model", { messages: [{ role: "assistant", tool_calls: [{ id: invalid, function: { name: "f", arguments: "{}" } }] }, { role: "tool", tool_call_id: invalid, content: "ok" }] });
  const generated = first.messages[0].content[0].toolUse.toolUseId;
  const result = openAIToBedrockConverse("model", { messages: [{ role: "assistant", tool_calls: [{ id: invalid, function: { name: "f", arguments: "{}" } }, { id: generated, function: { name: "g", arguments: "{}" } }] }, { role: "tool", tool_call_id: invalid, content: "ok" }, { role: "tool", tool_call_id: generated, content: "ok" }] });
  const calls = result.messages[0].content.map(x => x.toolUse.toolUseId);
  const results = result.messages[1].content.map(x => x.toolResult.toolUseId);
  expect(calls[0]).not.toBe(calls[1]);
  expect(calls).toEqual(results);
  expect(calls[0]).toMatch(/^[a-zA-Z0-9_-]+$/);
});

it("normalizes Claude tool results and omits empty IDs", () => {
  const result = openAIToBedrockConverse("model", { messages: [
    { role: "assistant", content: [{ type: "tool_use", id: "call.1", name: "f", input: {} }, { type: "tool_use", id: "", name: "g", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call.1", content: "ok" }, { type: "tool_result", tool_use_id: "", content: "no" }] }
  ] });
  expect(result.messages[0].content).toHaveLength(1);
  expect(result.messages[1].content).toHaveLength(1);
  expect(result.messages[0].content[0].toolUse.toolUseId).toBe(result.messages[1].content[0].toolResult.toolUseId);
});
