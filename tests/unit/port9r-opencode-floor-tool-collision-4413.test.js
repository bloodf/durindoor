import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { kiroToClaudeResponse } from "../../open-sse/translator/response/kiro-to-claude.js";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";
import { OpenCodeZenExecutor } from "../../open-sse/executors/opencode-zen.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

const chunk = (toolCalls, finishReason) => ({
  id: "chatcmpl-collision",
  model: "test-model",
  choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: finishReason ?? null }],
});

// Feed tool-call deltas through a translator, one chunk each, then finish the turn.
function translate(translator, deltas, extraState = {}) {
  const state = { toolCalls: new Map(), nextBlockIndex: 0, ...extraState };
  const events = [];
  for (const delta of deltas) events.push(...(translator(chunk([delta]), state) || []));
  events.push(...(translator(chunk([], "tool_calls"), state) || []));
  return events;
}

// One entry per tool_use block, in opening order, with its concatenated arguments.
function toolBlocks(events) {
  return events
    .filter((event) => event.type === "content_block_start" && event.content_block.type === "tool_use")
    .map((start) => ({
      id: start.content_block.id,
      name: start.content_block.name,
      args: events
        .filter((event) => event.index === start.index && event.delta?.type === "input_json_delta")
        .map((event) => event.delta.partial_json)
        .join(""),
      stops: events.filter((event) => event.type === "content_block_stop" && event.index === start.index).length,
    }));
}

const call = (index, id, name, args) => ({ index, ...(id ? { id } : {}), function: { ...(name ? { name } : {}), ...(args !== undefined ? { arguments: args } : {}) } });

describe.each([
  ["openai-to-claude", openaiToClaudeResponse],
  ["kiro-to-claude", kiroToClaudeResponse],
])("9router #4413 - reused tool index in %s", (_label, translator) => {
  it("gives a second call that reuses index 0 its own block and arguments", () => {
    const blocks = toolBlocks(translate(translator, [
      call(0, "call_1", "Bash"),
      call(0, null, null, '{"command":"first"}'),
      call(0, "call_2", "Grep"),
      call(0, null, null, '{"pattern":"second"}'),
    ]));

    expect(blocks).toEqual([
      { id: "call_1", name: "Bash", args: '{"command":"first"}', stops: 1 },
      { id: "call_2", name: "Grep", args: '{"pattern":"second"}', stops: 1 },
    ]);
  });

  it("does not collide with a later call that really uses the remapped index", () => {
    const blocks = toolBlocks(translate(translator, [
      call(0, "call_1", "Bash", '{"a":1}'),
      call(0, "call_2", "Bash", '{"a":2}'),
      call(1, "call_3", "Bash", '{"a":3}'),
    ]));

    expect(blocks.map((block) => [block.id, block.args])).toEqual([
      ["call_1", '{"a":1}'], ["call_2", '{"a":2}'], ["call_3", '{"a":3}'],
    ]);
  });
});

describe("9router #4413 - openai-to-claude collision guard", () => {
  it("keeps one call when an upstream changes the id on argument-only fragments", () => {
    const blocks = toolBlocks(translate(openaiToClaudeResponse, [
      call(0, "call_1", "Bash", '{"command":'),
      call(0, "call_x", null, '"ls"}'),
    ]));

    expect(blocks).toEqual([{ id: "call_1", name: "Bash", args: '{"command":"ls"}', stops: 1 }]);
  });

  it("starts a new call for a new id once the open arguments are complete", () => {
    const blocks = toolBlocks(translate(openaiToClaudeResponse, [
      call(0, "call_1", "Bash", '{"command":"ls"}'),
      call(0, "call_2", null, '{"command":"pwd"}'),
      call(0, null, "Bash"),
    ]));

    expect(blocks.map((block) => block.args)).toEqual(['{"command":"ls"}', '{"command":"pwd"}']);
  });

  const declared = (name, key) => ({ clientTools: [{ name, input_schema: { type: "object", properties: { [key]: { type: "string" } } } }] });
  const argsFor = (name, args, extra) => JSON.parse(toolBlocks(translate(openaiToClaudeResponse, [call(0, "call_a", name, JSON.stringify(args))], extra))[0].args);

  it.each([["Read", "path"], ["Edit", "filePath"], ["Write", "filePath"]])(
    "renames the %s %s alias to the declared file_path", (name, alias) => {
      expect(argsFor(name, { [alias]: "c.txt" }, declared(name, "file_path"))).toEqual({ file_path: "c.txt" });
    },
  );

  it("leaves arguments alone when the client's tool declares the alias or is unknown", () => {
    expect(argsFor("Write", { path: "c.txt" }, declared("Write", "path"))).toEqual({ path: "c.txt" });
    expect(argsFor("Write", { path: "c.txt" })).toEqual({ path: "c.txt" });
    expect(argsFor("Write", { file_path: "a", path: "b" }, declared("Write", "file_path"))).toEqual({ file_path: "a", path: "b" });
  });
});

describe("9router #4413 - Responses output cap floor on OpenCode routes", () => {
  const responsesModel = (alias) => PROVIDER_MODELS[alias].find((model) => model.targetFormat === "openai-responses").id;
  const input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }];

  it.each([
    ["opencode-go", () => new OpenCodeGoExecutor()],
    ["opencode-zen", () => new OpenCodeZenExecutor()],
  ])("raises a too-small cap to 16 on %s and never invents one", (provider, build) => {
    const model = responsesModel(provider);
    const send = (extra) => build().transformRequest(model, { model, input, ...extra }, true, {}).max_output_tokens;

    expect(send({ max_output_tokens: 1 })).toBe(16);
    expect(send({ max_output_tokens: 16 })).toBe(16);
    expect(send({ max_output_tokens: 4096 })).toBe(4096);
    expect(send({})).toBeUndefined();
  });

  // The 64-character tool-name aliases (#4545) travel on the same body as the floor.
  it.each([
    ["opencode-go", () => new OpenCodeGoExecutor()],
    ["opencode-zen", () => new OpenCodeZenExecutor()],
  ])("keeps the tool-name map on %s when a retry reuses a floored body", (provider, build) => {
    const model = responsesModel(provider);
    const name = `tool_${"x".repeat(80)}`;
    const body = { model, input, max_output_tokens: 1, tools: [{ type: "function", name, parameters: { type: "object", properties: {} } }] };
    const executor = build();

    for (const attempt of [1, 2]) {
      const sent = executor.transformRequest(model, body, true, {});

      expect(sent.max_output_tokens, `attempt ${attempt}`).toBe(16);
      expect([...(sent._toolNameMap?.values() || [])], `attempt ${attempt}`).toEqual([name]);
    }
  });

  it("applies the floor to a Chat max_tokens that OpenCode Go renames", () => {
    const model = responsesModel("opencode-go");
    const sent = new OpenCodeGoExecutor().transformRequest(model, { model, input, max_tokens: 5 }, true, {});

    expect(sent.max_output_tokens).toBe(16);
    expect(sent.max_tokens).toBeUndefined();
  });
});
