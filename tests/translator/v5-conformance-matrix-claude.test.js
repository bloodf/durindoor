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
    // prepareClaudeRequest strips user-block cache_control by design; only system/tools/last assistant keep it.
    expect(out.messages[0].content[0].cache_control).toBeUndefined();
  });

  it("already-present: OpenAI source cache_control survives Claude target", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", {
      messages: [
        { role: "system", content: [{ type: "text", text: "rules", cache_control: { type: "ephemeral" } }] },
        { role: "user", content: [{ type: "text", text: "find", cache_control: { type: "ephemeral" } }] },
      ],
    }, false);
    const blocks = [...(out.system || []), ...out.messages.flatMap((m) => m.content)];
    expect(blocks.some((b) => b.cache_control?.type === "ephemeral")).toBe(true);
  });

  const streamTo = (stopReason, withStop = true) => {
    const state = initState(FORMATS.CLAUDE);
    const events = [
      { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "x", content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 2 } },
      ...(withStop ? [{ type: "message_stop" }] : []),
    ];
    return events.flatMap((e) => translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, e, state) || []);
  };

  it("already-present: Claude stop_reason maps to OpenAI finish_reason", () => {
    const chunks = streamTo("max_tokens");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("length");
  });

  it("already-present: Claude stream terminal completes OpenAI stream with one finish", () => {
    const chunks = streamTo("end_turn");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
    expect(chunks.filter((c) => c.choices?.[0]?.finish_reason).length).toBe(1);
  });
});
