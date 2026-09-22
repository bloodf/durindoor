// Real Codex CLI requests (OpenAI Responses API: { input:[], instructions }) → providers.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const R2O = (body) => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", body, true, null, null);
const O2R = (body) => translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", body, true, null, null);

describe("Codex CLI Responses → OpenAI", () => {
  // openai-responses.js — function_call items with an empty name are skipped (#444).
  // That used to leave `tool_calls: []` on the assistant turn, and OpenAI/Codex
  // reject an empty tool_calls array. The turn now ends up with nothing in it, so
  // it is not emitted at all rather than as `{role:"assistant", content:null}`.
  it("emits no assistant message when every tool call has an empty name", () => {
    const out = R2O({
      input: [
        { type: "function_call", call_id: "c1", name: "", arguments: "{}" },
      ],
    });
    const assistants = out.messages.filter((m) => m.role === "assistant");
    expect(assistants, "assistant message with an empty turn").toHaveLength(0);
  });

  // openai-responses.js:109-110 — arguments passed through without ensuring string type
  // KNOWN BUG
  it.fails("function_call arguments end up as a string", () => {
    const out = R2O({
      input: [{ type: "function_call", call_id: "c1", name: "f", arguments: { a: 1 } }],
    });
    const asst = out.messages.find((m) => m.tool_calls);
    expect(typeof asst.tool_calls[0].function.arguments).toBe("string");
  });

  // openai-responses.js:75-77 — input_image uses file_id as raw url
  // KNOWN BUG
  it.fails("input_image with file_id is not used as a raw url", () => {
    const out = R2O({
      input: [{ type: "message", role: "user", content: [
        { type: "input_image", file_id: "file-abc" },
      ] }],
    });
    const userMsg = out.messages.find((m) => m.role === "user");
    const img = Array.isArray(userMsg?.content) ? userMsg.content.find((c) => c.type === "image_url") : null;
    // A bare file_id is not a valid image URL
    expect(img?.image_url?.url === "file-abc").toBe(false);
  });

  // The unit-level openaiResponsesToOpenAIRequest test only checks the merged
  // shape before filterToOpenAIFormat runs. On the real wire path,
  // filterToOpenAIFormat returns an assistant message untouched whenever
  // tool_calls is non-empty, so a text-only content array never gets
  // collapsed to a string and ships as `[{type:"text",...}]`. String-only
  // thinking backends reject that shape.
  it("collapses assistant text content to a string when tool_calls are present", () => {
    const out = R2O({
      input: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "checking now" }] },
        { type: "function_call", call_id: "call_1", name: "exec_command", arguments: "{}" },
      ],
    });
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content).toBe("checking now");
  });

  // A turn can carry more than one assistant `message` item (text, then a
  // tool call, then more text). Only the first non-null content used to
  // survive; the second was silently dropped.
  it("keeps text from a second assistant message on the same turn", () => {
    const out = R2O({
      input: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "first" }] },
        { type: "function_call", call_id: "call_1", name: "exec_command", arguments: "{}" },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "second" }] },
      ],
    });
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content).toBe("first\nsecond");
  });

  // A skipped (nameless) function_call never becomes a tool_calls entry, so
  // its function_call_output must not survive either — otherwise a lone
  // "tool" message references a tool_call_id nothing in the request declared.
  it("drops the tool output that answers a skipped nameless call", () => {
    const out = R2O({
      input: [
        { type: "function_call", call_id: "c1", name: "", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "ignored" },
      ],
    });
    expect(out.messages.find((m) => m.role === "tool")).toBeUndefined();
    expect(out.messages.find((m) => m.role === "assistant")).toBeUndefined();
  });

  // A turn with only reasoning (its one tool call was skipped as nameless)
  // must not ship content:null — OpenAI-shaped APIs reject that combination.
  it("normalizes content to an empty string when only reasoning survives a turn", () => {
    const out = R2O({
      input: [
        { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] },
        { type: "function_call", call_id: "c1", name: "  ", arguments: "{}" },
      ],
    });
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant.content).toBe("");
    expect(assistant.reasoning_content).toBe("thinking");
  });

  // collapseTextParts([]) returns [] as-is (its guard requires length > 0), so
  // an assistant message whose content array is already empty ships as
  // `{content:[], tool_calls:[...]}` once a tool call is present. Array
  // content next to tool_calls must be null, not an empty array.
  it("normalizes an empty content array to null when tool_calls are present", () => {
    const out = R2O({
      input: [
        { type: "message", role: "assistant", content: [] },
        { type: "function_call", call_id: "call_1", name: "exec_command", arguments: "{}" },
      ],
    });
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(Array.isArray(assistant.content)).toBe(false);
  });

  // A "refusal" or other non-whitelisted part sitting beside text in an
  // assistant turn with tool_calls skips filterToOpenAIFormat's whitelist
  // filter (that pass returns early whenever tool_calls is non-empty), so it
  // used to survive on the wire next to the collapsed text.
  it("drops non-whitelisted content parts from a tool-calling assistant turn", () => {
    const out = R2O({
      input: [
        { type: "message", role: "assistant", content: [
          { type: "refusal", refusal: "no" },
          { type: "output_text", text: "checking now" },
        ] },
        { type: "function_call", call_id: "call_1", name: "exec_command", arguments: "{}" },
      ],
    });
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content).toBe("checking now");
  });

  // A call_id that a nameless (skipped) function_call used can be reused by a
  // later NAMED function_call. That named call is real and gets a tool_calls
  // entry, so its function_call_output must survive too, not be dropped as
  // if it still answered the discarded nameless call.
  it("keeps the tool output for a call_id reused by a later named call", () => {
    const out = R2O({
      input: [
        { type: "function_call", call_id: "c1", name: "", arguments: "{}" },
        { type: "function_call", call_id: "c1", name: "exec_command", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "ran" },
      ],
    });
    const toolMsg = out.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toBe("ran");
  });

  // An assistant turn that starts with an empty-string content (a plain
  // string content item, not an array) must be REPLACED by later text, not
  // wrapped as a blank text part and joined — that produced a leading "\n".
  it("replaces an empty-string content instead of joining a blank line", () => {
    const out = R2O({
      input: [
        { type: "message", role: "assistant", content: "" },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "second" }] },
      ],
    });
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content).toBe("second");
  });

  // A blank-text part array (Responses text always arrives as parts, never a
  // bare "") must be treated the same as an empty string: replaced, not
  // wrapped and joined into a leading "\n".
  it("replaces a blank text-part-array content instead of joining a blank line", () => {
    const out = R2O({
      input: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "second" }] },
      ],
    });
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content).toBe("second");
  });

  // A blank content item arriving AFTER real text must be ignored, not
  // appended as a blank part that collapses into a trailing "\n".
  it("ignores a trailing blank content instead of appending a trailing newline", () => {
    const out = R2O({
      input: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "first" }] },
        { type: "message", role: "assistant", content: "" },
      ],
    });
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content).toBe("first");
  });

  // A call_id can be used by a NAMED call first, then reused by a nameless
  // one. The named call already put a real tool_calls entry on the turn, so
  // the id must not be marked skipped — that would drop the real output.
  it("keeps the tool output when a live tool_call already owns a call_id a later nameless call reuses", () => {
    const out = R2O({
      input: [
        { type: "function_call", call_id: "c1", name: "exec_command", arguments: "{}" },
        { type: "function_call", call_id: "c1", name: "", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "ran" },
      ],
    });
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.tool_calls).toEqual([{ id: "c1", type: "function", function: { name: "exec_command", arguments: "{}" } }]);
    const toolMsg = out.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toBe("ran");
  });

  // A skipped (nameless) call's output must still close out its own turn
  // before being dropped, or the next real assistant turn merges onto the
  // still-open one across the turn boundary the dropped output was meant to
  // mark.
  it("keeps two turns separate across a dropped skipped-call output", () => {
    const out = R2O({
      input: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "turn1" }] },
        { type: "function_call", call_id: "c1", name: "", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "ignored" },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "turn2" }] },
        { type: "function_call", call_id: "c2", name: "exec_command", arguments: "{}" },
        { type: "function_call_output", call_id: "c2", output: "ran" },
      ],
    });
    const assistants = out.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants[0].content).toBe("turn1");
    expect(assistants[0].tool_calls).toBeUndefined();
    expect(assistants[1].content).toBe("turn2");
    expect(assistants[1].tool_calls).toEqual([{ id: "c2", type: "function", function: { name: "exec_command", arguments: "{}" } }]);
    const toolMsg = out.messages.find((m) => m.role === "tool");
    expect(toolMsg.tool_call_id).toBe("c2");
    expect(toolMsg.content).toBe("ran");
  });
});

describe("OpenAI → Codex Responses (reverse)", () => {
  it("maps developer messages to Responses API instructions", () => {
    const out = O2R({
      messages: [
        { role: "developer", content: "Follow the project rules." },
        { role: "user", content: "Hello" },
      ],
    });

    expect(out.instructions).toBe("Follow the project rules.");
    expect(out.input).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] },
    ]);
  });

  // openai-responses.js:13 — clampCallId NOT applied on Responses→Chat; but here Chat→Responses must clamp
  it("call_id longer than 64 chars is clamped", () => {
    const longId = "call_" + "x".repeat(80);
    const out = O2R({
      messages: [
        { role: "assistant", content: null, tool_calls: [
          { id: longId, type: "function", function: { name: "f", arguments: "{}" } },
        ] },
        { role: "tool", tool_call_id: longId, content: "ok" },
      ],
    });
    const fc = out.input.find((i) => i.type === "function_call");
    expect(fc.call_id.length).toBeLessThanOrEqual(64);
  });
});
