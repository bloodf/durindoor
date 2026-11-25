import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { buildGeminiToolParameters } from "../../open-sse/translator/formats/gemini.js";
import { stripCodexUnsupportedPatterns } from "../../open-sse/utils/codexToolSchema.js";

// Native Responses passthrough: the tools reach the executor as the client wrote them.
function dispatchedTools(tools) {
  const body = new CodexExecutor().transformRequest("gpt-5.5", {
    model: "gpt-5.5",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "probe" }] }],
    tools,
    stream: true,
  }, true, { connectionId: "codex-tool-shapes", providerSpecificData: {} });
  return body.tools;
}

describe("9router #4442 - free-form property values and tuple items in tool schemas", () => {
  it("turns bare type names into schemas for Codex, including nested ones", () => {
    const [tool] = dispatchedTools([{
      type: "function",
      name: "jira_get_issue",
      parameters: {
        type: "object",
        properties: {
          value: "object",
          odd: "not-a-type",
          missing: null,
          anything: true,
          list: { type: "array", items: { type: "object", properties: { inner: "integer" } } },
          tags: { type: "array", items: "string" },
          properties: { type: "object", properties: { inner: "boolean" } },
        },
        required: ["value"],
      },
    }]);

    expect(tool.parameters.properties).toEqual({
      value: { type: "object" },
      odd: { type: "string" },
      missing: { type: "string" },
      // A boolean subschema is valid and must keep its meaning.
      anything: true,
      list: { type: "array", items: { type: "object", properties: { inner: { type: "integer" } } } },
      tags: { type: "array", items: { type: "string" } },
      properties: { type: "object", properties: { inner: { type: "boolean" } } },
    });
    expect(tool.parameters.required).toEqual(["value"]);
  });

  it("collapses a Codex tuple to its most informative member, or drops it", () => {
    const [tool] = dispatchedTools([{
      type: "function",
      name: "set_range",
      parameters: {
        type: "object",
        properties: {
          mixed: { type: "array", items: [{ type: "string" }, { type: "array", items: { type: "string" } }, { type: "object", properties: { k: "string" } }] },
          junk: { type: "array", items: [null, "not-a-schema"] },
        },
      },
    }]);

    expect(tool.parameters.properties.mixed.items).toEqual({ type: "object", properties: { k: { type: "string" } } });
    expect(tool.parameters.properties.junk).toEqual({ type: "array" });
  });

  it("coerces the same shapes inside Codex namespace tools", () => {
    const [namespace] = dispatchedTools([{
      type: "namespace",
      name: "atlassian",
      tools: [{ type: "function", name: "jira_search", parameters: { type: "object", properties: { value: "object" } } }],
    }]);

    expect(namespace.tools[0].parameters.properties.value).toEqual({ type: "object" });
  });

  it("leaves annotation data alone and keeps the reference of a compatible schema", () => {
    const schema = {
      type: "object",
      properties: { config: { type: "object", default: { properties: { a: "string" }, items: [1, 2] } } },
    };

    expect(stripCodexUnsupportedPatterns(schema)).toBe(schema);
  });

  it.each([
    ["without a type", {}],
    ["with a nullable array type list", { type: ["array", "null"] }],
  ])("never sends Gemini a list-valued items for a tuple %s", (_label, extra) => {
    const cleaned = buildGeminiToolParameters({
      type: "object",
      properties: { range: { ...extra, items: [{ type: "number" }, { type: "integer" }] } },
    }, "set_range");

    expect(cleaned.properties.range.type).toBe("array");
    expect(Array.isArray(cleaned.properties.range.items)).toBe(false);
    expect(cleaned.properties.range.items.type).toBeTruthy();
  });
});
