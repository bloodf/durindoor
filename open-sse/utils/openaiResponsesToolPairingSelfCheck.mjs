import assert from "node:assert/strict";
import { openaiResponsesToOpenAIRequest, openaiToOpenAIResponsesRequest } from "../translator/request/openai-responses.js";

function quietWarns(fn) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    return { value: fn(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

function responsesItems() {
  return [
    { type: "function_call", call_id: "call_ok", name: "read_file", arguments: "{}" },
    { type: "function_call_output", call_id: "call_ok", output: "contents" },
    { type: "function_call_output", call_id: "call_orphan", output: "old result" },
    { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] }
  ];
}

function run(name, fn) {
  fn();
  console.log(`ok   - ${name}`);
}

run("Responses→OpenAI strips orphaned function_call_output", () => {
  const { value, warnings } = quietWarns(() => openaiResponsesToOpenAIRequest("gpt-x", { input: responsesItems() }, true, {}));
  assert.equal(warnings.length, 1);
  assert.equal(value.messages.some(msg => msg.role === "tool" && msg.tool_call_id === "call_orphan"), false);
  assert.equal(value.messages.some(msg => msg.role === "tool" && msg.tool_call_id === "call_ok"), true);
});

run("Responses passthrough keeps same array when no function calls exist", () => {
  const input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }];
  const result = openaiToOpenAIResponsesRequest("gpt-x", { input }, true, {});
  assert.equal(result.input, input);
});

run("Responses passthrough strips orphan and returns a new input array", () => {
  const input = responsesItems();
  const { value, warnings } = quietWarns(() => openaiToOpenAIResponsesRequest("gpt-x", { input }, true, {}));
  assert.equal(warnings.length, 1);
  assert.notEqual(value.input, input);
  assert.deepEqual(value.input.map(item => item.call_id).filter(Boolean), ["call_ok", "call_ok"]);
});

run("OpenAI→Responses built input strips tool messages without matching tool_calls", () => {
  const body = {
    messages: [
      { role: "user", content: "hi" },
      { role: "tool", tool_call_id: "missing", content: "stale result" }
    ]
  };
  const { value, warnings } = quietWarns(() => openaiToOpenAIResponsesRequest("gpt-x", body, true, {}));
  assert.equal(warnings.length, 1, "orphan tool result with no function_call is now stripped");
  assert.equal(value.input.some(item => item.type === "function_call_output"), false);
});

run("OpenAI→Responses built input keeps matched tool result", () => {
  const body = {
    messages: [
      { role: "assistant", content: null, tool_calls: [{ id: "call_ok", function: { name: "read_file", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_ok", content: "contents" }
    ]
  };
  const result = openaiToOpenAIResponsesRequest("gpt-x", body, true, {});
  assert.deepEqual(result.input.map(item => item.type), ["function_call", "function_call_output"]);
});

console.log("\n5/5 checks passed");
