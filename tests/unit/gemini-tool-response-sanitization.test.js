import { describe, expect, it } from "vitest";
import { openaiToAntigravityRequest, openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { claudeToGeminiRequest } from "../../open-sse/translator/request/claude-to-gemini.js";
import { sanitizeFunctionResponseResult } from "../../open-sse/translator/formats/gemini.js";

const result = {
  "$ref": "x",
  definitions: { nested: [{ "a/b": 1, "#c": 2 }, 3, null] },
  u: "http://x/#/$defs/a",
};
const sanitizedResult = {
  _ref: "x",
  _definitions: { nested: [{ a_b: 1, _c: 2 }, 3, null] },
  u: "http://x/#/$defs/a",
};

function openAIRequest(model = "gemini-test", toolResult = result) {
  return openaiToGeminiRequest(model, {
    messages: [
      {
        role: "assistant",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "lookup", arguments: '{"$literal":1}' },
        }],
      },
      { role: "tool", tool_call_id: "call_1", content: JSON.stringify(toolResult) },
    ],
  }, false);
}

function findPart(contents, key) {
  return contents.flatMap((content) => content.parts).find((part) => part[key])?.[key];
}

describe("Gemini functionResponse result sanitization", () => {
  it("rewrites forbidden result keys recursively without changing arguments, arrays, or scalars", () => {
    const request = openAIRequest();

    expect(findPart(request.contents, "functionResponse").response.result).toEqual(sanitizedResult);
    expect(findPart(request.contents, "functionCall").args).toEqual({ "$literal": 1 });
  });

  it("sanitizes the Antigravity Claude functionResponse construction path without changing arguments", () => {
    const request = openaiToAntigravityRequest("claude-test", {
      messages: [
        {
          role: "assistant",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "lookup", arguments: '{"$literal":1}' },
          }],
        },
        { role: "tool", tool_call_id: "call_1", content: JSON.stringify(result) },
      ],
    }, false);

    expect(findPart(request.request.contents, "functionResponse").response.result).toEqual(sanitizedResult);
    expect(findPart(request.request.contents, "functionCall").args).toEqual({ "$literal": 1 });
  });

  it("sanitizes the direct Claude-to-Gemini functionResponse construction path", () => {
    const request = claudeToGeminiRequest("gemini-test", {
      messages: [
        {
          role: "assistant",
          content: [{
            type: "tool_use",
            id: "toolu_1",
            name: "lookup",
            input: { "$literal": 1 },
            thoughtSignature: "signature",
          }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: JSON.stringify(result) }],
        },
      ],
    }, false);

    expect(findPart(request.contents, "functionResponse").response.result).toEqual(sanitizedResult);
    expect(findPart(request.contents, "functionCall").args).toEqual({ "$literal": 1 });
  });

  it("preserves __proto__ as own response data without polluting the result prototype", () => {
    const payload = JSON.parse('{"__proto__":{"secret":"leak"},"keep":2}');
    const request = openAIRequest("gemini-test", payload);
    const sanitized = findPart(request.contents, "functionResponse").response.result;

    expect(Object.hasOwn(sanitized, "__proto__")).toBe(true);
    expect(sanitized.__proto__).toEqual({ secret: "leak" });
    expect(sanitized.secret).toBeUndefined();
    expect(Object.getPrototypeOf(sanitized)).toBeNull();
    expect(JSON.stringify(sanitized)).toBe('{"__proto__":{"secret":"leak"},"keep":2}');
  });

  it("keeps a 3000-deep array result servable", () => {
    let payload = "leaf";
    for (let depth = 0; depth < 3000; depth++) payload = [payload];

    let request;
    expect(() => {
      request = openAIRequest("gemini-test", payload);
      JSON.stringify(request);
    }).not.toThrow();
    expect(findPart(request.contents, "functionResponse").response.result).toBeInstanceOf(Array);
  });

  it("bounds traversal of cyclic values", () => {
    const cyclic = {};
    cyclic.self = cyclic;

    expect(() => sanitizeFunctionResponseResult(cyclic)).not.toThrow();
  });

  it("preserves colliding siblings under deterministic suffixed keys", () => {
    const forward = sanitizeFunctionResponseResult({ "$ref": "A", _ref: "B" });
    const reversed = sanitizeFunctionResponseResult({ _ref: "B", "$ref": "A" });
    const definitions = sanitizeFunctionResponseResult({ definitions: 1, _definitions: 2 });

    expect({ ...forward }).toEqual({ _ref_2: "A", _ref: "B" });
    expect({ ...reversed }).toEqual({ _ref: "B", _ref_2: "A" });
    expect({ ...definitions }).toEqual({ _definitions_2: 1, _definitions: 2 });
  });
});
