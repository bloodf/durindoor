import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("#1089 Claude Messages client conformance", () => {
  it("already-present: Claude tool input_schema and cache_control survive Claude target", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, "claude-sonnet-4-5", {
      max_tokens: 100,
      system: [{ type: "text", text: "rules", cache_control: { type: "ephemeral" } }],
      tools: [{ name: "ns.search", description: "find", input_schema: { type: "object", properties: { q: { type: "string" } } }, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: "find", cache_control: { type: "ephemeral" } }] }],
    }, false);
    expect(out.tools[0].input_schema.properties.q.type).toBe("string");
    expect(out.tools[0].cache_control.type).toBe("ephemeral");
    expect(out.system[0].cache_control.type).toBe("ephemeral");
    expect(out.messages[0].content[0].cache_control.type).toBe("ephemeral");
  });

  it("already-present: Claude stop_reason maps to OpenAI finish_reason", () => {
    const out = translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, {
      id: "msg_1", type: "message", role: "assistant", model: "m", content: [], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 2 },
    }, initState(FORMATS.CLAUDE));
    expect(out.choices[0].finish_reason).toBe("length");
  });

  it("already-present: Claude stream message_stop completes OpenAI stream", () => {
    const state = initState(FORMATS.CLAUDE);
    translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "x", content: [], usage: { input_tokens: 1, output_tokens: 0 } } }, state);
    translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }, state);
    const out = translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, { type: "message_stop" }, state);
    expect(out.at(-1).choices[0].finish_reason).toBe("stop");
  });
});
