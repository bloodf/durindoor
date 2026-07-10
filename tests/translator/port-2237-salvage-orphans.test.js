// Regression for upstream decolua/9router#2237 — orphaned tool results across formats.
// One test per envelope; every assertion defends the non-lossy salvage contract:
// orphan text is folded into user text (`[Tool result: ...]`) rather than dropped,
// and no synthetic tool_call/tool_result id is invented for orphan-only history.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { salvageOrphanedToolResults } from "../../open-sse/translator/concerns/toolCall.js";

describe("port #2237: salvage orphaned tool results across formats", () => {
  it("OpenAI messages[]: orphaned role:tool folds into user text, not dropped", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        // assistant turn that owned call_1 was truncated away → orphan below
        { role: "tool", tool_call_id: "call_1", content: "the answer is 42" },
        { role: "user", content: "thanks" },
      ],
    };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "m", body);
    const json = JSON.stringify(out);
    expect(json, "orphan tool output lost").toContain("the answer is 42");
    expect(json, "orphan not surfaced as user text").toContain("[Tool result: the answer is 42]");
    // No synthetic id invented for the orphan
    expect(out.messages.some((m) => m.tool_call_id === "call_1"), "stale tool_call_id survived").toBe(false);
  });

  it("Claude messages[]: orphaned tool_result block salvaged to text, kept paired ones intact", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "keep_1", name: "f", input: {} }] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "keep_1", content: "ok" },
          { type: "tool_result", tool_use_id: "gone_1", content: "lost output" },
        ] },
      ],
    };
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", body);
    const json = JSON.stringify(out);
    expect(json, "paired tool_result dropped").toContain("keep_1");
    expect(json, "orphan text lost").toContain("lost output");
    expect(json, "orphan not folded to text").toContain("[Tool result: lost output]");
  });

  it("consecutive same-role user messages merge after salvage (Gemini 400 guard)", () => {
    const out = salvageOrphanedToolResults({
      messages: [
        { role: "user", content: "before" },
        { role: "tool", tool_call_id: "orphan", content: "payload" },
        { role: "user", content: "after" },
      ],
    });
    const users = out.messages.filter((m) => m.role === "user");
    // Exactly one merged string user turn; adjacent users must not survive
    // (openai-to-gemini would otherwise emit consecutive user turns → 400).
    expect(users, "adjacent user turns not merged").toHaveLength(1);
    expect(users[0].content).toBe("before\n[Tool result: payload]\nafter");
  });

  it("Gemini contents[]: orphaned functionResponse salvaged to text part; paired kept", () => {
    const body = {
      contents: [
        { role: "model", parts: [{ functionCall: { id: "fc_1", name: "f", args: {} } }] },
        { role: "user", parts: [
          { functionResponse: { id: "fc_1", name: "f", response: { result: "paired" } } },
          { functionResponse: { id: "fc_orphan", name: "g", response: { result: "dropped output" } } },
        ] },
      ],
    };
    const out = salvageOrphanedToolResults(body);
    const json = JSON.stringify(out);
    expect(json, "paired functionResponse dropped").toContain("fc_1");
    expect(json, "orphan response text lost").toContain("dropped output");
    expect(json, "orphan not folded to text part").toContain("[Tool result: dropped output]");
  });

  it("orphan-only history invents no synthetic tool_call or tool_result id", () => {
    const out = salvageOrphanedToolResults({
      messages: [
        { role: "user", content: "ctx" },
        { role: "tool", tool_call_id: "ghost", content: "stale" },
      ],
    });
    expect(out.messages.some((m) => m.tool_call_id === "ghost"), "ghost id survived").toBe(false);
    expect(out.messages.some((m) => m.role === "assistant" && m.tool_calls), "synthetic assistant call invented").toBe(false);
    expect(JSON.stringify(out)).toContain("[Tool result: stale]");
  });

  it("Responses API input[]: orphaned function_call_output is structurally stripped (not salvaged)", () => {
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", {
      input: [
        { type: "message", role: "user", content: "hi" },
        { type: "function_call_output", call_id: "missing_call", output: "stale" },
      ],
    });
    const json = JSON.stringify(out);
    expect(json, "orphaned function_call_output forwarded").not.toContain("missing_call");
  });

  // Guards the Gemini-family skip in translator/index.js: salvage MUST NOT run
  // on native contents[] before gemini->openai conversion, otherwise it rewrites
  // legitimate functionResponses (keyed per-part) into `[Tool result: ...]` text
  // because its global knownCall set never contains sibling parts. Asserts BOTH
  // that the input object is byte-for-byte unchanged (salvage never touched it)
  // and that the translated OpenAI output still emits the tool result.
  it("Gemini native contents[]: salvage skipped — input unchanged, tool result survives translation", () => {
    const body = {
      contents: [
        { role: "user", parts: [{ text: "run both" }] },
        {
          role: "model",
          parts: [
            { functionCall: { id: "call_a", name: "tool_a", args: { x: 1 } } },
            { functionCall: { id: "call_b", name: "tool_b", args: { y: 2 } } },
          ],
        },
        {
          role: "user",
          parts: [
            { functionResponse: { id: "call_a", name: "tool_a", response: { result: "A" } } },
            { functionResponse: { id: "call_b", name: "tool_b", response: { result: "B" } } },
          ],
        },
      ],
    };
    const before = JSON.stringify(body);
    const out = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, "gemini-pro", body, false);
    expect(JSON.stringify(body), "salvage mutated native Gemini contents[] before conversion").toBe(before);
    const toolMsgs = out.messages.filter((m) => m.role === "tool");
    expect(toolMsgs, "both functionResponses must survive as role:tool messages").toHaveLength(2);
    expect(toolMsgs.map((m) => m.tool_call_id).sort()).toEqual(["call_a", "call_b"]);
  });

  it("Gemini native contents[]: co-located functionCall+functionResponse not collapsed to text", () => {
    // Regression for run 29122517702: one content with functionCall(call_a)
    // plus functionResponse(call_b) — salvage keyed call_b as orphan against
    // the {call_a} set and rewrote it to text, dropping the role:tool message.
    const body = {
      contents: [
        {
          role: "model",
          parts: [
            { functionCall: { id: "call_a", name: "tool_a", args: {} } },
            { functionResponse: { id: "call_b", name: "tool_b", response: { result: "B" } } },
          ],
        },
      ],
    };
    const before = JSON.stringify(body);
    const out = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, "gemini-pro", body, false);
    expect(JSON.stringify(body)).toBe(before);
    expect(out.messages.find((m) => m.role === "tool"), "call_b functionResponse must survive").toBeDefined();
    expect(out.messages.find((m) => m.role === "assistant" && m.tool_calls), "call_a tool_call must survive").toBeDefined();
  });
});
