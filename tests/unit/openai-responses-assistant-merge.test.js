/**
 * One Responses assistant turn = ONE Chat Completions assistant message.
 *
 * Codex replays a turn as `message` (the visible text) + `reasoning` + N
 * `function_call` items. Emitting those as two consecutive assistant messages
 * makes thinking-mode upstreams reject the whole request as soon as the
 * request declares tools.
 */
import { describe, it, expect } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";

const asInput = (t) => [{ type: "output_text", text: t }];

const turn = () => [
  { type: "message", role: "user", content: [{ type: "input_text", text: "introduce the project" }] },
  { type: "message", role: "assistant", content: asInput("Let me check the project layout first.") },
  { type: "reasoning", summary: [{ type: "summary_text", text: "ls, then read README" }] },
  {
    type: "function_call",
    call_id: "call_1",
    name: "exec_command",
    arguments: JSON.stringify({ cmd: "ls -la" }),
  },
  {
    type: "function_call",
    call_id: "call_2",
    name: "exec_command",
    arguments: JSON.stringify({ cmd: "cat README.md" }),
  },
  { type: "function_call_output", call_id: "call_1", output: "a.txt\nb.txt" },
  { type: "function_call_output", call_id: "call_2", output: "# Laya" },
];

describe("responses→openai assistant turn merging", () => {
  it("merges the assistant message with the tool calls that follow it", () => {
    const out = openaiResponsesToOpenAIRequest("deepseek-v4.1-flash", { model: "m", input: turn() }, true, null);

    const assistants = out.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);

    const [assistant] = assistants;
    expect(assistant.tool_calls).toHaveLength(2);
    expect(assistant.tool_calls.map((tc) => tc.id)).toEqual(["call_1", "call_2"]);
    // The visible text is kept, not dropped in favour of content: null. A
    // text-only content array collapses to a string, matching the shape a
    // plain assistant message without tool_calls would carry.
    expect(assistant.content).toBe("Let me check the project layout first.");
  });

  it("attaches reasoning that arrives after the message to the same turn", () => {
    const out = openaiResponsesToOpenAIRequest("deepseek-v4.1-flash", { model: "m", input: turn() }, true, null);

    const assistants = out.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].reasoning_content).toBe("ls, then read README");
  });

  it("keeps tool result ordering: assistant turn, then its tool messages", () => {
    const out = openaiResponsesToOpenAIRequest("deepseek-v4.1-flash", { model: "m", input: turn() }, true, null);

    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "tool"]);
    expect(out.messages[2].tool_call_id).toBe("call_1");
    expect(out.messages[3].tool_call_id).toBe("call_2");
  });

  it("does not emit an empty tool_calls array for a plain assistant message", () => {
    const out = openaiResponsesToOpenAIRequest(
      "deepseek-v4.1-flash",
      {
        model: "m",
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
          { type: "message", role: "assistant", content: asInput("hello") },
          { type: "message", role: "user", content: [{ type: "input_text", text: "again" }] },
        ],
      },
      true,
      null
    );

    const assistants = out.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).not.toHaveProperty("tool_calls");
    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  // #1335 CTO: flush the tool-only turn, then relocate the late output by call id.
  it("flushes a preceding tool-only turn and relocates its late output", () => {
    const out = openaiResponsesToOpenAIRequest(
      "deepseek-v4.1-flash",
      {
        model: "m",
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
          { type: "function_call", call_id: "call_1", name: "exec_command", arguments: "{}" },
          { type: "message", role: "assistant", content: asInput("done") },
          { type: "function_call_output", call_id: "call_1", output: "ok" },
        ],
      },
      true,
      null
    );

    expect(out.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "exec_command", arguments: "{}" },
        }],
      },
      { role: "tool", tool_call_id: "call_1", content: "ok" },
      { role: "assistant", content: "done" },
    ]);
  });
});
