import { expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

it("sanitizes native Antigravity function responses without losing payload data or mutating the request", () => {
  const response = {
    nested: [{ "$ref": "kept-data", count: 0, enabled: false, empty: null }],
    object: { nested: { "$ref": "object-data", _ref: "legal-sibling" } },
    values: [1, "http://example.test/#/$ref", false, null],
  };
  const body = {
    model: "gemini-2.5-pro",
    request: {
      sessionId: "123",
      contents: [{
        role: "user",
        parts: [
          { text: "Keep surrounding content" },
          { functionResponse: { id: "x", name: "tool", response } },
          { functionResponse: { id: "y", name: "other_tool", response: { result: [{ "$ref": "second" }] } } },
        ],
      }],
    },
  };
  const original = structuredClone(body);
  const output = new AntigravityExecutor().transformRequest(
    "gemini-2.5-pro", body, false, { projectId: "isolated" },
  );

  expect(output.request.contents).toEqual([{
    role: "user",
    parts: [
      { text: "Keep surrounding content" },
      { functionResponse: {
        id: "x",
        name: "tool",
        response: {
          nested: [{ _ref: "kept-data", count: 0, enabled: false, empty: null }],
          object: { nested: { _ref_2: "object-data", _ref: "legal-sibling" } },
          values: [1, "http://example.test/#/$ref", false, null],
        },
      } },
      { functionResponse: { id: "y", name: "other_tool", response: { result: [{ _ref: "second" }] } } },
    ],
  }]);
  expect(body).toEqual(original);
  expect(output.request.contents[0].parts[1].functionResponse).not.toBe(body.request.contents[0].parts[1].functionResponse);
});
