/**
 * Regression: Codex replays raw streamed args verbatim. A partial-fragment or
 * freeform-text string lands in `function.arguments` and upstream rejects the
 * chat/completions body with HTTP 400 "function.arguments must be valid JSON".
 * Guard lives in two places:
 *   1. `ensureToolCallIds` (toolCall.js) - global, covers any chat-shaped body.
 *   2. Responses to Chat translator (openai-responses.js) - catches the Codex
 *      Responses-path leak at translation time before ensureToolCallIds.
 */
import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { ensureToolCallIds } from "../../open-sse/translator/concerns/toolCall.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { buildDeclaredToolTypes } from "../../open-sse/translator/formats/responsesApi.js";
import { sanitizeResponsesItems } from "../../open-sse/executors/opencode-go.js";

// ---------- toolCall.js ensureToolCallIds ----------
describe("ensureToolCallIds: arguments JSON coercion", () => {
  const makeBody = (args) => ({
    messages: [
      {
        role: "assistant",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "fn", arguments: args } },
        ],
      },
    ],
  });

  it("valid JSON string passes through unchanged", () => {
    const body = makeBody('{"key":"val"}');
    ensureToolCallIds(body);
    expect(body.messages[0].tool_calls[0].function.arguments).toBe('{"key":"val"}');
  });

  it("malformed JSON string coerced to {}", () => {
    const body = makeBody('{"city":');
    ensureToolCallIds(body);
    expect(body.messages[0].tool_calls[0].function.arguments).toBe("{}");
  });

  it("freeform text coerced to {}", () => {
    const body = makeBody("San Francisco");
    ensureToolCallIds(body);
    expect(body.messages[0].tool_calls[0].function.arguments).toBe("{}");
  });

  it("object coerced to stringified JSON", () => {
    const body = makeBody({ city: "SF" });
    ensureToolCallIds(body);
    expect(body.messages[0].tool_calls[0].function.arguments).toBe('{"city":"SF"}');
  });

  // apply_patch is the freeform custom tool (#4208 review): its raw patch text must
  // survive a chat replay instead of collapsing to "{}" and losing the patch body.
  it("apply_patch raw patch body wrapped as JSON input, not dropped to {}", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "apply_patch", arguments: "*** Begin Patch" } },
          ],
        },
      ],
    };
    ensureToolCallIds(body);
    expect(body.messages[0].tool_calls[0].function.arguments).toBe(JSON.stringify({ input: "*** Begin Patch" }));
  });

  // #4208 review round 2 (HIGH, toolCall.js:281): a raw custom-tool body the
  // Responses stream stored (openai-responses.js:651) must survive chat
  // replay for ANY declared custom tool, not just apply_patch by name.
  it("declared custom tool (not apply_patch) raw body wrapped, not dropped to {}", () => {
    const body = {
      tools: [{ type: "custom", name: "draft_note" }],
      messages: [
        {
          role: "assistant",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "draft_note", arguments: "remember to feed the cat" } },
          ],
        },
      ],
    };
    ensureToolCallIds(body);
    expect(body.messages[0].tool_calls[0].function.arguments).toBe(JSON.stringify({ input: "remember to feed the cat" }));
  });

  // #4208 review round 2 (MEDIUM, toolCall.js:281 vs responsesApi.js:97): a
  // request that declares "apply_patch" as an ordinary function must never
  // freeform-wrap it — matches isCustomToolByState, where a function
  // declaration wins over the legacy name check.
  it("apply_patch declared as a function is never freeform-wrapped", () => {
    const body = {
      tools: [{ type: "function", function: { name: "apply_patch" } }],
      messages: [
        {
          role: "assistant",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "apply_patch", arguments: '{"path":' } },
          ],
        },
      ],
    };
    ensureToolCallIds(body);
    expect(body.messages[0].tool_calls[0].function.arguments).toBe("{}");
  });
});

// ---------- Responses to Chat translator ----------
describe("Responses to Chat: malformed arguments coerced at translation", () => {
  const inputWithArgs = (args) => ({
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "function_call", call_id: "call_abc", name: "get_weather", arguments: args },
    ],
  });

  it("valid JSON string preserved", () => {
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "gpt-4o", inputWithArgs('{"city":"NYC"}'));
    const assistant = result.messages.find((m) => m.tool_calls);
    expect(assistant.tool_calls[0].function.arguments).toBe('{"city":"NYC"}');
  });

  it("malformed string coerced to {}", () => {
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "gpt-4o", inputWithArgs('{"city":'));
    const assistant = result.messages.find((m) => m.tool_calls);
    expect(assistant.tool_calls[0].function.arguments).toBe("{}");
  });

  it("object coerced to stringified JSON", () => {
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "gpt-4o", inputWithArgs({ city: "SF" }));
    const assistant = result.messages.find((m) => m.tool_calls);
    expect(assistant.tool_calls[0].function.arguments).toBe('{"city":"SF"}');
  });

  // Any declared Responses "custom" tool (not just apply_patch) must keep its
  // raw freeform body instead of losing it to "{}" (#4208 review follow-up).
  it("declared custom tool's raw body wrapped as JSON input, not dropped to {}", () => {
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "gpt-4o", {
      tools: [{ type: "custom", name: "draft_note" }],
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
        { type: "function_call", call_id: "call_note", name: "draft_note", arguments: "remember to feed the cat" },
      ],
    });
    const assistant = result.messages.find((m) => m.tool_calls);
    expect(assistant.tool_calls[0].function.arguments).toBe(JSON.stringify({ input: "remember to feed the cat" }));
  });

  // #4208 review round 2 (MEDIUM, responsesApi.js:97): apply_patch declared
  // as an ordinary function must lose to that declaration, matching
  // isCustomToolByState (response/openai-responses.js:412) where a function
  // declaration always wins over the legacy apply_patch name fallback.
  it("apply_patch declared as a function is never freeform-wrapped", () => {
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "gpt-4o", {
      tools: [{ type: "function", name: "apply_patch" }],
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
        { type: "function_call", call_id: "call_ap", name: "apply_patch", arguments: '{"path":' },
      ],
    });
    const assistant = result.messages.find((m) => m.tool_calls);
    expect(assistant.tool_calls[0].function.arguments).toBe("{}");
  });
});

// ---------- buildDeclaredToolTypes (#4208 review round 3) ----------
describe("buildDeclaredToolTypes", () => {
  // HIGH: a Responses "custom" tool can nest its name under `function` (the
  // same shape initState records at translator/index.js:344), not just the
  // flat {type,name} shape. Missing this dropped the tool's declared status.
  it("reads a name nested under function, even for a custom tool", () => {
    const declared = buildDeclaredToolTypes([{ type: "custom", function: { name: "custom_tool" } }]);
    expect(declared.get("custom_tool")).toBe("custom");
  });

  // A typeless entry (no declared `type`) must not be recorded — matches
  // initState, which only records a tool when both name AND type are present.
  // Otherwise a typeless {name:"apply_patch"} would silently suppress the
  // legacy apply_patch name fallback for an undeclared tool.
  it("does not record a tool with no declared type", () => {
    const declared = buildDeclaredToolTypes([{ name: "apply_patch" }]);
    expect(declared.has("apply_patch")).toBe(false);
  });

  // MEDIUM: isObject(null) is true, so a naive `isObject(tool.function)` guard
  // would still attempt `.name` on a null `function` field and throw. Optional
  // chaining must make this a no-op instead of a crash.
  it("does not throw when a tool's function field is null", () => {
    expect(() => buildDeclaredToolTypes([{ type: "function", function: null }])).not.toThrow();
    const declared = buildDeclaredToolTypes([{ type: "function", function: null, name: "fallback_name" }]);
    expect(declared.get("fallback_name")).toBe("function");
  });
});

// ---------- opencode-go.js sanitizeResponsesItems (#4208 review round 3) ----------
describe("sanitizeResponsesItems: declared tool argument coercion", () => {
  // MEDIUM: native Responses passthrough (sourceFormat === targetFormat) skips
  // the request translator entirely, so this was the one place still calling
  // coerceResponsesArguments with no name/declaration — losing a declared
  // custom tool's raw body on the native path.
  it("preserves a declared custom tool's raw body instead of dropping to {}", () => {
    const body = {
      tools: [{ type: "custom", name: "draft_note" }],
      input: [
        { type: "function_call", call_id: "call_note", name: "draft_note", arguments: "remember to feed the cat" },
      ],
    };
    sanitizeResponsesItems(body);
    expect(body.input[0].arguments).toBe(JSON.stringify({ input: "remember to feed the cat" }));
  });

  it("apply_patch declared as a function is never freeform-wrapped", () => {
    const body = {
      tools: [{ type: "function", name: "apply_patch" }],
      input: [
        { type: "function_call", call_id: "call_ap", name: "apply_patch", arguments: '{"path":' },
      ],
    };
    sanitizeResponsesItems(body);
    expect(body.input[0].arguments).toBe("{}");
  });
});
