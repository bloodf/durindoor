/**
 * Claude terminal status must match the tool calls the turn emitted.
 *
 * Source: OmniRoute #18280 (head b6a1beabec061dfee18f4b5bff3a81196c559530,
 * merge e429ae792586a040d8cf20d8cd11186ed891cd3f), issue #18270.
 *
 * Some OpenAI-compatible upstreams report `finish_reason: "stop"` together
 * with `tool_calls`. The Claude projections trusted the finish reason
 * verbatim, so the client received `stop_reason: "end_turn"` next to
 * `tool_use` blocks. An agentic Claude client (Claude Code) treats `end_turn`
 * as a final turn and stops after one step, so the agent loop never reached
 * the objective.
 *
 * The promotion is deliberately narrow: it applies only when a tool block was
 * emitted and the mapped reason is an ordinary clean stop. Truncation
 * (`max_tokens`), safety stops, upstream errors, plain text completions,
 * duplicate finish chunks, tool argument identity and usage stay untouched.
 *
 * Synthetic OpenAI-shaped input only — no provider call, no network, no
 * credentials.
 */
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { translateOpenAIToClaudeIfNeeded } from "../../open-sse/translator/response/openai-to-claude-json.js";
import { projectCompletionToClientFormat } from "../../open-sse/translator/response/completionProjector.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const TOOL_ARGS = { file_path: "/tmp/a.txt" };

const toolCallMessage = (extra = {}) => ({
  role: "assistant",
  content: "Looking.",
  tool_calls: [
    {
      id: "call_1073",
      type: "function",
      function: { name: "Read", arguments: JSON.stringify(TOOL_ARGS) },
    },
  ],
  ...extra,
});

const completion = (finishReason, message = toolCallMessage()) => ({
  id: "chatcmpl-1073",
  object: "chat.completion",
  created: 1763600000,
  model: "gpt-test",
  choices: [{ index: 0, message, finish_reason: finishReason }],
  usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
});

/** Feed chunks through the streaming OpenAI → Claude translator. */
function stream(chunks) {
  const state = { toolCalls: new Map() };
  const events = [];
  for (const chunk of chunks) {
    const out = openaiToClaudeResponse(chunk, state);
    if (out) events.push(...out);
  }
  return events;
}

const toolCallChunk = () => ({
  id: "chatcmpl-1073",
  model: "gpt-test",
  choices: [
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: "call_1073",
            type: "function",
            function: { name: "Read", arguments: JSON.stringify(TOOL_ARGS) },
          },
        ],
      },
      finish_reason: null,
    },
  ],
});

const finishChunk = (finishReason, usage) => ({
  id: "chatcmpl-1073",
  model: "gpt-test",
  choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  ...(usage ? { usage } : {}),
});

const messageDelta = (events) => events.find((event) => event.type === "message_delta");
const toolBlockStart = (events) =>
  events.find(
    (event) =>
      event.type === "content_block_start" && event.content_block?.type === "tool_use"
  );

describe("Claude terminal status vs emitted tool calls (#1073)", () => {
  it("streams tool_use when an ordinary stop accompanies a tool call", () => {
    const events = stream([
      toolCallChunk(),
      finishChunk("stop", { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }),
    ]);

    expect(toolBlockStart(events)).toBeTruthy();
    const delta = messageDelta(events);
    expect(delta.delta.stop_reason).toBe("tool_use");
    expect(delta.usage).toEqual({ input_tokens: 10, output_tokens: 4 });
    expect(events.filter((event) => event.type === "message_stop")).toHaveLength(1);
  });

  it("keeps the tool arguments and the tool call identity intact", () => {
    const events = stream([toolCallChunk(), finishChunk("stop")]);

    const start = toolBlockStart(events);
    expect(start.content_block.id).toBe("call_1073");
    expect(start.content_block.name).toBe("Read");

    const argDelta = events.find(
      (event) => event.type === "content_block_delta" && event.delta?.type === "input_json_delta"
    );
    expect(JSON.parse(argDelta.delta.partial_json)).toEqual(TOOL_ARGS);
  });

  it("streams end_turn for a text-only turn", () => {
    const events = stream([
      {
        id: "chatcmpl-1073",
        model: "gpt-test",
        choices: [{ index: 0, delta: { content: "done" }, finish_reason: null }],
      },
      finishChunk("stop"),
    ]);

    expect(messageDelta(events).delta.stop_reason).toBe("end_turn");
  });

  it("keeps truncation and safety results when tool calls were emitted", () => {
    expect(messageDelta(stream([toolCallChunk(), finishChunk("length")])).delta.stop_reason).toBe(
      "max_tokens"
    );
    expect(
      messageDelta(stream([toolCallChunk(), finishChunk("content_filter")])).delta.stop_reason
    ).toBe("end_turn");
  });

  it("keeps an upstream error an error", () => {
    const events = stream([toolCallChunk(), finishChunk("error")]);
    expect(events.some((event) => event.type === "error")).toBe(true);
    expect(events.some((event) => event.type === "message_delta")).toBe(false);
  });

  it("emits one terminal delta for a duplicated finish chunk", () => {
    const events = stream([toolCallChunk(), finishChunk("stop"), finishChunk("stop")]);
    expect(events.filter((event) => event.type === "message_delta")).toHaveLength(1);
    expect(messageDelta(events).delta.stop_reason).toBe("tool_use");
  });

  it("buffers tool_use when an ordinary stop accompanies a tool call", () => {
    const out = translateOpenAIToClaudeIfNeeded(completion("stop"), FORMATS.CLAUDE);

    expect(out.stop_reason).toBe("tool_use");
    expect(out.content).toEqual([
      { type: "text", text: "Looking." },
      { type: "tool_use", id: "call_1073", name: "Read", input: TOOL_ARGS },
    ]);
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 4 });
  });

  it("buffers end_turn for a text-only turn and keeps truncation and safety", () => {
    const textOnly = { role: "assistant", content: "done" };
    expect(
      translateOpenAIToClaudeIfNeeded(completion("stop", textOnly), FORMATS.CLAUDE).stop_reason
    ).toBe("end_turn");
    expect(
      translateOpenAIToClaudeIfNeeded(completion("length"), FORMATS.CLAUDE).stop_reason
    ).toBe("max_tokens");
    expect(
      translateOpenAIToClaudeIfNeeded(completion("content_filter"), FORMATS.CLAUDE).stop_reason
    ).toBe("end_turn");
  });

  it("aligns the forced stream-to-json adapter with the same rule", () => {
    const projected = projectCompletionToClientFormat(completion("stop"), FORMATS.CLAUDE);
    expect(projected.stop_reason).toBe("tool_use");
    expect(projected.content).toEqual([
      { type: "text", text: "Looking." },
      { type: "tool_use", id: "call_1073", name: "Read", input: TOOL_ARGS },
    ]);
    expect(projectCompletionToClientFormat(completion("stop", { role: "assistant", content: "done" }), FORMATS.CLAUDE)
      .stop_reason).toBe("end_turn");
  });
});
